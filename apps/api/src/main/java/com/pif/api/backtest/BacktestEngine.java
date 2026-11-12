package com.pif.api.backtest;

import com.pif.api.backtest.Strategy.Bar;
import com.pif.api.backtest.Strategy.Context;
import com.pif.api.backtest.Strategy.Target;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Chronological daily backtest engine.
 *
 * <p><b>Execution convention (NEXT_CLOSE):</b> after bar {@code t} closes, the strategy emits a target using only
 * data through {@code t}. That target is executed at the <em>close of bar {@code t+1}</em> (not the same bar).
 * There is no same-bar fill and no use of future prices. When only daily closes are available this is equivalent to
 * a one-bar delay; it is stricter than filling at the signal close and avoids look-ahead. Documented as NEXT_CLOSE
 * in {@code docs/trading/BACKTESTING.md}.
 *
 * <p>Costs: buys fill at {@code close x (1 + slippageBps/10_000)}; sells at {@code close x (1 - slippageBps/10_000)}.
 * Commission is {@code notional x feeBps / 10_000} (no minimum in v1). Fractional shares are allowed.
 */
public final class BacktestEngine {

  public static final String EXECUTION_CONVENTION = "NEXT_CLOSE";

  public record Config(double initialCash, double feeBps, double slippageBps, double riskFreeAnnual) {}

  public record Trade(Instant at, String symbol, String side, double quantity, double price, double fee,
      double slippageCost, double cashAfter) {}

  public record EquityPoint(Instant at, double equity, double cash, double positionsValue, double drawdown) {}

  public record Result(List<EquityPoint> equityCurve, List<Trade> trades, double finalCash,
      Map<String, Double> finalPositions, double totalFees, double totalSlippageCost, String executionConvention) {}

  private BacktestEngine() {}

  public static Result run(Strategy strategy, List<String> symbols, List<Bar> bars, Map<String, Object> params,
      Config config) {
    if (symbols.isEmpty()) throw new IllegalArgumentException("At least one symbol is required");
    if (bars.size() < 2) throw new IllegalArgumentException("Need at least two bars to signal then fill");
    if (!(config.initialCash() > 0)) throw new IllegalArgumentException("initialCash must be > 0");
    if (config.feeBps() < 0 || config.slippageBps() < 0) {
      throw new IllegalArgumentException("feeBps and slippageBps must be >= 0");
    }

    Context ctx = new Context(List.copyOf(symbols), List.copyOf(bars), Map.copyOf(params));
    double cash = config.initialCash();
    Map<String, Double> positions = new LinkedHashMap<>();
    for (String s : symbols) positions.put(s, 0.0);

    List<Trade> trades = new ArrayList<>();
    List<EquityPoint> curve = new ArrayList<>();
    double totalFees = 0;
    double totalSlippage = 0;
    double peak = config.initialCash();
    Target pending = null;

    for (int i = 0; i < bars.size(); i++) {
      Bar bar = bars.get(i);

      if (pending != null && !pending.hold()) {
        RebalanceOutcome outcome = rebalance(cash, positions, pending.weights(), bar, symbols, config);
        cash = outcome.cash();
        totalFees += outcome.fees();
        totalSlippage += outcome.slippage();
        trades.addAll(outcome.trades());
      }

      double positionsValue = mark(positions, bar);
      double equity = cash + positionsValue;
      peak = Math.max(peak, equity);
      double dd = peak > 0 ? (peak - equity) / peak : 0;
      curve.add(new EquityPoint(bar.at(), equity, cash, positionsValue, dd));

      Target signal = strategy.target(i, ctx);
      validateTarget(signal, symbols);
      pending = signal;
    }

    return new Result(curve, trades, cash, Map.copyOf(positions), totalFees, totalSlippage, EXECUTION_CONVENTION);
  }

