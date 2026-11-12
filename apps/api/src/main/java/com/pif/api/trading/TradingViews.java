package com.pif.api.trading;

import com.pif.api.data.Db;
import com.pif.api.finance.JsSemantics;
import com.pif.api.finance.Money;
import com.pif.api.finance.PreTrade.FeeSchedule;
import com.pif.api.market.MarketQuote;
import com.pif.api.market.MarketDisplay;
import com.pif.api.market.Provenance;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.trading.Engine.Evaluation;
import com.pif.api.trading.TradingRepository.ExecutionRow;
import com.pif.api.trading.TradingRepository.InstrumentRow;
import com.pif.api.trading.TradingRepository.OrderRow;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * apps/api/src/trading/trading.view.ts. Amounts leave the API in DT with 3 decimals; balances are never computed by
 * the client. Keys are inserted in the order of the TypeScript object literals.
 */
final class TradingViews {

  private TradingViews() {}

  static double dt(double amount) {
    return Money.fromAmount(amount);
  }

  static Double dtOrNull(Long amount) {
    return amount == null ? null : dt(amount);
  }

  static Map<String, Object> quoteView(MarketQuote quote) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("mid", dt(quote.mid()));
    m.put("bid", dt(quote.bid()));
    m.put("ask", dt(quote.ask()));
    m.put("spreadBps", JsSemantics.round(((quote.ask() - quote.bid()) / quote.mid()) * 10_000 * 10) / 10);
    m.put("depth", quote.depth());
    m.put("asOf", Db.iso(quote.asOf()));
    m.put("validUntil", Db.iso(quote.asOf().plusMillis(SimulatedMarketProvider.BUCKET_MS)));
    return m;
  }

  static Map<String, Object> instrumentView(InstrumentRow instrument, Provenance provenance) {
    FeeSchedule fees = TradingRules.FEE_SCHEDULES.get(instrument.assetClass());
    Map<String, Object> feeView = new LinkedHashMap<>();
    feeView.put("feeBps", fees.feeBps());
    feeView.put("minFee", dt(fees.minFee()));
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", instrument.id().toString());
    m.put("symbol", instrument.symbol());
    m.put("name", instrument.name());
    m.put("assetClass", instrument.assetClass());
    m.put("sector", instrument.sector());
    m.put("sectorLabel", MarketDisplay.sectorLabel(instrument.sector()));
    m.put("currency", instrument.quoteCurrency());
    m.put("status", instrument.status());
    m.put("priceDecimals", instrument.priceDecimals());
    m.put("quantityDecimals", instrument.quantityDecimals());
    m.put("lotSize", instrument.lotSize());
    m.put("fees", feeView);
    m.put("fictional", instrument.fictional());
    m.put("provenance", provenance.toJson());
    return m;
  }

  static Map<String, Object> orderView(OrderRow order) {
    boolean working = Engine.isWorking(order.status());
    Map<String, Object> quote = new LinkedHashMap<>();
    quote.put("mid", dt(order.quoteMid()));
    quote.put("bid", dt(order.quoteBid()));
    quote.put("ask", dt(order.quoteAsk()));
    quote.put("asOf", Db.iso(order.quoteAsOf()));
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", order.id().toString());
    m.put("clientOrderId", order.clientOrderId());
    m.put("symbol", order.symbol());
    m.put("side", order.side());
    m.put("type", order.type());
    m.put("quantity", order.quantity());
    m.put("filledQuantity", order.filledQuantity());
    m.put("remainingQuantity", working ? order.quantity() - order.filledQuantity() : 0);
    m.put("limitPrice", dtOrNull(order.limitPrice()));
    m.put("stopPrice", dtOrNull(order.stopPrice()));
    m.put("triggered", order.triggered());
    m.put("status", order.status());
    m.put("averagePrice", dtOrNull(order.averagePrice()));
    m.put("rejectionCode", order.rejectionCode());
    m.put("statusReason", order.statusReason());
    m.put("quoteAtSubmission", quote);
    m.put("providerId", order.providerId());
    m.put("submittedAt", Db.iso(order.submittedAt()));
    m.put("sequence", order.sequence());
    m.put("expiresAt", Db.iso(order.expiresAt()));
    m.put("closedAt", Db.iso(order.closedAt()));
    return m;
  }

  static Map<String, Object> executionView(ExecutionRow execution) {
    boolean buy = "BUY".equals(execution.side());
    Map<String, Object> quote = new LinkedHashMap<>();
    quote.put("mid", dt(execution.quoteMid()));
    quote.put("bid", dt(execution.quoteBid()));
    quote.put("ask", dt(execution.quoteAsk()));
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", execution.id().toString());
    m.put("orderId", execution.orderId().toString());
    m.put("symbol", execution.symbol());
    m.put("side", execution.side());
    m.put("quantity", execution.quantity());
    m.put("price", dt(execution.price()));
    m.put("notional", dt(execution.notional()));
    m.put("fee", dt(execution.fee()));
    m.put("spreadCost", dt(execution.spreadCost()));
    m.put("realizedPnl", buy ? null : dt(execution.realizedPnl()));
    m.put("cashImpact", dt(buy ? -(execution.notional() + execution.fee()) : execution.notional() - execution.fee()));
    m.put("quote", quote);
    m.put("providerId", execution.providerId());
    m.put("executedAt", Db.iso(execution.executedAt()));
    m.put("sequence", execution.sequence());
    m.put("recordedAt", Db.iso(execution.recordedAt()));
    return m;
  }

  static Map<String, Object> evaluationView(Evaluation evaluation) {
    Map<String, Object> rejection = null;
    if (evaluation.rejection() != null) {
      rejection = new LinkedHashMap<>();
      rejection.put("code", evaluation.rejection().code());
      rejection.put("message", evaluation.rejection().message());
    }
    Map<String, Object> estimate = new LinkedHashMap<>();
    estimate.put("notional", dt(evaluation.estimate().notional()));
    estimate.put("fee", dt(evaluation.estimate().fee()));
    estimate.put("total", dt(evaluation.estimate().total()));
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("accepted", evaluation.rejection() == null);
    m.put("rejection", rejection);
    m.put("referencePrice", dt(evaluation.referencePrice()));
    m.put("estimate", estimate);
    m.put("executesNow", evaluation.executesNow());
    m.put("fillableNow", evaluation.fillableNow());
    m.put("availableCash", dt(evaluation.availableCash()));
    m.put("held", evaluation.held());
    m.put("equity", dt(evaluation.equity()));
    m.put("warnings", evaluation.warnings());
    return m;
  }
}
