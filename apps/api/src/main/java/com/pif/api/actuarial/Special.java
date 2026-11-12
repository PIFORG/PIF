package com.pif.api.actuarial;

import java.util.function.DoubleUnaryOperator;

/**
 * Special functions of apps/api/src/actuarial/math/special.ts, operation for operation. Transcendental functions use
 * {@link StrictMath} (fdlibm), which V8 also implements for log, exp, sin, log1p and expm1, so results are bit-identical.
 *
 * <ul>
 *   <li>logGamma: Lanczos approximation (g = 7, 9 terms), relative error below 1e-14 for x &gt; 0.
 *   <li>gammaP / gammaQ: regularized incomplete gamma, by series for x &lt; a + 1 and by Lentz's continued fraction
 *       otherwise (Numerical Recipes, 3rd ed., §6.2).
 *   <li>normalCdf: Φ(x) = ½ erfc(−x/√2), with erfc(z) = Q(½, z²), accurate in both tails.
 *   <li>normalQuantile: Acklam's rational approximation refined by one Halley step on normalCdf.
 * </ul>
 */
final class Special {

  private static final double[] LANCZOS = {
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  };
  private static final double EPS = 1e-16;
  private static final double FPMIN = 1e-300;
  private static final int MAX_ITERATIONS = 10_000;

  private Special() {}

  static double logGamma(double x) {
    if (!(x > 0)) throw new ArithmeticException("logGamma is defined here for x > 0 only");
    if (x < 0.5) return StrictMath.log(Math.PI / StrictMath.sin(Math.PI * x)) - logGamma(1 - x);
    double z = x - 1;
    double sum = LANCZOS[0];
    for (int i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i] / (z + i);
    double t = z + 7.5;
    return 0.5 * StrictMath.log(2 * Math.PI) + (z + 0.5) * StrictMath.log(t) - t + StrictMath.log(sum);
  }

  /** ln C(n, k) for integers 0 ≤ k ≤ n. */
  static double logChoose(double n, double k) {
    return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  }

  private static double gammaSeries(double a, double x) {
    double ap = a;
    double term = 1 / a;
    double sum = term;
    for (int n = 0; n < MAX_ITERATIONS; n++) {
      ap += 1;
      term *= x / ap;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * EPS) break;
    }
    return sum * StrictMath.exp(-x + a * StrictMath.log(x) - logGamma(a));
  }

  private static double gammaContinuedFraction(double a, double x) {
    double b = x + 1 - a;
    double c = 1 / FPMIN;
    double d = 1 / b;
    double h = d;
    for (int i = 1; i < MAX_ITERATIONS; i++) {
      double an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      double delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < EPS) break;
    }
    return StrictMath.exp(-x + a * StrictMath.log(x) - logGamma(a)) * h;
  }

  /** Regularized lower incomplete gamma P(a, x) = γ(a, x) / Γ(a). */
  static double gammaP(double a, double x) {
    if (!(a > 0)) throw new ArithmeticException("gammaP needs a > 0");
    if (x <= 0) return 0;
    return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
  }

  /** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), computed directly in the tail. */
  static double gammaQ(double a, double x) {
    if (!(a > 0)) throw new ArithmeticException("gammaQ needs a > 0");
    if (x <= 0) return 1;
    return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContinuedFraction(a, x);
  }

  static double normalCdf(double x) {
    if (x == Double.POSITIVE_INFINITY) return 1;
    if (x == Double.NEGATIVE_INFINITY) return 0;
    double tail = 0.5 * gammaQ(0.5, (x * x) / 2);
    return x < 0 ? tail : 1 - tail;
  }

  private static final double[] A = {
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  };
  private static final double[] B = {
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  };
  private static final double[] C = {
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  };
  private static final double[] D = {7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416};

  static double normalQuantile(double p) {
    if (!(p > 0 && p < 1)) throw new ArithmeticException("normalQuantile needs 0 < p < 1");
    double low = 0.02425;
    double x;
    if (p < low) {
      double q = Math.sqrt(-2 * StrictMath.log(p));
      x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
          / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
    } else if (p <= 1 - low) {
      double q = p - 0.5;
      double r = q * q;
      x = ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q)
          / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
    } else {
      double q = Math.sqrt(-2 * StrictMath.log(1 - p));
      x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
          / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
    }
    double e = normalCdf(x) - p;
    double u = e * Math.sqrt(2 * Math.PI) * StrictMath.exp((x * x) / 2);
    return x - u / (1 + (x * u) / 2);
  }

  /**
   * Smallest y ≥ 0 with cdf(y) ≥ p for a continuous, increasing cdf on [0, ∞), by bracketing and bisection.
   * {@code guess} only speeds up the bracketing.
   */
  static double invertCdf(DoubleUnaryOperator cdf, double p, double guess) {
    double hi = Math.max(guess, 1e-12) * 2;
    for (int i = 0; i < 2000 && cdf.applyAsDouble(hi) < p; i++) hi *= 2;
    double lo = 0;
    for (int i = 0; i < 200; i++) {
      double mid = (lo + hi) / 2;
      if (cdf.applyAsDouble(mid) < p) lo = mid;
      else hi = mid;
      if (hi - lo <= hi * 1e-14) break;
    }
    return hi;
  }
}
