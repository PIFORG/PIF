package com.pif.api.actuarial;

import com.pif.api.finance.JsSemantics;
import com.pif.api.market.Rng;
import com.pif.api.web.JsNumbers;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Monte Carlo simulation of the aggregate claims S = X₁ + … + X_N of one cover period
 * (apps/api/src/actuarial/models/simulation.ts).
 *
 * <p>Every simulated period draws N from the frequency model and then the claim costs: DETERMINISTIC: S = m·N; GAMMA:
 * the sum of N independent Gamma(k, θ) costs is exactly Gamma(N·k, θ), drawn in one step; LOGNORMAL: N individual
 * costs exp(μ + σZ) are drawn and added (no closed form exists).
 *
 * <p>The run is reproducible: the same assumptions, seed and engine version give the same losses. Estimates come with
 * 95% intervals so that a reader can tell sampling noise from model effects.
 */
final class Simulation {

  static final String ENGINE_VERSION = "pif-actuarial-mc-1.0.0";
  static final String RNG_ALGORITHM = "mulberry32 (32-bit state) with Box–Muller normals";
  static final int MIN_SIMULATIONS = 1_000;
  static final int MAX_SIMULATIONS = 200_000;
  /** Individual lognormal claim draws per run: keeps a run within a few seconds. */
  static final double MAX_CLAIM_DRAWS = 20_000_000;
  static final double MAX_SEED = 2_147_483_647;
  static final double[] RISK_LEVELS = {0.9, 0.95, 0.99, 0.995};
  private static final double Z95 = 1.959963984540054;
  private static final int HISTOGRAM_BINS = 60;
  private static final int CURVE_POINTS = 41;
  private static final int CONVERGENCE_POINTS = 40;
  private static final int CHECK_EVERY = 1 << 12;

  private Simulation() {}

  /** premiumCharged null: the model's gross premium is used. */
  record Input(Pricing.Assumptions assumptions, double simulations, double seed, double initialCapital,
      Double premiumCharged) {}

  /** Called between batches of draws; throws to stop a run that has exceeded its time budget. */
  @FunctionalInterface
  interface Deadline {
    void check();

    Deadline NONE = () -> {};
  }

  record Interval(double lower, double upper) {}

  record Thresholds(double premiumCharged, String premiumSource, double modelGrossPremium, double fixedExpenses,
      double variableExpenses, double claimsBudget, double initialCapital, double capitalThreshold) {}

  record ClaimCount(double mean, double analyticMean, double max) {}

  record Statistics(double mean, Interval meanInterval, double sd, double median, double min, double max,
      Double skewness) {}

  record Risk(double level, double valueAtRisk, Interval valueAtRiskInterval, double tailValueAtRisk,
      Interval tailValueAtRiskInterval) {}

  record Probability(double estimate, Interval interval, double count) {}

  record Histogram(double from, double binWidth, int[] counts, int above) {}

  record CurvePoint(double threshold, double simulated, Double exact) {}

  record ConvergencePoint(double simulations, double mean, double lower, double upper,
      double probabilityClaimsExceedBudget) {}

  record AnalyticRisk(double level, Double valueAtRisk, Double tailValueAtRisk) {}

  /** distributionMethod is null when the distribution is unavailable; distributionReason then says why. */
  record Analytic(double mean, double sd, String distributionMethod, String distributionReason,
      List<AnalyticRisk> risk, Double claimsExceedBudget, Double claimsExceedPremium, Double capitalInsufficient) {}

  /** expectedShortfall = E[max(S − claims budget − capital, 0)] over all periods. */
  record Output(String engineVersion, String rng, double seed, double simulations, Thresholds thresholds,
      ClaimCount claimCount, Statistics statistics, List<Risk> risk, Probability claimsExceedBudget,
      Probability claimsExceedPremium, Probability capitalInsufficient, double expectedShortfall, Histogram histogram,
      List<CurvePoint> exceedanceCurve, List<ConvergencePoint> convergence, Analytic analytic) {}

