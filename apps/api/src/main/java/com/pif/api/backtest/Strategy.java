package com.pif.api.backtest;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Rule-based target allocation. Called after bar {@code barIndex} has closed; may only read prices and indicators
 * through that bar (no look-ahead).
 */
public interface Strategy {

  String id();

  /** Decision after the close of {@code barIndex}. */
  Target target(int barIndex, Context ctx);

  /**
   * {@code hold == true}: keep current positions (no rebalance). Otherwise {@code weights} are fractions of equity
   * (non-negative, sum <= 1); residual weight is cash. An empty weight map means 100% cash.
   */
  record Target(boolean hold, Map<String, Double> weights) {
    /** Keep current positions (no rebalance on the next bar). */
    public static Target keep() {
      return new Target(true, Map.of());
    }

    public static Target weights(Map<String, Double> weights) {
      return new Target(false, Map.copyOf(new LinkedHashMap<>(weights)));
    }

    public static Target cash() {
      return weights(Map.of());
    }
  }

  /** Read-only market and run context available to strategies. */
  record Context(List<String> symbols, List<Bar> bars, Map<String, Object> params) {
    public double close(String symbol, int barIndex) {
      Double mid = bars.get(barIndex).closes().get(symbol);
      if (mid == null) throw new IllegalStateException("Missing close for " + symbol + " at bar " + barIndex);
      return mid;
    }

    public double[] closes(String symbol) {
      double[] out = new double[bars.size()];
      for (int i = 0; i < bars.size(); i++) out[i] = close(symbol, i);
      return out;
    }

    public int intParam(String key, int defaultValue) {
      Object v = params.get(key);
      if (v instanceof Number n) return n.intValue();
      return defaultValue;
    }
  }

  /** One chronological bar: aligned closes for every symbol in the run. */
  record Bar(java.time.Instant at, Map<String, Double> closes) {}
}
