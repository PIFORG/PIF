package com.pif.api.finance;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.ToDoubleFunction;

/**
 * Portfolio valuation (apps/api/src/finance/valuation.ts). Value maps are symbol → amount and are
 * iterated in JavaScript property order, so pass insertion-ordered maps (e.g. LinkedHashMap).
 */
public final class Valuation {

  private Valuation() {}

  /** Herfindahl–Hirschman index of invested weights (1 = everything in one holding) and its inverse. */
  public record Concentration(Double hhi, Double effectiveAssets) {}

  /**
   * Market value of every non-empty holding, in holding order, keyed by {@link Holding#symbol()}.
   * {@code priceOf} is the valuation price of a symbol (the mid price in the simulators).
   */
  public static Map<String, Double> marketValues(Map<String, Holding> positions, ToDoubleFunction<String> priceOf) {
    Map<String, Double> values = new LinkedHashMap<>();
    for (Holding position : JsSemantics.values(positions)) {
      if (position.quantity() > 0) {
        values.put(position.symbol(), Money.notional(priceOf.applyAsDouble(position.symbol()), position.quantity()));
      }
    }
    return JsSemantics.inPropertyOrder(values);
  }

  public static double totalValue(Map<String, Double> values) {
    double sum = 0;
    for (double value : JsSemantics.values(values)) sum += value;
    return sum;
  }

  public static double equityOf(double cash, Map<String, Double> values) {
    return cash + totalValue(values);
  }

  /**
   * Largest single-holding share of {@code base} (equity), as a fraction; 0 when nothing is held or
   * {@code base} is not positive. Each weight is one correctly rounded IEEE-754 division
   * {@code value / base} with no further rounding, so the result is the exact maximum of the same
   * ratios TypeScript computes. Unlike TypeScript's {@code Math.max(...weights)}, there is no limit
   * on the number of holdings.
   */
  public static double maxWeight(Map<String, Double> values, double base) {
    if (!(base > 0)) return 0;
    double max = 0;
    for (double value : JsSemantics.values(values)) max = Math.max(max, value / base);
    return max;
  }

  /** Invested value / equity, as a fraction. */
  public static double exposure(Map<String, Double> values, double equity) {
    return equity > 0 ? totalValue(values) / equity : 0;
  }

  public static Concentration concentration(Map<String, Double> values) {
    double invested = totalValue(values);
    Double hhi = null;
    if (invested > 0 && !values.isEmpty()) {
      double sum = 0;
      for (double value : JsSemantics.values(values)) {
        double weight = value / invested;
        sum += weight * weight;
      }
      hhi = sum;
    }
    boolean truthy = hhi != null && hhi != 0 && !hhi.isNaN();
    return new Concentration(hhi, truthy ? 1 / hhi : null);
  }

  /** Market value − cost basis over all holdings (fees on buys included in cost). */
  public static double unrealizedPnl(Map<String, Holding> positions, Map<String, Double> values) {
    double costBasis = 0;
    for (Holding position : JsSemantics.values(positions)) costBasis += position.costBasis();
    return totalValue(values) - costBasis;
  }
}
