package com.pif.api.learning.engine;

import com.pif.api.finance.Risk;
import com.pif.api.finance.Valuation;
import com.pif.api.learning.engine.SimState.Fill;
import com.pif.api.learning.engine.SimState.Order;
import com.pif.api.learning.engine.Simulator.Context;
import com.pif.api.web.JsNumbers;
import java.util.LinkedHashMap;
import java.util.Map;

/** Portfolio metrics of a session (apps/api/src/learning/engine/metrics.ts). Amounts in millimes. */
public final class Metrics {

  private Metrics() {}

  /** Snap percentage metrics to the same binary value Node's JSON number text round-trips to. */
  private static double jsPct(double x) {
    String text = JsNumbers.toJson(x);
    return text == null ? x : Double.parseDouble(text);
  }

  public record PortfolioMetrics(double equity, double cash, double invested, double totalReturnPct,
      double realizedPnl, double unrealizedPnl, double maxDrawdownPct, Double volatilityPct, Double var95,
      Double es95, int varObservations, Double hhi, Double effectiveAssets, double maxWeightPct, double exposurePct,
      double feesPaid, double spreadCost, double turnover, int fills, int ordersPlaced, int ordersRejected) {

    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("equity", equity);
      out.put("cash", cash);
      out.put("invested", invested);
      out.put("totalReturnPct", totalReturnPct);
      out.put("realizedPnl", realizedPnl);
      out.put("unrealizedPnl", unrealizedPnl);
      out.put("maxDrawdownPct", jsPct(maxDrawdownPct));
      out.put("volatilityPct", volatilityPct == null ? null : jsPct(volatilityPct));
      out.put("var95", var95);
      out.put("es95", es95);
      out.put("varObservations", varObservations);
      out.put("hhi", hhi);
      out.put("effectiveAssets", effectiveAssets);
      out.put("maxWeightPct", jsPct(maxWeightPct));
      out.put("exposurePct", jsPct(exposurePct));
      out.put("feesPaid", feesPaid);
      out.put("spreadCost", spreadCost);
      out.put("turnover", turnover);
      out.put("fills", fills);
      out.put("ordersPlaced", ordersPlaced);
      out.put("ordersRejected", ordersRejected);
      return out;
    }
  }

  static double[] equitySeries(SimState state) {
    double[] series = new double[state.history.size()];
    for (int i = 0; i < series.length; i++) series[i] = state.history.get(i).equity();
    return series;
  }

  /**
   * Historical simulation: today's holdings are revalued with every past one-step return observed up to now (never
   * later), then the lower 5 % tail is read by the core VaR/ES estimator.
   */
  public static PortfolioMetrics compute(Context ctx, SimState state) {
    Map<String, Double> values = Simulator.marketValues(ctx, state);
    double invested = Valuation.totalValue(values);
    double equity = Simulator.equityOf(ctx, state);
    double[] equitySeries = equitySeries(state);
    double[] returns = Risk.simpleReturns(equitySeries);
    Double vol = returns.length >= Risk.MIN_VOLATILITY_RETURNS ? Risk.sampleStdDev(returns) : null;

    MarketPath market = ctx.market();
    int firstStep = -market.historySteps();
    double[] pnl = new double[Math.max(0, state.step - firstStep)];
    int n = 0;
    for (int step = firstStep + 1; step <= state.step; step++) {
      int at = step;
      pnl[n++] = Risk.scenarioPnl(values,
          symbol -> market.quoteAt(at, symbol).mid() / market.quoteAt(at - 1, symbol).mid() - 1);
    }
    Risk.VarResult risk = invested > 0 ? Risk.historicalVaR(pnl) : new Risk.VarResult(0, 0);

    Valuation.Concentration concentration = Valuation.concentration(values);
    double traded = 0;
    int fills = 0;
    int rejected = 0;
    for (Order o : state.orders) {
      for (Fill f : o.fills) {
        traded = traded + f.price() * f.quantity();
        fills++;
      }
      if ("REJECTED".equals(o.status)) rejected++;
    }

    return new PortfolioMetrics(
        equity,
        state.cash,
        invested,
        ((equity - state.initialEquity) / state.initialEquity) * 100,
        state.realizedPnl,
        Valuation.unrealizedPnl(state.positions, values),
        Risk.maxDrawdown(equitySeries) * 100,
        vol == null ? null : vol * 100,
        risk == null ? null : Js.round(risk.valueAtRisk()),
        risk == null ? null : Js.round(risk.expectedShortfall()),
        n,
        concentration.hhi(),
        concentration.effectiveAssets(),
        Valuation.maxWeight(values, equity) * 100,
        equity > 0 ? (invested / equity) * 100 : 0,
        state.feesPaid,
        state.spreadCostPaid,
        state.initialEquity > 0 ? traded / state.initialEquity : 0,
        fills,
        state.orders.size(),
        rejected);
  }
}
