package com.pif.api.backtest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.pif.api.backtest.BacktestEngine.Config;
import com.pif.api.backtest.BacktestEngine.Result;
import com.pif.api.backtest.Strategy.Bar;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Tiny deterministic backtest with hand-checked equity and trade fill. */
class BacktestEngineTest {

  @Test
  void buyAndHoldNextCloseFillGolden() {
    // Closes: day0=100, day1=110, day2=120. Signal after day0 -> fill at day1 close (NEXT_CLOSE).
    List<Bar> bars = List.of(
        new Bar(Instant.parse("2026-01-02T00:00:00Z"), Map.of("X", 100.0)),
        new Bar(Instant.parse("2026-01-03T00:00:00Z"), Map.of("X", 110.0)),
        new Bar(Instant.parse("2026-01-04T00:00:00Z"), Map.of("X", 120.0)));

    Result result = BacktestEngine.run(new BuyAndHoldStrategy(), List.of("X"), bars, Map.of(),
        new Config(1_100.0, 0, 0, 0));

    assertEquals(BacktestEngine.EXECUTION_CONVENTION, result.executionConvention());
    assertEquals(1, result.trades().size());
    assertEquals("BUY", result.trades().get(0).side());
    assertEquals(110.0, result.trades().get(0).price());
    assertEquals(10.0, result.trades().get(0).quantity(), 1e-12); // 1100 / 110
    assertEquals(0.0, result.finalCash(), 1e-9);
    assertEquals(10.0, result.finalPositions().get("X"), 1e-12);

    // Equity: bar0 cash-only 1100; bar1 after buy 10*110=1100; bar2 10*120=1200
    assertEquals(1_100.0, result.equityCurve().get(0).equity(), 1e-9);
    assertEquals(1_100.0, result.equityCurve().get(1).equity(), 1e-9);
    assertEquals(1_200.0, result.equityCurve().get(2).equity(), 1e-9);

    BacktestMetrics.Metrics metrics = BacktestMetrics.compute(result, 1_100.0, 0, bars, List.of("X"));
    assertEquals(1_200.0 / 1_100.0 - 1, metrics.totalReturn(), 1e-12);
    assertEquals(120.0 / 100.0 - 1, metrics.benchmarkTotalReturn(), 1e-12);
    assertTrue(metrics.maxDrawdown() >= 0);
  }

  @Test
  void feesAndSlippageReducePurchasingPower() {
    List<Bar> bars = List.of(
        new Bar(Instant.parse("2026-01-02T00:00:00Z"), Map.of("X", 100.0)),
        new Bar(Instant.parse("2026-01-03T00:00:00Z"), Map.of("X", 100.0)));

    Result free = BacktestEngine.run(new BuyAndHoldStrategy(), List.of("X"), bars, Map.of(),
        new Config(10_000.0, 0, 0, 0));
    Result costly = BacktestEngine.run(new BuyAndHoldStrategy(), List.of("X"), bars, Map.of(),
        new Config(10_000.0, 10, 10, 0)); // 10 bps fee + 10 bps slip

    assertTrue(costly.finalPositions().get("X") < free.finalPositions().get("X"));
    assertTrue(costly.totalFees() > 0);
    assertTrue(costly.totalSlippageCost() > 0);
  }

  @Test
  void maCrossoverStaysCashUntilBothSmasReadyAndShortAboveLong() {
    // Rising series so short SMA > long SMA once both ready.
    double[] px = {10, 11, 12, 13, 14, 15, 16, 17};
    List<Bar> bars = new java.util.ArrayList<>();
    for (int i = 0; i < px.length; i++) {
      bars.add(new Bar(Instant.parse("2026-01-%02dT00:00:00Z".formatted(i + 2)), Map.of("X", px[i])));
    }
    Result result = BacktestEngine.run(new MovingAverageCrossoverStrategy(), List.of("X"), bars,
        Map.of("shortPeriod", 2.0, "longPeriod", 3.0), new Config(1_000.0, 0, 0, 0));
    // First long signal at index where both SMAs exist and short>long (index 2: SMA2=11.5, SMA3=11)
    // Fill on next bar (index 3).
    assertTrue(result.trades().stream().anyMatch(t -> "BUY".equals(t.side())));
    assertEquals(Instant.parse("2026-01-05T00:00:00Z"), result.trades().get(0).at());
  }
}
