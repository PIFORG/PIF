package com.pif.api.trading;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.finance.Holding;
import com.pif.api.finance.Ledger;
import com.pif.api.finance.OrderSide;
import com.pif.api.finance.OrderType;
import com.pif.api.market.FictionalUniverse;
import com.pif.api.market.MarketQuote;
import com.pif.api.market.PricePoint;
import com.pif.api.market.Rng;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.trading.Analytics.AnalyticsInput;
import com.pif.api.trading.Analytics.CashEntryInput;
import com.pif.api.trading.Analytics.EquityPoint;
import com.pif.api.trading.Analytics.ExecutionInput;
import com.pif.api.trading.Analytics.Flow;
import com.pif.api.trading.Analytics.FlowPoint;
import com.pif.api.trading.Analytics.HoldingInput;
import com.pif.api.trading.Engine.Book;
import com.pif.api.trading.Engine.Evaluation;
import com.pif.api.trading.Engine.Fill;
import com.pif.api.trading.Engine.InstrumentTerms;
import com.pif.api.trading.Engine.OrderRequest;
import com.pif.api.trading.Engine.Period;
import com.pif.api.trading.Engine.WorkingOrder;
import com.pif.api.web.JsNumbers;
import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.json.JsonMapper;

/**
 * Golden master for the simulated market, the trading engine and portfolio analytics: every expectation was produced
 * by the TypeScript code (contract/generate-trading-fixtures.mjs) and must match bit for bit. Engine scenarios
 * replay whole order lifecycles and compare the ledger, every position and every order after each step.
 */
class TradingGoldenMasterTest {

  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final SimulatedMarketProvider PROVIDER = new SimulatedMarketProvider();
  private static final Instant EPOCH = SimulatedMarketProvider.SIMULATION_EPOCH;
  private static Map<String, Object> fixture;

  @BeforeAll
  static void load() throws Exception {
    try (InputStream in = TradingGoldenMasterTest.class.getResourceAsStream("/fixtures/trading-golden.json")) {
      fixture = map(JSON.readValue(in, Map.class));
    }
  }

  // ---------------------------------------------------------------- helpers

  @SuppressWarnings("unchecked")
  private static Map<String, Object> map(Object o) {
    return (Map<String, Object>) o;
  }

  @SuppressWarnings("unchecked")
  private static List<Object> list(Object o) {
    return (List<Object>) o;
  }

  private static double d(Object o) {
    return Double.parseDouble((String) o);
  }

  private static Double dOrNull(Object o) {
    return o == null ? null : d(o);
  }

  private static Instant at(Object o) {
    return Instant.parse((String) o);
  }

  /** The fixture's number text: Number.prototype.toString(), with "-0" kept. */
  private static String num(double x) {
    return x == 0 && 1 / x < 0 ? "-0" : JsNumbers.toJsString(x);
  }

  private static String iso(Instant i) {
    return com.pif.api.data.Db.iso(i);
  }

  /** Encodes a Java output tree the way the generator encodes TypeScript values. */
  private static Object enc(Object v) {
    if (v instanceof Number n) return num(n.doubleValue());
    if (v instanceof Instant i) return iso(i);
    if (v instanceof Map<?, ?> m) {
      Map<String, Object> out = new LinkedHashMap<>();
      m.forEach((k, x) -> out.put((String) k, enc(x)));
      return out;
    }
    if (v instanceof List<?> l) return l.stream().map(TradingGoldenMasterTest::enc).toList();
    return v;
  }

  private static String json(Object o) {
    return JSON.writeValueAsString(o);
  }

  private static void assertSame(String what, Object expected, Object actual) {
    assertThat(json(actual)).as(what).isEqualTo(json(expected));
  }

  // ---------------------------------------------------------------- market data

  @TestFactory
  Stream<DynamicTest> seedsAndRandomStreams() {
    Map<String, Object> market = map(fixture.get("market"));
    List<DynamicTest> tests = new ArrayList<>();
    for (Object o : list(market.get("seeds"))) {
      List<Object> c = list(o);
      tests.add(DynamicTest.dynamicTest("seedFromString " + json(c.get(0)), () ->
          assertThat(num(Rng.seedFromString((String) c.get(0)))).isEqualTo(c.get(1))));
    }
    for (Object o : list(market.get("rng"))) {
      Map<String, Object> c = map(o);
      tests.add(DynamicTest.dynamicTest("rng seed " + c.get("seed"), () -> {
        Rng u = new Rng((long) d(c.get("seed")));
        Rng n = new Rng((long) d(c.get("seed")));
        assertThat(list(c.get("uniform")).stream().map(x -> num(u.uniform())).toList()).isEqualTo(c.get("uniform"));
        assertThat(list(c.get("normal")).stream().map(x -> num(n.normal())).toList()).isEqualTo(c.get("normal"));
      }));
    }
    return tests.stream();
  }

