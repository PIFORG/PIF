package com.pif.api.trading;

import com.pif.api.finance.InvalidSampleException;
import com.pif.api.finance.JsSemantics;
import com.pif.api.finance.Money;
import com.pif.api.finance.Performance;
import com.pif.api.finance.Performance.ValuationPoint;
import com.pif.api.finance.PreTrade.FeeSchedule;
import com.pif.api.finance.Risk;
import com.pif.api.finance.Valuation;
import com.pif.api.trading.TradingRules.ShockTarget;
import com.pif.api.trading.TradingRules.StressScenario;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.function.DoubleUnaryOperator;
import java.util.function.Function;

/**
 * Portfolio analytics (apps/api/src/trading/analytics.ts). Unavailable metrics carry a reason and are never reported
 * as 0. Outputs are insertion-ordered maps whose keys and number values match the TypeScript objects.
 */
public final class Analytics {

  private static final long DAY_MS = 86_400_000L;

  private Analytics() {}

  public record HoldingInput(String symbol, String name, String assetClass, String sector, double quantity,
      double costBasis, double mid, double bid, FeeSchedule fees) {}

  public record CashEntryInput(String type, double amount, double balanceAfter, Instant occurredAt) {}

  public record ExecutionInput(String symbol, String side, double quantity, Instant executedAt) {}

  /** {@code flows}: deposits minus withdrawals since the previous point. */
  public record EquityPoint(Instant at, double equity, double flows, double netContributions) {}

  /** An OPENING or CASH_FLOW snapshot: equity just before the flow, and the flow. */
  public record FlowPoint(double equity, double flowAfter, Instant at) {}

  /** {@code instrumentReturns}: daily simple returns per held symbol over the same dates, oldest first. */
  public record AnalyticsInput(Instant now, Instant createdAt, double cash, double reserved, double netContributions,
      double realizedPnl, double feesPaid, double spreadCost, List<HoldingInput> holdings, List<FlowPoint> flowPoints,
      List<EquityPoint> dailyEquity, Map<String, double[]> instrumentReturns, double cashLedgerSum,
      List<StressScenario> scenarios, DoubleUnaryOperator money) {}

  /** {@code [...].sort((a, b) => b - a)}: stable, descending, with −0 and +0 equal. */
  private static <T> Comparator<T> descending(Function<T, Double> value) {
    return (x, y) -> {
      double d = value.apply(y) - value.apply(x);
      return d > 0 ? 1 : d < 0 ? -1 : 0;
    };
  }

