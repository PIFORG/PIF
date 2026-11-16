package com.pif.api.ai;

import com.pif.api.market.Rng;
import java.util.ArrayList;
import java.util.List;

/**
 * Chronological synthetic market series for educational ML. Prices are fictional and reproducible from a seed.
 * Features at day t use only information available at t; the target is the next-day return (no look-ahead).
 */
final class AiDataset {

  static final String[] FEATURE_NAMES = {
      "rendement_1j", "rendement_5j", "volatilite_10j", "momentum_20j", "ecart_moyenne_20j", "volume_relatif"
  };

  record Sample(double[] x, double y, String day) {}

  record Split(List<Sample> train, List<Sample> validation, List<Sample> test) {}

  private AiDataset() {}

  /** Build a chronological split: 60 % train, 20 % validation, 20 % test on ordered days. */
  static Split build(long seed, int days) {
    Rng rng = new Rng(seed);
    double price = 100;
    double[] closes = new double[days];
    double[] volumes = new double[days];
    for (int i = 0; i < days; i++) {
      double shock = rng.normal() * 0.012 + 0.0002;
      price = Math.max(5, price * (1 + shock));
      closes[i] = price;
      volumes[i] = 0.7 + rng.uniform() * 0.8;
    }

    List<Sample> samples = new ArrayList<>();
    for (int t = 20; t < days - 1; t++) {
      double r1 = closes[t] / closes[t - 1] - 1;
      double r5 = closes[t] / closes[t - 5] - 1;
      double vol = 0;
      for (int k = 0; k < 10; k++) {
        double ri = closes[t - k] / closes[t - k - 1] - 1;
        vol += ri * ri;
      }
      vol = Math.sqrt(vol / 10);
      double mom = closes[t] / closes[t - 20] - 1;
      double sma = 0;
      for (int k = 0; k < 20; k++) sma += closes[t - k];
      sma /= 20;
      double gap = closes[t] / sma - 1;
      double vRel = volumes[t] / average(volumes, t - 9, t);
      double next = closes[t + 1] / closes[t] - 1;
      samples.add(new Sample(new double[] {r1, r5, vol, mom, gap, vRel}, next, "J" + (t + 1)));
    }

    int n = samples.size();
    int trainEnd = (int) Math.floor(n * 0.6);
    int valEnd = (int) Math.floor(n * 0.8);
    return new Split(
        List.copyOf(samples.subList(0, trainEnd)),
        List.copyOf(samples.subList(trainEnd, valEnd)),
        List.copyOf(samples.subList(valEnd, n)));
  }

  private static double average(double[] values, int from, int toInclusive) {
    double s = 0;
    int n = 0;
    for (int i = Math.max(0, from); i <= toInclusive; i++) {
      s += values[i];
      n++;
    }
    return n == 0 ? 1 : s / n;
  }

  static double[][] matrix(List<Sample> samples) {
    double[][] x = new double[samples.size()][];
    for (int i = 0; i < samples.size(); i++) x[i] = samples.get(i).x();
    return x;
  }

  static double[] targets(List<Sample> samples) {
    double[] y = new double[samples.size()];
    for (int i = 0; i < samples.size(); i++) y[i] = samples.get(i).y();
    return y;
  }
}
