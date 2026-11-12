package com.pif.api.actuarial;

import com.pif.api.finance.JsSemantics;
import com.pif.api.web.JsNumbers;
import java.util.List;

/**
 * Claim-count models for a portfolio of {@code policies} independent policies observed for {@code years}
 * (apps/api/src/actuarial/models/frequency.ts).
 *
 * <p>BINOMIAL — each policy has at most one claim in the period. With an annual claim probability p the period
 * probability is p_t = 1 − (1 − p)^t, so N ~ Bin(n, p_t), E[N] = n·p_t and Var(N) = n·p_t·(1 − p_t).
 *
 * <p>POISSON — claims arrive at {@code intensity} μ per policy-year, so N ~ Poisson(λ) with λ = n·t·μ and E[N] =
 * Var(N) = λ. Several claims per policy are possible.
 *
 * <p>Both belong to the (a, b, 0) class used by Panjer's recursion: p_k = (a + b/k)·p_{k−1}.
 */
final class Frequency {

  static final List<String> FAMILIES = List.of("BINOMIAL", "POISSON");

  /**
   * Largest expected claim count for which the count table is computed: the largest the API accepts (1,000,000
   * policies × 5 years × 2 claims per policy-year). The table spans mean ± 9 sd, so even then it holds only about
   * 57,000 entries.
   */
  static final double MAX_TABULATED_MEAN = 10_000_000;

  private Frequency() {}

  /** A null number is a field the request left undefined. */
  record Assumptions(String family, Double policies, Double years, Double probability, Double intensity) {}

  static final class Model {
    final String family;
    final double policies;
    final double years;
    final double exposure;
    /** BINOMIAL: n and the period probability; POISSON: λ and μ. */
    final double first;
    final double second;
    final double mean;
    final double variance;
    final double panjerA;
    final double panjerB;
    private final double lp;
    private final double lq;

    private Model(String family, double policies, double years, double first, double second, double mean,
        double variance, double panjerA, double panjerB, double lp, double lq) {
      this.family = family;
      this.policies = policies;
      this.years = years;
      this.exposure = policies * years;
      this.first = first;
      this.second = second;
      this.mean = mean;
      this.variance = variance;
      this.panjerA = panjerA;
      this.panjerB = panjerB;
      this.lp = lp;
      this.lq = lq;
    }

    boolean binomial() {
      return family.equals("BINOMIAL");
    }

    /** Parameter names as the TypeScript model lists them. */
    List<String> parameterNames() {
      return binomial() ? List.of("n", "periodProbability") : List.of("lambda", "intensity");
    }

    double periodProbability() {
      return second;
    }

    double lambda() {
      return first;
    }

    double intensity() {
      return second;
    }

    double logPmf(double k) {
      if (binomial()) {
        double n = policies;
        return JsSemantics.isInteger(k) && k >= 0 && k <= n ? Special.logChoose(n, k) + k * lp + (n - k) * lq
            : Double.NEGATIVE_INFINITY;
      }
      return JsSemantics.isInteger(k) && k >= 0 ? -first + k * lp - Special.logGamma(k + 1)
          : Double.NEGATIVE_INFINITY;
    }

    /** ln of the probability-generating function. */
    double logPgf(double z) {
      if (binomial()) return policies * StrictMath.log1p(second * (z - 1));
      return first * (z - 1);
    }
  }

  static Model model(Assumptions input) {
    double n = num(input.policies());
    double t = num(input.years());
    if (!JsSemantics.isInteger(n) || n < 1) throw new AssumptionException("policies must be a positive whole number");
    if (!(t > 0)) throw new AssumptionException("years must be positive");

    if ("BINOMIAL".equals(input.family())) {
      Double p = input.probability();
      if (p == null || !(p > 0 && p < 1)) {
        throw new AssumptionException("probability must be strictly between 0 and 1");
      }
      double pt = 1 - StrictMath.pow(1 - p, t);
      double lp = StrictMath.log(pt);
      double lq = StrictMath.log1p(-pt);
      return new Model("BINOMIAL", n, t, n, pt, n * pt, n * pt * (1 - pt), -pt / (1 - pt), ((n + 1) * pt) / (1 - pt),
          lp, lq);
    }

    Double mu = input.intensity();
    if (mu == null || !(mu > 0)) throw new AssumptionException("intensity must be positive");
    double lambda = n * t * mu;
    double ll = StrictMath.log(lambda);
    return new Model("POISSON", n, t, lambda, mu, lambda, lambda, 0, lambda, ll, 0);
  }

  /** P(N = from + i) = probabilities[i]; coveredMass is 1 up to rounding. */
  record CountTable(double from, double[] probabilities, double coveredMass) {}

  /**
   * P(N = k) over mean ± 9 standard deviations (plus a margin for small, skewed means), which holds all but a
   * negligible tail of either family.
   */
  static CountTable countTable(Model model) {
    if (model.mean > MAX_TABULATED_MEAN) {
      throw new AssumptionException("expected claim count above " + JsNumbers.toLocaleEnUs(MAX_TABULATED_MEAN)
          + " is outside the tabulated range");
    }
    double sd = Math.sqrt(model.variance);
    double from = Math.max(0, Math.floor(model.mean - 9 * sd));
    double to = Math.ceil(model.mean + 9 * sd + 12);
    if (model.binomial()) to = Math.min(to, model.policies);
    int size = to >= from ? (int) (to - from + 1) : 0;
    double[] probabilities = new double[size];
    double coveredMass = 0;
    int i = 0;
    for (double k = from; k <= to; k++) {
      double p = StrictMath.exp(model.logPmf(k));
      probabilities[i++] = p;
      coveredMass += p;
    }
    return new CountTable(from, probabilities, coveredMass);
  }

  /** Smallest k with P(N ≤ k) ≥ level. */
  static double countQuantile(CountTable table, double level) {
    double cumulative = 0;
    double[] p = table.probabilities();
    for (int i = 0; i < p.length; i++) {
      cumulative += p[i];
      if (cumulative >= level - 1e-12) return table.from() + i;
    }
    return table.from() + p.length - 1;
  }

  /** P(N > k). */
  static double countExceedance(CountTable table, double k) {
    double tail = 0;
    double[] p = table.probabilities();
    for (int i = p.length - 1; i >= 0 && table.from() + i > k; i--) tail += p[i];
    return Math.min(1, tail);
  }

  /** JavaScript's ToNumber of an undefined field. */
  static double num(Double value) {
    return value == null ? Double.NaN : value;
  }
}
