package com.pif.api.market;

import com.pif.api.finance.Quote;
import java.time.Instant;

/** A top-of-book quote in millimes, valid from {@code asOf} until the next quote of the same instrument. */
public record MarketQuote(String symbol, Instant asOf, double mid, double bid, double ask, double depth) {

  public Quote quote() {
    return new Quote(mid, bid, ask, depth);
  }

  public MarketQuote withSymbol(String newSymbol) {
    return new MarketQuote(newSymbol, asOf, mid, bid, ask, depth);
  }
}
