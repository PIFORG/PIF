package com.pif.api.stress.ml;

/** Evaluation metrics for regression and for the derived breach / no-breach classification. */
public final class Metrics {

  private Metrics() {}

  public static double mae(double[] y, double[] p) {
    double s = 0;
    for (int i = 0; i < y.length; i++) s += Math.abs(y[i] - p[i]);
    return s / y.length;
  }

  public static double rmse(double[] y, double[] p) {
    double s = 0;
    for (int i = 0; i < y.length; i++) s += (y[i] - p[i]) * (y[i] - p[i]);
    return Math.sqrt(s / y.length);
  }

  /** Coefficient of determination 1 − SS_res / SS_tot (can be negative for a model worse than the mean). */
  public static double r2(double[] y, double[] p) {
    double mean = 0;
    for (double v : y) mean += v / y.length;
    double res = 0;
    double tot = 0;
    for (int i = 0; i < y.length; i++) {
      res += (y[i] - p[i]) * (y[i] - p[i]);
      tot += (y[i] - mean) * (y[i] - mean);
    }
    return tot == 0 ? 0 : 1 - res / tot;
  }

  public record Classification(int truePositive, int falsePositive, int falseNegative, int trueNegative) {
    public double precision() {
      return truePositive + falsePositive == 0 ? Double.NaN : (double) truePositive / (truePositive + falsePositive);
    }

    public double recall() {
      return truePositive + falseNegative == 0 ? Double.NaN : (double) truePositive / (truePositive + falseNegative);
    }

    public double accuracy() {
      return (double) (truePositive + trueNegative) / (truePositive + falsePositive + falseNegative + trueNegative);
    }

    public int positives() {
      return truePositive + falseNegative;
    }
  }

  public static Classification classify(boolean[] actual, boolean[] predicted) {
    int tp = 0;
    int fp = 0;
    int fn = 0;
    int tn = 0;
    for (int i = 0; i < actual.length; i++) {
      if (actual[i] && predicted[i]) tp++;
      else if (!actual[i] && predicted[i]) fp++;
      else if (actual[i]) fn++;
      else tn++;
    }
    return new Classification(tp, fp, fn, tn);
  }
}
