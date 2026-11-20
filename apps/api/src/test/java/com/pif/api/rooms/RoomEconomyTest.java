package com.pif.api.rooms;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.rooms.RoomEconomy.Rules;
import org.junit.jupiter.api.Test;

class RoomEconomyTest {

  @Test
  void creditRequiresLearningPoints() {
    Rules rules = Rules.defaults();
    assertThat(RoomEconomy.creditCeilingMillimes(rules, 0, 0)).isZero();
    assertThat(RoomEconomy.creditCeilingMillimes(rules, 50, 0)).isPositive();
  }

  @Test
  void conversionIsCappedAndRateBased() {
    Rules rules = Rules.defaults();
    long millimes = RoomEconomy.conversionCapitalMillimes(rules, 100);
    assertThat(millimes).isEqualTo(10_000L); // 100 pts / 10 = 10 units * 1000 millimes
    long capped = RoomEconomy.conversionCapitalMillimes(rules, 1_000_000);
    assertThat(capped).isEqualTo(rules.maxConversionMillimes());
  }

  @Test
  void pedagogicalScoreDoesNotRewardLockingAlone() {
    double risky = RoomEconomy.pedagogicalScore(80, 40, 10, 0, true);
    double steady = RoomEconomy.pedagogicalScore(10, 5, 200, 2, false);
    assertThat(steady).isGreaterThan(risky);
  }

  @Test
  void tradingReturnExcludesConversionsAndOutstandingCredit() {
    // equity 120k with 10k conversion + 10k debt must not look like +20% on 100k
    double withExternal = RoomEconomy.tradingReturnPct(120_000, 100_000, 20_000);
    assertThat(withExternal).isEqualTo(0.0);
    double genuineGain = RoomEconomy.tradingReturnPct(110_000, 100_000, 0);
    assertThat(genuineGain).isEqualTo(10.0);
  }

  @Test
  void excessiveDrawdownLowersRiskComponentVersusSteady() {
    double aggressive = RoomEconomy.pedagogicalScore(30, 50, 100, 1, false);
    double cautious = RoomEconomy.pedagogicalScore(30, 2, 100, 1, false);
    assertThat(cautious).isGreaterThan(aggressive);
  }

  @Test
  void levelsProgressFromPoints() {
    assertThat(RoomEconomy.levelFromPoints(0)).isEqualTo("BEGINNER");
    assertThat(RoomEconomy.levelFromPoints(50)).isEqualTo("LEARNER");
    assertThat(RoomEconomy.levelFromPoints(200)).isEqualTo("INTERMEDIATE");
    assertThat(RoomEconomy.levelFromPoints(400)).isEqualTo("ADVANCED");
    assertThat(RoomEconomy.levelFromPoints(800)).isEqualTo("EXPERT");
  }
}
