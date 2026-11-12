package com.pif.api.finance;

import java.util.List;

/** Account-level checks before an order is accepted (apps/api/src/finance/pretrade.ts). */
public final class PreTrade {

  private PreTrade() {}

  public record FeeSchedule(double feeBps, double minFee) {}

  public record OpenBuyLimit(double limitPrice, double remainingQuantity) {}

  /**
   * {@code referencePrice} is the price the order is checked at: the limit for limit buys, otherwise
   * the current ask (buys) or bid (sells). {@code mid} values the position-limit check,
   * {@code pendingBuyQuantity} counts units of this symbol already in open buy orders and
   * {@code availableCash} is cash minus reservations for open buy limits.
   * {@code maxPositionWeightPct} is optional (null = no cap).
   */
  public record PreTradeInput(
      OrderSide side,
      double quantity,
      double referencePrice,
      double mid,
      double held,
      double pendingBuyQuantity,
      double availableCash,
      double equity,
      FeeSchedule fees,
      Double maxPositionWeightPct) {}

  /** Buys: total = notional + fee (cash out). Sells: notional − fee (cash in). */
  public record PreTradeEstimate(double notional, double fee, double total) {}

  public sealed interface Rejection permits InsufficientPosition, InsufficientCash, PositionLimit {
    String code();
  }

  public record InsufficientPosition(double held) implements Rejection {
    @Override
    public String code() {
      return "INSUFFICIENT_POSITION";
    }
  }

  public record InsufficientCash(double needed, double available) implements Rejection {
    @Override
    public String code() {
      return "INSUFFICIENT_CASH";
    }
  }

  public record PositionLimit(double weightPct, double limitPct) implements Rejection {
    @Override
    public String code() {
      return "POSITION_LIMIT";
    }
  }

  /** Cash committed to open buy limits: limit price × remaining quantity + the commission on it. */
  public static double reservedCash(List<OpenBuyLimit> openBuys, FeeSchedule fees) {
    double reserved = 0;
    for (OpenBuyLimit order : openBuys) {
      double value = Money.notional(order.limitPrice(), order.remainingQuantity());
      reserved += value + Money.commission(value, fees.feeBps(), fees.minFee());
    }
    return reserved;
  }

  public static PreTradeEstimate estimateOrder(OrderSide side, double price, double quantity, FeeSchedule fees) {
    double value = Money.notional(price, quantity);
    double fee = Money.commission(value, fees.feeBps(), fees.minFee());
    return new PreTradeEstimate(value, fee, side == OrderSide.BUY ? value + fee : value - fee);
  }

  /**
   * No short selling, enough available cash including commission, and an optional cap on a single
   * holding's share of equity (held + pending + new units, valued at mid). Null when accepted.
   */
  public static Rejection checkOrder(PreTradeInput input) {
    if (input.side() == OrderSide.SELL) {
      return input.quantity() > input.held() ? new InsufficientPosition(input.held()) : null;
    }
    double needed = estimateOrder(OrderSide.BUY, input.referencePrice(), input.quantity(), input.fees()).total();
    if (needed > input.availableCash()) return new InsufficientCash(needed, input.availableCash());
    if (input.maxPositionWeightPct() != null) {
      double units = input.held() + input.pendingBuyQuantity() + input.quantity();
      double weightPct = (Money.notional(input.mid(), units) / input.equity()) * 100;
      if (weightPct > input.maxPositionWeightPct()) return new PositionLimit(weightPct, input.maxPositionWeightPct());
    }
    return null;
  }
}
