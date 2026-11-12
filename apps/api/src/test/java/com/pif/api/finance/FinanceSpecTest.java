package com.pif.api.finance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The expectations of apps/api/src/finance/finance.spec.ts and orders.spec.ts, restated for the Java port. */
class FinanceSpecTest {

  private static final Quote QUOTE = new Quote(10_000, 9_990, 10_010, 100);

  @Nested
  class MoneyTest {
    @Test
    void convertsToAndFromThousandthsWithoutDrift() {
      assertThat(Money.toAmount(0.1 + 0.2)).isEqualTo(300);
      assertThat(Money.toAmount(12.3456)).isEqualTo(12_346);
      assertThat(Money.fromAmount(8_457_500)).isEqualTo(8_457.5);
      assertThatThrownBy(() -> Money.toAmount(Double.NaN)).isInstanceOf(IllegalArgumentException.class).hasMessage("Amount must be finite");
    }

    @Test
    void roundsHalfAwayFromZero() {
      assertThat(Money.divRound(5, 2)).isEqualTo(3);
      assertThat(Money.divRound(-5, 2)).isEqualTo(-3);
      assertThat(Money.divRound(4, 3)).isEqualTo(1);
      assertThatThrownBy(() -> Money.divRound(1, 0)).isInstanceOf(ArithmeticException.class).hasMessage("Division by zero");
    }

    @Test
    void chargesTheLargerOfTheMinimumAndTheRateNothingOnAZeroNotional() {
      assertThat(Money.commission(1_000_000, 25, 500)).isEqualTo(2_500);
      assertThat(Money.commission(100_000, 25, 500)).isEqualTo(500);
      assertThat(Money.commission(1_000_100, 25, 0)).isEqualTo(2_500);
      assertThat(Money.commission(1_000_200, 25, 0)).isEqualTo(2_501);
      assertThat(Money.commission(0, 25, 500)).isEqualTo(0);
    }
  }

  @Nested
  class ExecutionRulesTest {
    @Test
    void buysAtTheAskSellsAtTheBidAndMeasuresTheHalfSpreadPaid() {
      assertThat(ExecutionRules.executionPrice(OrderSide.BUY, QUOTE)).isEqualTo(10_010);
      assertThat(ExecutionRules.executionPrice(OrderSide.SELL, QUOTE)).isEqualTo(9_990);
      assertThat(ExecutionRules.spreadCost(10_010, 10_000, 7)).isEqualTo(70);
    }

    @Test
    void crossesLimitsAndTriggersSellStopsAtTheBid() {
      assertThat(ExecutionRules.limitIsMarketable(OrderSide.BUY, 10_010, QUOTE)).isTrue();
      assertThat(ExecutionRules.limitIsMarketable(OrderSide.BUY, 10_009, QUOTE)).isFalse();
      assertThat(ExecutionRules.limitIsMarketable(OrderSide.SELL, 9_990, QUOTE)).isTrue();
      assertThat(ExecutionRules.limitCrosses(OrderSide.BUY, 10_020, QUOTE)).isTrue();
      assertThat(ExecutionRules.limitCrosses(OrderSide.SELL, 10_000, QUOTE)).isFalse();
      assertThat(ExecutionRules.sellStopTriggered(9_990, QUOTE)).isTrue();
      assertThat(ExecutionRules.sellStopTriggered(9_989, QUOTE)).isFalse();
      assertThat(ExecutionRules.remainingDepth(QUOTE, 30)).isEqualTo(70);
    }
  }

