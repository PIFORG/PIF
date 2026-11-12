package com.pif.api.backtest;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Equal-weight portfolio. On bars where {@code barIndex % rebalanceEvery == 0} (default every 21 bars), target equal
 * weights; otherwise hold current positions so weights drift with prices until the next rebalance signal.
 */
public final class PeriodicRebalancingStrategy implements Strategy {

  public static final String ID = "PERIODIC_REBALANCE";

  @Override
  public String id() {
    return ID;
  }

  @Override
  public Target target(int barIndex, Context ctx) {
    int every = ctx.intParam("rebalanceEvery", 21);
    if (every < 1) throw new IllegalArgumentException("rebalanceEvery must be >= 1");
    if (barIndex % every != 0) return Target.keep();
    Map<String, Double> weights = new LinkedHashMap<>();
    double w = 1.0 / ctx.symbols().size();
    for (String symbol : ctx.symbols()) weights.put(symbol, w);
    return Target.weights(weights);
  }
}
