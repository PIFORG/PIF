package com.pif.api.finance;

/** Execution rules against a top-of-book quote (apps/api/src/finance/execution.ts). */
public final class ExecutionRules {

  private ExecutionRules() {}

  /** Buys pay the ask, sells receive the bid. */
  public static double executionPrice(OrderSide side, Quote quote) {
    return side == OrderSide.BUY ? quote.ask() : quote.bid();
  }

  /** A limit order can execute when the opposite side of the book reaches its price. */
  public static boolean limitCrosses(OrderSide side, double limitPrice, Quote quote) {
    return side == OrderSide.BUY ? quote.ask() <= limitPrice : quote.bid() >= limitPrice;
  }

  /** Same test at placement: a marketable limit executes immediately. */
  public static boolean limitIsMarketable(OrderSide side, double limitPrice, Quote quote) {
    return side == OrderSide.BUY ? limitPrice >= quote.ask() : limitPrice <= quote.bid();
  }

  /** A sell stop triggers once the bid falls to or below the stop price, and then sells at the bid. */
  public static boolean sellStopTriggered(double stopPrice, Quote quote) {
    return quote.bid() <= stopPrice;
  }

  /** Units still available at the best price after earlier fills in the same period. */
  public static double remainingDepth(Quote quote, double alreadyUsed) {
    return quote.depth() - alreadyUsed;
  }

  /** |fill − mid| × quantity: what crossing the spread cost. */
  public static double spreadCost(double price, double mid, double quantity) {
    return Math.abs(price - mid) * quantity;
  }
}
