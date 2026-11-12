package com.pif.api.finance;

import java.util.Objects;

/**
 * A long holding at average cost. Cost basis includes the commissions paid on buys. Mutated in
 * place by {@link Ledger#bookExecution}, like the TypeScript object it mirrors.
 */
public final class Holding {

  private final String symbol;
  private double quantity;
  private double costBasis;

  public Holding(String symbol, double quantity, double costBasis) {
    this.symbol = symbol;
    this.quantity = quantity;
    this.costBasis = costBasis;
  }

  public String symbol() {
    return symbol;
  }

  public double quantity() {
    return quantity;
  }

  public double costBasis() {
    return costBasis;
  }

  void quantity(double quantity) {
    this.quantity = quantity;
  }

  void costBasis(double costBasis) {
    this.costBasis = costBasis;
  }

  @Override
  public boolean equals(Object o) {
    return o instanceof Holding h
        && Objects.equals(symbol, h.symbol)
        && Double.compare(quantity, h.quantity) == 0
        && Double.compare(costBasis, h.costBasis) == 0;
  }

  @Override
  public int hashCode() {
    return Objects.hash(symbol, quantity, costBasis);
  }

  @Override
  public String toString() {
    return "Holding[symbol=" + symbol + ", quantity=" + quantity + ", costBasis=" + costBasis + "]";
  }
}
