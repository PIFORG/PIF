package com.pif.api.market;

/**
 * Deterministic pseudo-random numbers for reproducible scenarios (apps/api/src/market-data/rng.ts). Not for
 * security. mulberry32 gives a uniform [0, 1) stream from a 32-bit seed; Box–Muller turns pairs of uniforms into
 * standard normals. Integer steps use Java's wrapping {@code int} arithmetic, which is exactly JavaScript's
 * {@code Math.imul} and ToInt32; {@code log}, {@code sin} and {@code cos} use {@link StrictMath} (fdlibm), the
 * algorithms V8 implements, so the same seed yields bit-identical paths.
 */
public final class Rng {

  private static final double TWO_POW_32 = 4294967296.0;
  /** {@code Number.EPSILON}. */
  private static final double JS_EPSILON = Math.ulp(1.0);

  private int state;
  private double spare;
  private boolean hasSpare;

  public Rng(long seed) {
    this.state = (int) seed;
  }

  public double uniform() {
    state += 0x6d2b79f5;
    int t = state;
    t = (t ^ (t >>> 15)) * (t | 1);
    t ^= t + (t ^ (t >>> 7)) * (t | 61);
    return Integer.toUnsignedLong(t ^ (t >>> 14)) / TWO_POW_32;
  }

  public double normal() {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }
    double u = 0;
    while (u <= JS_EPSILON) u = uniform();
    double v = uniform();
    double radius = Math.sqrt(-2 * StrictMath.log(u));
    spare = radius * StrictMath.sin(2 * Math.PI * v);
    hasSpare = true;
    return radius * StrictMath.cos(2 * Math.PI * v);
  }

  /** FNV-1a hash of a string's UTF-16 code units to a 32-bit seed. */
  public static long seedFromString(String text) {
    int hash = 0x811c9dc5;
    for (int i = 0; i < text.length(); i++) {
      hash ^= text.charAt(i);
      hash *= 0x01000193;
    }
    return Integer.toUnsignedLong(hash);
  }
}
