package com.pif.api.stress;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Guards the documented results of the stress-test emulator. Thresholds sit below the values measured on
 * 13 November 2026 (CET1: test R² 0.983 boosting / 0.783 linear; LCR: 0.9998 / 0.879), so a regression in data,
 * training or evaluation fails here instead of silently changing the model card.
 */
class StressModelServiceTest {

  private final StressModelService models = SharedModels.INSTANCE;

  @SuppressWarnings("unchecked")
  private static Map<String, Object> map(Object o) {
    return (Map<String, Object>) o;
  }

  @SuppressWarnings("unchecked")
  private static List<Object> list(Object o) {
    return (List<Object>) o;
  }

  private static double d(Object o) {
    return ((Number) o).doubleValue();
  }

  private double r2(String target, String split, String model) {
    Map<String, Object> t = map(map(models.card().get("targets")).get(target));
    return d(map(map(map(t.get("metrics")).get(split)).get(model)).get("r2"));
  }

  @Test
  void boostingBeatsTheLinearAndMeanModelsOnUnseenScenarios() {
    for (String target : List.of("CET1_CHANGE_PP", "LCR_CHANGE_PP")) {
      assertThat(r2(target, "test", "GBM")).as(target).isGreaterThan(r2(target, "test", "LINEAR"));
      assertThat(r2(target, "test", "LINEAR")).as(target).isGreaterThan(r2(target, "test", "MEAN"));
      assertThat(Math.abs(r2(target, "test", "MEAN"))).as(target).isLessThan(0.01);
    }
    assertThat(r2("CET1_CHANGE_PP", "test", "GBM")).isGreaterThan(0.97);
    assertThat(r2("LCR_CHANGE_PP", "test", "GBM")).isGreaterThan(0.99);
  }

  @Test
  void performanceDegradesOutsideTheTrainingRangesAndTheCardSaysSo() {
    for (String target : List.of("CET1_CHANGE_PP", "LCR_CHANGE_PP")) {
      assertThat(r2(target, "extrapolation", "GBM")).as(target).isLessThan(r2(target, "test", "GBM"));
    }
    assertThat(list(models.card().get("limitations")))
        .anySatisfy(l -> assertThat((String) l).contains("n'extrapolent pas"));
  }

  @Test
  void boostingDetectsThresholdBreachesBetterThanTheLinearModel() {
    Map<String, Object> test = map(map(models.card().get("breachDetection")).get("test"));
    Map<String, Object> gbm = map(test.get("GBM"));
    Map<String, Object> linear = map(test.get("LINEAR"));
    assertThat(d(gbm.get("actualBreaches"))).isPositive();
    assertThat(d(gbm.get("recall"))).isGreaterThan(d(linear.get("recall"))).isGreaterThan(0.95);
    assertThat(d(gbm.get("precision"))).isGreaterThan(0.95);
  }

  @Test
  void permutationImportanceAgreesWithTheEngineStructure() {
    Map<String, Object> targets = map(models.card().get("targets"));
    for (Object o : list(map(targets.get("CET1_CHANGE_PP")).get("permutationImportance"))) {
      Map<String, Object> f = map(o);
      // In the engine, deposit run-offs move liquidity only, never capital.
      if ("runoffMultiplier".equals(f.get("feature"))) assertThat(d(f.get("gbm"))).isLessThan(0.01);
    }
    List<Object> lcr = list(map(targets.get("LCR_CHANGE_PP")).get("permutationImportance"));
    Map<String, Object> top = lcr.stream().map(StressModelServiceTest::map)
        .max((a, b) -> Double.compare(d(a.get("gbm")), d(b.get("gbm")))).orElseThrow();
    assertThat(top.get("feature")).isEqualTo("runoffMultiplier");
  }

  @Test
  void aLocalExplanationAddsUpAndOutOfRangeFactorsAreFlagged() {
    StressService service = new StressService(models);
    Map<String, Object> out = service.run(StressDtos.run(Map.of("factors", Map.of("rateShockBps", 700,
        "unemploymentShockPp", 3))));
    for (Object o : list(out.get("banks"))) {
      Map<String, Object> ai = map(map(o).get("aiEstimate"));
      assertThat(list(ai.get("outsideTrainingRange"))).containsExactly("rateShockBps");
      for (String target : List.of("CET1_CHANGE_PP", "LCR_CHANGE_PP")) {
        Map<String, Object> m = map(ai.get(target));
        double sum = list(m.get("contributions")).stream().mapToDouble(c -> d(map(c).get("model"))).sum();
        assertThat(sum).as(target).isCloseTo(d(m.get("gbm")) - d(m.get("modelReference")), within(1e-4));
        double engineSum = list(m.get("contributions")).stream().mapToDouble(c -> d(map(c).get("engine"))).sum();
        assertThat(engineSum).as(target).isCloseTo(d(m.get("engine")), within(1e-4));
        assertThat(d(m.get("gbmError"))).isCloseTo(d(m.get("gbm")) - d(m.get("engine")), within(1e-5));
      }
    }
  }

  @Test
  void withNoEngineChangeTheTopFactorComparisonIsUndefined() {
    StressService service = new StressService(models);
    Map<String, Object> out = service.run(StressDtos.run(Map.of("scenario", "recession")));
    // The recession preset has no rate or run-off shock: the engine's LCR does not move.
    Map<String, Object> lcr = map(map(map(list(out.get("banks")).get(0)).get("aiEstimate")).get("LCR_CHANGE_PP"));
    assertThat(d(lcr.get("engine"))).isZero();
    assertThat(lcr.get("sameTopFactor")).isNull();
    assertThat(lcr.get("explanationGap")).isNull();
  }

  @Test
  void theModelCardDocumentsItsProtocol() {
    Map<String, Object> protocol = map(models.card().get("protocol"));
    assertThat(d(protocol.get("trainingRows"))).isEqualTo(StressModelService.TRAIN * 2);
    assertThat(d(protocol.get("testRows"))).isEqualTo(StressModelService.TEST * 2);
    assertThat(map(protocol.get("seeds"))).containsKeys("train", "validation", "test", "extrapolation");
    assertThat((String) models.card().get("nature")).contains("pas des banques réelles");
  }
}