  private static void validateTarget(Target target, List<String> symbols) {
    if (target.hold()) return;
    double sum = 0;
    for (Map.Entry<String, Double> e : target.weights().entrySet()) {
      if (!symbols.contains(e.getKey())) {
        throw new IllegalArgumentException("Strategy targeted unknown symbol " + e.getKey());
      }
      if (e.getValue() < 0 || Double.isNaN(e.getValue()) || Double.isInfinite(e.getValue())) {
        throw new IllegalArgumentException("Weights must be finite and >= 0");
      }
      sum += e.getValue();
    }
    if (sum > 1.0000001) throw new IllegalArgumentException("Weights must sum to at most 1");
  }

  private record RebalanceOutcome(double cash, double fees, double slippage, List<Trade> trades) {}

  private static RebalanceOutcome rebalance(double cash, Map<String, Double> positions, Map<String, Double> weights,
      Bar bar, List<String> symbols, Config config) {
    double equity = cash + mark(positions, bar);
    List<Trade> trades = new ArrayList<>();
    double fees = 0;
    double slippage = 0;

    // Sells first to free cash, then buys.
    for (String symbol : symbols) {
      double price = requireClose(bar, symbol);
      double targetWeight = weights.getOrDefault(symbol, 0.0);
      double targetValue = equity * targetWeight;
      double currentQty = positions.getOrDefault(symbol, 0.0);
      double currentValue = currentQty * price;
      double deltaValue = targetValue - currentValue;
      if (deltaValue >= -1e-9) continue; // buy or flat - handle buys in second pass
      double sellQty = Math.min(currentQty, (-deltaValue) / price);
      if (sellQty <= 1e-12) continue;
      double fill = price * (1 - config.slippageBps() / 10_000.0);
      double notional = fill * sellQty;
      double slip = (price - fill) * sellQty;
      double fee = notional * config.feeBps() / 10_000.0;
      cash += notional - fee;
      positions.put(symbol, currentQty - sellQty);
      fees += fee;
      slippage += slip;
      trades.add(new Trade(bar.at(), symbol, "SELL", sellQty, fill, fee, slip, cash));
    }

    equity = cash + mark(positions, bar);
    for (String symbol : symbols) {
      double price = requireClose(bar, symbol);
      double targetWeight = weights.getOrDefault(symbol, 0.0);
      double targetValue = equity * targetWeight;
      double currentQty = positions.getOrDefault(symbol, 0.0);
      double currentValue = currentQty * price;
      double deltaValue = targetValue - currentValue;
      if (deltaValue <= 1e-9) continue;
      double fill = price * (1 + config.slippageBps() / 10_000.0);
      double budget = Math.min(deltaValue, cash);
      if (budget <= 1e-9) continue;
      // Solve qty such that qty*fill + fee = budget, fee = qty*fill*feeBps/10000
      double feeFactor = config.feeBps() / 10_000.0;
      double qty = budget / (fill * (1 + feeFactor));
      if (qty <= 1e-12) continue;
      double notional = fill * qty;
      double fee = notional * feeFactor;
      double slip = (fill - price) * qty;
      if (notional + fee > cash + 1e-9) {
        qty = cash / (fill * (1 + feeFactor));
        notional = fill * qty;
        fee = notional * feeFactor;
        slip = (fill - price) * qty;
      }
      cash -= notional + fee;
      positions.put(symbol, currentQty + qty);
      fees += fee;
      slippage += slip;
      trades.add(new Trade(bar.at(), symbol, "BUY", qty, fill, fee, slip, cash));
    }

    return new RebalanceOutcome(cash, fees, slippage, trades);
  }

  private static double mark(Map<String, Double> positions, Bar bar) {
    double value = 0;
    for (Map.Entry<String, Double> e : positions.entrySet()) {
      if (e.getValue() != 0) value += e.getValue() * requireClose(bar, e.getKey());
    }
    return value;
  }

  private static double requireClose(Bar bar, String symbol) {
    Double mid = bar.closes().get(symbol);
    if (mid == null || !(mid > 0)) throw new IllegalStateException("Missing positive close for " + symbol);
    return mid;
  }
}
