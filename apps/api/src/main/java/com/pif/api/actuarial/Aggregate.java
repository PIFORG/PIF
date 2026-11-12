package com.pif.api.actuarial;

/**
 * Aggregate (compound) loss S = X₁ + … + X_N with N independent of the i.i.d. claim costs Xᵢ
 * (apps/api/src/actuarial/models/aggregate.ts).
 *
 * <pre>
 *   E[S]   = E[N]·E[X]
 *   Var(S) = E[N]·Var(X) + Var(N)·E[X]²
 * </pre>
 *
 * The distribution of S is held on an arithmetic lattice origin + i·span:
 *
 * <ul>
 *   <li>EXACT: deterministic severity c gives S = c·N, so P(S = c·k) = P(N = k).
 *   <li>PANJER: the severity is discretised on 0, h, 2h, … by mean-preserving local moment matching, x_0 = 1 −
 *       E[X∧h]/h and x_j = (2E[X∧jh] − E[X∧(j−1)h] − E[X∧(j+1)h])/h, which keeps E[X] exact even when h is comparable
 *       to the median claim. Panjer's recursion f_k = Σ_{j=1..k} (a + b·j/k)·x_j·f_{k−j} / (1 − a·x_0) then gives the
 *       compound distribution on [0, upper]. The only errors are the discretisation and the mass beyond
 *       {@code upper}, both reported.
 * </ul>
 */
final class Aggregate {

  private static final int PANJER_POINTS = 4096;
  private static final int MAX_ATTEMPTS = 4;
  private static final double TARGET_MASS = 1 - 1e-7;
  /** exp(−700) is close to the smallest normal double; below it f_S(0) underflows and the recursion collapses. */
  private static final double MIN_LOG_F0 = -700;
  static final String UNDERFLOW_REASON = "The probability of no claims is below 1e-304, so the exact recursion "
      + "underflows. The expected claim count is too large for the exact method; the moments remain valid and a Monte "
      + "Carlo estimate is planned for the simulation lab.";

  private Aggregate() {}

  /** capturedMass is the probability mass on the lattice; 1 − capturedMass lies beyond the last point. */
  record Lattice(String method, double origin, double span, double[] probabilities, double capturedMass) {}

  /** Either a lattice or the reason it is unavailable. */
  record Distribution(Lattice lattice, String reason) {
    boolean available() {
      return lattice != null;
    }
  }

  record Moments(double mean, double variance, double sd) {}

  static Moments moments(Frequency.Model frequency, Severity.Model severity) {
    double mean = frequency.mean * severity.mean();
    double variance = frequency.mean * severity.variance() + frequency.variance * (severity.mean() * severity.mean());
    return new Moments(mean, variance, Math.sqrt(variance));
  }

