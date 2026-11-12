package com.pif.api.trading;

import com.pif.api.finance.InvalidSampleException;
import com.pif.api.finance.Risk;
import com.pif.api.finance.Valuation;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleUnaryOperator;

/**
 * Extra risk-studio payload fields layered on top of {@link Analytics#portfolioAnalytics} so golden masters of the
 * core analytics object stay unchanged. Historical contributions use the same concurrent-return window as VaR.
 */
public final class RiskStudio {

  private RiskStudio() {}

  public static Map<String, Object> methodology(String currency, int observations, int heldSymbols) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("horizon", "1 trading day");
    m.put("confidenceLevel", 0.95);
    m.put("dataPeriod", "Up to " + Risk.MIN_VAR_OBSERVATIONS + "-250 aligned daily closes per held instrument "
        + "(provider: fictional simulated market).");
    m.put("observationFrequency", "1 day");
    m.put("currency", currency);
    m.put("calculationMethod", "Historical simulation on current holdings: each day replays concurrent instrument "
        + "simple returns; VaR is the loss at index floor((1-0.95)*n) of sorted P&L; ES is the mean of losses at or below "
        + "that VaR. Realised volatility and drawdown use the portfolio equity path with deposits/withdrawals removed.");
    m.put("assumptions", List.of(
        "Holdings marked at mid; liquidation uses bid minus commission.",
        "Cash carries no price risk in this simulation.",
        "Returns are simple close-to-close; no corporate actions.",
        "Stress scenarios are instantaneous linear shocks, not forecasts."));
    m.put("limitations", List.of(
        "Historical VaR is not a guarantee of maximum possible loss.",
        "Fictional prices only - not calibrated to a real market.",
        "No covariance matrix is inverted for parametric VaR; contributions are historical component ES shares.",
        observations < Risk.MIN_VAR_OBSERVATIONS && heldSymbols > 0
            ? "Only " + observations + " aligned daily windows are available (need "
                + Risk.MIN_VAR_OBSERVATIONS + ")."
            : "Aligned observation count: " + observations + "."));
    m.put("metricSource", Map.of(
        "valueAtRisk95", "OBSERVED_RETURNS",
        "expectedShortfall95", "OBSERVED_RETURNS",
        "holdingsVolatilityDaily", "OBSERVED_RETURNS",
        "realizedVolatilityDaily", "OBSERVED_RETURNS",
        "maxDrawdown", "OBSERVED_RETURNS",
        "stress", "SIMULATED_SCENARIO"));
    m.put("minVarObservations", Risk.MIN_VAR_OBSERVATIONS);
    return m;
  }

  /**
   * Component expected-shortfall contributions on the historical VaR tail (equal share of tail P&amp;L by symbol).
   * Unavailable when VaR itself is unavailable.
   */
  public static Map<String, Object> riskContributions(Map<String, Double> values, Map<String, double[]> returns,
      double equity, DoubleUnaryOperator money) {
    Map<String, Object> out = new LinkedHashMap<>();
    List<String> symbols = new ArrayList<>(values.keySet());
    if (symbols.isEmpty()) {
      out.put("available", true);
      out.put("basis", "No holdings - no price-risk contribution.");
      out.put("byInstrument", List.of());
      return out;
    }
    int window = Integer.MAX_VALUE;
    for (String s : symbols) {
      double[] r = returns.get(s);
      window = Math.min(window, r == null ? 0 : r.length);
    }
    if (window < Risk.MIN_VAR_OBSERVATIONS) {
      out.put("available", false);
      out.put("unavailableReason", "Only " + window + " aligned daily returns (need "
          + Risk.MIN_VAR_OBSERVATIONS + ").");
      out.put("byInstrument", List.of());
      return out;
    }
    double[] pnl = new double[window];
    double[][] bySym = new double[symbols.size()][window];
    for (int k = 0; k < window; k++) {
      double total = 0;
      for (int i = 0; i < symbols.size(); i++) {
        String s = symbols.get(i);
        double[] r = returns.get(s);
        double line = values.get(s) * r[r.length - window + k];
        bySym[i][k] = line;
        total += line;
      }
      pnl[k] = total;
    }
    Risk.VarResult hs;
    try {
      hs = Risk.historicalVaR(pnl, 0.95);
    } catch (InvalidSampleException e) {
      out.put("available", false);
      out.put("unavailableReason", com.pif.api.web.Messages.get("risk.invalid_sample"));
      out.put("byInstrument", List.of());
      return out;
    }
    if (hs == null) {
      out.put("available", false);
      out.put("unavailableReason", "Insufficient observations for VaR.");
      out.put("byInstrument", List.of());
      return out;
    }
    double[] sorted = pnl.clone();
    java.util.Arrays.sort(sorted);
    double index = Math.floor((1 - 0.95) * sorted.length);
    double varLevel = sorted[(int) index];
    List<Integer> tail = new ArrayList<>();
    for (int k = 0; k < window; k++) if (pnl[k] <= varLevel) tail.add(k);
    if (tail.isEmpty()) {
      out.put("available", false);
      out.put("unavailableReason", "Empty VaR tail.");
      out.put("byInstrument", List.of());
      return out;
    }
    List<Map<String, Object>> rows = new ArrayList<>();
    double sumAbs = 0;
    double[] contrib = new double[symbols.size()];
    for (int i = 0; i < symbols.size(); i++) {
      double mean = 0;
      for (int k : tail) mean += bySym[i][k];
      mean /= tail.size();
      contrib[i] = Math.max(0, -mean);
      sumAbs += contrib[i];
    }
    for (int i = 0; i < symbols.size(); i++) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("symbol", symbols.get(i));
      row.put("value", money.applyAsDouble(values.get(symbols.get(i))));
      row.put("weight", equity > 0 ? values.get(symbols.get(i)) / equity : null);
      row.put("tailLossContribution", money.applyAsDouble(contrib[i]));
      row.put("shareOfTailLoss", sumAbs > 0 ? contrib[i] / sumAbs : null);
      rows.add(row);
    }
    rows.sort((a, b) -> Double.compare(
        ((Number) b.get("tailLossContribution")).doubleValue(),
        ((Number) a.get("tailLossContribution")).doubleValue()));
    out.put("available", true);
    out.put("basis", "Mean loss of each holding on historical VaR-tail days (component ES). Not a guarantee of future loss.");
    out.put("tailDays", tail.size());
    out.put("byInstrument", rows);
    return out;
  }

  /** Mean pairwise Pearson correlation of holding return windows (same length). Null with reason if &lt; 2 holdings. */
  public static Map<String, Object> diversification(Map<String, double[]> returns, List<String> symbols) {
    Map<String, Object> out = new LinkedHashMap<>();
    if (symbols.size() < 2) {
      out.put("meanPairwiseCorrelation", null);
      out.put("unavailableReason", symbols.isEmpty() ? "No holdings." : "Need at least two holdings.");
      out.put("pairs", 0);
      return out;
    }
    int window = Integer.MAX_VALUE;
    for (String s : symbols) {
      double[] r = returns.get(s);
      window = Math.min(window, r == null ? 0 : r.length);
    }
    if (window < Risk.MIN_VOLATILITY_RETURNS) {
      out.put("meanPairwiseCorrelation", null);
      out.put("unavailableReason", "Need at least " + Risk.MIN_VOLATILITY_RETURNS + " aligned returns per holding.");
      out.put("pairs", 0);
      return out;
    }
    double sum = 0;
    int pairs = 0;
    for (int i = 0; i < symbols.size(); i++) {
      for (int j = i + 1; j < symbols.size(); j++) {
        Double corr = pearson(returns.get(symbols.get(i)), returns.get(symbols.get(j)), window);
        if (corr != null) {
          sum += corr;
          pairs++;
        }
      }
    }
    if (pairs == 0) {
      out.put("meanPairwiseCorrelation", null);
      out.put("unavailableReason", "Correlation could not be computed (zero variance).");
      out.put("pairs", 0);
      return out;
    }
    out.put("meanPairwiseCorrelation", sum / pairs);
    out.put("unavailableReason", null);
    out.put("pairs", pairs);
    out.put("requirement", "Pearson correlation of concurrent daily simple returns, averaged over unique pairs.");
    return out;
  }

  public static Map<String, Object> snapshot(double cash, Map<String, Double> values, Double maxWeightPct) {
    double positions = Valuation.totalValue(values);
    double equity = cash + positions;
    Valuation.Concentration conc = Valuation.concentration(values);
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("cash", cash);
    m.put("positionsValue", positions);
    m.put("equity", equity);
    m.put("exposure", Valuation.exposure(values, equity));
    m.put("largestWeight", Valuation.maxWeight(values, equity));
    m.put("hhi", conc.hhi());
    m.put("effectiveHoldings", conc.effectiveAssets());
    m.put("maxPositionWeightPct", maxWeightPct);
    m.put("withinPositionLimit", maxWeightPct == null || Valuation.maxWeight(values, equity) * 100 <= maxWeightPct + 1e-9);
    return m;
  }

  private static Double pearson(double[] a, double[] b, int n) {
    double[] xa = new double[n];
    double[] xb = new double[n];
    System.arraycopy(a, a.length - n, xa, 0, n);
    System.arraycopy(b, b.length - n, xb, 0, n);
    double meanA = 0;
    double meanB = 0;
    for (int i = 0; i < n; i++) {
      meanA += xa[i];
      meanB += xb[i];
    }
    meanA /= n;
    meanB /= n;
    double num = 0;
    double denA = 0;
    double denB = 0;
    for (int i = 0; i < n; i++) {
      double da = xa[i] - meanA;
      double db = xb[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    if (denA == 0 || denB == 0) return null;
    return num / Math.sqrt(denA * denB);
  }
}
