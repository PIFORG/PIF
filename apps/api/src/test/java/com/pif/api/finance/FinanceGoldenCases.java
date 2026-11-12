package com.pif.api.finance;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Replays cases of fixtures/finance-golden.json (written by contract/generate-finance-fixtures.mjs
 * with the TypeScript core) against the Java port. Works on the plain parsed JSON tree
 * (Map / List / String / Boolean / null) and needs only the JDK, so the same checks run under JUnit
 * and in a standalone harness. Numbers are JavaScript Number#toString texts and must match the Java
 * double exactly, sign of zero included.
 */
final class FinanceGoldenCases {

  static final List<String> FUNCTIONS = List.of(
      "toAmount", "fromAmount", "notional", "divRound", "commission", "ratio",
      "executionPrice", "limitCrosses", "limitIsMarketable", "sellStopTriggered", "remainingDepth", "spreadCost",
      "bookExecution", "heldQuantity",
      "marketValues", "totalValue", "equityOf", "maxWeight", "exposure", "concentration", "unrealizedPnl",
      "maxDrawdown", "simpleReturns", "sampleStdDev", "historicalVaR", "scenarioPnl", "stressImpact",
      "reservedCash", "estimateOrder", "checkOrder",
      "limitWithinBand", "stopBelowBid", "restingOrderAction", "fillableQuantity",
      "timeWeightedReturn", "netContributions", "investmentProfit");

  private FinanceGoldenCases() {}

  /** Throws AssertionError describing the first difference between Java and TypeScript. */
  static void check(String fn, Map<String, Object> c) {
    Map<String, Object> in = map(c.get("input"));
    if (fn.equals("bookExecution")) {
      checkLedgerScenario(in, map(c.get("output")));
      return;
    }
    if (isRefusedVarSample(fn, in)) {
      try {
        run(fn, in);
      } catch (InvalidSampleException expected) {
        return;
      }
      throw new AssertionError(fn + ": a sample with a non-finite observation must be refused (missing-data policy), "
          + "TypeScript returned " + c.get("output"));
    }
    Object actual;
    try {
      actual = run(fn, in);
    } catch (RuntimeException e) {
      if (c.containsKey("error")) {
        expectError(fn, map(c.get("error")), e);
        return;
      }
      throw new AssertionError(fn + ": Java threw " + e + " but TypeScript returned " + c.get("output"), e);
    }
    if (c.containsKey("error")) throw new AssertionError(fn + ": TypeScript threw " + c.get("error") + " but Java returned " + actual);
    compare(fn, c.get("output"), actual);
  }

  /**
   * Golden cases where TypeScript computes a VaR from NaN or ±Infinity. Java deliberately refuses them
   * (FINANCIAL_PARITY.md, missing-data policy), so they verify the refusal instead of the TypeScript number.
   */
  static boolean isRefusedVarSample(String fn, Map<String, Object> in) {
    if (!fn.equals("historicalVaR")) return false;
    double[] pnl = numbers(in.get("pnl"));
    return pnl.length >= Risk.MIN_VAR_OBSERVATIONS && !Risk.allFinite(pnl);
  }

