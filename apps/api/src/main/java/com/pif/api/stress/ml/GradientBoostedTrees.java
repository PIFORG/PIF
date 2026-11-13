package com.pif.api.stress.ml;

import com.pif.api.market.Rng;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * Gradient-boosted regression trees for squared loss (Friedman, 2001). Each round fits a depth-limited regression
 * tree to the current residuals on a random subsample of rows (stochastic gradient boosting), and adds it with a
 * shrinkage factor. The number of rounds is chosen by early stopping on a separate validation set: training stops
 * when validation RMSE has not improved for {@code patience} rounds, and the best round is kept.
 *
 * <p>Trees are grown level by level with exact splits found by one pass over pre-sorted feature columns. All
 * randomness comes from a seeded {@link Rng}, so the same data and parameters always give the same model.
 */
public final class GradientBoostedTrees implements Regressor {

  public record Params(int maxRounds, double learningRate, int maxDepth, int minLeaf, double subsample, int patience,
      long seed) {}

  /**
   * 400 rounds at rate 0.1: on the stress data, test R² of the CET1 model is 0.983 at 400 rounds and 0.986 at 1 000,
   * for 2.5 times the training and explanation cost; early stopping still guards against a degrading validation.
   */
  public static final Params DEFAULT = new Params(400, 0.1, 4, 20, 0.8, 50, 20261113L);

  /** One regression tree in flat arrays; leaves have feature −1. */
  static final class Tree {
    final int[] feature;
    final double[] threshold;
    final int[] left;
    final int[] right;
    final double[] value;

    Tree(int[] feature, double[] threshold, int[] left, int[] right, double[] value) {
      this.feature = feature;
      this.threshold = threshold;
      this.left = left;
      this.right = right;
      this.value = value;
    }

    double predict(double[] x) {
      int node = 0;
      while (feature[node] >= 0) node = x[feature[node]] <= threshold[node] ? left[node] : right[node];
      return value[node];
    }
  }

  private final double base;
  private final List<Tree> trees;
  private final double learningRate;
  private final double[] validationCurve;

  private GradientBoostedTrees(double base, List<Tree> trees, double learningRate, double[] validationCurve) {
    this.base = base;
    this.trees = trees;
    this.learningRate = learningRate;
    this.validationCurve = validationCurve;
  }

  public int rounds() {
    return trees.size();
  }

  /** Validation RMSE after each round actually trained (including rounds discarded by early stopping). */
  public double[] validationCurve() {
    return validationCurve.clone();
  }

  @Override
  public double predict(double[] x) {
    double s = base;
    for (Tree t : trees) s += learningRate * t.predict(x);
    return s;
  }

  public static GradientBoostedTrees fit(double[][] x, double[] y, double[][] valX, double[] valY, Params p) {
    int n = x.length;
    int features = x[0].length;
    double base = Regressor.MeanModel.fit(y).mean();

    int[][] sorted = new int[features][];
    for (int f = 0; f < features; f++) {
      final int feat = f;
      Integer[] idx = new Integer[n];
      for (int i = 0; i < n; i++) idx[i] = i;
      Arrays.sort(idx, Comparator.comparingDouble(i -> x[i][feat]));
      sorted[f] = new int[n];
      for (int i = 0; i < n; i++) sorted[f][i] = idx[i];
    }

    double[] pred = new double[n];
    Arrays.fill(pred, base);
    double[] valPred = new double[valX.length];
    Arrays.fill(valPred, base);

    Rng rng = new Rng(p.seed());
    List<Tree> trees = new ArrayList<>();
    List<Double> curve = new ArrayList<>();
    double best = Double.POSITIVE_INFINITY;
    int bestRounds = 0;
    double[] residual = new double[n];
    boolean[] inSample = new boolean[n];

    for (int round = 0; round < p.maxRounds(); round++) {
      for (int i = 0; i < n; i++) {
        residual[i] = y[i] - pred[i];
        inSample[i] = rng.uniform() < p.subsample();
      }
      Tree tree = grow(x, residual, inSample, sorted, p);
      trees.add(tree);
      for (int i = 0; i < n; i++) pred[i] += p.learningRate() * tree.predict(x[i]);
      for (int i = 0; i < valX.length; i++) valPred[i] += p.learningRate() * tree.predict(valX[i]);
      double rmse = Metrics.rmse(valY, valPred);
      curve.add(rmse);
      if (rmse < best - 1e-12) {
        best = rmse;
        bestRounds = trees.size();
      } else if (trees.size() - bestRounds >= p.patience()) {
        break;
      }
    }
    double[] c = new double[curve.size()];
    for (int i = 0; i < c.length; i++) c[i] = curve.get(i);
    return new GradientBoostedTrees(base, List.copyOf(trees.subList(0, bestRounds)), p.learningRate(), c);
  }