  @Nested
  class LedgerTest {
    @Test
    void booksBuysAtCostIncludingFeesAndSellsAtAverageCostKeepingTheAccountingIdentity() {
      Ledger ledger = Ledger.empty(1_000_000);
      Ledger.bookExecution(ledger, new Execution("AAA", OrderSide.BUY, 10_010, 50, 1_000, 10_000));
      assertThat(ledger.cash()).isEqualTo(1_000_000 - 500_500 - 1_000);
      assertThat(ledger.positions().get("AAA")).isEqualTo(new Holding("AAA", 50, 501_500));

      Ledger.bookExecution(ledger, new Execution("AAA", OrderSide.BUY, 12_010, 25, 1_000, 12_000));
      assertThat(ledger.positions().get("AAA")).isEqualTo(new Holding("AAA", 75, 802_750));

      Booking sale = Ledger.bookExecution(ledger, new Execution("AAA", OrderSide.SELL, 11_990, 30, 1_000, 12_000));
      assertThat(sale.costRemoved()).isEqualTo(321_100);
      assertThat(sale.realizedPnl()).isEqualTo(359_700 - 1_000 - 321_100);
      assertThat(ledger.positions().get("AAA")).isEqualTo(new Holding("AAA", 45, 481_650));

      Booking last = Ledger.bookExecution(ledger, new Execution("AAA", OrderSide.SELL, 11_990, 45, 1_000, 12_000));
      assertThat(last.costRemoved()).isEqualTo(481_650);
      assertThat(ledger.positions().get("AAA")).isEqualTo(new Holding("AAA", 0, 0));
      assertThat(ledger.feesPaid()).isEqualTo(4_000);
      assertThat(ledger.spreadCostPaid()).isEqualTo(500 + 250 + 300 + 450);
      assertThat(ledger.cash()).isEqualTo(1_000_000 + ledger.realizedPnl());
    }

    @Test
    void refusesExecutionsThatWouldBreakAnInvariantAndLeavesTheLedgerUntouched() {
      Ledger ledger = Ledger.empty(100_000);
      Map<String, Object> before = FinanceGoldenCases.snapshot(ledger);
      assertThatThrownBy(() -> Ledger.bookExecution(ledger, new Execution("AAA", OrderSide.BUY, 10_010, 10, 1_000, 10_000)))
          .isInstanceOfSatisfying(LedgerException.class, e -> assertThat(e.code()).isEqualTo(LedgerException.Code.INSUFFICIENT_CASH));
      assertThatThrownBy(() -> Ledger.bookExecution(ledger, new Execution("AAA", OrderSide.SELL, 9_990, 1, 0, 10_000)))
          .isInstanceOf(LedgerException.class);
      assertThatThrownBy(() -> Ledger.bookExecution(ledger, new Execution("AAA", OrderSide.BUY, 10.5, 1, 0, 10)))
          .isInstanceOfSatisfying(LedgerException.class, e -> assertThat(e.code()).isEqualTo(LedgerException.Code.INVALID_EXECUTION));
      assertThat(FinanceGoldenCases.snapshot(ledger)).isEqualTo(before);
    }
  }

  @Nested
  class ValuationTest {
    private final Map<String, Holding> positions = ordered(
        "AAA", new Holding("AAA", 100, 900_000), "BBB", new Holding("BBB", 20, 1_100_000), "CCC", new Holding("CCC", 0, 0));
    private final Map<String, Double> prices = Map.of("AAA", 10_000.0, "BBB", 50_000.0, "CCC", 1.0);
    private final Map<String, Double> values = Valuation.marketValues(positions, prices::get);

    @Test
    void valuesNonEmptyHoldingsAndDerivesEquityWeightsAndExposure() {
      assertThat(values).containsExactly(Map.entry("AAA", 1_000_000.0), Map.entry("BBB", 1_000_000.0));
      assertThat(Valuation.totalValue(values)).isEqualTo(2_000_000);
      assertThat(Valuation.equityOf(2_000_000, values)).isEqualTo(4_000_000);
      assertThat(Valuation.maxWeight(values, 4_000_000)).isEqualTo(0.25);
      assertThat(Valuation.exposure(values, 4_000_000)).isEqualTo(0.5);
      assertThat(Valuation.maxWeight(Map.of(), 0)).isEqualTo(0);
    }

