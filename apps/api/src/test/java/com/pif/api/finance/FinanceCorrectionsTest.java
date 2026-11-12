package com.pif.api.finance;

import static com.pif.api.finance.FinanceGoldenCases.list;
import static com.pif.api.finance.FinanceGoldenCases.map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.InputStream;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/**
 * Regression tests for the three intentional corrections of the Java core (FINANCIAL_PARITY.md),
 * against hand-derived fixtures that neither implementation generated.
 */
class FinanceCorrectionsTest {

  private static Map<String, Object> fixture;

  @BeforeAll
  static void load() throws Exception {
    try (InputStream in = FinanceCorrectionsTest.class.getResourceAsStream("/fixtures/finance-corrections.json")) {
      fixture = map(JsonMapper.builder().build().readValue(in, Map.class));
    }
  }

  @Test
  void symbolsNamedLikeObjectPropertiesAreBookedLikeAnyOther() {
    Map<String, Object> f = map(fixture.get("objectPropertySymbols"));
    Map<String, Object> buy = map(f.get("buy"));
    Map<String, Object> sell = map(f.get("sell"));
    Map<String, Object> afterBuy = map(map(f.get("expected")).get("afterBuy"));
    Map<String, Object> afterSell = map(map(f.get("expected")).get("afterSell"));
    for (Object o : list(f.get("symbols"))) {
      String symbol = (String) o;
      Ledger ledger = Ledger.empty(num(f.get("initialCash")));
      Ledger.bookExecution(ledger, execution(symbol, OrderSide.BUY, buy));
      assertThat(ledger.cash()).as(symbol).isEqualTo(num(afterBuy.get("cash")));
      assertThat(ledger.positions()).as(symbol).containsExactly(Map.entry(symbol,
          new Holding(symbol, num(afterBuy.get("quantity")), num(afterBuy.get("costBasis")))));
      assertThat(ledger.spreadCostPaid()).isEqualTo(num(afterBuy.get("spreadCost")));

      Booking booking = Ledger.bookExecution(ledger, execution(symbol, OrderSide.SELL, sell));
      assertThat(booking.costRemoved()).isEqualTo(num(afterSell.get("costRemoved")));
      assertThat(booking.realizedPnl()).isEqualTo(num(afterSell.get("realizedPnl")));
      assertThat(ledger.cash()).isEqualTo(num(afterSell.get("cash")));
      assertThat(Ledger.heldQuantity(ledger, symbol)).isEqualTo(num(afterSell.get("quantity")));
      assertThat(ledger.positions().get(symbol).costBasis()).isEqualTo(num(afterSell.get("costBasis")));
      assertThat(ledger.realizedPnl()).isEqualTo(num(afterSell.get("realizedPnl")));
      assertThat(ledger.feesPaid()).isEqualTo(num(afterSell.get("feesPaid")));
      assertThat(ledger.spreadCostPaid()).isEqualTo(num(afterSell.get("spreadCostPaid")));
      assertThat(ledger.cash() + ledger.positions().get(symbol).costBasis())
          .as("cash + cost basis = initial cash + realised P&L")
          .isEqualTo(num(f.get("initialCash")) + ledger.realizedPnl());

      Map<String, Double> values = Valuation.marketValues(ledger.positions(), s -> 12_000);
      assertThat(values).containsExactly(Map.entry(symbol, 72_000.0));
    }
  }

  @Test
  void ordinarySymbolsBookExactlyTheSameNumbers() {
    Map<String, Object> f = map(fixture.get("objectPropertySymbols"));
    Ledger ledger = Ledger.empty(num(f.get("initialCash")));
    Ledger.bookExecution(ledger, execution("CTB", OrderSide.BUY, map(f.get("buy"))));
    Booking booking = Ledger.bookExecution(ledger, execution("CTB", OrderSide.SELL, map(f.get("sell"))));
    Map<String, Object> afterSell = map(map(f.get("expected")).get("afterSell"));
    assertThat(ledger.cash()).isEqualTo(num(afterSell.get("cash")));
    assertThat(booking.realizedPnl()).isEqualTo(num(afterSell.get("realizedPnl")));
  }

