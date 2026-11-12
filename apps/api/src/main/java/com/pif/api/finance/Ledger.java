package com.pif.api.finance;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Cash account and holdings of one portfolio (apps/api/src/finance/ledger.ts). Short positions are
 * not supported. Positions keep insertion order; functions that sum over them use JavaScript
 * property order, as the TypeScript core does.
 */
public final class Ledger {

  private double cash;
  private final Map<String, Holding> positions;
  private double realizedPnl;
  private double feesPaid;
  private double spreadCostPaid;

  public Ledger(double cash, Map<String, Holding> positions, double realizedPnl, double feesPaid, double spreadCostPaid) {
    this.cash = cash;
    this.positions = new LinkedHashMap<>(positions);
    this.realizedPnl = realizedPnl;
    this.feesPaid = feesPaid;
    this.spreadCostPaid = spreadCostPaid;
  }

  public static Ledger empty(double cash) {
    return new Ledger(cash, Map.of(), 0, 0, 0);
  }

  public double cash() {
    return cash;
  }

  /** Read-only view; holdings change only through {@link #bookExecution}. */
  public Map<String, Holding> positions() {
    return Collections.unmodifiableMap(positions);
  }

  public double realizedPnl() {
    return realizedPnl;
  }

  public double feesPaid() {
    return feesPaid;
  }

  public double spreadCostPaid() {
    return spreadCostPaid;
  }

  /** An external cash flow (deposit or withdrawal); trades change cash only through {@link #bookExecution}. */
  public void addCash(double amount) {
    cash += amount;
  }

  /** {@code delete positions[symbol]} for a holding that reached zero; a later buy re-adds it at the end. */
  public void removeEmptyPosition(String symbol) {
    Holding holding = positions.get(symbol);
    if (holding != null && holding.quantity() == 0) positions.remove(symbol);
  }

  public static double heldQuantity(Map<String, Holding> positions, String symbol) {
    Holding holding = positions.get(symbol);
    return holding == null ? 0 : holding.quantity();
  }

  public static double heldQuantity(Ledger ledger, String symbol) {
    return heldQuantity(ledger.positions, symbol);
  }

  /**
   * Books one execution in place. Buys add value + fee to cash out and to cost basis. Sells release
   * cost basis pro rata (average cost), and realise proceeds − fee − released cost. The ledger is
   * left untouched when the execution is refused.
   *
   * <p>Identity preserved: cash + Σ cost basis = initial cash + initial cost + realised P&amp;L.
   *
   * @throws LedgerException with the same codes and messages as the TypeScript LedgerError
   */
  public static Booking bookExecution(Ledger ledger, Execution execution) {
    String symbol = execution.symbol();
    OrderSide side = execution.side();
    double price = execution.price();
    double quantity = execution.quantity();
    double fee = execution.fee();
    double mid = execution.mid();
    if (!JsSemantics.isInteger(quantity) || quantity < 1 || !JsSemantics.isInteger(price) || price <= 0 || !JsSemantics.isInteger(fee) || fee < 0) {
      throw new LedgerException(
          LedgerException.Code.INVALID_EXECUTION,
          "Executions need a positive whole quantity, a positive price and a non-negative fee.");
    }
    double value = Money.notional(price, quantity);
    if (side == OrderSide.BUY && value + fee > ledger.cash) {
      throw new LedgerException(LedgerException.Code.INSUFFICIENT_CASH, "Not enough cash to book this buy.");
    }
    if (side == OrderSide.SELL && quantity > heldQuantity(ledger, symbol)) {
      throw new LedgerException(LedgerException.Code.INSUFFICIENT_POSITION, "Cannot sell more than is held.");
    }

    double spreadCost = ExecutionRules.spreadCost(price, mid, quantity);
    Holding position = ledger.positions.get(symbol);
    if (position == null) {
      position = new Holding(symbol, 0, 0);
      ledger.positions.put(symbol, position);
    }
    double costRemoved = 0;
    double realizedPnl = 0;
    if (side == OrderSide.BUY) {
      ledger.cash -= value + fee;
      position.quantity(position.quantity() + quantity);
      position.costBasis(position.costBasis() + (value + fee));
    } else {
      costRemoved = Money.divRound(position.costBasis() * quantity, position.quantity());
      double proceeds = value - fee;
      realizedPnl = proceeds - costRemoved;
      ledger.cash += proceeds;
      ledger.realizedPnl += realizedPnl;
      position.costBasis(position.costBasis() - costRemoved);
      position.quantity(position.quantity() - quantity);
    }
    ledger.feesPaid += fee;
    ledger.spreadCostPaid += spreadCost;
    return new Booking(value, fee, spreadCost, costRemoved, realizedPnl);
  }
}
