package com.pif.api.market;

import com.pif.api.finance.JsSemantics;
import com.pif.api.market.FictionalUniverse.FictionalInstrument;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Deterministic simulated market (apps/api/src/market-data/simulated-provider.ts). Each calendar day d ≥ 0 since the
 * epoch has one log-return per instrument from a one-factor model:
 * <pre>r = μ + σ·(β·f + √(1−β²)·ε),   f, ε ~ N(0, 1), seeded by day (f) and by instrument and day (ε).</pre>
 * Within the day, the 288 five-minute log-prices follow a Brownian bridge from 0 to r:
 * <pre>Bⱼ = σ/√288 · (Sⱼ − (j/288)·S₂₈₈) + (j/288)·r,   Sⱼ = z₁ + … + zⱼ,</pre>
 * so intraday moves have the daily volatility and each day ends exactly at its close. The price at the epoch equals
 * the instrument's reference price. A quote is in force for its whole 5-minute period.
 *
 * <p>Every value is a pure function of (seed prefix, symbol, period), computed with the same floating-point
 * operations in the same order as TypeScript, so prices are bit-identical with the NestJS API. The caches only
 * avoid recomputation: concurrent requests may compute the same entry twice and always get the same numbers.
 */
public final class SimulatedMarketProvider {

  public static final Instant SIMULATION_EPOCH = Instant.parse("2026-01-01T00:00:00Z");
  public static final long BUCKET_MS = 5 * 60_000L;
  public static final int BUCKETS_PER_DAY = 288;
  private static final long DAY_MS = BUCKET_MS * BUCKETS_PER_DAY;
  private static final int BRIDGE_CACHE_LIMIT = 512;

  public static final Provenance SIMULATED_PROVENANCE = new Provenance("pif-simulated-v1", "FICTIONAL", "TND",
      "Prix simulés déterministes pour des instruments fictifs — pas des données de marché réelles. "
          + "Le marché simulé cote en continu, 24 h sur 24, par périodes de cotation de 5 minutes.");

  private final Map<String, FictionalInstrument> universe;
  private final String seedPrefix;
  private final Map<Integer, Double> factors = new ConcurrentHashMap<>();
  private final Map<String, double[]> dayStartLogs = new ConcurrentHashMap<>();
  private final Map<String, double[]> bridges = new ConcurrentHashMap<>();

  public SimulatedMarketProvider() {
    this(FictionalUniverse.INSTRUMENTS, "pif-sim-v1");
  }

  public SimulatedMarketProvider(Map<String, FictionalInstrument> universe, String seedPrefix) {
    this.universe = universe;
    this.seedPrefix = seedPrefix;
  }

  public Provenance provenance() {
    return SIMULATED_PROVENANCE;
  }

  /** Earliest instant with a quote. */
  public Instant dataStart() {
    return SIMULATION_EPOCH;
  }

  public boolean supports(String symbol) {
    return universe.containsKey(symbol);
  }

  /** The quote in force at {@code at}, or null before the data start. */
  public MarketQuote quote(String symbol, Instant at) {
    long bucket = bucketOf(at);
    return bucket < 0 ? null : quoteAtBucket(symbol, bucket);
  }

  /** Every quote that came into force in (after, upTo], oldest first. */
  public List<MarketQuote> quotesBetween(String symbol, Instant after, Instant upTo) {
    long first = Math.max(0, bucketOf(after) + 1);
    long last = bucketOf(upTo);
    List<MarketQuote> out = new ArrayList<>();
    for (long b = first; b <= last; b++) out.add(quoteAtBucket(symbol, b));
    return out;
  }

  /** Closing mids of the days fully completed within [from, to], oldest first. */
  public List<PricePoint> dailyCloses(String symbol, Instant from, Instant to) {
    FictionalInstrument asset = asset(symbol);
    long epoch = SIMULATION_EPOCH.toEpochMilli();
    double firstDay = Math.max(0, Math.ceil((double) (from.toEpochMilli() - epoch) / DAY_MS) - 1);
    double lastCompleted = Math.floor((double) (to.toEpochMilli() - epoch) / DAY_MS) - 1;
    List<PricePoint> out = new ArrayList<>();
    for (long d = (long) firstDay; d <= lastCompleted; d++) {
      Instant closeAt = Instant.ofEpochMilli(epoch + (d + 1) * DAY_MS);
      if (closeAt.isBefore(from)) continue;
      out.add(new PricePoint(closeAt, toMid(StrictMath.log(asset.initialPrice()) + dayStartLog(asset, (int) (d + 1)))));
    }
    return out;
  }

