package com.pif.api.finance;

/**
 * Fixed-point money shared by every PIF financial service (apps/api/src/finance/money.ts). An
 * amount is an integer number of thousandths of the currency unit (millimes for the Tunisian
 * dinar). Amounts are carried in a {@code double}, exactly like the TypeScript {@code number}, so
 * results are bit-identical with the NestJS API; integer values stay exact up to 2^53.
 */
public final class Money {

  public static final int AMOUNT_SCALE = 1000;

  private Money() {}

  /**
   * {@code Math.round(value × 1000)} (ties toward +∞).
   *
   * @throws IllegalArgumentException "Amount must be finite" (a RangeError in TypeScript)
   */
  public static double toAmount(double value) {
    if (!Double.isFinite(value)) throw new IllegalArgumentException("Amount must be finite");
    return JsSemantics.round(value * AMOUNT_SCALE);
  }

  public static double fromAmount(double amount) {
    return amount / AMOUNT_SCALE;
  }

  /** Value of {@code quantity} units at {@code price}. */
  public static double notional(double price, double quantity) {
    return price * quantity;
  }

  /**
   * Division rounded half away from zero.
   *
   * @throws ArithmeticException "Division by zero" (a RangeError in TypeScript)
   */
  public static double divRound(double numerator, double denominator) {
    if (denominator == 0) throw new ArithmeticException("Division by zero");
    double q = numerator / denominator;
    return q >= 0 ? Math.floor(q + 0.5) : -Math.floor(-q + 0.5);
  }

  /**
   * Commission = max(minimum, notional × bps / 10 000), rounded half-up to the thousandth. A zero
   * notional pays nothing (no fill, no fee).
   */
  public static double commission(double tradeNotional, double feeBps, double minFee) {
    if (tradeNotional <= 0) return 0;
    return Math.max(minFee, divRound(tradeNotional * feeBps, 10_000));
  }

  /** part / whole, or null when the denominator is zero. */
  public static Double ratio(double part, double whole) {
    return whole == 0 ? null : part / whole;
  }
}
