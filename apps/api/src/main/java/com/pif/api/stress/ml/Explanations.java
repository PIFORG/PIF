package com.pif.api.stress.ml;

import com.pif.api.market.Rng;

/** Model-agnostic explanations: permutation importance (global) and exact Shapley values against a reference (local). */
public final class Explanations {

  private Explanations() {}

  public record Importance(double mean, double std) {}

  /**
   * Breiman-style permutation importance: increase in RMSE on held-out data when one feature's column is shuffled,
   * which breaks its link with the target while keeping its distribution. Averaged over {@code repeats} seeded
   * shuffles. Measures what the model relies on, not what causes the target.
   */
  public static Importance[] permutationImportance(Regressor model, double[][] x, double[] y, int repeats,
      long seed) {
    double reference = Metrics.rmse(y, model.predictAll(x));
    int p = x[0].length;
    int n = x.length;
    Importance[] out = new Importance[p];
    Rng rng = new Rng(seed);
    for (int j = 0; j < p; j++) {
      double[] increases = new double[repeats];
      for (int k = 0; k < repeats; k++) {
        int[] perm = new int[n];
        for (int i = 0; i < n; i++) perm[i] = i;
        for (int i = n - 1; i > 0; i--) {
          int swap = (int) Math.floor(rng.uniform() * (i + 1));
          int t = perm[i];
          perm[i] = perm[swap];
          perm[swap] = t;
        }
        double[] pred = new double[n];
        double[] row = new double[p];
        for (int i = 0; i < n; i++) {
          System.arraycopy(x[i], 0, row, 0, p);
          row[j] = x[perm[i]][j];
          pred[i] = model.predict(row);
        }
        increases[k] = Metrics.rmse(y, pred) - reference;
      }
      double mean = 0;
      for (double v : increases) mean += v / repeats;
      double var = 0;
      for (double v : increases) var += (v - mean) * (v - mean) / Math.max(1, repeats - 1);
      out[j] = new Importance(mean, Math.sqrt(var));
    }
    return out;
  }

  /**
   * Exact Shapley values of a model prediction over the features listed in {@code players}, with the others held at
   * their value in {@code x}. An absent player takes its value in {@code reference} (interventional Shapley with a
   * single reference point). φ sums exactly to f(x) − f(x with every player at its reference value).
   */
  public static double[] shapley(Regressor model, double[] x, double[] reference, int[] players) {
    int n = players.length;
    int coalitions = 1 << n;
    double[] value = new double[coalitions];
    double[] row = new double[x.length];
    for (int mask = 0; mask < coalitions; mask++) {
      System.arraycopy(x, 0, row, 0, x.length);
      for (int k = 0; k < n; k++) if ((mask & (1 << k)) == 0) row[players[k]] = reference[players[k]];
      value[mask] = model.predict(row);
    }
    double[] fact = new double[n + 1];
    fact[0] = 1;
    for (int i = 1; i <= n; i++) fact[i] = fact[i - 1] * i;
    double[] phi = new double[n];
    for (int k = 0; k < n; k++) {
      int bit = 1 << k;
      double s = 0;
      for (int mask = 0; mask < coalitions; mask++) {
        if ((mask & bit) != 0) continue;
        int size = Integer.bitCount(mask);
        s += fact[size] * fact[n - size - 1] / fact[n] * (value[mask | bit] - value[mask]);
      }
      phi[k] = s;
    }
    return phi;
  }
}