  @TestFactory
  Stream<DynamicTest> everyDailyCloseSinceTheEpoch() {
    Map<String, Object> closes = map(map(fixture.get("market")).get("closes"));
    return closes.entrySet().stream().map(e -> DynamicTest.dynamicTest("closes " + e.getKey(), () -> {
      List<Object> expected = list(e.getValue());
      List<String> actual = PROVIDER.dailyCloses(e.getKey(), EPOCH, EPOCH.plus(Duration.ofDays(expected.size())))
          .stream().map(p -> num(p.mid())).toList();
      assertThat(actual).hasSize(420).isEqualTo(expected);
    }));
  }

  @TestFactory
  Stream<DynamicTest> fullIntradayPaths() {
    return list(map(fixture.get("market")).get("intraday")).stream().map(o -> {
      Map<String, Object> c = map(o);
      String symbol = (String) c.get("symbol");
      int day = ((Number) c.get("day")).intValue();
      return DynamicTest.dynamicTest("intraday " + symbol + " day " + day, () -> {
        List<List<String>> actual = new ArrayList<>();
        for (int j = 0; j < 288; j++) {
          MarketQuote q = PROVIDER.quoteAtBucket(symbol, day * 288L + j);
          actual.add(List.of(num(q.mid()), num(q.bid()), num(q.ask())));
          assertThat(num(q.depth())).isEqualTo(c.get("depth"));
        }
        assertSame(symbol + " day " + day, c.get("quotes"), actual);
      });
    });
  }

  private static Object quoteOut(MarketQuote q) {
    if (q == null) return null;
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("symbol", q.symbol());
    m.put("asOf", iso(q.asOf()));
    m.put("mid", num(q.mid()));
    m.put("bid", num(q.bid()));
    m.put("ask", num(q.ask()));
    m.put("depth", num(q.depth()));
    return m;
  }