  static Distribution distribution(Frequency.Model frequency, Severity.Model severity) {
    if (severity.deterministic()) {
      Frequency.CountTable table = Frequency.countTable(frequency);
      return new Distribution(new Lattice("EXACT", table.from() * severity.mean(), severity.mean(),
          table.probabilities().clone(), table.coveredMass()), null);
    }

    Moments moments = moments(frequency, severity);
    double upper = Math.max(moments.mean() + 12 * moments.sd(), severity.quantile().applyAsDouble(0.9999));
    Lattice best = null;
    for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      Lattice lattice = panjer(frequency, severity, upper);
      if (lattice == null) return new Distribution(null, UNDERFLOW_REASON);
      best = lattice;
      if (lattice.capturedMass() >= TARGET_MASS) break;
      upper *= 2;
    }
    return new Distribution(best, null);
  }

  private static Lattice panjer(Frequency.Model frequency, Severity.Model severity, double upper) {
    int m = PANJER_POINTS;
    double h = upper / m;
    double[] x = new double[m + 1];
    double[] lev = new double[m + 2];
    for (int j = 0; j <= m + 1; j++) lev[j] = severity.limitedMean().applyAsDouble(j * h);
    x[0] = Math.max(0, 1 - lev[1] / h);
    for (int j = 1; j <= m; j++) x[j] = Math.max(0, (2 * lev[j] - lev[j - 1] - lev[j + 1]) / h);

    double logF0 = frequency.logPgf(x[0]);
    if (!(logF0 >= MIN_LOG_F0)) return null;

    double a = frequency.panjerA;
    double b = frequency.panjerB;
    double[] f = new double[m + 1];
    f[0] = StrictMath.exp(logF0);
    double denominator = 1 - a * x[0];
    double captured = f[0];
    for (int k = 1; k <= m; k++) {
      double plain = 0;
      double weighted = 0;
      for (int j = 1; j <= k; j++) {
        double term = x[j] * f[k - j];
        plain += term;
        weighted += j * term;
      }
      double value = Math.max(0, (a * plain + (b / k) * weighted) / denominator);
      f[k] = value;
      captured += value;
    }
    return new Lattice("PANJER", 0, h, f, Math.min(1, captured));
  }

  static double value(Lattice lattice, int index) {
    return lattice.origin() + index * lattice.span();
  }

  /** Mean of the lattice distribution (renormalised to the captured mass). */
  static double mean(Lattice lattice) {
    double total = 0;
    double mass = 0;
    double[] p = lattice.probabilities();
    for (int i = 0; i < p.length; i++) {
      total += p[i] * value(lattice, i);
      mass += p[i];
    }
    return total / mass;
  }

  /** Smallest lattice value s with P(S ≤ s) ≥ level, or null when level lies in the uncaptured tail. */
  static Double quantile(Lattice lattice, double level) {
    if (level > lattice.capturedMass() - 1e-12) return null;
    double cumulative = 0;
    double[] p = lattice.probabilities();
    for (int i = 0; i < p.length; i++) {
      cumulative += p[i];
      if (cumulative >= level - 1e-12) return value(lattice, i);
    }
    return null;
  }

  /**
   * Tail value-at-risk (expected shortfall) for a discrete distribution: TVaR_α = ( E[S·1{S > VaR}] + VaR·(P(S ≤
   * VaR) − α) ) / (1 − α). Null when the uncaptured tail is not negligible against 1 − α.
   */
  static Double tvar(Lattice lattice, double level) {
    Double valueAtRisk = quantile(lattice, level);
    if (valueAtRisk == null || 1 - lattice.capturedMass() > (1 - level) * 1e-4) return null;
    double var = valueAtRisk;
    double below = 0;
    double tail = 0;
    double[] p = lattice.probabilities();
    for (int i = 0; i < p.length; i++) {
      double s = value(lattice, i);
      if (s <= var + tolerance(var)) below += p[i];
      else tail += p[i] * s;
    }
    return (tail + var * (below - level)) / (1 - level);
  }

  /** P(S > threshold), counting the uncaptured mass as exceeding (an upper bound by at most 1 − capturedMass). */
  static double exceedance(Lattice lattice, double threshold) {
    double tail = 1 - lattice.capturedMass();
    double[] p = lattice.probabilities();
    for (int i = 0; i < p.length; i++) if (value(lattice, i) > threshold + tolerance(threshold)) tail += p[i];
    return Math.min(1, Math.max(0, tail));
  }

  /** from is the lower edge of the first bin. */
  record Histogram(double from, double binWidth, double[] probabilities) {}

  /** Groups the lattice between its 0.05% and 99.95% quantiles into at most {@code maxBins} equal bins. */
  static Histogram histogram(Lattice lattice, int maxBins) {
    double[] p = lattice.probabilities();
    int n = p.length;
    int first = 0;
    int last = n - 1;
    double cumulative = 0;
    for (int i = 0; i < n; i++) {
      cumulative += p[i];
      if (cumulative >= 0.0005) {
        first = i;
        break;
      }
    }
    cumulative = 0;
    for (int i = 0; i < n; i++) {
      cumulative += p[i];
      if (cumulative >= Math.min(0.9995, lattice.capturedMass() - 1e-12)) {
        last = i;
        break;
      }
    }
    int pointsPerBin = (int) Math.max(1, Math.ceil((double) (last - first + 1) / maxBins));
    int bins = last >= first ? (last - first) / pointsPerBin + 1 : 0;
    double[] probabilities = new double[bins];
    int b = 0;
    for (int start = first; start <= last; start += pointsPerBin) {
      double mass = 0;
      for (int i = start; i < Math.min(start + pointsPerBin, n); i++) mass += p[i];
      probabilities[b++] = mass;
    }
    double edgeShift = lattice.method().equals("PANJER") ? lattice.span() / 2 : 0;
    return new Histogram(Math.max(0, value(lattice, first) - edgeShift), pointsPerBin * lattice.span(), probabilities);
  }

  private static double tolerance(double value) {
    return 1e-9 * Math.max(1, Math.abs(value));
  }
}