  private static Object run(String fn, Map<String, Object> in) {
    return switch (fn) {
      case "toAmount" -> Money.toAmount(d(in, "value"));
      case "fromAmount" -> Money.fromAmount(d(in, "amount"));
      case "notional" -> Money.notional(d(in, "price"), d(in, "quantity"));
      case "divRound" -> Money.divRound(d(in, "numerator"), d(in, "denominator"));
      case "commission" -> Money.commission(d(in, "notional"), d(in, "feeBps"), d(in, "minFee"));
      case "ratio" -> Money.ratio(d(in, "part"), d(in, "whole"));
      case "executionPrice" -> ExecutionRules.executionPrice(side(in), quote(in.get("quote")));
      case "limitCrosses" -> ExecutionRules.limitCrosses(side(in), d(in, "limitPrice"), quote(in.get("quote")));
      case "limitIsMarketable" -> ExecutionRules.limitIsMarketable(side(in), d(in, "limitPrice"), quote(in.get("quote")));
      case "sellStopTriggered" -> ExecutionRules.sellStopTriggered(d(in, "stopPrice"), quote(in.get("quote")));
      case "remainingDepth" -> ExecutionRules.remainingDepth(quote(in.get("quote")), d(in, "alreadyUsed"));
      case "spreadCost" -> ExecutionRules.spreadCost(d(in, "price"), d(in, "mid"), d(in, "quantity"));
      case "heldQuantity" -> Ledger.heldQuantity(holdings(in.get("positions")), (String) in.get("symbol"));
      case "marketValues" -> {
        Map<String, Double> prices = amounts(in.get("prices"));
        yield pairs(Valuation.marketValues(holdings(in.get("positions")), s -> prices.get(s)));
      }
      case "totalValue" -> Valuation.totalValue(amounts(in.get("values")));
      case "equityOf" -> Valuation.equityOf(d(in, "cash"), amounts(in.get("values")));
      case "maxWeight" -> Valuation.maxWeight(amounts(in.get("values")), d(in, "base"));
      case "exposure" -> Valuation.exposure(amounts(in.get("values")), d(in, "equity"));
      case "concentration" -> {
        Valuation.Concentration r = Valuation.concentration(amounts(in.get("values")));
        yield obj("hhi", r.hhi(), "effectiveAssets", r.effectiveAssets());
      }
      case "unrealizedPnl" -> Valuation.unrealizedPnl(holdings(in.get("positions")), amounts(in.get("values")));
      case "maxDrawdown" -> Risk.maxDrawdown(numbers(in.get("series")));
      case "simpleReturns" -> boxed(Risk.simpleReturns(numbers(in.get("series"))));
      case "sampleStdDev" -> Risk.sampleStdDev(numbers(in.get("values")));
      case "historicalVaR" -> {
        double[] pnl = numbers(in.get("pnl"));
        Risk.VarResult r = in.containsKey("confidence") ? Risk.historicalVaR(pnl, d(in, "confidence")) : Risk.historicalVaR(pnl);
        yield r == null ? null : obj("var", r.valueAtRisk(), "es", r.expectedShortfall());
      }
      case "scenarioPnl" -> {
        Map<String, Double> returns = amounts(in.get("returns"));
        yield Risk.scenarioPnl(amounts(in.get("values")), s -> returns.get(s));
      }
      case "stressImpact" -> {
        Map<String, Double> shocks = amounts(in.get("shocks"));
        yield stress(Risk.stressImpact(amounts(in.get("values")), s -> shocks.get(s)));
      }
      case "reservedCash" -> {
        List<PreTrade.OpenBuyLimit> openBuys = new ArrayList<>();
        for (Object o : list(in.get("openBuys"))) openBuys.add(new PreTrade.OpenBuyLimit(d(map(o), "limitPrice"), d(map(o), "remainingQuantity")));
        yield PreTrade.reservedCash(openBuys, fees(in.get("fees")));
      }
      case "estimateOrder" -> {
        PreTrade.PreTradeEstimate e = PreTrade.estimateOrder(side(in), d(in, "price"), d(in, "quantity"), fees(in.get("fees")));
        yield obj("notional", e.notional(), "fee", e.fee(), "total", e.total());
      }
      case "checkOrder" -> rejection(PreTrade.checkOrder(preTradeInput(map(in.get("input")))));
      case "limitWithinBand" -> OrderRules.limitWithinBand(d(in, "limitPrice"), d(in, "mid"), d(in, "bandPct"));
      case "stopBelowBid" -> OrderRules.stopBelowBid(d(in, "stopPrice"), quote(in.get("quote")));
      case "restingOrderAction" -> {
        Map<String, Object> o = map(in.get("order"));
        OrderRules.RestingOrder order = new OrderRules.RestingOrder(
            OrderType.valueOf((String) o.get("type")), side(o), nd(o, "limitPrice"), nd(o, "stopPrice"), (Boolean) o.get("triggered"));
        OrderRules.RestingOrderAction a = OrderRules.restingOrderAction(order, quote(in.get("quote")));
        yield obj("triggered", a.triggered(), "execute", a.execute());
      }
      case "fillableQuantity" -> OrderRules.fillableQuantity(side(in), d(in, "remaining"), d(in, "held"), d(in, "depthLeft"));
      case "timeWeightedReturn" -> {
        List<Performance.ValuationPoint> points = new ArrayList<>();
        for (Object o : list(in.get("points"))) points.add(new Performance.ValuationPoint(d(map(o), "equity"), d(map(o), "flowAfter")));
        yield Performance.timeWeightedReturn(points);
      }
      case "netContributions" -> Performance.netContributions(numbers(in.get("flows")));
      case "investmentProfit" -> Performance.investmentProfit(d(in, "equity"), d(in, "contributions"));
      default -> throw new IllegalStateException("No Java mapping for " + fn);
    };
  }

