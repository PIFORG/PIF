package com.pif.api.actuarial;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleUnaryOperator;

/**
 * Individual claim-cost models (apps/api/src/actuarial/models/severity.ts), all on (0, ∞) and parameterised by the
 * arithmetic mean m and the coefficient of variation c = sd / m that a pricing actuary reasons with.
 *
 * <p>DETERMINISTIC — every claim costs exactly m (variance 0). GAMMA — shape k = 1/c², scale θ = m·c², so E[X] = kθ =
 * m and Var(X) = kθ² = (c·m)². LOGNORMAL — ln X ~ Normal(μ, σ²) with σ² = ln(1 + c²) and μ = ln m − σ²/2. μ and σ are
 * the mean and sd of ln X, NOT of X; E[X] = e^(μ + σ²/2) = m and Var(X) = (e^(σ²) − 1)·m².
 *
 * <p>Normal distributions are deliberately absent: claim costs cannot be negative.
 */
final class Severity {

  static final List<String> FAMILIES = List.of("DETERMINISTIC", "GAMMA", "LOGNORMAL");

  private Severity() {}

  /** A null number is a field the request left undefined. */
  record Assumptions(String family, Double mean, Double cv) {}

  /**
   * One fitted model. {@code density} is null for the deterministic (point-mass) model; {@code limitedMean} is E[min(X,
   * d)].
   */
  record Model(String family, double mean, double variance, Map<String, Double> parameters, DoubleUnaryOperator cdf,
      DoubleUnaryOperator density, DoubleUnaryOperator quantile, DoubleUnaryOperator limitedMean) {

    boolean deterministic() {
      return family.equals("DETERMINISTIC");
    }

    double parameter(String name) {
      return parameters.get(name);
    }
  }

  static Model model(Assumptions input) {
    double m = Frequency.num(input.mean());
    if (!(m > 0) || !Double.isFinite(m)) throw new AssumptionException("mean claim cost must be positive");

    if ("DETERMINISTIC".equals(input.family())) {
      return new Model("DETERMINISTIC", m, 0, params("value", m), x -> x >= m ? 1 : 0, null, level -> m,
          d -> Math.max(0, Math.min(d, m)));
    }

    Double cv = input.cv();
    if (cv == null || !(cv > 0) || !Double.isFinite(cv)) {
      throw new AssumptionException("coefficient of variation must be positive");
    }
    double c = cv;

    if ("GAMMA".equals(input.family())) {
      double shape = 1 / (c * c);
      double scale = m * c * c;
      double logNorm = Special.logGamma(shape) + shape * StrictMath.log(scale);
      DoubleUnaryOperator cdf = x -> x <= 0 ? 0 : Special.gammaP(shape, x / scale);
      double sd = c * m;
      return new Model("GAMMA", m, sd * sd, params("shape", shape, "scale", scale), cdf,
          x -> x <= 0 ? 0 : StrictMath.exp((shape - 1) * StrictMath.log(x) - x / scale - logNorm),
          level -> Special.invertCdf(cdf, level, m),
          d -> d <= 0 ? 0 : m * Special.gammaP(shape + 1, d / scale) + d * Special.gammaQ(shape, d / scale));
    }

    double sigma2 = StrictMath.log1p(c * c);
    double sigma = Math.sqrt(sigma2);
    double mu = StrictMath.log(m) - sigma2 / 2;
    return new Model("LOGNORMAL", m, StrictMath.expm1(sigma2) * m * m, params("mu", mu, "sigma", sigma),
        x -> x <= 0 ? 0 : Special.normalCdf((StrictMath.log(x) - mu) / sigma),
        x -> {
          if (x <= 0) return 0;
          double z = StrictMath.log(x) - mu;
          return StrictMath.exp(-(z * z) / (2 * sigma2)) / (x * sigma * Math.sqrt(2 * Math.PI));
        },
        level -> StrictMath.exp(mu + sigma * Special.normalQuantile(level)),
        d -> {
          if (d <= 0) return 0;
          double z = (StrictMath.log(d) - mu) / sigma;
          return m * Special.normalCdf(z - sigma) + d * Special.normalCdf(-z);
        });
  }

  /** Claim-cost trend factor (1 + i)^years applied to the mean (all three families are scale families). */
  static double trendFactor(double annualRate, double years) {
    if (!(annualRate > -1)) throw new AssumptionException("inflation must be above −100%");
    return StrictMath.pow(1 + annualRate, years);
  }

  private static Map<String, Double> params(Object... entries) {
    Map<String, Double> map = new LinkedHashMap<>();
    for (int i = 0; i < entries.length; i += 2) map.put((String) entries[i], (Double) entries[i + 1]);
    return map;
  }
}
