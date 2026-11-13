package com.pif.api.stress.ml;

import com.pif.api.market.Rng;
import com.pif.api.stress.BankProfile;
import com.pif.api.stress.StressEngine;
import com.pif.api.stress.StressFactors;
import java.util.List;

/**
 * Synthetic training data for the stress-test emulator. Each row is one (scenario, bank) pair: the eight scenario
 * factors and a bank indicator are the features; the targets are what the deterministic engine computes for that
 * pair. The data says nothing about real banks: a model trained on it learns to reproduce the engine.
 *
 * <p>Sampling: every factor is left neutral with probability {@link #NEUTRAL_PROBABILITY}, otherwise drawn
 * uniformly in its training range. The "extrapolation" set draws every factor in its full accepted range instead,
 * so it contains scenarios more severe than anything seen in training.
 */
public final class ScenarioDataset {

  public static final double NEUTRAL_PROBABILITY = 0.4;

  /** Training range per factor, in {@link StressFactors#DEFINITIONS} order: narrower than the accepted range. */
  public static final double[][] TRAINING_RANGE = {
      {-200, 500},  // rate shock, bp
      {-50, 10},    // equity, %
      {-1, 8},      // unemployment, pp
      {-8, 2},      // GDP, pp
      {-40, 10},    // property, %
      {-50, 10},    // revenue, %
      {0.8, 3},     // default multiplier
      {0.8, 3}};    // run-off multiplier

  public static final List<String> FEATURES = featureNames();
  public static final int BANK_FEATURE = StressFactors.DEFINITIONS.size();

  public enum Target {
    CET1_CHANGE_PP("Variation du ratio CET1 (pp)"),
    LCR_CHANGE_PP("Variation du LCR (pp)");

    public final String label;

    Target(String label) {
      this.label = label;
    }
  }

  public record Data(double[][] x, double[][] y, double[] baselineCet1, double[] baselineLcr) {
    public int size() {
      return x.length;
    }

    public double[] target(Target t) {
      double[] out = new double[y.length];
      for (int i = 0; i < y.length; i++) out[i] = y[i][t.ordinal()];
      return out;
    }
  }

  private ScenarioDataset() {}

  private static List<String> featureNames() {
    java.util.ArrayList<String> names = new java.util.ArrayList<>();
    for (StressFactors.Definition d : StressFactors.DEFINITIONS) names.add(d.key());
    names.add("participativeBank");
    return List.copyOf(names);
  }

  /** Feature vector of a scenario for a bank: the eight factors, then 1 for the participative bank, 0 otherwise. */
  public static double[] features(StressFactors f, BankProfile bank) {
    double[] x = new double[FEATURES.size()];
    for (int i = 0; i < BANK_FEATURE; i++) x[i] = f.get(i);
    x[BANK_FEATURE] = bank.participative() == null ? 0 : 1;
    return x;
  }

  public static StressFactors sample(Rng rng, boolean extrapolation) {
    double[] v = new double[BANK_FEATURE];
    for (int i = 0; i < BANK_FEATURE; i++) {
      StressFactors.Definition d = StressFactors.DEFINITIONS.get(i);
      if (rng.uniform() < NEUTRAL_PROBABILITY) {
        v[i] = d.neutral();
        rng.uniform(); // keep the stream aligned whatever the branch
        continue;
      }
      double lo = extrapolation ? d.min() : TRAINING_RANGE[i][0];
      double hi = extrapolation ? d.max() : TRAINING_RANGE[i][1];
      v[i] = lo + rng.uniform() * (hi - lo);
    }
    return new StressFactors(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
  }

  /** {@code scenarios} sampled scenarios, each evaluated for both banks (2 × scenarios rows). */
  public static Data generate(long seed, int scenarios, boolean extrapolation) {
    Rng rng = new Rng(seed);
    int n = scenarios * BankProfile.ALL.size();
    double[][] x = new double[n][];
    double[][] y = new double[n][];
    double[] baseCet1 = new double[n];
    double[] baseLcr = new double[n];
    double[][] neutral = new double[BankProfile.ALL.size()][];
    for (int b = 0; b < BankProfile.ALL.size(); b++) {
      StressEngine.Ratios r = StressEngine.run(BankProfile.ALL.get(b), StressFactors.NEUTRAL).ratios();
      neutral[b] = new double[] {r.cet1Ratio(), r.lcr()};
    }
    int row = 0;
    for (int s = 0; s < scenarios; s++) {
      StressFactors f = sample(rng, extrapolation);
      for (int b = 0; b < BankProfile.ALL.size(); b++) {
        BankProfile bank = BankProfile.ALL.get(b);
        StressEngine.Ratios r = StressEngine.run(bank, f).ratios();
        x[row] = features(f, bank);
        y[row] = new double[] {100 * (r.cet1Ratio() - neutral[b][0]), 100 * (r.lcr() - neutral[b][1])};
        baseCet1[row] = neutral[b][0];
        baseLcr[row] = neutral[b][1];
        row++;
      }
    }
    return new Data(x, y, baseCet1, baseLcr);
  }
}