  private static void checkLedgerScenario(Map<String, Object> in, Map<String, Object> expected) {
    Map<String, Object> l = map(in.get("ledger"));
    Ledger ledger = new Ledger(d(l, "cash"), holdings(l.get("positions")), d(l, "realizedPnl"), d(l, "feesPaid"), d(l, "spreadCostPaid"));
    List<Object> executions = list(in.get("executions"));
    List<Object> steps = list(expected.get("steps"));
    if (executions.size() != steps.size()) throw new AssertionError("bookExecution: fixture has " + executions.size() + " executions but " + steps.size() + " steps");
    for (int i = 0; i < executions.size(); i++) {
      Map<String, Object> e = map(executions.get(i));
      Map<String, Object> step = map(steps.get(i));
      Execution execution = new Execution((String) e.get("symbol"), side(e), d(e, "price"), d(e, "quantity"), d(e, "fee"), d(e, "mid"));
      String path = "bookExecution step " + i;
      try {
        Booking b = Ledger.bookExecution(ledger, execution);
        if (step.containsKey("error")) throw new AssertionError(path + ": TypeScript threw " + step.get("error") + " but Java booked " + b);
        compare(path + " booking", step.get("booking"),
            obj("notional", b.notional(), "fee", b.fee(), "spreadCost", b.spreadCost(), "costRemoved", b.costRemoved(), "realizedPnl", b.realizedPnl()));
      } catch (LedgerException ex) {
        if (!step.containsKey("error")) throw new AssertionError(path + ": Java threw " + ex + " but TypeScript booked " + step.get("booking"), ex);
        expectError(path, map(step.get("error")), ex);
      }
      compare(path + " ledger", step.get("ledger"), snapshot(ledger));
    }
  }

  static Map<String, Object> snapshot(Ledger ledger) {
    List<Object> positions = new ArrayList<>();
    for (Map.Entry<String, Holding> e : JsSemantics.entries(ledger.positions())) {
      Holding h = e.getValue();
      positions.add(List.of(e.getKey(), obj("symbol", h.symbol(), "quantity", h.quantity(), "costBasis", h.costBasis())));
    }
    return obj("cash", ledger.cash(), "realizedPnl", ledger.realizedPnl(), "feesPaid", ledger.feesPaid(),
        "spreadCostPaid", ledger.spreadCostPaid(), "positions", positions);
  }

  private static void expectError(String path, Map<String, Object> error, RuntimeException thrown) {
    String type = (String) error.get("type");
    Class<?> expectedType = switch (type) {
      case "RangeError" -> path.equals("toAmount") ? IllegalArgumentException.class : ArithmeticException.class;
      case "LedgerError" -> LedgerException.class;
      default -> throw new AssertionError(path + ": unexpected TypeScript error type " + type);
    };
    if (!expectedType.isInstance(thrown)) throw new AssertionError(path + ": expected " + expectedType.getSimpleName() + " for " + type + " but Java threw " + thrown, thrown);
    if (!Objects.equals(error.get("message"), thrown.getMessage())) {
      throw new AssertionError(path + ": message \"" + thrown.getMessage() + "\" differs from TypeScript \"" + error.get("message") + "\"");
    }
    if (error.containsKey("code") && !(thrown instanceof LedgerException le && le.code().name().equals(error.get("code")))) {
      throw new AssertionError(path + ": expected code " + error.get("code") + " but Java threw " + thrown);
    }
  }

  /** Expected numbers are JS texts; actual numbers are Doubles compared bit for bit (NaN equal to NaN). */
  static void compare(String path, Object expected, Object actual) {
    if (expected == null || actual == null) {
      if (expected != actual) throw mismatch(path, expected, actual);
    } else if (actual instanceof Double a) {
      if (!(expected instanceof String s) || Double.compare(Double.parseDouble(s), a) != 0) throw mismatch(path, expected, actual);
    } else if (actual instanceof List<?> actualList) {
      if (!(expected instanceof List<?> expectedList) || expectedList.size() != actualList.size()) throw mismatch(path, expected, actual);
      for (int i = 0; i < actualList.size(); i++) compare(path + "[" + i + "]", expectedList.get(i), actualList.get(i));
    } else if (actual instanceof Map<?, ?> actualMap) {
      if (!(expected instanceof Map<?, ?> expectedMap) || !expectedMap.keySet().equals(actualMap.keySet())) throw mismatch(path, expected, actual);
      for (Object key : actualMap.keySet()) compare(path + "." + key, expectedMap.get(key), actualMap.get(key));
    } else if (!actual.equals(expected)) {
      throw mismatch(path, expected, actual);
    }
  }