    @Test
    void measuresConcentrationAndUnrealisedPnl() {
      assertThat(Valuation.concentration(values)).isEqualTo(new Valuation.Concentration(0.5, 2.0));
      assertThat(Valuation.concentration(Map.of())).isEqualTo(new Valuation.Concentration(null, null));
      assertThat(Valuation.unrealizedPnl(positions, values)).isEqualTo(0);
    }
  }

  @Nested
  class RiskTest {
    @Test
    void measuresDrawdownFromTheRunningPeak() {
      assertThat(Risk.maxDrawdown(new double[] {100, 120, 90, 130, 65})).isEqualTo(0.5);
      assertThat(Risk.maxDrawdown(new double[] {100, 110, 120})).isEqualTo(0);
    }

    @Test
    void computesReturnsAndTheSampleStandardDeviation() {
      assertThat(Risk.simpleReturns(new double[] {100, 110, 99})).containsExactly(0.10000000000000009, -0.09999999999999998);
      assertThat(Risk.sampleStdDev(new double[] {2, 4, 4, 4, 5, 5, 7, 9})).isCloseTo(2.13809, within(5e-6));
      assertThat(Risk.sampleStdDev(new double[] {1})).isNull();
    }

    @Test
    void readsHistoricalVarAndExpectedShortfallFromTheLowerTailWithAMinimumSample() {
      double[] pnl = IntStream.range(0, 40).mapToDouble(i -> -(i + 1)).toArray();
      assertThat(Risk.historicalVaR(pnl)).isEqualTo(new Risk.VarResult(38, 39));
      assertThat(Risk.historicalVaR(java.util.Arrays.copyOf(pnl, 29))).isNull();
      assertThat(Risk.historicalVaR(IntStream.range(0, 40).mapToDouble(i -> 5).toArray())).isEqualTo(new Risk.VarResult(0, 0));
    }

    @Test
    void revaluesHoldingsUnderAScenarioAndAStressTest() {
      Map<String, Double> values = ordered("BBB", 2_000_000.0, "AAA", 1_000_000.0);
      assertThat(Risk.scenarioPnl(values, s -> s.equals("AAA") ? -0.1 : 0.05)).isEqualTo(0);
      assertThat(Risk.stressImpact(values, s -> s.equals("AAA") ? -0.2 : -0.05)).isEqualTo(new Risk.StressResult(-300_000, List.of(
          new Risk.StressLine("AAA", 1_000_000, -20, -200_000),
          new Risk.StressLine("BBB", 2_000_000, -5, -100_000))));
    }
  }

  @Nested
  class PreTradeTest {
    private final PreTrade.FeeSchedule fees = new PreTrade.FeeSchedule(25, 500);

    private PreTrade.PreTradeInput base(OrderSide side, double held, double pending, double cash, Double maxPct) {
      return new PreTrade.PreTradeInput(side, 100, 10_010, 10_000, held, pending, cash, 4_000_000, fees, maxPct);
    }

    @Test
    void estimatesCashOutForBuysAndCashInForSells() {
      assertThat(PreTrade.estimateOrder(OrderSide.BUY, 10_010, 100, fees)).isEqualTo(new PreTrade.PreTradeEstimate(1_001_000, 2_503, 1_003_503));
      assertThat(PreTrade.estimateOrder(OrderSide.SELL, 9_990, 100, fees)).isEqualTo(new PreTrade.PreTradeEstimate(999_000, 2_498, 996_502));
    }

    @Test
    void acceptsABuyThatUsesExactlyTheAvailableCashAndRefusesOneMoreUnit() {
      assertThat(PreTrade.checkOrder(base(OrderSide.BUY, 0, 0, 1_003_503, null))).isNull();
      assertThat(PreTrade.checkOrder(base(OrderSide.BUY, 0, 0, 1_003_502, null))).isEqualTo(new PreTrade.InsufficientCash(1_003_503, 1_003_502));
    }

