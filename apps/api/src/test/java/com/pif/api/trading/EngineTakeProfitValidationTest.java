package com.pif.api.trading;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.finance.Holding;
import com.pif.api.finance.Ledger;
import com.pif.api.finance.OrderSide;
import com.pif.api.finance.OrderType;
import com.pif.api.market.MarketQuote;
import com.pif.api.trading.Engine.Book;
import com.pif.api.trading.Engine.Evaluation;
import com.pif.api.trading.Engine.InstrumentTerms;
import com.pif.api.trading.Engine.OrderRequest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

/** Submission-time take-profit validation for Engine.evaluateOrder. */
class EngineTakeProfitValidationTest {

  private static final Instant T0 = Instant.parse("2026-06-01T10:00:00Z");
  private static final MarketQuote QUOTE = new MarketQuote("ACME", T0, 10_000, 9_990, 10_010, 100);

  private static Book bookWithHolding(double qty) {
    Map<String, Holding> positions = new LinkedHashMap<>();
    positions.put("ACME", new Holding("ACME", qty, 9_500));
    return new Book(new Ledger(100_000, positions, 0, 0, 0), new ArrayList<>(), 50);
  }

  private static InstrumentTerms equityTerms() {
    return new InstrumentTerms("ACME", "EQUITY", "TECH", "ACTIVE", 1, TradingRules.FEE_SCHEDULES.get("EQUITY"));
  }

  private static Function<String, InstrumentTerms> termsOf() {
    InstrumentTerms terms = equityTerms();
    return sym -> terms;
  }

  @Test
  void rejectsTakeProfitBuy() {
    Evaluation e = Engine.evaluateOrder(bookWithHolding(10),
        new OrderRequest("ACME", OrderSide.BUY, OrderType.TAKE_PROFIT, 5, null, 10_050.0), equityTerms(), QUOTE,
        termsOf(), sym -> QUOTE.mid(), 0);
    assertThat(e.rejection()).isNotNull();
    assertThat(e.rejection().code()).isEqualTo("STOP_BUY_UNSUPPORTED");
  }

  @Test
  void rejectsTakeProfitWithoutTriggerPrice() {
    Evaluation e = Engine.evaluateOrder(bookWithHolding(10),
        new OrderRequest("ACME", OrderSide.SELL, OrderType.TAKE_PROFIT, 5, null, null), equityTerms(), QUOTE,
        termsOf(), sym -> QUOTE.mid(), 0);
    assertThat(e.rejection()).isNotNull();
    assertThat(e.rejection().code()).isEqualTo("PRICE_REQUIRED");
  }

  @Test
  void rejectsTakeProfitAtOrBelowBid() {
    Evaluation e = Engine.evaluateOrder(bookWithHolding(10),
        new OrderRequest("ACME", OrderSide.SELL, OrderType.TAKE_PROFIT, 5, null, 9_990.0), equityTerms(), QUOTE,
        termsOf(), sym -> QUOTE.mid(), 0);
    assertThat(e.rejection()).isNotNull();
    assertThat(e.rejection().code()).isEqualTo("TAKE_PROFIT_NOT_ABOVE_BID");
  }

  @Test
  void acceptsTakeProfitSellAboveBidWhenPositionExists() {
    Evaluation e = Engine.evaluateOrder(bookWithHolding(10),
        new OrderRequest("ACME", OrderSide.SELL, OrderType.TAKE_PROFIT, 5, null, 10_050.0), equityTerms(), QUOTE,
        termsOf(), sym -> QUOTE.mid(), 0);
    assertThat(e.rejection()).isNull();
    assertThat(e.executesNow()).isFalse();
  }
}