  /** Cheap checks run before any sampling: the assumptions, the run size and the work it implies. */
  static Pricing.Model prepare(Input input) {
    double simulations = input.simulations();
    double seed = input.seed();
    if (!JsSemantics.isInteger(simulations) || simulations < MIN_SIMULATIONS || simulations > MAX_SIMULATIONS) {
      throw new SimulationLimitException("the number of simulations must be a whole number from "
          + JsNumbers.toLocaleEnUs(MIN_SIMULATIONS) + " to " + JsNumbers.toLocaleEnUs(MAX_SIMULATIONS));
    }
    if (!JsSemantics.isInteger(seed) || seed < 1 || seed > MAX_SEED) {
      throw new SimulationLimitException("the seed must be a whole number from 1 to 2,147,483,647");
    }
    if (!(input.initialCapital() >= 0)) throw new SimulationLimitException("initial capital cannot be negative");
    if (input.premiumCharged() != null && !(input.premiumCharged() > 0)) {
      throw new SimulationLimitException("the premium charged must be positive");
    }
    Pricing.Model model = Pricing.build(input.assumptions(), false);
    if (model.severity().family().equals("LOGNORMAL")) {
      double draws = simulations * model.frequency().mean;
      if (draws > MAX_CLAIM_DRAWS) {
        double fits = Math.floor(MAX_CLAIM_DRAWS / model.frequency().mean);
        throw new SimulationLimitException("lognormal claims are drawn one by one and this run would need about "
            + JsNumbers.toLocaleEnUs(JsSemantics.round(draws)) + " draws (limit "
            + JsNumbers.toLocaleEnUs(MAX_CLAIM_DRAWS) + "). "
            + (fits >= MIN_SIMULATIONS ? "Use at most " + JsNumbers.toLocaleEnUs(fits) + " simulations"
                : "Reduce the portfolio or the claim frequency"));
      }
    }
    return model;
  }

  record Losses(double[] losses, int[] counts) {}

  /** Draws the aggregate claims of {@code simulations} independent periods, in a fixed order. */
  static Losses simulateLosses(Frequency.Model frequency, Severity.Model severity, int simulations, double seed,
      Deadline deadline) {
    Rng rng = new Rng((long) seed);
    double[] losses = new double[simulations];
    int[] counts = new int[simulations];
    for (int i = 0; i < simulations; i++) {
      if ((i & (CHECK_EVERY - 1)) == 0) deadline.check();
      double n = frequency.binomial() ? Sampling.binomial(rng, frequency.policies, frequency.periodProbability())
          : Sampling.poisson(rng, frequency.lambda());
      counts[i] = (int) n;
      losses[i] = n == 0 ? 0 : total(severity, rng, n, deadline);
    }
    return new Losses(losses, counts);
  }

  private static double total(Severity.Model severity, Rng rng, double claims, Deadline deadline) {
    if (severity.deterministic()) return severity.mean() * claims;
    if (severity.family().equals("GAMMA")) {
      return severity.parameter("scale") * Sampling.gamma(rng, severity.parameter("shape") * claims);
    }
    double mu = severity.parameter("mu");
    double sigma = severity.parameter("sigma");
    double total = 0;
    for (int j = 0; j < claims; j++) {
      if ((j & 0xFFFF) == 0xFFFF) deadline.check();
      total += StrictMath.exp(mu + sigma * rng.normal());
    }
    return total;
  }

