package com.pif.api.finance;

/** Top-of-book quote. Depth is the number of units available at the best bid and at the best ask. */
public record Quote(double mid, double bid, double ask, double depth) {}