  private static Map<String, Object> metric(Object value, String unavailableReason, String requirement) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("value", value);
    m.put("unavailableReason", unavailableReason);
    m.put("requirement", requirement);
    return m;
  }

  private static Map<String, Object> available(Object value, String requirement) {
    return metric(value, null, requirement);
  }

  private static Map<String, Object> unavailable(String reason, String requirement) {
    return metric(null, reason, requirement);
  }

  /**
   * Rebuilds end-of-day equity from the cash ledger and executions, marking holdings at each daily close of the
   * price provider. The first point is the portfolio's funding at creation.
   */
  public static List<EquityPoint> reconstructDailyEquity(Instant createdAt, Instant now, double initialCapital,
      List<CashEntryInput> cashEntries, List<ExecutionInput> executions, BiFunction<String, Instant, Double> closeOf) {
    List<EquityPoint> points = new ArrayList<>();
    points.add(new EquityPoint(createdAt, initialCapital, 0, initialCapital));
    List<CashEntryInput> entries = new ArrayList<>(cashEntries);
    entries.sort(Comparator.comparing(CashEntryInput::occurredAt));
    List<ExecutionInput> fills = new ArrayList<>(executions);
    fills.sort(Comparator.comparing(ExecutionInput::executedAt));
    double cash = initialCapital;
    double contributions = initialCapital;
    int entryIndex = 0;
    int fillIndex = 0;
    Map<String, Double> held = new LinkedHashMap<>();
    while (entryIndex < entries.size() && !entries.get(entryIndex).occurredAt().isAfter(createdAt)) {
      cash = entries.get(entryIndex).balanceAfter();
      entryIndex++;
    }
    long first = Math.floorDiv(createdAt.toEpochMilli(), DAY_MS) * DAY_MS + DAY_MS;
    for (long close = first; close <= now.toEpochMilli(); close += DAY_MS) {
      Instant at = Instant.ofEpochMilli(close);
      double flows = 0;
      while (entryIndex < entries.size() && !entries.get(entryIndex).occurredAt().isAfter(at)) {
        CashEntryInput entry = entries.get(entryIndex++);
        cash = entry.balanceAfter();
        if ("DEPOSIT".equals(entry.type()) || "WITHDRAWAL".equals(entry.type())) {
          flows += entry.amount();
          contributions += entry.amount();
        }
      }
      while (fillIndex < fills.size() && !fills.get(fillIndex).executedAt().isAfter(at)) {
        ExecutionInput fill = fills.get(fillIndex++);
        held.put(fill.symbol(), held.getOrDefault(fill.symbol(), 0.0)
            + ("BUY".equals(fill.side()) ? fill.quantity() : -fill.quantity()));
      }
      double value = 0;
      for (Map.Entry<String, Double> h : held.entrySet()) {
        if (h.getValue() > 0) value += Money.notional(closeOf.apply(h.getKey(), at), h.getValue());
      }
      points.add(new EquityPoint(at, cash + value, flows, contributions));
    }
    return points;
  }

  /** Period returns assuming each period's flows arrive at its end: rₜ = (Vₜ − Fₜ) / Vₜ₋₁ − 1. */
  public static double[] periodReturns(List<EquityPoint> points) {
    List<Double> out = new ArrayList<>();
    for (int i = 1; i < points.size(); i++) {
      if (points.get(i - 1).equity() > 0) {
        out.add((points.get(i).equity() - points.get(i).flows()) / points.get(i - 1).equity() - 1);
      }
    }
    return out.stream().mapToDouble(Double::doubleValue).toArray();
  }

  public record Flow(double amount, Instant at) {}

  /**
   * Money-weighted return over the life of the portfolio (Modified Dietz): (V_end − ΣF) / Σ wᵢFᵢ with
   * wᵢ = (T − tᵢ) / T, where flows include the initial funding at t₀ (weight 1). Not annualised.
   */
  public static Double modifiedDietz(List<Flow> flows, Instant start, Instant end, double endValue) {
    double span = end.toEpochMilli() - start.toEpochMilli();
    if (span <= 0 || flows.isEmpty()) return null;
    double net = 0;
    for (Flow f : flows) net += f.amount();
    double weighted = 0;
    for (Flow f : flows) weighted += f.amount() * ((end.toEpochMilli() - f.at().toEpochMilli()) / span);
    return weighted > 0 ? (endValue - net) / weighted : null;
  }

  public static Map<String, Object> portfolioAnalytics(AnalyticsInput input) {
    DoubleUnaryOperator m = input.money() == null ? DoubleUnaryOperator.identity() : input.money();
    Map<String, Double> rawValues = new LinkedHashMap<>();
    for (HoldingInput h : input.holdings()) rawValues.put(h.symbol(), Money.notional(h.mid(), h.quantity()));
    Map<String, Double> values = JsSemantics.inPropertyOrder(rawValues);
    double positionsValue = Valuation.totalValue(values);
    double equity = input.cash() + positionsValue;
    double costBasis = 0;
    for (HoldingInput h : input.holdings()) costBasis += h.costBasis();
    double unrealizedPnl = positionsValue - costBasis;
    double liquidation = 0;
    for (HoldingInput h : input.holdings()) {
      double proceeds = Money.notional(h.bid(), h.quantity());
      liquidation = liquidation + proceeds - Money.commission(proceeds, h.fees().feeBps(), h.fees().minFee());
    }
    double liquidationValue = input.cash() + liquidation;

    Function<Function<HoldingInput, String>, List<Map<String, Object>>> byGroup = key -> {
      Map<String, Double> groups = new LinkedHashMap<>();
      for (HoldingInput h : input.holdings()) {
        groups.put(key.apply(h), groups.getOrDefault(key.apply(h), 0.0) + values.get(h.symbol()));
      }
      List<Map.Entry<String, Double>> sorted = new ArrayList<>(groups.entrySet());
      sorted.sort(descending(Map.Entry::getValue));
      List<Map<String, Object>> out = new ArrayList<>();
      for (Map.Entry<String, Double> g : sorted) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("name", g.getKey());
        row.put("value", m.applyAsDouble(g.getValue()));
        row.put("weight", equity > 0 ? g.getValue() / equity : null);
        out.add(row);
      }
      return out;
    };
    Valuation.Concentration conc = Valuation.concentration(values);

    List<ValuationPoint> twrPoints = new ArrayList<>();
    for (FlowPoint p : input.flowPoints()) twrPoints.add(new ValuationPoint(p.equity(), p.flowAfter()));
    twrPoints.add(new ValuationPoint(equity, 0));
    Double twr = Performance.timeWeightedReturn(twrPoints);
    List<Flow> flows = input.flowPoints().stream().map(p -> new Flow(p.flowAfter(), p.at())).toList();
    Double mwr = modifiedDietz(flows, input.createdAt(), input.now(), equity);
    double[] daily = periodReturns(input.dailyEquity());

    List<String> symbols = new ArrayList<>(values.keySet());
    int windowLength = 0;
    if (!symbols.isEmpty()) {
      windowLength = Integer.MAX_VALUE;
      for (String s : symbols) {
        double[] r = input.instrumentReturns().get(s);
        windowLength = Math.min(windowLength, r == null ? 0 : r.length);
      }
    }
    double[] pnl = new double[windowLength];
    for (int k = 0; k < windowLength; k++) {
      int offset = k;
      int window = windowLength;
      pnl[k] = Risk.scenarioPnl(values, s -> {
        double[] r = input.instrumentReturns().get(s);
        return r[r.length - window + offset];
      });
    }
    Risk.VarResult hs;
    boolean invalidSample = false;
    try {
      hs = Risk.historicalVaR(pnl, 0.95);
    } catch (InvalidSampleException e) {
      hs = null;
      invalidSample = true;
    }
    Double pnlSd = Risk.sampleStdDev(pnl);
    String varRequirement = "At least " + Risk.MIN_VAR_OBSERVATIONS + " daily returns for every held instrument "
        + "(up to 250 are used); 1-day horizon, 95 % confidence, current holdings, historical simulation.";
    boolean noHoldings = symbols.isEmpty();

    String realizedRequirement = "At least " + Risk.MIN_VOLATILITY_RETURNS
        + " complete days of portfolio history since creation.";
    List<Double> index = new ArrayList<>();
    index.add(1.0);
    for (double r : daily) index.add(index.get(index.size() - 1) * (1 + r));
    List<EquityPoint> dailyEquity = input.dailyEquity();
    EquityPoint lastDaily = dailyEquity.isEmpty() ? null : dailyEquity.get(dailyEquity.size() - 1);
    if (lastDaily != null && lastDaily.equity() > 0 && input.now().isAfter(lastDaily.at())) {
      double flowsSince = input.netContributions() - lastDaily.netContributions();
      index.add(index.get(index.size() - 1) * ((equity - flowsSince) / lastDaily.equity()));
    }
    Double dailyVol = Risk.sampleStdDev(daily);

    Map<String, Object> out = new LinkedHashMap<>();

    Map<String, Object> valuation = new LinkedHashMap<>();
    valuation.put("convention", "Holdings are marked at the mid price. Liquidation value sells every holding at the "
        + "bid and deducts the commission.");
    valuation.put("equity", m.applyAsDouble(equity));
    valuation.put("cash", m.applyAsDouble(input.cash()));
    valuation.put("reservedCash", m.applyAsDouble(input.reserved()));
    valuation.put("availableCash", m.applyAsDouble(input.cash() - input.reserved()));
    valuation.put("positionsValue", m.applyAsDouble(positionsValue));
    valuation.put("liquidationValue", m.applyAsDouble(liquidationValue));
    valuation.put("costBasis", m.applyAsDouble(costBasis));
    valuation.put("unrealizedPnl", m.applyAsDouble(unrealizedPnl));
    valuation.put("realizedPnl", m.applyAsDouble(input.realizedPnl()));
    valuation.put("feesPaid", m.applyAsDouble(input.feesPaid()));
    valuation.put("spreadCost", m.applyAsDouble(input.spreadCost()));
    out.put("valuation", valuation);

    Map<String, Object> reconciliation = new LinkedHashMap<>();
    reconciliation.put("description", "Equity − net contributions must equal realised + unrealised P&L. Commissions "
        + "are inside both: buy commissions in cost basis, sell commissions in proceeds.");
    reconciliation.put("equity", m.applyAsDouble(equity));
    reconciliation.put("netContributions", m.applyAsDouble(input.netContributions()));
    reconciliation.put("profit", m.applyAsDouble(equity - input.netContributions()));
    reconciliation.put("realizedPnl", m.applyAsDouble(input.realizedPnl()));
    reconciliation.put("unrealizedPnl", m.applyAsDouble(unrealizedPnl));
    reconciliation.put("difference",
        m.applyAsDouble(equity - input.netContributions() - input.realizedPnl() - unrealizedPnl));
    reconciliation.put("cashLedgerSum", m.applyAsDouble(input.cashLedgerSum()));
    reconciliation.put("cashMatchesLedger", input.cashLedgerSum() == input.cash());
    out.put("reconciliation", reconciliation);

    Map<String, Object> allocation = new LinkedHashMap<>();
    Map<String, Object> cashShare = new LinkedHashMap<>();
    cashShare.put("value", m.applyAsDouble(input.cash()));
    cashShare.put("weight", equity > 0 ? input.cash() / equity : null);
    allocation.put("cash", cashShare);
    List<HoldingInput> byValue = new ArrayList<>(input.holdings());
    byValue.sort(descending(h -> values.get(h.symbol())));
    List<Map<String, Object>> byInstrument = new ArrayList<>();
    for (HoldingInput h : byValue) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("name", h.symbol());
      row.put("label", h.name());
      row.put("value", m.applyAsDouble(values.get(h.symbol())));
      row.put("weight", equity > 0 ? values.get(h.symbol()) / equity : null);
      byInstrument.add(row);
    }
    allocation.put("byInstrument", byInstrument);
    allocation.put("bySector", byGroup.apply(HoldingInput::sector));
    allocation.put("byAssetClass", byGroup.apply(HoldingInput::assetClass));
    out.put("allocation", allocation);

    Map<String, Object> concentration = new LinkedHashMap<>();
    concentration.put("largestWeight", noHoldings
        ? available(0, "Largest holding as a share of equity.")
        : available(Valuation.maxWeight(values, equity), "Largest holding as a share of equity."));
    concentration.put("exposure", available(Valuation.exposure(values, equity), "Invested value as a share of equity."));
    concentration.put("hhi", conc.hhi() == null
        ? unavailable("Nothing is invested.", "Herfindahl index of invested weights; needs at least one holding.")
        : available(conc.hhi(), "Herfindahl index of invested weights."));
    concentration.put("effectiveHoldings", conc.effectiveAssets() == null
        ? unavailable("Nothing is invested.", "1 / HHI; needs at least one holding.")
        : available(conc.effectiveAssets(), "1 / HHI."));
    out.put("concentration", concentration);

    Map<String, Object> performance = new LinkedHashMap<>();
    performance.put("profit", available(m.applyAsDouble(equity - input.netContributions()),
        "Equity minus net contributions, in DT. Profit is an amount, not a rate of return."));
    performance.put("timeWeightedReturn", twr == null
        ? unavailable("There is no complete period to measure yet.",
            "Valuations at creation and at every deposit or withdrawal.")
        : available(twr, "Chains returns between deposits and withdrawals, so flows do not count as performance. "
            + "Since creation, not annualised."));
    performance.put("moneyWeightedReturn", mwr == null
        ? unavailable("The portfolio is too new to weight its cash flows.",
            "Time since creation and the dates and amounts of every deposit and withdrawal.")
        : available(mwr, "Modified Dietz: gain divided by time-weighted capital, so the timing of your deposits "
            + "matters. Since creation, not annualised."));
    performance.put("completeDays", daily.length);
    out.put("performance", performance);

    String noRisk = "No holdings: cash carries no price risk in this simulation.";
    String tooFew = "Only " + windowLength + " daily returns are available.";
    String invalid = "The price history of a holding contains invalid values, so this metric is not computed.";
    Map<String, Object> risk = new LinkedHashMap<>();
    risk.put("valueAtRisk95", noHoldings ? available(0, noRisk)
        : invalidSample ? unavailable(invalid, varRequirement)
        : hs == null ? unavailable(tooFew, varRequirement)
        : available(m.applyAsDouble(JsSemantics.round(hs.valueAtRisk())), varRequirement));
    risk.put("expectedShortfall95", noHoldings ? available(0, noRisk)
        : invalidSample ? unavailable(invalid, varRequirement)
        : hs == null ? unavailable(tooFew, varRequirement)
        : available(m.applyAsDouble(JsSemantics.round(hs.expectedShortfall())),
            "Mean loss beyond the VaR. " + varRequirement));
    risk.put("holdingsVolatilityDaily", noHoldings ? available(0, "No holdings.")
        : pnlSd == null || equity <= 0 ? unavailable(com.pif.api.web.Messages.get("risk.not_enough_returns"), varRequirement)
        : available(pnlSd / equity,
            "Standard deviation of the simulated daily P&L of current holdings, as a share of equity."));
    risk.put("observations", windowLength);
    String historyDays = "The portfolio has " + daily.length + " complete days of history.";
    boolean noVol = dailyVol == null || daily.length < Risk.MIN_VOLATILITY_RETURNS;
    risk.put("realizedVolatilityDaily", noVol ? unavailable(historyDays, realizedRequirement)
        : available(dailyVol, "Sample standard deviation of daily returns, flows removed. " + realizedRequirement));
    risk.put("realizedVolatilityAnnualized", noVol ? unavailable(historyDays, realizedRequirement)
        : available(dailyVol * Math.sqrt(365),
            "Daily volatility × √365 (the simulated market trades every day). " + realizedRequirement));
    risk.put("maxDrawdown", index.size() < 2
        ? unavailable("The portfolio has no price history yet.", "At least one revaluation after creation.")
        : available(Risk.maxDrawdown(index.stream().mapToDouble(Double::doubleValue).toArray()),
            "Largest peak-to-trough fall of the time-weighted value index (deposits and withdrawals removed)."));
    out.put("risk", risk);

    Map<String, HoldingInput> holdingBy = new HashMap<>();
    for (HoldingInput h : input.holdings()) holdingBy.put(h.symbol(), h);
    List<Map<String, Object>> stress = new ArrayList<>();
    for (StressScenario scenario : input.scenarios()) {
      Risk.StressResult result = Risk.stressImpact(values, s -> {
        HoldingInput h = holdingBy.get(s);
        return scenario.shockOf().of(new ShockTarget(h.assetClass(), h.sector()));
      });
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("id", scenario.id());
      row.put("name", scenario.name());
      row.put("description", scenario.description());
      row.put("hypothetical", true);
      row.put("impact", m.applyAsDouble(result.impact()));
      row.put("impactPct", equity > 0 ? result.impact() / equity : null);
      row.put("equityAfter", m.applyAsDouble(equity + result.impact()));
      List<Map<String, Object>> breakdown = new ArrayList<>();
      for (Risk.StressLine line : result.breakdown()) {
        Map<String, Object> l = new LinkedHashMap<>();
        l.put("symbol", line.symbol());
        l.put("value", m.applyAsDouble(line.value()));
        l.put("shockPct", line.shockPct());
        l.put("impact", m.applyAsDouble(line.impact()));
        breakdown.add(l);
      }
      row.put("breakdown", breakdown);
      stress.add(row);
    }
    out.put("stress", stress);
    return out;
  }
}