  static Output run(Input input, Deadline deadline) {
    prepare(input);
    Pricing.Model model = Pricing.build(input.assumptions(), true);
    double seed = input.seed();
    double initialCapital = input.initialCapital();
    int n = (int) input.simulations();
    Losses drawn = simulateLosses(model.frequency(), model.severity(), n, seed, deadline);
    double[] losses = drawn.losses();
    int[] counts = drawn.counts();

    Pricing.PremiumBreakdown p = model.premium();
    double variableRate = Frequency.num(input.assumptions().variableRate());
    double premiumCharged = input.premiumCharged() != null ? input.premiumCharged() : p.grossPremium();
    double variableExpenses = variableRate * premiumCharged;
    double claimsBudget = premiumCharged - p.fixedExpenses() - variableExpenses;
    double capitalThreshold = claimsBudget + initialCapital;

    double[] sorted = losses.clone();
    Arrays.sort(sorted);

    double sum = 0;
    double countSum = 0;
    double maxCount = 0;
    for (int i = 0; i < n; i++) {
      sum += losses[i];
      countSum += counts[i];
      if (counts[i] > maxCount) maxCount = counts[i];
    }
    double mean = sum / n;
    double m2 = 0;
    double m3 = 0;
    for (int i = 0; i < n; i++) {
      double d = losses[i] - mean;
      m2 += d * d;
      m3 += d * d * d;
    }
    double variance = m2 / (n - 1);
    double sd = Math.sqrt(variance);
    double halfWidth = (Z95 * sd) / Math.sqrt(n);
    double populationSd = Math.sqrt(m2 / n);
    Double skewness = populationSd > 0 ? m3 / n / StrictMath.pow(populationSd, 3) : null;

    double shortfall = 0;
    for (int i = n - 1; i >= 0 && sorted[i] > capitalThreshold; i--) shortfall += sorted[i] - capitalThreshold;

    Aggregate.Distribution distribution = model.distribution();
    List<Risk> risk = new ArrayList<>();
    List<AnalyticRisk> analyticRisk = new ArrayList<>();
    for (double level : RISK_LEVELS) {
      double v = empiricalQuantile(sorted, level);
      Tvar t = empiricalTvar(sorted, level, v);
      risk.add(new Risk(level, v, quantileInterval(sorted, level), t.value(), t.interval()));
    }
    for (double level : RISK_LEVELS) {
      analyticRisk.add(new AnalyticRisk(level,
          distribution.available() ? Aggregate.quantile(distribution.lattice(), level) : null,
          distribution.available() ? Aggregate.tvar(distribution.lattice(), level) : null));
    }

    return new Output(ENGINE_VERSION, RNG_ALGORITHM, seed, n,
        new Thresholds(premiumCharged, input.premiumCharged() == null ? "MODEL" : "USER", p.grossPremium(),
            p.fixedExpenses(), variableExpenses, claimsBudget, initialCapital, capitalThreshold),
        new ClaimCount(countSum / n, model.frequency().mean, maxCount),
        new Statistics(mean, new Interval(mean - halfWidth, mean + halfWidth), sd, empiricalQuantile(sorted, 0.5),
            sorted[0], sorted[n - 1], skewness),
        risk,
        probability(n - upperBound(sorted, claimsBudget), n),
        probability(n - upperBound(sorted, premiumCharged), n),
        probability(n - upperBound(sorted, capitalThreshold), n),
        shortfall / n,
        histogram(sorted, model.severity().deterministic() ? model.severity().mean() : null),
        exceedanceCurve(sorted, distribution),
        convergence(losses, claimsBudget),
        new Analytic(model.moments().mean(), model.moments().sd(),
            distribution.available() ? distribution.lattice().method() : null, distribution.reason(), analyticRisk,
            exact(distribution, claimsBudget), exact(distribution, premiumCharged),
            exact(distribution, capitalThreshold)));
  }

  private static Double exact(Aggregate.Distribution distribution, double threshold) {
    return distribution.available() ? Aggregate.exceedance(distribution.lattice(), threshold) : null;
  }

  private static Probability probability(double count, int n) {
    return new Probability(count / n, wilson(count, n), count);
  }

