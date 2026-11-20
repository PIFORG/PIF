package com.pif.api.rooms;

import java.time.LocalDate;

/**
 * Thread-local simulation clock for room trading/valuation.
 * When set, warehouse quotes must be on or before this date (no look-ahead).
 */
public final class RoomQuoteContext {

  private static final ThreadLocal<LocalDate> AS_OF = new ThreadLocal<>();

  private RoomQuoteContext() {}

  public static void setAsOf(LocalDate date) {
    AS_OF.set(date);
  }

  public static LocalDate asOf() {
    return AS_OF.get();
  }

  public static void clear() {
    AS_OF.remove();
  }
}
