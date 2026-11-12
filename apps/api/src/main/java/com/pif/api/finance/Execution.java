package com.pif.api.finance;

/** One fill to book. {@code mid} is the mid price at execution, used to measure the spread cost. */
public record Execution(String symbol, OrderSide side, double price, double quantity, double fee, double mid) {}
