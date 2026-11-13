package com.pif.api.stress;

import java.util.function.ToDoubleFunction;

/**
 * Exact Shapley decomposition of a stress result over the eight scenario factors.
 *
 * <p>The "game" is the deterministic engine itself: v(S) is the metric when only the factors in S take their
 * stressed value and the others stay neutral, minus the metric with every factor neutral. The Shapley value of
 * factor i is the average, over every order in which factors can be switched on, of the change i causes:
 * <pre>φᵢ = Σ_{S ⊆ N∖{i}} |S|! (n−|S|−1)! / n! · [v(S ∪ {i}) − v(S)].</pre>
 * With n = 8 the 256 coalitions are evaluated exactly (no sampling). The contributions add up exactly to the total
 * change (efficiency), and a factor left neutral receives zero. Interaction effects between two factors are split
 * equally between them. This explains the model's arithmetic; it is not a causal statement about real banks.
 */
public final class StressAttribution {

  private StressAttribution() {}

  public static final int FACTORS = StressFactors.DEFINITIONS.size();

  /** Shapley values of {@code metric} for every factor, in {@link StressFactors#DEFINITIONS} order. */
  public static double[] shapley(BankProfile bank, StressFactors scenario,
      ToDoubleFunction<StressEngine.Outcome> metric) {
    int n = FACTORS;
    int coalitions = 1 << n;
    double[] value = new double[coalitions];
    for (int mask = 0; mask < coalitions; mask++) {
      value[mask] = metric.applyAsDouble(StressEngine.run(bank, scenario.only(mask)));
    }
    double[] weight = new double[n];
    double nFact = factorial(n);
    for (int s = 0; s < n; s++) weight[s] = factorial(s) * factorial(n - s - 1) / nFact;

    double[] phi = new double[n];
    for (int i = 0; i < n; i++) {
      int bit = 1 << i;
      double sum = 0;
      for (int mask = 0; mask < coalitions; mask++) {
        if ((mask & bit) != 0) continue;
        sum += weight[Integer.bitCount(mask)] * (value[mask | bit] - value[mask]);
      }
      phi[i] = sum;
    }
    return phi;
  }

  private static double factorial(int k) {
    double f = 1;
    for (int i = 2; i <= k; i++) f *= i;
    return f;
  }
}
