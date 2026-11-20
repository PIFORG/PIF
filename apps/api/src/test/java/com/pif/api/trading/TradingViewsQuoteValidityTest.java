package com.pif.api.trading;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.pif.api.market.MarketQuote;
import com.pif.api.market.SimulatedMarketProvider;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TradingViewsQuoteValidityTest {

  @Test
  void liveBucketKeepsNativeExpiry() {
    Instant asOf = Instant.parse("2026-11-20T04:00:00Z");
    Instant now = Instant.parse("2026-11-20T04:02:00Z");
    Instant until = TradingViews.validUntil(asOf, now);
    assertEquals(asOf.plusMillis(SimulatedMarketProvider.BUCKET_MS), until);
  }

  @Test
  void staleHistoricalObservationBindsToCurrentBucketEnd() {
    Instant asOf = Instant.parse("2026-10-30T15:00:00Z");
    Instant now = Instant.parse("2026-11-20T04:02:30Z");
    Instant until = TradingViews.validUntil(asOf, now);
    assertTrue(until.isAfter(now));
    assertEquals(Instant.parse("2026-11-20T04:05:00Z"), until);
  }

  @Test
  void quoteViewExposesFutureValidUntilForStaleAsOf() {
    MarketQuote q = new MarketQuote("BIAT", Instant.parse("2026-10-30T15:00:00Z"), 164_490, 164_300, 164_680, 10_000);
    Instant now = Instant.parse("2026-11-20T04:02:30Z");
    Map<String, Object> view = TradingViews.quoteView(q, now);
    assertEquals("2026-10-30T15:00:00.000Z", view.get("asOf"));
    assertEquals("2026-11-20T04:05:00.000Z", view.get("validUntil"));
  }
}