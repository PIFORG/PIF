package com.pif.api.finance;

/** Order terms and resting-order behaviour (apps/api/src/finance/orders.ts). */
public final class OrderRules {

  private OrderRules() {}

  /** {@code triggered}: a stop stays triggered once the bid has reached it. Prices are null when absent. */
  public record RestingOrder(OrderType type, OrderSide side, Double limitPrice, Double stopPrice, boolean triggered) {}

  public record RestingOrderAction(boolean triggered, boolean execute) {}

  /** A limit price must stay within ±bandPct % of the mid, which catches fat-finger prices. */
  public static boolean limitWithinBand(double limitPrice, double mid, double bandPct) {
    double band = bandPct / 100;
    return limitPrice >= mid * (1 - band) && limitPrice <= mid * (1 + band);
  }

  /** A protective sell stop must sit below the current bid; at or above it, it would trigger at once. */
  public static boolean stopBelowBid(double stopPrice, Quote quote) {
    return stopPrice < quote.bid();
  }

  /** What a resting order does against a new quote: a stop triggers and then sells; a limit executes when it crosses. */
  public static RestingOrderAction restingOrderAction(RestingOrder order, Quote quote) {
    if (order.type() == OrderType.STOP && order.stopPrice() != null) {
      boolean triggered = order.triggered() || ExecutionRules.sellStopTriggered(order.stopPrice(), quote);
      return new RestingOrderAction(triggered, triggered);
    }
    if (order.type() == OrderType.LIMIT && order.limitPrice() != null) {
      return new RestingOrderAction(order.triggered(), ExecutionRules.limitCrosses(order.side(), order.limitPrice(), quote));
    }
    return new RestingOrderAction(order.triggered(), false);
  }

  /** Units one fill can take: what is left of the order, capped by the holding for sells and by the depth still free. */
  public static double fillableQuantity(OrderSide side, double remaining, double held, double depthLeft) {
    double cap = side == OrderSide.SELL ? Math.min(remaining, held) : remaining;
    return Math.max(0, Math.min(cap, depthLeft));
  }
}
