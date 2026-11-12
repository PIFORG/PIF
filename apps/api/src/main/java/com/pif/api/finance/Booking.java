package com.pif.api.finance;

/**
 * What booking one execution did. {@code costRemoved} is the cost basis released by a sell and
 * {@code realizedPnl} the proceeds after fees minus that cost; both are 0 for buys.
 */
public record Booking(double notional, double fee, double spreadCost, double costRemoved, double realizedPnl) {}
