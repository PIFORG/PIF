package com.pif.api.backtest;

import java.util.LinkedHashMap;
import java.util.Map;

/** Equal-weight buy-and-hold: after every close, target 1/n on every selected symbol (engine fills next bar). */
public final class BuyAndHoldStrategy implements Strategy {

  public static final String ID = "BUY_AND_HOLD";

  @Override
  public String id() {
    return ID;
  }

  @Override
  public Target target(int barIndex, Context ctx) {
    Map<String, Double> weights = new LinkedHashMap<>();
    double w = 1.0 / ctx.symbols().size();
    for (String symbol : ctx.symbols()) weights.put(symbol, w);
    return Target.weights(weights);
  }
}
