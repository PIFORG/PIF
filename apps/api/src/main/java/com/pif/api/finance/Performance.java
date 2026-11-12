package com.pif.api.finance;

import java.util.List;

/** Performance measures (apps/api/src/finance/performance.ts). */
public final class Performance {

  private Performance() {}

  /**
   * A valuation of the portfolio followed, at the same instant, by an external cash flow
   * (deposit &gt; 0, withdrawal &lt; 0; 0 when none). {@code equity} is the equity just before the
   * flow. Trades are internal and never flows.
   */
  public record ValuationPoint(double equity, double flowAfter) {}

  /**
   * Time-weighted return: the product of sub-period returns between valuations, each measured from
   * the equity just after the previous flow, so deposits and withdrawals do not count as
   * performance. Null when there is no complete sub-period or a sub-period starts at or below 0.
   *
   * <pre>TWR = Π (Vᵢ / (Vᵢ₋₁ + Fᵢ₋₁)) − 1</pre>
   */
  public static Double timeWeightedReturn(List<ValuationPoint> points) {
    if (points.size() < 2) return null;
    double growth = 1;
    for (int i = 1; i < points.size(); i++) {
      double start = points.get(i - 1).equity() + points.get(i - 1).flowAfter();
      if (start <= 0) return null;
      growth *= points.get(i).equity() / start;
    }
    return growth - 1;
  }

  /** Deposits minus withdrawals, including the initial funding. */
  public static double netContributions(double[] flows) {
    double sum = 0;
    for (double flow : flows) sum += flow;
    return sum;
  }

  /** Money made on what was put in: equity minus net contributions. This is profit, not a rate of return. */
  public static double investmentProfit(double equity, double contributions) {
    return equity - contributions;
  }
}