    @Test
    void capsAHoldingAtAShareOfEquityCountingHeldAndPendingUnitsAtMid() {
      assertThat(PreTrade.checkOrder(base(OrderSide.BUY, 0, 0, 1_003_503, 25.0))).isNull();
      assertThat(PreTrade.checkOrder(base(OrderSide.BUY, 1, 0, 1_003_503, 25.0))).isEqualTo(new PreTrade.PositionLimit(25.25, 25));
      assertThat(PreTrade.checkOrder(base(OrderSide.BUY, 0, 1, 1_003_503, 25.0)).code()).isEqualTo("POSITION_LIMIT");
    }

    @Test
    void refusesShortSales() {
      assertThat(PreTrade.checkOrder(base(OrderSide.SELL, 99, 0, 1_003_503, null))).isEqualTo(new PreTrade.InsufficientPosition(99));
      assertThat(PreTrade.checkOrder(base(OrderSide.SELL, 100, 0, 1_003_503, null))).isNull();
    }

    @Test
    void reservesCashForOpenBuyLimitsIncludingTheirCommission() {
      assertThat(PreTrade.reservedCash(List.of(new PreTrade.OpenBuyLimit(10_000, 100), new PreTrade.OpenBuyLimit(5_000, 10)), fees))
          .isEqualTo(1_000_000 + 2_500 + 50_000 + 500);
    }
  }

  @Nested
  class OrderRulesTest {
    private OrderRules.RestingOrder limit(OrderSide side, double limitPrice) {
      return new OrderRules.RestingOrder(OrderType.LIMIT, side, limitPrice, null, false);
    }

    @Test
    void acceptsLimitPricesInsideTheBandEdgesIncluded() {
      assertThat(OrderRules.limitWithinBand(5_000, 10_000, 50)).isTrue();
      assertThat(OrderRules.limitWithinBand(15_000, 10_000, 50)).isTrue();
      assertThat(OrderRules.limitWithinBand(4_999, 10_000, 50)).isFalse();
      assertThat(OrderRules.limitWithinBand(15_001, 10_000, 50)).isFalse();
    }

    @Test
    void requiresAProtectiveStopStrictlyBelowTheBid() {
      assertThat(OrderRules.stopBelowBid(9_989, QUOTE)).isTrue();
      assertThat(OrderRules.stopBelowBid(9_990, QUOTE)).isFalse();
    }

    @Test
    void executesABuyLimitOnceTheAskReachesItAndASellLimitOnceTheBidReachesIt() {
      assertThat(OrderRules.restingOrderAction(limit(OrderSide.BUY, 10_009), QUOTE).execute()).isFalse();
      assertThat(OrderRules.restingOrderAction(limit(OrderSide.BUY, 10_010), QUOTE).execute()).isTrue();
      assertThat(OrderRules.restingOrderAction(limit(OrderSide.SELL, 9_991), QUOTE).execute()).isFalse();
      assertThat(OrderRules.restingOrderAction(limit(OrderSide.SELL, 9_990), QUOTE).execute()).isTrue();
    }

    @Test
    void triggersASellStopWhenTheBidFallsToItAndKeepsItTriggered() {
      OrderRules.RestingOrder stop = new OrderRules.RestingOrder(OrderType.STOP, OrderSide.SELL, null, 9_980.0, false);
      assertThat(OrderRules.restingOrderAction(stop, QUOTE)).isEqualTo(new OrderRules.RestingOrderAction(false, false));
      assertThat(OrderRules.restingOrderAction(stop, new Quote(10_000, 9_980, 10_010, 100))).isEqualTo(new OrderRules.RestingOrderAction(true, true));
      OrderRules.RestingOrder triggered = new OrderRules.RestingOrder(OrderType.STOP, OrderSide.SELL, null, 9_980.0, true);
      assertThat(OrderRules.restingOrderAction(triggered, QUOTE)).isEqualTo(new OrderRules.RestingOrderAction(true, true));
    }