  /** Number of sorted values ≤ x (with a relative tolerance for amounts that are equal up to rounding). */
  static int upperBound(double[] sorted, double x) {
    double limit = x + 1e-9 * Math.max(1, Math.abs(x));
    int lo = 0;
    int hi = sorted.length;
    while (lo < hi) {
      int mid = (lo + hi) >>> 1;
      if (sorted[mid] <= limit) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Smallest simulated value s with F_n(s) ≥ level: the empirical VaR, consistent with the exact definition. */
  static double empiricalQuantile(double[] sorted, double level) {
    double index = Math.min(sorted.length, Math.max(1, Math.ceil(sorted.length * level - 1e-9)));
    return sorted[(int) index - 1];
  }

  /**
   * Distribution-free 95% interval for a quantile from order statistics: the number of simulated values below the
   * true quantile is Binomial(n, level), approximated by a normal law.
   */
  static Interval quantileInterval(double[] sorted, double level) {
    int n = sorted.length;
    double spread = Z95 * Math.sqrt(n * level * (1 - level));
    double lowerIndex = Math.max(1, Math.floor(n * level - spread));
    double upperIndex = Math.min(n, Math.ceil(n * level + spread));
    return new Interval(sorted[(int) lowerIndex - 1], sorted[(int) upperIndex - 1]);
  }

  record Tvar(double value, Interval interval) {}

  /**
   * Empirical TVaR_α = (Σ_{s &gt; VaR} s / n + VaR·(F_n(VaR) − α)) / (1 − α), the same discrete formula as the exact
   * method. Approximate 95% interval from the asymptotic variance [Var(S | S ≥ VaR) + α·(TVaR − VaR)²] / (n(1 − α));
   * null when fewer than 10 values lie in the tail.
   */
  static Tvar empiricalTvar(double[] sorted, double level, double valueAtRisk) {
    int n = sorted.length;
    int below = upperBound(sorted, valueAtRisk);
    double tailSum = 0;
    for (int i = below; i < n; i++) tailSum += sorted[i];
    double value = (tailSum / n + valueAtRisk * ((double) below / n - level)) / (1 - level);
    int tailStart = n - (int) Math.ceil(n * (1 - level) - 1e-9);
    int tailCount = n - tailStart;
    if (tailCount < 10) return new Tvar(value, null);
    double tailMean = 0;
    for (int i = tailStart; i < n; i++) tailMean += sorted[i];
    tailMean /= tailCount;
    double tailVariance = 0;
    for (int i = tailStart; i < n; i++) {
      double d = sorted[i] - tailMean;
      tailVariance += d * d;
    }
    tailVariance /= tailCount - 1;
    double gap = value - valueAtRisk;
    double se = Math.sqrt((tailVariance + level * (gap * gap)) / (n * (1 - level)));
    return new Tvar(value, new Interval(value - Z95 * se, value + Z95 * se));
  }

  /** Wilson score 95% interval for a proportion; stays inside [0, 1] and is informative when count is 0. */
  static Interval wilson(double count, double n) {
    double p = count / n;
    double z2 = Z95 * Z95;
    double centre = (p + z2 / (2 * n)) / (1 + z2 / n);
    double half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
    return new Interval(count == 0 ? 0 : Math.max(0, centre - half), count == n ? 1 : Math.min(1, centre + half));
  }

  /**
   * Histogram between the minimum and the 99.9% quantile; {@code above} counts the periods beyond the last bin. With
   * a fixed claim cost, the bin width is a whole number of claims so every bin holds the same number of possible
   * totals.
   */
  private static Histogram histogram(double[] sorted, Double latticeStep) {
    int n = sorted.length;
    double from = sorted[0];
    double top = empiricalQuantile(sorted, 0.999);
    double range = top - from;
    double binWidth;
    int bins;
    if (range <= 0) {
      binWidth = latticeStep != null ? latticeStep : Math.max(1, Math.abs(from) * 0.01);
      bins = 1;
    } else if (latticeStep != null && latticeStep != 0 && !latticeStep.isNaN()) {
      binWidth = latticeStep * Math.ceil(range / latticeStep / HISTOGRAM_BINS + 1e-9);
      bins = (int) (Math.floor(range / binWidth + 1e-9) + 1);
    } else {
      binWidth = range / HISTOGRAM_BINS;
      bins = HISTOGRAM_BINS;
    }
    int[] counts = new int[bins];
    int above = 0;
    double topLimit = top + 1e-9 * Math.max(1, Math.abs(top));
    for (int i = 0; i < n; i++) {
      double bin = Math.floor((sorted[i] - from) / binWidth + 1e-9);
      if (bin < bins) counts[(int) bin]++;
      else if (sorted[i] <= topLimit) counts[bins - 1]++;
      else above++;
    }
    return new Histogram(from, binWidth, counts, above);
  }

  private static List<CurvePoint> exceedanceCurve(double[] sorted, Aggregate.Distribution distribution) {
    int n = sorted.length;
    double from = empiricalQuantile(sorted, 0.001);
    double to = empiricalQuantile(sorted, 0.999);
    double step = (to - from) / (CURVE_POINTS - 1);
    int points = step > 0 ? CURVE_POINTS : 1;
    List<CurvePoint> curve = new ArrayList<>(points);
    for (int i = 0; i < points; i++) {
      double threshold = from + i * step;
      curve.add(new CurvePoint(threshold, (double) (n - upperBound(sorted, threshold)) / n,
          exact(distribution, threshold)));
    }
    return curve;
  }

  /** Running mean with its 95% interval, and the running probability of an underwriting loss, in simulation order. */
  private static List<ConvergencePoint> convergence(double[] losses, double claimsBudget) {
    int n = losses.length;
    boolean[] checkpoint = new boolean[n + 1];
    for (int i = 0; i < CONVERGENCE_POINTS; i++) {
      double k = Math.max(2, JsSemantics.round(((double) (i + 1) * n) / CONVERGENCE_POINTS));
      if (k <= n) checkpoint[(int) k] = true;
    }
    List<ConvergencePoint> points = new ArrayList<>();
    double sum = 0;
    double sumSquares = 0;
    double exceed = 0;
    double budgetLimit = claimsBudget + 1e-9 * Math.max(1, Math.abs(claimsBudget));
    for (int i = 0; i < n; i++) {
      double x = losses[i];
      sum += x;
      sumSquares += x * x;
      if (x > budgetLimit) exceed++;
      int k = i + 1;
      if (checkpoint[k]) {
        double mean = sum / k;
        double variance = Math.max(0, (sumSquares - k * mean * mean) / (k - 1));
        double half = Z95 * Math.sqrt(variance / k);
        points.add(new ConvergencePoint(k, mean, mean - half, mean + half, exceed / k));
      }
    }
    return points;
  }
}
