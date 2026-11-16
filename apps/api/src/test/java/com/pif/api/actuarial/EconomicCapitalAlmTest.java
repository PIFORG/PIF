package com.pif.api.actuarial;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

class EconomicCapitalAlmTest {

  @Test
  void economicCapitalIsNonNegativeAndBelowVarMinusMeanConvention() {
    Frequency.Assumptions f = new Frequency.Assumptions("POISSON", 50.0, 1.0, null, 0.05);
    Severity.Assumptions s = new Severity.Assumptions("GAMMA", 1000.0, 0.8);
    EconomicCapital.Result r =
        EconomicCapital.compute(new EconomicCapital.Input(f, s, 0.995, 1.0, "Test capital"));
    assertThat(r.economicCapital()).isGreaterThanOrEqualTo(0);
    assertThat(r.valueAtRisk()).isGreaterThan(r.expectedLoss());
    assertThat(r.economicCapital()).isCloseTo(r.valueAtRisk() - r.expectedLoss(), within(1.0));
    assertThat(r.sensitivities()).isNotEmpty();
    assertThat(r.modelVersion()).isEqualTo(EconomicCapital.VERSION);
  }

  @Test
  void almDemoSurplusAndDurationGapAreFinite() {
    Alm.Result r = Alm.compute(Alm.demo());
    assertThat(r.assets().presentValue()).isPositive();
    assertThat(r.liabilities().presentValue()).isPositive();
    assertThat(r.assets().macaulayDuration()).isPositive();
    assertThat(r.liabilities().macaulayDuration()).isPositive();
    assertThat(Double.isFinite(r.surplus())).isTrue();
    assertThat(Double.isFinite(r.surplusAfterShock())).isTrue();
    assertThat(r.modelVersion()).isEqualTo(Alm.VERSION);
  }

  @Test
  void parallelRateHikeReducesPresentValues() {
    Alm.Input base = Alm.demo();
    Alm.Result flat = Alm.compute(base);
    Alm.Result hiked =
        Alm.compute(new Alm.Input(base.label(), base.discountRate() + 0.02, 0, base.assets(), base.liabilities()));
    assertThat(hiked.assets().presentValue()).isLessThan(flat.assets().presentValue());
    assertThat(hiked.liabilities().presentValue()).isLessThan(flat.liabilities().presentValue());
  }

  @Test
  void economicCapitalNeverNegativeEvenIfMeanExceedsVarApproximation() {
    Frequency.Assumptions f = new Frequency.Assumptions("POISSON", 1.0, 1.0, null, 0.05);
    Severity.Assumptions s = new Severity.Assumptions("DETERMINISTIC", 100.0, null);
    EconomicCapital.Result r =
        EconomicCapital.compute(new EconomicCapital.Input(f, s, 0.55, 1.0, "Faible confiance"));
    assertThat(r.economicCapital()).isGreaterThanOrEqualTo(0);
    assertThat(r.horizonYears()).isEqualTo(1.0);
    assertThat(r.confidenceLevel()).isEqualTo(0.55);
  }

  @Test
  void longerHorizonScalesMeanAndVarLinearlyInPedagogicalModel() {
    Frequency.Assumptions f = new Frequency.Assumptions("POISSON", 20.0, 1.0, null, 0.05);
    Severity.Assumptions s = new Severity.Assumptions("GAMMA", 500.0, 0.6);
    EconomicCapital.Result one =
        EconomicCapital.compute(new EconomicCapital.Input(f, s, 0.99, 1.0, "1 an"));
    EconomicCapital.Result two =
        EconomicCapital.compute(new EconomicCapital.Input(f, s, 0.99, 2.0, "2 ans"));
    assertThat(two.expectedLoss()).isCloseTo(one.expectedLoss() * 2.0, within(1.0));
    assertThat(two.valueAtRisk()).isCloseTo(one.valueAtRisk() * 2.0, within(1.0));
  }

  @Test
  void almNegativeSurplusWhenLiabilitiesDominate() {
    Alm.Result r =
        Alm.compute(
            new Alm.Input(
                "Passif dominant",
                0.04,
                0.01,
                java.util.List.of(new Alm.CashFlow(1, 1_000, "Actif faible")),
                java.util.List.of(
                    new Alm.CashFlow(1, 5_000, "Engagement"),
                    new Alm.CashFlow(2, 5_000, "Engagement"))));
    assertThat(r.surplus()).isNegative();
    assertThat(r.liquidityGapYear1()).isNegative();
    assertThat(r.assets().macaulayDuration()).isGreaterThanOrEqualTo(0);
    assertThat(r.liabilities().modifiedDuration()).isGreaterThanOrEqualTo(0);
  }

  @Test
  void almAssetCashFlowsAreTreatedAsPositiveInflows() {
    Alm.Input input =
        new Alm.Input(
            "Signes",
            0.05,
            0.0,
            java.util.List.of(new Alm.CashFlow(1, 10_000, "Inflow")),
            java.util.List.of(new Alm.CashFlow(1, 8_000, "Outflow")));
    Alm.Result r = Alm.compute(input);
    assertThat(r.assets().totalNominal()).isEqualTo(10_000.0);
    assertThat(r.liabilities().totalNominal()).isEqualTo(8_000.0);
    assertThat(r.surplus()).isPositive();
  }
}
