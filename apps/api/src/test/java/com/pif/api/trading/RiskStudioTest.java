package com.pif.api.trading;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.finance.Risk;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RiskStudioTest {

  @Test
  void methodologyStatesHorizonConfidenceAndNeverTreatsVaRAsGuarantee() {
    Map<String, Object> m = RiskStudio.methodology("TND", 12, 2);
    assertThat(m.get("horizon")).isEqualTo("1 jour de bourse");
    assertThat(m.get("confidenceLevel")).isEqualTo(0.95);
    assertThat(m.get("currency")).isEqualTo("TND");
    assertThat(m.get("minVarObservations")).isEqualTo(Risk.MIN_VAR_OBSERVATIONS);
    @SuppressWarnings("unchecked")
    List<String> limitations = (List<String>) m.get("limitations");
    assertThat(limitations.get(0)).contains("ne garantit pas");
    assertThat(limitations.stream().anyMatch(s -> s.contains("12"))).isTrue();
  }

  @Test
  void riskContributionsUnavailableBelowMinObservations() {
    Map<String, Double> values = new LinkedHashMap<>();
    values.put("CTB", 1000.0);
    Map<String, double[]> returns = Map.of("CTB", new double[] {0.01, -0.02, 0.0});
    Map<String, Object> out = RiskStudio.riskContributions(values, returns, 10_000, x -> x);
    assertThat(out.get("available")).isEqualTo(false);
    assertThat((String) out.get("unavailableReason")).contains(String.valueOf(Risk.MIN_VAR_OBSERVATIONS));
  }

  @Test
  void diversificationNeedsTwoHoldings() {
    Map<String, Object> one = RiskStudio.diversification(Map.of("CTB", new double[] {0.01, 0.02, 0.0, -0.01, 0.03}),
        List.of("CTB"));
    assertThat(one.get("meanPairwiseCorrelation")).isNull();
    assertThat(one.get("unavailableReason")).isEqualTo("Il faut au moins deux positions.");
  }

  @Test
  void snapshotFlagsPositionLimitBreach() {
    Map<String, Double> values = Map.of("CTB", 8000.0);
    Map<String, Object> snap = RiskStudio.snapshot(2000, values, 50.0);
    assertThat(snap.get("largestWeight")).isEqualTo(0.8);
    assertThat(snap.get("withinPositionLimit")).isEqualTo(false);
    assertThat(snap.get("exposure")).isEqualTo(0.8);
  }
}
