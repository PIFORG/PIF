package com.pif.api.backtest;

import com.pif.api.backtest.BacktestEngine.EquityPoint;
import com.pif.api.backtest.BacktestEngine.Result;
import com.pif.api.backtest.BacktestEngine.Trade;
import com.pif.api.backtest.Strategy.Bar;
import com.pif.api.finance.Risk;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Performance statistics for a finished backtest.
 *
 * <p><b>Annualization:</b> let {@code nDays = max(1, calendarDaysBetween(first, last))} using UTC midnights of the
 * equity curve endpoints (or 1 when the span is under a day). Annualized return =
 * {@code (1 + totalReturn)^(365 / nDays) - 1}. Volatility and Sharpe scale daily sample statistics by
 * {@code sqrt(365)}. Risk-free for Sharpe defaults to 0 (excess = raw daily return) unless {@code riskFreeAnnual} > 0,
 * in which case the daily risk-free is {@code riskFreeAnnual / 365}.
 */
public final class BacktestMetrics {

  private BacktestMetrics() {}

  public record Metrics(double totalReturn, Double annualizedReturn, Double volatilityAnnualized, double maxDrawdown,
      Double sharpe, double totalFees, double totalSlippageCost, int tradeCount, int buyCount, int sellCount,
      Double winRate, Double benchmarkTotalReturn, Double excessReturnVsBenchmark, int calendarDays,
      String annualization) {}

  public static Metrics compute(Result result, double initialCash, double riskFreeAnnual, List<Bar> bars,
      List<String> symbols) {
    List<EquityPoint> curve = result.equityCurve();
    if (curve.isEmpty()) {
      throw new IllegalArgumentException("Empty equity curve");
    }
    double endEquity = curve.get(curve.size() - 1).equity();
    double totalReturn = initialCash > 0 ? endEquity / initialCash - 1 : 0;

    int calendarDays = calendarDays(curve.get(0).at(), curve.get(curve.size() - 1).at());
    Double annualized = Math.pow(1 + totalReturn, 365.0 / calendarDays) - 1;

    double[] equity = curve.stream().mapToDouble(EquityPoint::equity).toArray();
    double maxDd = Risk.maxDrawdown(equity);

    double[] rets = Risk.simpleReturns(equity);
    Double volDaily = Risk.sampleStdDev(rets);
    Double volAnn = volDaily == null ? null : volDaily * Math.sqrt(365);

    Double sharpe = null;
    if (volDaily != null && volDaily > 0 && rets.length > 0) {
      double rfDaily = riskFreeAnnual / 365.0;
      double mean = 0;
      for (double r : rets) mean += r - rfDaily;
      mean /= rets.length;
      sharpe = (mean / volDaily) * Math.sqrt(365);
    }

    int buys = 0;
    int sells = 0;
    for (Trade t : result.trades()) {
      if ("BUY".equals(t.side())) buys++;
      else sells++;
    }

    Double winRate = roundTripWinRate(result.trades());

    Double benchmark = null;
    Double excess = null;
    if (symbols.size() == 1 && bars.size() >= 2) {
      String symbol = symbols.get(0);
      Double first = bars.get(0).closes().get(symbol);
      Double last = bars.get(bars.size() - 1).closes().get(symbol);
      if (first != null && first > 0 && last != null) {
        benchmark = last / first - 1;
        excess = totalReturn - benchmark;
      }
    }

    return new Metrics(totalReturn, annualized, volAnn, maxDd, sharpe, result.totalFees(), result.totalSlippageCost(),
        result.trades().size(), buys, sells, winRate, benchmark, excess, calendarDays,
        "(1+R)^(365/nDays)-1; vol & Sharpe x sqrt(365); RF daily = annual/365 (default RF=0)");
  }

  public static Map<String, Object> toJson(Metrics m) {
    Map<String, Object> map = new LinkedHashMap<>();
    map.put("totalReturn", m.totalReturn());
    map.put("annualizedReturn", m.annualizedReturn());
    map.put("volatilityAnnualized", m.volatilityAnnualized());
    map.put("maxDrawdown", m.maxDrawdown());
    map.put("sharpe", m.sharpe());
    map.put("totalFees", m.totalFees());
    map.put("totalSlippageCost", m.totalSlippageCost());
    map.put("tradeCount", m.tradeCount());
    map.put("buyCount", m.buyCount());
    map.put("sellCount", m.sellCount());
    map.put("winRate", m.winRate());
    map.put("benchmarkTotalReturn", m.benchmarkTotalReturn());
    map.put("excessReturnVsBenchmark", m.excessReturnVsBenchmark());
    map.put("calendarDays", m.calendarDays());
    map.put("annualization", m.annualization());
    return map;
  }

  private static int calendarDays(java.time.Instant start, java.time.Instant end) {
    long millis = Duration.between(start, end).toMillis();
    if (millis <= 0) return 1;
    int days = (int) Math.max(1, Math.round(millis / 86_400_000.0));
    return days;
  }

  /** FIFO round-trips on the first symbol that has both buys and sells; otherwise null. */
  private static Double roundTripWinRate(List<Trade> trades) {
    double qty = 0;
    double cost = 0;
    int wins = 0;
    int closed = 0;
    for (Trade t : trades) {
      if ("BUY".equals(t.side())) {
        cost += t.price() * t.quantity() + t.fee();
        qty += t.quantity();
      } else if (qty > 1e-12) {
        double sellQty = Math.min(qty, t.quantity());
        double avgCost = cost / qty;
        double proceeds = t.price() * sellQty - t.fee() * (sellQty / t.quantity());
        double pnl = proceeds - avgCost * sellQty;
        closed++;
        if (pnl > 0) wins++;
        cost -= avgCost * sellQty;
        qty -= sellQty;
      }
    }
    return closed == 0 ? null : (double) wins / closed;
  }
}
