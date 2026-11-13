package com.pif.api.stress.ml;

/**
 * Ordinary least squares on standardised features, with a vanishing ridge term (λ = 1e-8 · n) only to keep the
 * normal equations well conditioned. Transparent reference model: one coefficient per factor, no interaction.
 */
public final class LinearModel implements Regressor {

  private final double[] mean;
  private final double[] scale;
  private final double intercept;
  private final double[] coefficients;

  private LinearModel(double[] mean, double[] scale, double intercept, double[] coefficients) {
    this.mean = mean;
    this.scale = scale;
    this.intercept = intercept;
    this.coefficients = coefficients;
  }

  public static LinearModel fit(double[][] x, double[] y) {
    int n = x.length;
    int p = x[0].length;
    double[] mean = new double[p];
    double[] scale = new double[p];
    for (double[] row : x) for (int j = 0; j < p; j++) mean[j] += row[j] / n;
    for (double[] row : x) for (int j = 0; j < p; j++) scale[j] += (row[j] - mean[j]) * (row[j] - mean[j]) / n;
    for (int j = 0; j < p; j++) scale[j] = scale[j] > 0 ? Math.sqrt(scale[j]) : 1;

    int k = p + 1;
    double[][] a = new double[k][k];
    double[] b = new double[k];
    double[] z = new double[k];
    for (int i = 0; i < n; i++) {
      z[0] = 1;
      for (int j = 0; j < p; j++) z[j + 1] = (x[i][j] - mean[j]) / scale[j];
      for (int r = 0; r < k; r++) {
        b[r] += z[r] * y[i];
        for (int c = 0; c < k; c++) a[r][c] += z[r] * z[c];
      }
    }
    for (int j = 1; j < k; j++) a[j][j] += 1e-8 * n;
    double[] beta = solve(a, b);
    double[] coef = new double[p];
    System.arraycopy(beta, 1, coef, 0, p);
    return new LinearModel(mean, scale, beta[0], coef);
  }

  /** Gaussian elimination with partial pivoting. */
  static double[] solve(double[][] a, double[] b) {
    int k = b.length;
    double[][] m = new double[k][];
    for (int i = 0; i < k; i++) {
      m[i] = new double[k + 1];
      System.arraycopy(a[i], 0, m[i], 0, k);
      m[i][k] = b[i];
    }
    for (int col = 0; col < k; col++) {
      int pivot = col;
      for (int r = col + 1; r < k; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
      double[] tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
      if (Math.abs(m[col][col]) < 1e-15) throw new IllegalStateException("Singular normal equations");
      for (int r = 0; r < k; r++) {
        if (r == col) continue;
        double factor = m[r][col] / m[col][col];
        for (int c = col; c <= k; c++) m[r][c] -= factor * m[col][c];
      }
    }
    double[] out = new double[k];
    for (int i = 0; i < k; i++) out[i] = m[i][k] / m[i][i];
    return out;
  }

  @Override
  public double predict(double[] x) {
    double s = intercept;
    for (int j = 0; j < coefficients.length; j++) s += coefficients[j] * (x[j] - mean[j]) / scale[j];
    return s;
  }

  /** Effect on the prediction of a one-standard-deviation increase of each feature. */
  public double[] standardisedCoefficients() {
    return coefficients.clone();
  }

  /** Effect of a one-unit increase of each feature, in its own unit. */
  public double[] unitCoefficients() {
    double[] out = new double[coefficients.length];
    for (int j = 0; j < out.length; j++) out[j] = coefficients[j] / scale[j];
    return out;
  }

  public double intercept() {
    return intercept;
  }
}
