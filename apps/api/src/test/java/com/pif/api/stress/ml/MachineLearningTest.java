package com.pif.api.stress.ml;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.pif.api.market.Rng;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class MachineLearningTest {

  /** n rows of three features uniform in [−1, 1]; the third never enters the target. */
  private static double[][] features(long seed, int n) {
    Rng rng = new Rng(seed);
    double[][] x = new double[n][3];
    for (double[] row : x) for (int j = 0; j < 3; j++) row[j] = 2 * rng.uniform() - 1;
    return x;
  }

  private static double nonLinear(double[] x) {
    return (x[0] > 0 ? 3 : -1) * x[1] + x[0] * x[0];
  }

  @Test
  void metricsMatchHandComputedValues() {
    double[] y = {1, 2, 3, 4};
    double[] p = {1, 3, 2, 4};
    assertThat(Metrics.mae(y, p)).isEqualTo(0.5);
    assertThat(Metrics.rmse(y, p)).isCloseTo(Math.sqrt(0.5), within(1e-15));
    assertThat(Metrics.r2(y, p)).isCloseTo(1 - 2 / 5.0, within(1e-15));
    Metrics.Classification c = Metrics.classify(new boolean[] {true, true, false, false},
        new boolean[] {true, false, true, false});
    assertThat(c.precision()).isEqualTo(0.5);
    assertThat(c.recall()).isEqualTo(0.5);
    assertThat(c.accuracy()).isEqualTo(0.5);
  }

  @Test
  void linearRegressionRecoversKnownCoefficients() {
    double[][] x = features(1, 500);
    double[] y = Arrays.stream(x).mapToDouble(r -> 2 + 3 * r[0] - 0.5 * r[1]).toArray();
    LinearModel m = LinearModel.fit(x, y);
    double[] unit = m.unitCoefficients();
    assertThat(unit[0]).isCloseTo(3, within(1e-6));
    assertThat(unit[1]).isCloseTo(-0.5, within(1e-6));
    assertThat(unit[2]).isCloseTo(0, within(1e-6));
    assertThat(m.predict(new double[] {0, 0, 0})).isCloseTo(2, within(1e-6));
  }

  @Test
  void boostingLearnsANonLinearFunctionThatALinearModelCannot() {
    double[][] train = features(11, 3000);
    double[][] val = features(12, 800);
    double[][] test = features(13, 1500);
    double[] yTrain = Arrays.stream(train).mapToDouble(MachineLearningTest::nonLinear).toArray();
    double[] yVal = Arrays.stream(val).mapToDouble(MachineLearningTest::nonLinear).toArray();
    double[] yTest = Arrays.stream(test).mapToDouble(MachineLearningTest::nonLinear).toArray();

    GradientBoostedTrees gbm = GradientBoostedTrees.fit(train, yTrain, val, yVal, GradientBoostedTrees.DEFAULT);
    LinearModel linear = LinearModel.fit(train, yTrain);
    double gbmR2 = Metrics.r2(yTest, gbm.predictAll(test));
    double linR2 = Metrics.r2(yTest, linear.predictAll(test));
    assertThat(gbmR2).isGreaterThan(0.97);
    assertThat(linR2).isLessThan(0.8);
    assertThat(gbm.rounds()).isPositive().isLessThanOrEqualTo(GradientBoostedTrees.DEFAULT.maxRounds());
    double[] curve = gbm.validationCurve();
    double best = Arrays.stream(curve).min().orElseThrow();
    assertThat(curve[gbm.rounds() - 1]).isEqualTo(best);
  }

  @Test
  void trainingIsReproducible() {
    double[][] train = features(21, 800);
    double[][] val = features(22, 200);
    double[] y = Arrays.stream(train).mapToDouble(MachineLearningTest::nonLinear).toArray();
    double[] yVal = Arrays.stream(val).mapToDouble(MachineLearningTest::nonLinear).toArray();
    GradientBoostedTrees a = GradientBoostedTrees.fit(train, y, val, yVal, GradientBoostedTrees.DEFAULT);
    GradientBoostedTrees b = GradientBoostedTrees.fit(train, y, val, yVal, GradientBoostedTrees.DEFAULT);
    assertThat(a.rounds()).isEqualTo(b.rounds());
    assertThat(a.predictAll(val)).containsExactly(b.predictAll(val));
  }

  @Test
  void permutationImportanceIgnoresAnUnusedFeature() {
    double[][] x = features(31, 1000);
    double[] y = Arrays.stream(x).mapToDouble(r -> 3 * r[0] - 0.5 * r[1]).toArray();
    LinearModel m = LinearModel.fit(x, y);
    Explanations.Importance[] imp = Explanations.permutationImportance(m, x, y, 5, 7);
    assertThat(imp[0].mean()).isGreaterThan(imp[1].mean());
    assertThat(imp[1].mean()).isGreaterThan(0.1);
    assertThat(imp[2].mean()).isCloseTo(0, within(1e-6));
  }

  @Test
  void modelShapleyValuesAreEfficientAndExactForAnAdditiveModel() {
    Regressor additive = x -> 2 * x[0] + x[1] * x[1] - x[2];
    double[] x = {1, 2, 3};
    double[] ref = {0, 0, 0};
    double[] phi = Explanations.shapley(additive, x, ref, new int[] {0, 1, 2});
    assertThat(phi[0]).isCloseTo(2, within(1e-12));
    assertThat(phi[1]).isCloseTo(4, within(1e-12));
    assertThat(phi[2]).isCloseTo(-3, within(1e-12));
    Regressor interaction = v -> v[0] * v[1];
    double[] psi = Explanations.shapley(interaction, new double[] {2, 3, 0}, ref, new int[] {0, 1});
    assertThat(psi[0] + psi[1]).isCloseTo(6, within(1e-12));
    assertThat(psi[0]).isCloseTo(3, within(1e-12)); // the interaction is split equally
  }

  @Test
  void datasetsAreReproducibleAndSeedsGiveDisjointSamples() {
    ScenarioDataset.Data a = ScenarioDataset.generate(5, 50, false);
    ScenarioDataset.Data b = ScenarioDataset.generate(5, 50, false);
    ScenarioDataset.Data c = ScenarioDataset.generate(6, 50, false);
    assertThat(a.x()).isDeepEqualTo(b.x());
    assertThat(a.y()).isDeepEqualTo(b.y());
    assertThat(Arrays.deepEquals(a.x(), c.x())).isFalse();
    assertThat(a.size()).isEqualTo(100);
    assertThat(a.x()[0][ScenarioDataset.BANK_FEATURE]).isZero();
    assertThat(a.x()[1][ScenarioDataset.BANK_FEATURE]).isOne();
    // Training samples stay inside their training ranges.
    for (double[] row : a.x()) {
      for (int j = 0; j < ScenarioDataset.BANK_FEATURE; j++) {
        assertThat(row[j]).isBetween(Math.min(ScenarioDataset.TRAINING_RANGE[j][0],
            com.pif.api.stress.StressFactors.DEFINITIONS.get(j).neutral()), ScenarioDataset.TRAINING_RANGE[j][1]);
      }
    }
  }
}