  private static Object pointOut(PricePoint p) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("at", iso(p.at()));
    m.put("mid", num(p.mid()));
    return m;
  }

  @TestFactory
  Stream<DynamicTest> providerCalls() {
    List<Object> calls = list(map(fixture.get("market")).get("calls"));
    List<DynamicTest> tests = new ArrayList<>();
    for (int i = 0; i < calls.size(); i++) {
      Map<String, Object> c = map(calls.get(i));
      String kind = (String) c.get("kind");
      tests.add(DynamicTest.dynamicTest("call " + i + " " + kind, () -> {
        String symbol = (String) c.get("symbol");
        Instant from = at(c.get("from"));
        Instant to = at(c.get("to"));
        Object actual = switch (kind) {
          case "quote" -> quoteOut(PROVIDER.quote(symbol, from));
          case "quotesBetween" -> PROVIDER.quotesBetween(symbol, from, min(to, from.plus(Duration.ofDays(3))))
              .stream().map(TradingGoldenMasterTest::quoteOut).toList();
          case "dailyCloses" -> PROVIDER.dailyCloses(symbol, from, to).stream()
              .map(TradingGoldenMasterTest::pointOut).toList();
          default -> PROVIDER.intraday(symbol, from, min(to, from.plus(Duration.ofDays(5))),
              "intraday1".equals(kind) ? 1 : 6).stream().map(TradingGoldenMasterTest::pointOut).toList();
        };
        assertSame(kind, c.get("output"), actual);
      }));
    }
    return tests.stream();
  }

  private static Instant min(Instant a, Instant b) {
    return a.isBefore(b) ? a : b;
  }

  @Test
  void providerRefusesQuotesBeforeTheEpoch() {
    assertThat(PROVIDER.quote("CTB", EPOCH.minusMillis(1))).isNull();
    assertThat(PROVIDER.quote("CTB", EPOCH).mid()).isEqualTo(42_500);
  }

  // ---------------------------------------------------------------- engine scenarios

  private static Map<String, Object> ledgerOut(Ledger l) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("cash", num(l.cash()));
    List<Object> positions = new ArrayList<>();
    for (Holding h : l.positions().values()) positions.add(List.of(h.symbol(), num(h.quantity()), num(h.costBasis())));
    m.put("positions", positions);
    m.put("realizedPnl", num(l.realizedPnl()));
    m.put("feesPaid", num(l.feesPaid()));
    m.put("spreadCostPaid", num(l.spreadCostPaid()));
    return m;
  }

  private static Map<String, Object> orderOut(WorkingOrder o) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", o.id);
    m.put("symbol", o.symbol);
    m.put("side", o.side.name());
    m.put("type", o.type.name());
    m.put("quantity", num(o.quantity));
    m.put("filledQuantity", num(o.filledQuantity));
    m.put("filledValue", num(o.filledValue));
    m.put("limitPrice", o.limitPrice == null ? null : num(o.limitPrice));
    m.put("stopPrice", o.stopPrice == null ? null : num(o.stopPrice));
    m.put("triggered", o.triggered);
    m.put("status", o.status);
    m.put("statusReason", o.statusReason);
    m.put("submittedAt", iso(o.submittedAt));
    m.put("expiresAt", o.expiresAt == null ? null : iso(o.expiresAt));
    m.put("closedAt", o.closedAt == null ? null : iso(o.closedAt));
    m.put("changed", o.changed);
    Double average = Engine.averagePrice(o);
    m.put("averagePrice", average == null ? null : num(average));
    return m;
  }

  private static Map<String, Object> fillOut(Fill f) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("orderId", f.orderId());
    m.put("symbol", f.symbol());
    m.put("side", f.side().name());
    m.put("quantity", num(f.quantity()));
    m.put("price", num(f.price()));
    m.put("notional", num(f.notional()));
    m.put("fee", num(f.fee()));
    m.put("spreadCost", num(f.spreadCost()));
    m.put("realizedPnl", num(f.realizedPnl()));
    m.put("quote", quoteOut(f.quote()));
    m.put("cashAfter", num(f.cashAfter()));
    return m;
  }

  private static Map<String, Object> evaluationOut(Evaluation e) {
    Map<String, Object> m = new LinkedHashMap<>();
    if (e.rejection() == null) {
      m.put("rejection", null);
    } else {
      Map<String, Object> r = new LinkedHashMap<>();
      r.put("code", e.rejection().code());
      r.put("message", e.rejection().message());
      m.put("rejection", r);
    }
    m.put("referencePrice", num(e.referencePrice()));
    Map<String, Object> estimate = new LinkedHashMap<>();
    estimate.put("notional", num(e.estimate().notional()));
    estimate.put("fee", num(e.estimate().fee()));
    estimate.put("total", num(e.estimate().total()));
    m.put("estimate", estimate);
    m.put("executesNow", e.executesNow());
    m.put("fillableNow", num(e.fillableNow()));
    m.put("availableCash", num(e.availableCash()));
    m.put("held", num(e.held()));
    m.put("equity", num(e.equity()));
    m.put("warnings", e.warnings());
    return m;
  }

  @TestFactory
  Stream<DynamicTest> orderLifecycleScenarios() {
    List<Object> scenarios = list(fixture.get("engine"));
    List<DynamicTest> tests = new ArrayList<>();
    for (int i = 0; i < scenarios.size(); i++) {
      Map<String, Object> scenario = map(scenarios.get(i));
      tests.add(DynamicTest.dynamicTest("scenario " + i, () -> replay(scenario)));
    }
    return tests.stream();
  }

  private static void replay(Map<String, Object> scenario) {
    Set<String> halted = new HashSet<>();
    list(scenario.get("halted")).forEach(s -> halted.add((String) s));
    Map<String, Double> lots = new HashMap<>();
    list(scenario.get("lots")).forEach(o -> lots.put((String) list(o).get(0), d(list(o).get(1))));
    Function<String, InstrumentTerms> termsOf = sym -> {
      String assetClass = "GOV".equals(sym) ? "FUND" : "EQUITY";
      return new InstrumentTerms(sym, assetClass, FictionalUniverse.INSTRUMENTS.get(sym).sector(),
          halted.contains(sym) ? "HALTED" : "ACTIVE", lots.get(sym), TradingRules.FEE_SCHEDULES.get(assetClass));
    };
    Map<String, Holding> positions = new LinkedHashMap<>();
    for (Object o : list(scenario.get("positions"))) {
      List<Object> p = list(o);
      positions.put((String) p.get(0), new Holding((String) p.get(0), d(p.get(1)), d(p.get(2))));
    }
    Book book = new Book(new Ledger(d(scenario.get("cash")), positions, 0, 0, 0), new ArrayList<>(),
        d(scenario.get("maxPositionWeightPct")));

    List<Object> steps = list(scenario.get("steps"));
    for (int k = 0; k < steps.size(); k++) {
      Map<String, Object> step = map(steps.get(k));
      String label = "step " + k + " (" + step.get("op") + ")";
      Instant now = at(step.get("now"));
      Function<String, MarketQuote> quoteOf = sym -> PROVIDER.quote(sym, now).withSymbol(sym);
      switch ((String) step.get("op")) {
        case "match" -> {
          Map<Long, Period> periods = new LinkedHashMap<>();
          Set<String> symbols = new LinkedHashSet<>();
          for (WorkingOrder o : book.orders()) if (Engine.isWorking(o.status)) symbols.add(o.symbol);
          for (String sym : symbols) {
            for (MarketQuote q : PROVIDER.quotesBetween(sym, at(step.get("matchedThrough")), now)) {
              periods.computeIfAbsent(q.asOf().toEpochMilli(), t -> new Period(q.asOf(), new HashMap<>()))
                  .quotes().put(sym, q.withSymbol(sym));
            }
          }
          List<Period> ordered = new ArrayList<>(new TreeMap<>(periods).values());
          List<Fill> fills = Engine.matchWorkingOrders(book, ordered, termsOf);
          assertSame(label + " fills", step.get("fills"), fills.stream().map(TradingGoldenMasterTest::fillOut).toList());
          assertSame(label + " executedAt", step.get("executedAt"), fills.stream()
              .map(f -> iso(Engine.executedAt(f, find(book, f.orderId())))).toList());
        }
        case "cancel" -> Engine.cancelWorkingOrder(find(book, (String) step.get("orderId")), now);
        default -> {
          Map<String, Object> r = map(step.get("request"));
          OrderRequest request = new OrderRequest((String) r.get("symbol"), OrderSide.valueOf((String) r.get("side")),
              OrderType.valueOf((String) r.get("type")), d(r.get("quantity")), dOrNull(r.get("limitPrice")),
              dOrNull(r.get("stopPrice")));
          MarketQuote quote = quoteOf.apply(request.symbol());
          double depthUsed = d(step.get("depthUsed"));
          Evaluation evaluation = Engine.evaluateOrder(book, request, termsOf.apply(request.symbol()), quote, termsOf,
              sym -> quoteOf.apply(sym).mid(), depthUsed);
          assertSame(label + " evaluation", step.get("evaluation"), evaluationOut(evaluation));
          if (evaluation.rejection() == null) {
            WorkingOrder order = WorkingOrder.open((String) step.get("orderId"), request, now);
            Map<String, Double> depth = new HashMap<>();
            depth.put(request.symbol() + ":" + request.side().name(), depthUsed);
            List<Fill> fills = Engine.placeOrder(book, order, termsOf.apply(request.symbol()), quote, depth, now);
            assertSame(label + " fills", step.get("fills"),
                fills.stream().map(TradingGoldenMasterTest::fillOut).toList());
            assertSame(label + " executedAt", step.get("executedAt"),
                fills.stream().map(f -> iso(Engine.executedAt(f, order))).toList());
          }
        }
      }
      assertSame(label + " ledger", step.get("ledger"), ledgerOut(book.ledger()));
      assertSame(label + " orders", step.get("orders"), book.orders().stream().map(TradingGoldenMasterTest::orderOut).toList());
      assertThat(num(Engine.availableCash(book, termsOf))).as(label + " availableCash").isEqualTo(step.get("availableCash"));
      assertThat(num(Engine.bookEquity(book, sym -> quoteOf.apply(sym).mid()))).as(label + " equity")
          .isEqualTo(step.get("equity"));
      for (WorkingOrder o : book.orders()) o.changed = false;
    }
  }

  private static WorkingOrder find(Book book, String id) {
    return book.orders().stream().filter(o -> o.id.equals(id)).findFirst().orElseThrow();
  }

  // ---------------------------------------------------------------- analytics

  @TestFactory
  Stream<DynamicTest> dailyEquityReconstruction() {
    List<Object> cases = list(map(fixture.get("analytics")).get("reconstruct"));
    List<DynamicTest> tests = new ArrayList<>();
    for (int i = 0; i < cases.size(); i++) {
      Map<String, Object> c = map(cases.get(i));
      tests.add(DynamicTest.dynamicTest("reconstruct " + i, () -> {
        List<CashEntryInput> entries = list(c.get("cashEntries")).stream().map(o -> {
          Map<String, Object> e = map(o);
          return new CashEntryInput((String) e.get("type"), d(e.get("amount")), d(e.get("balanceAfter")),
              at(e.get("occurredAt")));
        }).toList();
        List<ExecutionInput> executions = list(c.get("executions")).stream().map(o -> {
          Map<String, Object> e = map(o);
          return new ExecutionInput((String) e.get("symbol"), (String) e.get("side"), d(e.get("quantity")),
              at(e.get("executedAt")));
        }).toList();
        List<EquityPoint> points = Analytics.reconstructDailyEquity(at(c.get("createdAt")), at(c.get("now")),
            d(c.get("initialCapital")), entries, executions, (sym, t) -> {
              MarketQuote q = PROVIDER.quote(sym, t);
              return q == null ? 0.0 : q.mid();
            });
        List<Object> actual = points.stream().map(p -> {
          Map<String, Object> m = new LinkedHashMap<>();
          m.put("at", iso(p.at()));
          m.put("equity", num(p.equity()));
          m.put("flows", num(p.flows()));
          m.put("netContributions", num(p.netContributions()));
          return (Object) m;
        }).toList();
        assertSame("points", c.get("points"), actual);
        List<String> returns = new ArrayList<>();
        for (double r : Analytics.periodReturns(points)) returns.add(num(r));
        assertSame("returns", c.get("returns"), returns);
      }));
    }
    return tests.stream();
  }

  @TestFactory
  Stream<DynamicTest> modifiedDietz() {
    List<Object> cases = list(map(fixture.get("analytics")).get("dietz"));
    List<DynamicTest> tests = new ArrayList<>();
    for (int i = 0; i < cases.size(); i++) {
      Map<String, Object> c = map(cases.get(i));
      tests.add(DynamicTest.dynamicTest("dietz " + i, () -> {
        List<Flow> flows = list(c.get("flows")).stream()
            .map(o -> new Flow(d(map(o).get("amount")), at(map(o).get("at")))).toList();
        Double out = Analytics.modifiedDietz(flows, at(c.get("start")), at(c.get("end")), d(c.get("endValue")));
        assertThat(out == null ? null : num(out)).isEqualTo(c.get("output"));
      }));
    }
    return tests.stream();
  }

  @TestFactory
  Stream<DynamicTest> portfolioAnalytics() {
    List<Object> cases = list(map(fixture.get("analytics")).get("portfolio"));
    List<DynamicTest> tests = new ArrayList<>();
    for (int i = 0; i < cases.size(); i++) {
      Map<String, Object> c = map(cases.get(i));
      tests.add(DynamicTest.dynamicTest("analytics " + i, () -> {
        Map<String, Object> in = map(c.get("input"));
        List<HoldingInput> holdings = list(in.get("holdings")).stream().map(o -> {
          Map<String, Object> h = map(o);
          String assetClass = (String) h.get("assetClass");
          return new HoldingInput((String) h.get("symbol"), (String) h.get("name"), assetClass,
              (String) h.get("sector"), d(h.get("quantity")), d(h.get("costBasis")), d(h.get("mid")),
              d(h.get("bid")), TradingRules.FEE_SCHEDULES.get(assetClass));
        }).toList();
        List<FlowPoint> flowPoints = list(in.get("flowPoints")).stream().map(o -> {
          Map<String, Object> p = map(o);
          return new FlowPoint(d(p.get("equity")), d(p.get("flowAfter")), at(p.get("at")));
        }).toList();
        List<EquityPoint> dailyEquity = list(in.get("dailyEquity")).stream().map(o -> {
          Map<String, Object> p = map(o);
          return new EquityPoint(at(p.get("at")), d(p.get("equity")), d(p.get("flows")),
              d(p.get("netContributions")));
        }).toList();
        Map<String, double[]> returns = new LinkedHashMap<>();
        for (Object o : list(in.get("instrumentReturns"))) {
          List<Object> pair = list(o);
          returns.put((String) pair.get(0), list(pair.get(1)).stream().mapToDouble(TradingGoldenMasterTest::d).toArray());
        }
        Map<String, Object> out = Analytics.portfolioAnalytics(new AnalyticsInput(at(in.get("now")),
            at(in.get("createdAt")), d(in.get("cash")), d(in.get("reserved")), d(in.get("netContributions")),
            d(in.get("realizedPnl")), d(in.get("feesPaid")), d(in.get("spreadCost")), holdings, flowPoints,
            dailyEquity, returns, d(in.get("cashLedgerSum")), TradingRules.STRESS_SCENARIOS, x -> x / 1000));
        assertSame("analytics", c.get("output"), enc(out));
      }));
    }
    return tests.stream();
  }
}
