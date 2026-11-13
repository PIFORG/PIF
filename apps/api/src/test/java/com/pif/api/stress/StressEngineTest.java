package com.pif.api.stress;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.pif.api.stress.BankProfile.CreditSegment;
import com.pif.api.stress.StressEngine.Outcome;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class StressEngineTest {

  private static final BankProfile CONV = BankProfile.CONVENTIONAL;
  private static final BankProfile PART = BankProfile.PARTICIPATIVE;
  private static final double EPS = 1e-9;

  private static StressFactors only(int index, double value) {
    double[] v = StressFactors.NEUTRAL.toArray();
    v[index] = value;
    return StressFactors.of(v);
  }

  @Test
  void balanceSheetsBalanceAndAreComparable() {
    for (BankProfile b : BankProfile.ALL) {
      assertThat(b.totalAssets()).as(b.id()).isCloseTo(b.totalLiabilities() + b.cet1(), within(EPS));
    }
    assertThat(CONV.totalAssets()).isEqualTo(PART.totalAssets());
    assertThat(CONV.cet1()).isEqualTo(PART.cet1());
  }

  @Test
  void theNeutralScenarioReproducesTheBaselineIncomeStatement() {
    Outcome o = StressEngine.run(CONV, StressFactors.NEUTRAL);
    double expectedLoss = 2200 * 0.015 * 0.20 + 1300 * 0.04 * 0.60 + 1600 * 0.05 * 0.45 + 1300 * 0.025 * 0.40;
    assertThat(o.creditCost()).isCloseTo(expectedLoss, within(EPS));
    double preTax = 330 + 120 + 30 - 240 - expectedLoss;
    assertThat(o.preTaxIncome()).isCloseTo(preTax, within(EPS));
    assertThat(o.netIncome()).isCloseTo(preTax * 0.75, within(EPS));
    assertThat(o.bondRevaluation()).isZero();
    assertThat(o.equityRevaluation()).isZero();
    for (StressEngine.SegmentResult s : o.credit()) {
      assertThat(s.pdStressed()).isCloseTo(s.pdBase(), within(1e-12));
      assertThat(s.lgdStressed()).isEqualTo(s.lgdBase());
    }
    Outcome p = StressEngine.run(PART, StressFactors.NEUTRAL);
    assertThat(p.dcrCost()).isZero();
    assertThat(p.psiaAbsorbed()).isZero();
  }

  @Test
  void aRateRiseRevaluesBondsByDurationAndTriggersDisplacedCommercialRisk() {
    StressFactors rate = only(0, 300);
    Outcome c = StressEngine.run(CONV, rate);
    assertThat(c.bondRevaluation()).isCloseTo(-1800 * 0.6 * 4.5 * 0.03, within(EPS));
    Outcome p = StressEngine.run(PART, rate);
    assertThat(p.bondRevaluation()).isCloseTo(-900 * 0.6 * 3.0 * 0.03, within(EPS));
    // 60 % of 300 bp on 4 600 M DT of investment accounts is 82.8; the 60 M DT reserve covers the first part.
    assertThat(p.perUsed()).isCloseTo(60, within(EPS));
    assertThat(p.dcrCost()).isCloseTo(0.6 * 0.03 * 4600 - 60, within(EPS));
    // Margin change = Δr × repricing gap.
    double base = StressEngine.run(CONV, StressFactors.NEUTRAL).marginIncome();
    assertThat(c.marginIncome() - base).isCloseTo(0.03 * StressEngine.repricingGap(CONV), within(EPS));
  }

  @Test
  void fixedMarginMurabahaPaymentsDoNotReactToRatesButFloatingLoansDo() {
    StressFactors rate = only(0, 400);
    Outcome p = StressEngine.run(PART, rate);
    for (StressEngine.SegmentResult s : p.credit()) {
      if (s.key().startsWith("murabaha")) assertThat(s.pdStressed()).isCloseTo(s.pdBase(), within(1e-12));
    }
    Outcome c = StressEngine.run(CONV, rate);
    assertThat(c.credit()).allSatisfy(s -> assertThat(s.pdStressed()).isGreaterThan(s.pdBase()));
  }

  @Test
  void expectedLossIsPdTimesLgdTimesEadWithTheMacroSatellite() {
    StressFactors f = new StressFactors(0, 0, 2, -3, -20, 0, 1.5, 1);
    CreditSegment s = CONV.credit().get(0);
    double logit = Math.log(s.pd() / (1 - s.pd())) + s.unemploymentBeta() * 2 + s.gdpBeta() * 3;
    double pd = 1 / (1 + Math.exp(-logit)) * 1.5;
    double lgd = s.lgd() + s.collateralSensitivity() * 0.20;
    StressEngine.SegmentResult r = StressEngine.run(CONV, f).credit().get(0);
    assertThat(r.pdStressed()).isCloseTo(pd, within(1e-12));
    assertThat(r.lgdStressed()).isCloseTo(lgd, within(1e-12));
    assertThat(r.eclStressed()).isCloseTo(pd * lgd * s.ead(), within(1e-9));
  }

  @Test
  void capitalFallsMonotonicallyWithTheIntensityOfTheCombinedScenario() {
    StressFactors severe = StressFactors.preset("combined-severe").factors();
    for (BankProfile b : BankProfile.ALL) {
      double previous = Double.POSITIVE_INFINITY;
      double previousLcr = Double.POSITIVE_INFINITY;
      for (int k = 0; k <= 8; k++) {
        StressEngine.Ratios r = StressEngine.run(b, severe.scaled(k / 4.0)).ratios();
        assertThat(r.cet1Ratio()).as(b.id() + " intensity " + k / 4.0).isLessThan(previous);
        assertThat(r.lcr()).as(b.id() + " intensity " + k / 4.0).isLessThanOrEqualTo(previousLcr);
        previous = r.cet1Ratio();
        previousLcr = r.lcr();
      }
    }
  }

  @Test
  void depositRunsLowerTheLiquidityCoverageRatio() {
    for (BankProfile b : BankProfile.ALL) {
      double base = StressEngine.run(b, StressFactors.NEUTRAL).ratios().lcr();
      double run = StressEngine.run(b, only(7, 2.5)).ratios().lcr();
      assertThat(run).as(b.id()).isLessThan(base);
    }
  }

  @Test
  void investmentAccountsAbsorbPartOfTheParticipativeBanksFinancingLosses() {
    StressFactors defaults = only(6, 2.5);
    Outcome p = StressEngine.run(PART, defaults);
    assertThat(p.psiaPoolLoss()).isPositive();
    assertThat(p.irrUsed()).isCloseTo(Math.min(40, p.psiaPoolLoss()), within(EPS));
    assertThat(p.psiaAbsorbed()).isCloseTo((p.psiaPoolLoss() - p.irrUsed()) * 0.5, within(EPS));
    BankProfile noSharing = new BankProfile(PART.id(), PART.name(), PART.kind(), PART.description(),
        PART.specificities(), PART.treasury(), PART.credit(), PART.pls(), PART.liabilities(), PART.cet1(),
        PART.income(), new BankProfile.Participative(0.5, 0.6, 0, 60, 0));
    assertThat(StressEngine.run(noSharing, defaults).ratios().cet1())
        .isLessThan(p.ratios().cet1());
  }

  @Test
  void runsAreDeterministic() {
    StressFactors f = StressFactors.preset("combined-severe").factors();
    for (BankProfile b : BankProfile.ALL) assertThat(StressEngine.run(b, f)).isEqualTo(StressEngine.run(b, f));
  }

  @Test
  void shapleyContributionsAddUpExactlyToTheTotalChange() {
    StressFactors f = StressFactors.preset("combined-severe").factors();
    for (BankProfile b : BankProfile.ALL) {
      double total = StressEngine.run(b, f).ratios().cet1Ratio()
          - StressEngine.run(b, StressFactors.NEUTRAL).ratios().cet1Ratio();
      double[] phi = StressAttribution.shapley(b, f, o -> o.ratios().cet1Ratio());
      assertThat(Arrays.stream(phi).sum()).as(b.id()).isCloseTo(total, within(1e-12));
      double lcrTotal = StressEngine.run(b, f).ratios().lcr() - StressEngine.run(b, StressFactors.NEUTRAL).ratios().lcr();
      assertThat(Arrays.stream(StressAttribution.shapley(b, f, o -> o.ratios().lcr())).sum())
          .isCloseTo(lcrTotal, within(1e-12));
    }
  }

  @Test
  void aNeutralFactorReceivesNoContributionAndASingleShockReceivesAll() {
    StressFactors rate = only(0, 300);
    double[] phi = StressAttribution.shapley(CONV, rate, o -> o.ratios().cet1Ratio());
    double total = StressEngine.run(CONV, rate).ratios().cet1Ratio()
        - StressEngine.run(CONV, StressFactors.NEUTRAL).ratios().cet1Ratio();
    assertThat(phi[0]).isCloseTo(total, within(1e-12));
    for (int i = 1; i < phi.length; i++) assertThat(phi[i]).isCloseTo(0, within(1e-12));
  }

  @Test
  void intensityScalesShocksAroundTheirNeutralValueWithinBounds() {
    StressFactors f = StressFactors.preset("combined-severe").factors();
    assertThat(f.scaled(0)).isEqualTo(StressFactors.NEUTRAL);
    assertThat(f.scaled(1)).isEqualTo(f);
    StressFactors half = f.scaled(0.5);
    assertThat(half.rateShockBps()).isEqualTo(125);
    assertThat(half.defaultMultiplier()).isEqualTo(1.25);
    assertThat(f.scaled(3).equityShockPct()).isEqualTo(-80); // clamped to the accepted range
  }
}
