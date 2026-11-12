package com.pif.api.market;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Fictional instruments shared by MarketQuest missions and the simulated trading market
 * (apps/api/src/market-data/fictional-universe.ts). Names evoke the Tunisian market for context, but none is a real
 * listed company and no price comes from real market data. Prices are in TND (written DT); drift and volatility are
 * per trading day.
 */
public final class FictionalUniverse {

  /**
   * {@code initialPrice}: reference mid in DT (at most 3 decimals). {@code beta}: loading on the common market
   * factor, in [0, 1]. {@code spreadBps}: quoted bid–ask spread in basis points of the mid. {@code depth}: units
   * available at the best bid and at the best ask per period.
   */
  public record FictionalInstrument(String symbol, String name, String sector, double initialPrice,
      double driftPerStep, double volPerStep, double beta, double spreadBps, double depth) {}

  public static final Map<String, FictionalInstrument> INSTRUMENTS;

  static {
    Map<String, FictionalInstrument> m = new LinkedHashMap<>();
    add(m, new FictionalInstrument("CTB", "Carthage Bank", "Banking", 42.5, 0.0003, 0.014, 0.7, 20, 600));
    add(m, new FictionalInstrument("MDX", "Medina Telecom", "Telecom", 18.2, 0.0002, 0.012, 0.55, 25, 900));
    add(m, new FictionalInstrument("OLV", "Olivia Foods", "Consumer staples", 9.85, 0.0003, 0.01, 0.4, 30, 1500));
    add(m, new FictionalInstrument("SFX", "Sfax Phosphates", "Materials", 63, 0.0002, 0.02, 0.75, 35, 300));
    add(m, new FictionalInstrument("TEK", "TunisTech", "Technology", 27.4, 0.0005, 0.024, 0.8, 30, 700));
    add(m, new FictionalInstrument("ATL", "Atlas Utilities", "Utilities", 14.6, 0.0002, 0.008, 0.35, 25, 1000));
    add(m, new FictionalInstrument("GOV", "Treasury Bond Fund", "Fixed income", 100, 0.0001, 0.002, 0.05, 10, 2000));
    // Additional asset-class proxies (seeded only after enum migration on PIF_test / approved PIF).
    add(m, new FictionalInstrument("TNDB", "Tunisia Notional Bond 10Y", "Fixed income", 98.5, 0.00005, 0.003, 0.08, 12, 1500));
    add(m, new FictionalInstrument("OILX", "Fictional Crude Index", "Energy", 72.4, 0.0001, 0.022, 0.45, 40, 400));
    add(m, new FictionalInstrument("EURT", "EUR/TND Synthetic", "Currencies", 3.35, 0.00002, 0.006, 0.2, 8, 5000));
    INSTRUMENTS = java.util.Collections.unmodifiableMap(m);
  }

  private static void add(Map<String, FictionalInstrument> m, FictionalInstrument instrument) {
    m.put(instrument.symbol(), instrument);
  }

  private FictionalUniverse() {}
}
