package com.pif.api.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * In-memory store with the algorithm of legacy-NestJS-DTO-parity 6 ThrottlerStorageService.increment:
 * each hit expires individually after the TTL; exceeding the limit blocks the key for the block
 * duration (equal to the TTL, as configured in the NestJS API).
 */
public class ThrottleStore {

  public record Result(int totalHits, long timeToExpire, boolean blocked, long timeToBlockExpire) {}

  private static final class Record {
    final Map<String, Integer> totalHits = new HashMap<>();
    final Map<String, List<Long>> hitExpirations = new HashMap<>();
    long expiresAt;
    long blockExpiresAt;
    boolean blocked;
  }

  private static final long SWEEP_INTERVAL_MS = 60_000;

  private final Map<String, Record> storage = new ConcurrentHashMap<>();
  private final LongSupplier clock;
  private long lastSweep;

  public ThrottleStore(LongSupplier clock) {
    this.clock = clock;
  }

  public synchronized Result increment(String key, long ttlMs, int limit, long blockDurationMs, String throttler) {
    long now = clock.getAsLong();
    sweep(now);
    Record record = storage.computeIfAbsent(key, k -> {
      Record r = new Record();
      r.expiresAt = now + ttlMs;
      return r;
    });
    record.totalHits.putIfAbsent(throttler, 0);
    List<Long> hits = record.hitExpirations.computeIfAbsent(throttler, k -> new ArrayList<>());
    hits.removeIf(expiresAt -> expiresAt <= now);
    record.totalHits.put(throttler, hits.size());

    long timeToExpire = ceilSeconds(record.expiresAt - now);
    if (timeToExpire <= 0) {
      record.expiresAt = now + ttlMs;
      timeToExpire = ceilSeconds(record.expiresAt - now);
    }
    if (!record.blocked) fire(record, throttler, ttlMs, now);
    if (record.totalHits.get(throttler) > limit && !record.blocked) {
      record.blocked = true;
      record.blockExpiresAt = now + blockDurationMs;
    }
    long timeToBlockExpire = ceilSeconds(record.blockExpiresAt - now);
    if (timeToBlockExpire <= 0 && record.blocked) {
      record.blocked = false;
      record.totalHits.put(throttler, 0);
      record.hitExpirations.put(throttler, new ArrayList<>());
      fire(record, throttler, ttlMs, now);
    }
    return new Result(record.totalHits.get(throttler), timeToExpire, record.blocked, timeToBlockExpire);
  }

  private static void fire(Record record, String throttler, long ttlMs, long now) {
    record.totalHits.merge(throttler, 1, Integer::sum);
    record.hitExpirations.computeIfAbsent(throttler, k -> new ArrayList<>()).add(now + ttlMs);
  }

  private void sweep(long now) {
    if (now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    storage.entrySet().removeIf(e -> {
      Record r = e.getValue();
      if (r.blocked && r.blockExpiresAt > now) return false;
      if (r.expiresAt > now) return false;
      return r.hitExpirations.values().stream().flatMap(List::stream).noneMatch(t -> t > now);
    });
  }

  private static long ceilSeconds(long ms) {
    return (long) Math.ceil(ms / 1000.0);
  }
}
