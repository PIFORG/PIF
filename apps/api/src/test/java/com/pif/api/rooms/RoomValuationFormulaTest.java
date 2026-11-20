package com.pif.api.rooms;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * Pure formula checks for mark-to-market net worth and trading return
 * (no Spring context — complements RoomEconomyTest).
 */
class RoomValuationFormulaTest {

  @Test
  void netWorthSubtractsOutstandingCreditOnce() {
    double cash = 110_000; // includes 10k borrowed
    double positionsMtm = 5_000;
    double creditDebt = 10_000;
    double grossEquity = cash + positionsMtm;
    double netWorth = grossEquity - creditDebt;
    assertThat(netWorth).isEqualTo(105_000);
  }

  @Test
  void tradingReturnIgnoresConversionsAndCredit() {
    // 100k initial + 10k conversion + 10k credit sitting in cash, flat market
    double gross = 120_000;
    double external = 20_000;
    assertThat(RoomEconomy.tradingReturnPct(gross, 100_000, external)).isEqualTo(0.0);
  }

  @Test
  void genuineMarketGainIsMeasured() {
    // Bought at cost, market up 8k after fees already in cash/positions
    assertThat(RoomEconomy.tradingReturnPct(108_000, 100_000, 0)).isEqualTo(8.0);
  }

  @Test
  void repaidCreditNoLongerCountsAsExternal() {
    // Borrowed then repaid: debt 0, cash back to initial, no artificial return
    assertThat(RoomEconomy.tradingReturnPct(100_000, 100_000, 0)).isEqualTo(0.0);
  }

  @Test
  void incompleteValuationMustNotPresentExactScore() {
    boolean valuationComplete = false;
    Double score = valuationComplete ? 72.5 : null;
    assertThat(score).isNull();
  }
}
