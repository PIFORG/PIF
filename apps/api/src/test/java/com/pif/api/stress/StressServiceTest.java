package com.pif.api.stress;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.pif.api.config.OpenApiConfig;
import com.pif.api.web.ApiException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class StressServiceTest {

  private final StressService service = new StressService(SharedModels.INSTANCE);

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

  private Map<String, Object> run(Map<String, Object> body) {
    return service.run(StressDtos.run(body));
  }

  @Test
  void validationAcceptsPresetsOverridesAndIntensity() {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("scenario", "rate-shock");
    body.put("factors", Map.of("equityShockPct", -20));
    body.put("intensity", 0.5);
    StressDtos.RunRequest r = StressDtos.run(body);
    assertThat(r.presetId()).isEqualTo("rate-shock");
    assertThat(r.factors().rateShockBps()).isEqualTo(300);
    assertThat(r.factors().equityShockPct()).isEqualTo(-20);
    assertThat(r.intensity()).isEqualTo(0.5);
    StressDtos.RunRequest empty = StressDtos.run(new LinkedHashMap<>());
    assertThat(empty.factors()).isEqualTo(StressFactors.NEUTRAL);
    assertThat(empty.intensity()).isEqualTo(1);
  }

  @Test
  void validationRejectsUnknownPresetsFactorsAndOutOfRangeValues() {
    assertThatThrownBy(() -> StressDtos.run(Map.of("scenario", "apocalypse"))).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> StressDtos.run(Map.of("factors", Map.of("oilPrice", 1))))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> StressDtos.run(Map.of("factors", Map.of("rateShockBps", 5000))))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> StressDtos.run(Map.of("factors", Map.of("defaultMultiplier", "beaucoup"))))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> StressDtos.run(Map.of("intensity", 3))).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> StressDtos.run(Map.of("extra", true))).isInstanceOf(ApiException.class);
  }

  @Test
  void theCapitalBridgeAddsUpToTheStressedCapitalForBothBanks() {
    Map<String, Object> out = run(Map.of("scenario", "combined-severe"));
    for (Object o : list(out.get("banks"))) {
      Map<String, Object> bank = map(o);
      Map<String, Object> bridge = map(bank.get("capitalBridge"));
      double sum = d(bridge.get("start"));
      for (Object s : list(bridge.get("steps"))) sum += d(map(s).get("amount"));
      double stressedCet1 = d(map(map(bank.get("projections")).get("stressed")).get("cet1"));
      assertThat(sum).as((String) bank.get("id")).isCloseTo(stressedCet1, within(0.01));
      assertThat(d(bridge.get("end"))).isCloseTo(stressedCet1, within(0.001));
    }
  }

  @Test
  void theSevereScenarioBreachesTheCapitalThresholdAndTheBaselineDoesNot() {
    Map<String, Object> severe = run(Map.of("scenario", "combined-severe"));
    for (Object o : list(severe.get("banks"))) {
      Map<String, Object> res = map(map(o).get("resilience"));
      assertThat(res.get("status")).isEqualTo("VULNERABLE");
      assertThat(d(res.get("capitalShortfall"))).isPositive();
    }
    Map<String, Object> baseline = run(Map.of("scenario", "baseline"));
    for (Object o : list(baseline.get("banks"))) {
      Map<String, Object> res = map(map(o).get("resilience"));
      assertThat(res.get("status")).isEqualTo("RESILIENT");
      assertThat(d(res.get("cet1DepletionPp"))).isZero();
    }
  }

  @Test
  void theAttributionAndTheComparisonAreConsistentWithTheProjections() {
    Map<String, Object> out = run(Map.of("scenario", "recession"));
    for (Object o : list(out.get("banks"))) {
      Map<String, Object> attribution = map(map(o).get("attribution"));
      double sum = list(attribution.get("cet1Ratio")).stream().mapToDouble(c -> d(map(c).get("value"))).sum();
      assertThat(sum).isCloseTo(d(attribution.get("cet1RatioTotal")), within(1e-7));
      assertThat(list(attribution.get("explanation"))).isNotEmpty();
    }
    Map<String, Object> comparison = map(out.get("comparison"));
    Map<String, Object> cet1 = map(map(comparison.get("metrics")).get("cet1Ratio"));
    // The three values are each rounded to 6 decimals, so they can disagree by up to two rounding units.
    assertThat(d(cet1.get("difference")))
        .isCloseTo(d(cet1.get("participative")) - d(cet1.get("conventional")), within(2e-6));
    assertThat(list(comparison.get("factorGaps"))).hasSize(StressFactors.DEFINITIONS.size());
    assertThat(list(comparison.get("explanation"))).isNotEmpty()
        .allSatisfy(s -> assertThat((String) s).doesNotContain("NaN").doesNotContain("{"));
    assertThat(list(out.get("sensitivity"))).hasSize(StressService.SENSITIVITY_INTENSITIES.length);
  }

  @Test
  void theCatalogDescribesBothBanksWithBalancedBalanceSheets() {
    Map<String, Object> catalog = service.catalog();
    assertThat(list(catalog.get("banks"))).hasSize(2);
    for (Object o : list(catalog.get("banks"))) {
      Map<String, Object> sheet = map(map(o).get("balanceSheet"));
      assertThat(d(sheet.get("totalAssets"))).isCloseTo(d(sheet.get("totalLiabilitiesAndEquity")), within(1e-9));
    }
    assertThat(list(catalog.get("presets"))).hasSize(StressFactors.PRESETS.size());
    assertThat(list(catalog.get("factors"))).hasSize(8);
  }

  @Test
  void theRequestSchemaIsPublished() {
    assertThat(new OpenApiConfig().pifOpenApi().getComponents().getSchemas()).containsKey("RunStressTestDto");
  }

  @Test
  void frenchFormattingOfExplanations() {
    assertThat(StressService.fr(1234.5, 1)).isEqualTo("1 234,5");
    assertThat(StressService.pp(-0.0215)).isEqualTo("−2,15 pp");
    assertThat(StressService.pp(0.004)).isEqualTo("+0,40 pp");
  }
}
