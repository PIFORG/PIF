package com.pif.api.actuarial;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ActuarialCoreTest {

  @Test
  void poissonMeanEqualsVariance() {
    Frequency.Model model = Frequency.model(new Frequency.Assumptions("POISSON", 1000.0, 1.0, null, 0.02));
    assertThat(model.mean).isCloseTo(20.0, within(1e-12));
    assertThat(model.variance).isCloseTo(20.0, within(1e-12));
    assertThat(model.family).isEqualTo("POISSON");
  }

  @Test
  void binomialPeriodProbabilityAndMean() {
    Frequency.Model model = Frequency.model(new Frequency.Assumptions("BINOMIAL", 100.0, 1.0, 0.05, null));
    assertThat(model.mean).isCloseTo(5.0, within(1e-12));
    assertThat(model.variance).isCloseTo(4.75, within(1e-12));
  }

  @Test
  void gammaSeverityMomentsMatchMeanAndCv() {
    Severity.Model sev = Severity.model(new Severity.Assumptions("GAMMA", 1000.0, 0.5));
    assertThat(sev.mean()).isCloseTo(1000.0, within(1e-9));
    assertThat(Math.sqrt(sev.variance()) / sev.mean()).isCloseTo(0.5, within(1e-9));
  }

  @Test
  void lognormalSeverityPositiveSupport() {
    Severity.Model sev = Severity.model(new Severity.Assumptions("LOGNORMAL", 500.0, 1.0));
    assertThat(sev.cdf().applyAsDouble(-1)).isEqualTo(0.0);
    assertThat(sev.cdf().applyAsDouble(0)).isEqualTo(0.0);
    assertThat(sev.quantile().applyAsDouble(0.5)).isPositive();
  }

  @Test
  void aggregateMomentsFollowCompoundFormula() {
    Frequency.Model freq = Frequency.model(new Frequency.Assumptions("POISSON", 100.0, 1.0, null, 0.1));
    Severity.Model sev = Severity.model(new Severity.Assumptions("DETERMINISTIC", 200.0, null));
    Aggregate.Moments m = Aggregate.moments(freq, sev);
    assertThat(m.mean()).isCloseTo(freq.mean * sev.mean(), within(1e-9));
    assertThat(m.variance()).isCloseTo(
        freq.mean * sev.variance() + freq.variance * sev.mean() * sev.mean(), within(1e-6));
  }

  @Test
  void panjerDistributionAvailableForModeratePortfolio() {
    Frequency.Model freq = Frequency.model(new Frequency.Assumptions("POISSON", 50.0, 1.0, null, 0.05));
    Severity.Model sev = Severity.model(new Severity.Assumptions("GAMMA", 1000.0, 0.8));
    Aggregate.Distribution dist = Aggregate.distribution(freq, sev);
    assertThat(dist.available()).isTrue();
    assertThat(dist.lattice().method()).isEqualTo("PANJER");
    assertThat(dist.lattice().capturedMass()).isGreaterThan(0.99);
    Double var95 = Aggregate.quantile(dist.lattice(), 0.95);
    Double tvar95 = Aggregate.tvar(dist.lattice(), 0.95);
    assertThat(var95).isNotNull().isPositive();
    assertThat(tvar95).isNotNull().isGreaterThanOrEqualTo(var95);
  }

  @Test
  void pricingGrossPremiumExceedsExpectedClaims() {
    Frequency.Assumptions f = new Frequency.Assumptions("POISSON", 1000.0, 1.0, null, 0.02);
    Severity.Assumptions s = new Severity.Assumptions("DETERMINISTIC", 100.0, null);
    Frequency.Model freq = Frequency.model(f);
    Severity.Model sev = Severity.model(s);
    Aggregate.Moments moments = Aggregate.moments(freq, sev);
    Pricing.Assumptions a = new Pricing.Assumptions(f, s, 0.0, 0.0, 500.0, 0.0, 0.1, 0.05,
        "EXPECTED_VALUE", 0.1);
    Pricing.PremiumBreakdown p = Pricing.premiumBreakdown(a, freq.policies, moments);
    assertThat(p.grossPremium()).isGreaterThan(p.expectedClaims());
    assertThat(p.technicalPremium()).isGreaterThan(p.expectedClaims());
  }

  @Test
  void chainLadderUltimateAtLeastLatestPaid() {
    List<List<Double>> paid = Arrays.asList(
        Arrays.asList(100.0, 150.0, 180.0),
        Arrays.asList(120.0, 170.0),
        Arrays.asList(130.0));
    Reserving.Data data = new Reserving.Data(2020, paid, null, Arrays.asList(1000.0, 1100.0, 1200.0));
    Reserving.Assumptions assumptions = new Reserving.Assumptions(
        "VOLUME_WEIGHTED", null, 1.0, 1.0, null, null, 0.7);
    Map<String, Object> out = Reserving.analyze(data, assumptions);
    assertThat(out.get("modelVersion")).isEqualTo(Reserving.VERSION);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> methods = (List<Map<String, Object>>) out.get("methods");
    assertThat(methods).isNotEmpty();
    boolean clPaid = methods.stream().anyMatch(m -> "CHAIN_LADDER_PAID".equals(m.get("method"))
        && Boolean.TRUE.equals(m.get("available")));
    assertThat(clPaid).isTrue();
    boolean bf = methods.stream().anyMatch(m -> "BORNHUETTER_FERGUSON_PAID".equals(m.get("method"))
        && Boolean.TRUE.equals(m.get("available")));
    assertThat(bf).isTrue();
  }

  @Test
  void invalidTriangleRejected() {
    List<List<Double>> paid = Arrays.asList(Arrays.asList(100.0), Arrays.asList(120.0));
    Reserving.Data data = new Reserving.Data(2020, paid, null, null);
    Reserving.Assumptions assumptions = new Reserving.Assumptions(
        "VOLUME_WEIGHTED", null, 1.0, 1.0, null, null, null);
    assertThatThrownBy(() -> Reserving.analyze(data, assumptions))
        .isInstanceOf(Reserving.InputError.class);
  }

  @Test
  void monteCarloProducesFiniteMean() {
    Frequency.Model freq = Frequency.model(new Frequency.Assumptions("POISSON", 20.0, 1.0, null, 0.1));
    Severity.Model sev = Severity.model(new Severity.Assumptions("LOGNORMAL", 1000.0, 0.6));
    Simulation.Deadline deadline = () -> {};
    Simulation.Losses losses = Simulation.simulateLosses(freq, sev, 2000, 42.0, deadline);
    assertThat(losses.losses().length).isEqualTo(2000);
    assertThat(java.util.Arrays.stream(losses.losses()).average().orElse(0)).isPositive();
  }
}