    @Test
    void capsAFillByTheRemainingQuantityTheHoldingForSellsAndTheFreeDepth() {
      assertThat(OrderRules.fillableQuantity(OrderSide.BUY, 50, 0, 100)).isEqualTo(50);
      assertThat(OrderRules.fillableQuantity(OrderSide.BUY, 150, 0, 100)).isEqualTo(100);
      assertThat(OrderRules.fillableQuantity(OrderSide.SELL, 50, 30, 100)).isEqualTo(30);
      assertThat(OrderRules.fillableQuantity(OrderSide.SELL, 50, 80, 20)).isEqualTo(20);
      assertThat(OrderRules.fillableQuantity(OrderSide.BUY, 10, 0, -5)).isEqualTo(0);
    }
  }

  @Nested
  class PerformanceTest {
    @Test
    void chainsSubPeriodReturnsSoThatADepositIsNotCountedAsPerformance() {
      Double twr = Performance.timeWeightedReturn(List.of(
          new Performance.ValuationPoint(100_000, 0), new Performance.ValuationPoint(110_000, 50_000), new Performance.ValuationPoint(152_000, 0)));
      assertThat(twr).isCloseTo(0.045, within(5e-13));
      assertThat(Performance.investmentProfit(152_000, Performance.netContributions(new double[] {100_000, 50_000}))).isEqualTo(2_000);
    }

    @Test
    void treatsAWithdrawalTheSameWay() {
      Double twr = Performance.timeWeightedReturn(List.of(
          new Performance.ValuationPoint(100_000, 0), new Performance.ValuationPoint(120_000, -60_000), new Performance.ValuationPoint(57_000, 0)));
      assertThat(twr).isCloseTo(0.14, within(5e-13));
    }

    @Test
    void isUnavailableWithoutACompleteSubPeriodOrFromAZeroStart() {
      assertThat(Performance.timeWeightedReturn(List.of())).isNull();
      assertThat(Performance.timeWeightedReturn(List.of(new Performance.ValuationPoint(100_000, 0)))).isNull();
      assertThat(Performance.timeWeightedReturn(List.of(new Performance.ValuationPoint(0, 0), new Performance.ValuationPoint(10, 0)))).isNull();
    }
  }

  @Nested
  class JsSemanticsTest {
    @Test
    void roundsLikeMathRound() {
      assertThat(JsSemantics.round(2.5)).isEqualTo(3);
      assertThat(JsSemantics.round(-2.5)).isEqualTo(-2);
      assertThat(JsSemantics.round(0.49999999999999994)).isEqualTo(0);
      assertThat(Double.doubleToRawLongBits(JsSemantics.round(-0.5))).isEqualTo(Double.doubleToRawLongBits(-0.0));
      assertThat(Double.doubleToRawLongBits(JsSemantics.round(-0.2))).isEqualTo(Double.doubleToRawLongBits(-0.0));
      assertThat(JsSemantics.round(4_503_599_627_370_497.0)).isEqualTo(4_503_599_627_370_497.0);
      assertThat(JsSemantics.round(Double.POSITIVE_INFINITY)).isEqualTo(Double.POSITIVE_INFINITY);
    }

    @Test
    void listsArrayIndexKeysFirstThenInsertionOrder() {
      Map<String, Integer> map = ordered("10", 1, "B", 2, "2", 3, "01", 4, "4294967295", 5, "4294967294", 6, "A", 7);
      assertThat(JsSemantics.entries(map).stream().map(Map.Entry::getKey).toList())
          .containsExactly("2", "10", "4294967294", "B", "01", "4294967295", "A");
    }
  }

  @SuppressWarnings("unchecked")
  private static <V> Map<String, V> ordered(Object... keyValues) {
    Map<String, V> out = new LinkedHashMap<>();
    for (int i = 0; i < keyValues.length; i += 2) out.put((String) keyValues[i], (V) keyValues[i + 1]);
    return out;
  }
}
