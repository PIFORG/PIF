package com.pif.api.backtest;

import java.util.Map;

/**
 * Long the first selected symbol when SMA(short) &gt; SMA(long); otherwise all cash. Multi-symbol runs still trade
 * only {@code symbols[0]} (v1 limitation).
 */
public final class MovingAverageCrossoverStrategy implements Strategy {

  public static final String ID = "MA_CROSSOVER";

  @Override
  public String id() {
    return ID;
  }

  @Override
  public Target target(int barIndex, Context ctx) {
    int shortPeriod = ctx.intParam("shortPeriod", 10);
    int longPeriod = ctx.intParam("longPeriod", 30);
    if (shortPeriod < 1 || longPeriod <= shortPeriod) {
      throw new IllegalArgumentException("MA crossover requires 1 <= shortPeriod < longPeriod");
    }
    String symbol = ctx.symbols().get(0);
    Double[] shortSma = TechnicalIndicators.sma(ctx.closes(symbol), shortPeriod);
    Double[] longSma = TechnicalIndicators.sma(ctx.closes(symbol), longPeriod);
    if (shortSma[barIndex] != null && longSma[barIndex] != null && shortSma[barIndex] > longSma[barIndex]) {
      return Target.weights(Map.of(symbol, 1.0));
    }
    return Target.cash();
  }
}
