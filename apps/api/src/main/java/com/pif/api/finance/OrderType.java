package com.pif.api.finance;

public enum OrderType {
  MARKET,
  LIMIT,
  STOP,
  /** Protective sell that triggers when the bid rises to or above the take-profit price. */
  TAKE_PROFIT
}