  /** Level-wise growth: at each depth, one pass per feature finds the best split of every open node. */
  static Tree grow(double[][] x, double[] r, boolean[] inSample, int[][] sorted, Params p) {
    int n = x.length;
    int features = x[0].length;
    List<int[]> structure = new ArrayList<>(); // {feature, left, right}
    List<Double> thresholds = new ArrayList<>();
    List<Double> values = new ArrayList<>();

    int[] nodeOf = new int[n];
    double rootSum = 0;
    int rootCount = 0;
    for (int i = 0; i < n; i++) {
      nodeOf[i] = inSample[i] ? 0 : -1;
      if (inSample[i]) {
        rootSum += r[i];
        rootCount++;
      }
    }
    structure.add(new int[] {-1, -1, -1});
    thresholds.add(0.0);
    values.add(rootCount == 0 ? 0 : rootSum / rootCount);

    List<Integer> open = new ArrayList<>(List.of(0));
    for (int depth = 0; depth < p.maxDepth() && !open.isEmpty(); depth++) {
      int nodes = structure.size();
      double[] sum = new double[nodes];
      int[] count = new int[nodes];
      for (int i = 0; i < n; i++) {
        if (nodeOf[i] >= 0) {
          sum[nodeOf[i]] += r[i];
          count[nodeOf[i]]++;
        }
      }
      double[] bestGain = new double[nodes];
      int[] bestFeature = new int[nodes];
      double[] bestThreshold = new double[nodes];
      Arrays.fill(bestFeature, -1);
      boolean[] isOpen = new boolean[nodes];
      for (int node : open) isOpen[node] = true;

      double[] leftSum = new double[nodes];
      int[] leftCount = new int[nodes];
      double[] lastValue = new double[nodes];
      for (int f = 0; f < features; f++) {
        Arrays.fill(leftSum, 0);
        Arrays.fill(leftCount, 0);
        for (int i : sorted[f]) {
          int node = nodeOf[i];
          if (node < 0 || !isOpen[node]) continue;
          double v = x[i][f];
          int nl = leftCount[node];
          int nr = count[node] - nl;
          if (nl >= p.minLeaf() && nr >= p.minLeaf() && v > lastValue[node]) {
            double sl = leftSum[node];
            double sr = sum[node] - sl;
            double gain = sl * sl / nl + sr * sr / nr - sum[node] * sum[node] / count[node];
            if (gain > bestGain[node] + 1e-12) {
              bestGain[node] = gain;
              bestFeature[node] = f;
              bestThreshold[node] = (lastValue[node] + v) / 2;
            }
          }
          leftSum[node] += r[i];
          leftCount[node]++;
          lastValue[node] = v;
        }
      }

      List<Integer> next = new ArrayList<>();
      for (int node : open) {
        if (bestFeature[node] < 0) continue;
        int l = structure.size();
        structure.add(new int[] {-1, -1, -1});
        thresholds.add(0.0);
        values.add(0.0);
        int rr = structure.size();
        structure.add(new int[] {-1, -1, -1});
        thresholds.add(0.0);
        values.add(0.0);
        structure.set(node, new int[] {bestFeature[node], l, rr});
        thresholds.set(node, bestThreshold[node]);
        next.add(l);
        next.add(rr);
      }
      int total = structure.size();
      double[] newSum = new double[total];
      int[] newCount = new int[total];
      for (int i = 0; i < n; i++) {
        int node = nodeOf[i];
        if (node < 0) continue;
        int[] s = structure.get(node);
        if (s[0] < 0) {
          nodeOf[i] = -1; // became a leaf
          continue;
        }
        int child = x[i][s[0]] <= thresholds.get(node) ? s[1] : s[2];
        nodeOf[i] = child;
        newSum[child] += r[i];
        newCount[child]++;
      }
      for (int child : next) values.set(child, newCount[child] == 0 ? 0 : newSum[child] / newCount[child]);
      open = next;
    }

    int m = structure.size();
    int[] feature = new int[m];
    int[] left = new int[m];
    int[] right = new int[m];
    double[] threshold = new double[m];
    double[] value = new double[m];
    for (int k = 0; k < m; k++) {
      int[] s = structure.get(k);
      feature[k] = s[0];
      left[k] = s[1];
      right[k] = s[2];
      threshold[k] = thresholds.get(k);
      value[k] = values.get(k);
    }
    return new Tree(feature, threshold, left, right, value);
  }
}
