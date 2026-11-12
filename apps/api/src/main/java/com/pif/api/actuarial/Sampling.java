package com.pif.api.actuarial;

import com.pif.api.market.Rng;

/**
 * Exact random variate generators driven by the shared seeded stream (apps/api/src/actuarial/models/sampling.ts). None
 * of them approximates a count or a cost by a normal law: the claim counts of a large portfolio are drawn exactly with
 * Knuth's splitting methods (TAOCP vol. 2, §3.4.1), whose cost grows only with log(n) or log(λ).
 */
final class Sampling {

  private static final int DIRECT_BINOMIAL_TRIALS = 40;
  private static final int DIRECT_POISSON_MEAN = 30;

  private Sampling() {}

  /** Gamma(shape, 1). Marsaglia &amp; Tsang (2000) for shape ≥ 1; shape &lt; 1 via G(shape + 1)·U^(1/shape). */
  static double gamma(Rng rng, double shape) {
    if (shape < 1) {
      double u = 0;
      while (u == 0) u = rng.uniform();
      return gamma(rng, shape + 1) * StrictMath.pow(u, 1 / shape);
    }
    double d = shape - 1.0 / 3;
    double c = 1 / Math.sqrt(9 * d);
    for (;;) {
      double x;
      double v;
      do {
        x = rng.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      double u = rng.uniform();
      double x2 = x * x;
      if (u < 1 - 0.0331 * x2 * x2) return d * v;
      if (u > 0 && StrictMath.log(u) < 0.5 * x2 + d * (1 - v + StrictMath.log(v))) return d * v;
    }
  }

  /** Beta(a, b) as X / (X + Y) with independent gamma variates. */
  static double beta(Rng rng, double a, double b) {
    double x = gamma(rng, a);
    double y = gamma(rng, b);
    return x / (x + y);
  }

  /**
   * Binomial(n, p), exact. While n is large, the a-th smallest of n uniforms (a Beta(a, n + 1 − a) variate X) splits
   * the trials: if X ≥ p the successes are among the a − 1 uniforms below X, each below p with probability p/X;
   * otherwise all a are successes and the n − a uniforms above X succeed with probability (p − X)/(1 − X). The
   * remaining few trials are drawn directly.
   */
  static double binomial(Rng rng, double trials, double probability) {
    double n = trials;
    double p = probability;
    double successes = 0;
    while (n > DIRECT_BINOMIAL_TRIALS) {
      double a = 1 + Math.floor(n / 2);
      double b = n + 1 - a;
      double x = beta(rng, a, b);
      if (x >= p) {
        n = a - 1;
        p = p / x;
      } else {
        successes += a;
        n = b - 1;
        p = (p - x) / (1 - x);
      }
    }
    for (int i = 0; i < n; i++) if (rng.uniform() < p) successes++;
    return successes;
  }

  /**
   * Poisson(λ), exact: the count of a unit-rate Poisson process on [0, λ]. While λ is large, the m-th arrival time X ~
   * Gamma(m) either falls beyond λ (then the count is Binomial(m − 1, λ/X)) or accounts for m arrivals, leaving a
   * process on the remaining λ − X. Small means use the multiplication method.
   */
  static double poisson(Rng rng, double mean) {
    double lambda = mean;
    double count = 0;
    while (lambda > DIRECT_POISSON_MEAN) {
      double m = Math.floor((7 * lambda) / 8);
      double x = gamma(rng, m);
      if (x >= lambda) return count + binomial(rng, m - 1, lambda / x);
      count += m;
      lambda -= x;
    }
    double limit = StrictMath.exp(-lambda);
    double product = rng.uniform();
    while (product > limit) {
      count++;
      product *= rng.uniform();
    }
    return count;
  }
}