  /** Mids sampled every {@code every} quote periods within [from, to], oldest first. */
  public List<PricePoint> intraday(String symbol, Instant from, Instant to, int every) {
    if (every < 1) throw new IllegalArgumentException("every must be a positive integer");
    long first = Math.max(0, bucketOf(from));
    long last = bucketOf(to);
    List<PricePoint> out = new ArrayList<>();
    for (long b = first; b <= last; b += every) {
      MarketQuote q = quoteAtBucket(symbol, b);
      out.add(new PricePoint(q.asOf(), q.mid()));
    }
    return out;
  }

  /** Index of the 5-minute period containing {@code at} (negative before the epoch). */
  public long bucketOf(Instant at) {
    return Math.floorDiv(at.toEpochMilli() - SIMULATION_EPOCH.toEpochMilli(), BUCKET_MS);
  }

  public MarketQuote quoteAtBucket(String symbol, long bucket) {
    FictionalInstrument asset = asset(symbol);
    int day = (int) Math.floorDiv(bucket, BUCKETS_PER_DAY);
    int j = (int) (bucket - (long) day * BUCKETS_PER_DAY);
    double mid = toMid(StrictMath.log(asset.initialPrice()) + dayStartLog(asset, day) + bridge(asset, day)[j]);
    double half = Math.max(1, JsSemantics.round((mid * asset.spreadBps()) / 20_000));
    return new MarketQuote(symbol, Instant.ofEpochMilli(SIMULATION_EPOCH.toEpochMilli() + bucket * BUCKET_MS), mid,
        Math.max(1, mid - half), mid + half, asset.depth());
  }

  private FictionalInstrument asset(String symbol) {
    FictionalInstrument asset = universe.get(symbol);
    if (asset == null) throw new IllegalArgumentException("Unknown simulated instrument " + symbol);
    return asset;
  }

  private double factor(int day) {
    return factors.computeIfAbsent(day,
        d -> new Rng(Rng.seedFromString(seedPrefix + ":factor:" + d)).normal());
  }

  private double dailyReturn(FictionalInstrument asset, int day) {
    double idio = new Rng(Rng.seedFromString(seedPrefix + ":" + asset.symbol() + ":day:" + day)).normal();
    double beta = Math.min(1, Math.max(0, asset.beta()));
    return asset.driftPerStep()
        + asset.volPerStep() * (beta * factor(day) + Math.sqrt(1 - beta * beta) * idio);
  }

  /** Cumulative log-return from the epoch to the start of {@code day}. */
  private double dayStartLog(FictionalInstrument asset, int day) {
    double[] logs = dayStartLogs.get(asset.symbol());
    if (logs == null || logs.length <= day) {
      int from = logs == null ? 0 : logs.length;
      double[] grown = new double[Math.max(day + 1, from * 2)];
      if (logs != null) System.arraycopy(logs, 0, grown, 0, from);
      if (from == 0) {
        grown[0] = 0;
        from = 1;
      }
      for (int d = from; d < grown.length; d++) grown[d] = grown[d - 1] + dailyReturn(asset, d - 1);
      logs = grown;
      dayStartLogs.merge(asset.symbol(), grown, (a, b) -> a.length >= b.length ? a : b);
    }
    return logs[day];
  }

  private double[] bridge(FictionalInstrument asset, int day) {
    String key = asset.symbol() + ":" + day;
    double[] cached = bridges.get(key);
    if (cached != null) return cached;
    Rng rng = new Rng(Rng.seedFromString(seedPrefix + ":" + asset.symbol() + ":intraday:" + day));
    double[] sums = new double[BUCKETS_PER_DAY + 1];
    for (int j = 1; j <= BUCKETS_PER_DAY; j++) sums[j] = sums[j - 1] + rng.normal();
    double total = sums[BUCKETS_PER_DAY];
    double r = dailyReturn(asset, day);
    double scale = asset.volPerStep() / Math.sqrt(BUCKETS_PER_DAY);
    double[] path = new double[BUCKETS_PER_DAY + 1];
    for (int j = 0; j <= BUCKETS_PER_DAY; j++) {
      path[j] = scale * (sums[j] - ((double) j / BUCKETS_PER_DAY) * total) + ((double) j / BUCKETS_PER_DAY) * r;
    }
    if (bridges.size() >= BRIDGE_CACHE_LIMIT) bridges.clear();
    bridges.put(key, path);
    return path;
  }

  private static double toMid(double logPrice) {
    return Math.max(1, JsSemantics.round(StrictMath.exp(logPrice) * 1000));
  }
}
