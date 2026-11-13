package com.pif.api.stress.ml;

/** A fitted regression model: a pure function from a feature vector to a prediction. */
public interface Regressor {

  double predict(double[] x);

  default double[] predictAll(double[][] x) {
    double[] out = new double[x.length];
    for (int i = 0; i < x.length; i++) out[i] = predict(x[i]);
    return out;
  }

  /** Predicts the training mean: the floor any useful model must beat. */
  record MeanModel(double mean) implements Regressor {
    public static MeanModel fit(double[] y) {
      double s = 0;
      for (double v : y) s += v;
      return new MeanModel(s / y.length);
    }

    @Override
    public double predict(double[] x) {
      return mean;
    }
  }
}