  @Test
  void valueAtRiskOfAValidSampleMatchesTheHandDerivation() {
    Map<String, Object> valid = map(map(fixture.get("historicalVaR")).get("valid"));
    Risk.VarResult result = Risk.historicalVaR(numbers(valid.get("pnl")));
    Map<String, Object> expected = map(valid.get("expected"));
    assertThat(result.valueAtRisk()).isEqualTo(num(expected.get("valueAtRisk")));
    assertThat(result.expectedShortfall()).isEqualTo(num(expected.get("expectedShortfall")));
  }

  @Test
  void nonFiniteObservationsAreRefusedNeverReportedAsRisk() {
    Map<String, Object> f = map(fixture.get("historicalVaR"));
    double[] valid = numbers(map(f.get("valid")).get("pnl"));
    assertThat(Risk.allFinite(valid)).isTrue();
    for (Object o : list(f.get("invalid"))) {
      Map<String, Object> c = map(o);
      double[] pnl = valid.clone();
      pnl[(int) num(c.get("replaceIndex"))] = Double.parseDouble((String) c.get("with"));
      assertThat(Risk.allFinite(pnl)).as((String) c.get("note")).isFalse();
      assertThatThrownBy(() -> Risk.historicalVaR(pnl)).as((String) c.get("note"))
          .isInstanceOf(InvalidSampleException.class)
          .hasMessageContaining("not a finite number");
    }
    Map<String, Object> small = map(f.get("insufficientWithNaN"));
    double[] pnl = java.util.Arrays.copyOf(valid, (int) num(small.get("size")));
    pnl[(int) num(small.get("replaceIndex"))] = Double.NaN;
    assertThat(Risk.historicalVaR(pnl)).isNull();
  }

  @Test
  void maxWeightOfAVeryLargePortfolioIsTheExactLargestRatio() {
    Map<String, Object> f = map(map(fixture.get("maxWeight")).get("large"));
    int holdings = (int) num(f.get("holdings"));
    double each = num(f.get("valueEach"));
    double largest = num(f.get("largest"));
    Map<String, Double> values = new LinkedHashMap<>();
    for (int i = 0; i < holdings; i++) values.put("S" + i, each);
    values.put("BIG", largest);
    double base = holdings * each + largest + num(f.get("cash"));
    assertThat(base).isEqualTo(200_010_000);

    double weight = Valuation.maxWeight(values, base);
    double exact = new BigDecimal(largest).divide(new BigDecimal(base), MathContext.DECIMAL128).doubleValue();
    assertThat(weight).isEqualTo(largest / base).isEqualTo(exact);
  }

  @Test
  void maxWeightOrdinaryAndDegenerateCases() {
    Map<String, Object> f = map(fixture.get("maxWeight"));
    Map<String, Object> ordinary = map(f.get("ordinary"));
    Map<String, Double> values = new LinkedHashMap<>();
    map(ordinary.get("values")).forEach((k, v) -> values.put(k, num(v)));
    assertThat(Valuation.maxWeight(values, num(ordinary.get("base")))).isEqualTo(num(ordinary.get("expected")));
    assertThat(Valuation.maxWeight(Map.of(), num(map(f.get("noHoldings")).get("base")))).isEqualTo(0);
    for (Object base : list(f.get("nonPositiveBase"))) assertThat(Valuation.maxWeight(values, num(base))).isEqualTo(0);
  }

  private static Execution execution(String symbol, OrderSide side, Map<String, Object> e) {
    return new Execution(symbol, side, num(e.get("price")), num(e.get("quantity")), num(e.get("fee")), num(e.get("mid")));
  }

  private static double num(Object o) {
    return o instanceof Number n ? n.doubleValue() : Double.parseDouble((String) o);
  }

  private static double[] numbers(Object raw) {
    List<Object> items = list(raw);
    double[] out = new double[items.size()];
    for (int i = 0; i < out.length; i++) out[i] = num(items.get(i));
    return out;
  }
}