  private static AssertionError mismatch(String path, Object expected, Object actual) {
    String shown = actual instanceof Double a ? a + " (bits " + Long.toHexString(Double.doubleToRawLongBits(a)) + ")" : String.valueOf(actual);
    return new AssertionError(path + ": TypeScript " + expected + " but Java " + shown);
  }

  // ------------------------------------------------------------ fixture decoding

  @SuppressWarnings("unchecked")
  static Map<String, Object> map(Object o) {
    return (Map<String, Object>) o;
  }

  @SuppressWarnings("unchecked")
  static List<Object> list(Object o) {
    return (List<Object>) o;
  }

  static double num(Object o) {
    return Double.parseDouble((String) o);
  }

  static double d(Map<String, Object> m, String key) {
    if (!m.containsKey(key)) throw new IllegalStateException("fixture field missing: " + key);
    return num(m.get(key));
  }

  private static Double nd(Map<String, Object> m, String key) {
    return m.get(key) == null ? null : num(m.get(key));
  }

  static double[] numbers(Object o) {
    List<Object> values = list(o);
    double[] out = new double[values.size()];
    for (int i = 0; i < out.length; i++) out[i] = num(values.get(i));
    return out;
  }

  private static List<Object> boxed(double[] values) {
    List<Object> out = new ArrayList<>(values.length);
    for (double v : values) out.add(v);
    return out;
  }

  private static OrderSide side(Map<String, Object> m) {
    return OrderSide.valueOf((String) m.get("side"));
  }

  static Quote quote(Object o) {
    Map<String, Object> q = map(o);
    return new Quote(d(q, "mid"), d(q, "bid"), d(q, "ask"), d(q, "depth"));
  }

  /** [key, amount] pairs in insertion order. */
  static Map<String, Double> amounts(Object o) {
    Map<String, Double> out = new LinkedHashMap<>();
    for (Object pair : list(o)) out.put((String) list(pair).get(0), num(list(pair).get(1)));
    return out;
  }

  /** [key, {symbol, quantity, costBasis}] pairs in insertion order. */
  static Map<String, Holding> holdings(Object o) {
    Map<String, Holding> out = new LinkedHashMap<>();
    for (Object pair : list(o)) {
      Map<String, Object> h = map(list(pair).get(1));
      out.put((String) list(pair).get(0), new Holding((String) h.get("symbol"), d(h, "quantity"), d(h, "costBasis")));
    }
    return out;
  }

  private static PreTrade.FeeSchedule fees(Object o) {
    return new PreTrade.FeeSchedule(d(map(o), "feeBps"), d(map(o), "minFee"));
  }

  private static PreTrade.PreTradeInput preTradeInput(Map<String, Object> m) {
    return new PreTrade.PreTradeInput(side(m), d(m, "quantity"), d(m, "referencePrice"), d(m, "mid"), d(m, "held"),
        d(m, "pendingBuyQuantity"), d(m, "availableCash"), d(m, "equity"), fees(m.get("fees")), nd(m, "maxPositionWeightPct"));
  }

  private static Object rejection(PreTrade.Rejection r) {
    return switch (r) {
      case null -> null;
      case PreTrade.InsufficientPosition p -> obj("code", p.code(), "held", p.held());
      case PreTrade.InsufficientCash c -> obj("code", c.code(), "needed", c.needed(), "available", c.available());
      case PreTrade.PositionLimit p -> obj("code", p.code(), "weightPct", p.weightPct(), "limitPct", p.limitPct());
    };
  }

  static Map<String, Object> stress(Risk.StressResult r) {
    List<Object> lines = new ArrayList<>();
    for (Risk.StressLine l : r.breakdown()) lines.add(obj("symbol", l.symbol(), "value", l.value(), "shockPct", l.shockPct(), "impact", l.impact()));
    return obj("impact", r.impact(), "breakdown", lines);
  }

  private static List<Object> pairs(Map<String, Double> values) {
    List<Object> out = new ArrayList<>();
    for (Map.Entry<String, Double> e : values.entrySet()) out.add(List.of(e.getKey(), e.getValue()));
    return out;
  }

  private static Map<String, Object> obj(Object... keyValues) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i < keyValues.length; i += 2) out.put((String) keyValues[i], keyValues[i + 1]);
    return out;
  }
}
