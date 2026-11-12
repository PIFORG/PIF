package com.pif.api.trading;

import static com.pif.api.trading.TradingRules.LIMIT_BAND_PCT;
import static com.pif.api.trading.TradingRules.MAX_OPEN_ORDERS;
import static com.pif.api.trading.TradingRules.MAX_ORDER_QUANTITY;
import static com.pif.api.trading.TradingRules.ORDER_EXPIRY_DAYS;

import com.pif.api.finance.Booking;
import com.pif.api.finance.Execution;
import com.pif.api.finance.ExecutionRules;
import com.pif.api.finance.JsSemantics;
import com.pif.api.finance.Ledger;
import com.pif.api.finance.Money;
import com.pif.api.finance.OrderRules;
import com.pif.api.finance.OrderSide;
import com.pif.api.finance.OrderType;
import com.pif.api.finance.PreTrade;
import com.pif.api.finance.PreTrade.FeeSchedule;
import com.pif.api.finance.PreTrade.OpenBuyLimit;
import com.pif.api.finance.PreTrade.PreTradeEstimate;
import com.pif.api.finance.Valuation;
import com.pif.api.market.MarketQuote;
import com.pif.api.web.JsNumbers;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.ToDoubleFunction;

/**
 * Server-authoritative order handling for persistent portfolios (apps/api/src/trading/engine.ts). Pure functions over
 * an in-memory book: the service loads the book inside a locked transaction, calls these, and persists the result.
 * Preview and placement call the same {@link #evaluateOrder}, so they cannot disagree on the same state and quote.
 * Market orders fill at the touch up to the depth left in the quote period and cancel the rest; limits fill when
 * they cross; sell stops trigger at or below the bid and then sell at the bid.
 */
public final class Engine {

  private Engine() {}

  public record InstrumentTerms(String symbol, String assetClass, String sector, String status, double lotSize,
      FeeSchedule fees) {}

  /** A working order and its mutable state; {@code changed} marks objects that must be written back. */
  public static final class WorkingOrder {
    public final String id;
    public final String symbol;
    public final OrderSide side;
    public final OrderType type;
    public final double quantity;
    public double filledQuantity;
    /** Σ price × quantity over fills, for the average price. */
    public double filledValue;
    public final Double limitPrice;
    public final Double stopPrice;
    public boolean triggered;
    public String status;
    public String statusReason;
    public final Instant submittedAt;
    public Instant expiresAt;
    public Instant closedAt;
    public boolean changed;

    public WorkingOrder(String id, String symbol, OrderSide side, OrderType type, double quantity,
        double filledQuantity, double filledValue, Double limitPrice, Double stopPrice, boolean triggered,
        String status, String statusReason, Instant submittedAt, Instant expiresAt, Instant closedAt,
        boolean changed) {
      this.id = id;
      this.symbol = symbol;
      this.side = side;
      this.type = type;
      this.quantity = quantity;
      this.filledQuantity = filledQuantity;
      this.filledValue = filledValue;
      this.limitPrice = limitPrice;
      this.stopPrice = stopPrice;
      this.triggered = triggered;
      this.status = status;
      this.statusReason = statusReason;
      this.submittedAt = submittedAt;
      this.expiresAt = expiresAt;
      this.closedAt = closedAt;
      this.changed = changed;
    }

    /** A new, unfilled order from an accepted request. */
    public static WorkingOrder open(String id, OrderRequest request, Instant now) {
      return new WorkingOrder(id, request.symbol(), request.side(), request.type(), request.quantity(), 0, 0,
          request.limitPrice(), request.stopPrice(), false, "OPEN", null, now, null, null, true);
    }
  }

  /** {@code orders}: working orders (OPEN or PARTIALLY_FILLED), oldest first. */
  public record Book(Ledger ledger, List<WorkingOrder> orders, double maxPositionWeightPct) {}

  public record Fill(String orderId, String symbol, OrderSide side, double quantity, double price, double notional,
      double fee, double spreadCost, double realizedPnl, MarketQuote quote, double cashAfter) {}

  public record OrderRequest(String symbol, OrderSide side, OrderType type, double quantity, Double limitPrice,
      Double stopPrice) {}

  public record Rejection(String code, String message) {}

  /**
   * {@code referencePrice}: the limit for limit buys, otherwise the ask (buys) or bid (sells). {@code fillableNow}:
   * units that would fill on placement at the current quote.
   */
  public record Evaluation(Rejection rejection, double referencePrice, PreTradeEstimate estimate,
      boolean executesNow, double fillableNow, double availableCash, double held, double equity,
      List<String> warnings) {}

  public record Period(Instant asOf, Map<String, MarketQuote> quotes) {}

  private static String dt(double amount) {
    return JsNumbers.toLocaleEnUs(Money.fromAmount(amount), 3, 3);
  }

  private static String units(double n) {
    return JsNumbers.toLocaleEnUs(n);
  }

  public static boolean isWorking(String status) {
    return "OPEN".equals(status) || "PARTIALLY_FILLED".equals(status);
  }

  public static double availableCash(Book book, Function<String, InstrumentTerms> termsOf) {
    double reserved = 0;
    for (WorkingOrder order : book.orders()) {
      if (order.side == OrderSide.BUY && order.limitPrice != null && isWorking(order.status)) {
        reserved += PreTrade.reservedCash(
            List.of(new OpenBuyLimit(order.limitPrice, order.quantity - order.filledQuantity)),
            termsOf.apply(order.symbol).fees());
      }
    }
    return book.ledger().cash() - reserved;
  }

  public static double bookEquity(Book book, ToDoubleFunction<String> midOf) {
    return Valuation.equityOf(book.ledger().cash(), Valuation.marketValues(book.ledger().positions(), midOf));
  }

  /** Instrument terms, then account checks ({@link PreTrade#checkOrder}). Nothing is changed. */
  public static Evaluation evaluateOrder(Book book, OrderRequest request, InstrumentTerms terms, MarketQuote quote,
      Function<String, InstrumentTerms> termsOf, ToDoubleFunction<String> midOf, double depthUsed) {
    double held = Ledger.heldQuantity(book.ledger(), request.symbol());
    double cash = availableCash(book, termsOf);
    double equity = bookEquity(book, midOf);
    double referencePrice = request.type() == OrderType.LIMIT && request.side() == OrderSide.BUY
        && request.limitPrice() != null ? request.limitPrice()
        : ExecutionRules.executionPrice(request.side(), quote.quote());
    PreTradeEstimate estimate = PreTrade.estimateOrder(request.side(), referencePrice, request.quantity(),
        terms.fees());
    double depthLeft = Math.max(0, ExecutionRules.remainingDepth(quote.quote(), depthUsed));
    boolean marketable = request.type() == OrderType.MARKET || (request.type() == OrderType.LIMIT
        && request.limitPrice() != null
        && ExecutionRules.limitIsMarketable(request.side(), request.limitPrice(), quote.quote()));
    double fillableNow = marketable
        ? OrderRules.fillableQuantity(request.side(), request.quantity(), held, depthLeft) : 0;

    if (!"ACTIVE".equals(terms.status())) {
      return reject(request.symbol() + " is halted; orders are not accepted.", "INSTRUMENT_HALTED", referencePrice,
          estimate, cash, held, equity);
    }
    if (!JsSemantics.isInteger(request.quantity()) || request.quantity() < 1
        || request.quantity() > MAX_ORDER_QUANTITY || request.quantity() % terms.lotSize() != 0) {
      return reject("Quantity must be a whole number of lots of " + units(terms.lotSize()) + ", between 1 and "
          + units(MAX_ORDER_QUANTITY) + ".", "INVALID_QUANTITY", referencePrice, estimate, cash, held, equity);
    }
    if (request.type() == OrderType.LIMIT) {
      if (request.limitPrice() == null) {
        return reject("A limit order needs a limit price.", "PRICE_REQUIRED", referencePrice, estimate, cash, held,
            equity);
      }
      if (!OrderRules.limitWithinBand(request.limitPrice(), quote.mid(), LIMIT_BAND_PCT)) {
        return reject("The limit price must be within " + JsNumbers.toJsString(LIMIT_BAND_PCT)
            + " % of the current mid price (" + dt(quote.mid()) + " DT).", "LIMIT_OUT_OF_BAND", referencePrice,
            estimate, cash, held, equity);
      }
    }
    if (request.type() == OrderType.STOP) {
      if (request.side() == OrderSide.BUY) {
        return reject("Stop orders are protective sells; buy stops are not supported.", "STOP_BUY_UNSUPPORTED",
            referencePrice, estimate, cash, held, equity);
      }
      if (request.stopPrice() == null) {
        return reject("A stop order needs a stop price.", "PRICE_REQUIRED", referencePrice, estimate, cash, held,
            equity);
      }
      if (!OrderRules.stopBelowBid(request.stopPrice(), quote.quote())) {
        return reject("A stop must be below the current bid (" + dt(quote.bid())
            + " DT); at or above it, it would trigger at once.", "STOP_NOT_BELOW_BID", referencePrice, estimate,
            cash, held, equity);
      }
    }

    double pendingBuyQuantity = 0;
    for (WorkingOrder o : book.orders()) {
      if (o.symbol.equals(request.symbol()) && o.side == OrderSide.BUY && isWorking(o.status)) {
        pendingBuyQuantity += o.quantity - o.filledQuantity;
      }
    }
    PreTrade.Rejection check = PreTrade.checkOrder(new PreTrade.PreTradeInput(request.side(), request.quantity(),
        referencePrice, quote.mid(), held, pendingBuyQuantity, cash, equity, terms.fees(),
        book.maxPositionWeightPct()));
    if (check instanceof PreTrade.InsufficientPosition p) {
      return reject("You hold " + units(p.held()) + " " + request.symbol() + "; you cannot sell more than you hold.",
          "INSUFFICIENT_POSITION", referencePrice, estimate, cash, held, equity);
    }
    if (check instanceof PreTrade.InsufficientCash c) {
      return reject("This order needs " + dt(c.needed()) + " DT including commission, but only "
          + dt(c.available()) + " DT is available (cash minus amounts reserved for open buy orders).",
          "INSUFFICIENT_CASH", referencePrice, estimate, cash, held, equity);
    }
    if (check instanceof PreTrade.PositionLimit l) {
      return reject("This order would raise " + request.symbol() + " to " + JsNumbers.toFixed(l.weightPct(), 1)
          + " % of equity; this portfolio's limit is " + JsNumbers.toJsString(l.limitPct()) + " %.",
          "POSITION_LIMIT", referencePrice, estimate, cash, held, equity);
    }
    if (request.type() == OrderType.MARKET && depthLeft == 0) {
      return reject("No units are left at the best price in this 5-minute period. Try again in the next period or "
          + "use a limit order.", "NO_LIQUIDITY", referencePrice, estimate, cash, held, equity);
    }
    boolean rests = request.type() != OrderType.MARKET && fillableNow < request.quantity();
    if (rests && book.orders().stream().filter(o -> isWorking(o.status)).count() >= MAX_OPEN_ORDERS) {
      return reject("A portfolio can have at most " + MAX_OPEN_ORDERS + " open orders. Cancel one first.",
          "TOO_MANY_OPEN_ORDERS", referencePrice, estimate, cash, held, equity);
    }

    List<String> warnings = new ArrayList<>();
    if (request.type() == OrderType.MARKET && request.quantity() > depthLeft) {
      warnings.add("Only " + units(depthLeft) + " units are offered at the best "
          + (request.side() == OrderSide.BUY ? "ask" : "bid")
          + " now; a market order fills that much and cancels the rest.");
    }
    if (request.type() == OrderType.LIMIT && marketable) {
      warnings.add("This limit price is marketable: it executes now at the best price, which may be better than "
          + "your limit.");
    }
    if (request.type() == OrderType.LIMIT && marketable && fillableNow < request.quantity()) {
      warnings.add("Only " + units(fillableNow) + " units can fill now; the rest stays open at your limit.");
    }
    if (request.side() == OrderSide.SELL) {
      double committed = 0;
      for (WorkingOrder o : book.orders()) {
        if (o.symbol.equals(request.symbol()) && o.side == OrderSide.SELL && isWorking(o.status)) {
          committed += o.quantity - o.filledQuantity;
        }
      }
      if (committed > 0) {
        warnings.add("Open sell orders already cover " + units(committed) + " of your " + units(held) + " "
            + request.symbol() + "; whichever fills first leaves less for the others.");
      }
    }
    return new Evaluation(null, referencePrice, estimate, fillableNow > 0, fillableNow, cash, held, equity,
        List.copyOf(warnings));
  }

  private static Evaluation reject(String message, String code, double referencePrice, PreTradeEstimate estimate,
      double cash, double held, double equity) {
    return new Evaluation(new Rejection(code, message), referencePrice, estimate, false, 0, cash, held, equity,
        List.of());
  }

  private static void closeOrder(WorkingOrder order, String status, String reason, Instant at) {
    order.status = status;
    order.statusReason = reason;
    order.closedAt = at.isBefore(order.submittedAt) ? order.submittedAt : at;
    order.changed = true;
  }

  public static void cancelWorkingOrder(WorkingOrder order, Instant now) {
    closeOrder(order, "CANCELLED", "Cancelled by you.", now);
  }

  /** When a fill happened: the quote period start for resting orders, the submission time for fills on placement. */
  public static Instant executedAt(Fill fill, WorkingOrder order) {
    return fill.quote().asOf().isBefore(order.submittedAt) ? order.submittedAt : fill.quote().asOf();
  }

  private static String depthKey(String symbol, OrderSide side) {
    return symbol + ":" + side.name();
  }

  /**
   * Fills as much of a working order as the quote period's liquidity allows. {@code depthUsed} counts units already
   * taken per side and symbol in this quote period and is updated.
   */
  public static Fill fillOrder(Book book, WorkingOrder order, InstrumentTerms terms, MarketQuote quote,
      Map<String, Double> depthUsed) {
    Ledger ledger = book.ledger();
    double held = Ledger.heldQuantity(ledger, order.symbol);
    if (order.side == OrderSide.SELL && held == 0) {
      closeOrder(order, "CANCELLED", "The position was already closed, so this sell order was cancelled.",
          quote.asOf());
      return null;
    }
    String key = depthKey(order.symbol, order.side);
    double quantity = OrderRules.fillableQuantity(order.side, order.quantity - order.filledQuantity, held,
        ExecutionRules.remainingDepth(quote.quote(), depthUsed.getOrDefault(key, 0.0)));
    if (quantity <= 0) return null;

    double price = ExecutionRules.executionPrice(order.side, quote.quote());
    double value = Money.notional(price, quantity);
    double fee = Money.commission(value, terms.fees().feeBps(), terms.fees().minFee());
    if (order.side == OrderSide.BUY && value + fee > ledger.cash()) {
      closeOrder(order, "CANCELLED", "Not enough cash to complete this fill.", quote.asOf());
      return null;
    }
    Booking booking = Ledger.bookExecution(ledger,
        new Execution(order.symbol, order.side, price, quantity, fee, quote.mid()));
    ledger.removeEmptyPosition(order.symbol);
    depthUsed.put(key, depthUsed.getOrDefault(key, 0.0) + quantity);
    order.filledQuantity += quantity;
    order.filledValue += value;
    order.changed = true;
    if (order.filledQuantity == order.quantity) closeOrder(order, "FILLED", null, quote.asOf());
    else order.status = "PARTIALLY_FILLED";

    if (order.side == OrderSide.SELL && Ledger.heldQuantity(ledger, order.symbol) == 0) {
      for (WorkingOrder other : book.orders()) {
        if (other != order && other.symbol.equals(order.symbol) && other.side == OrderSide.SELL
            && isWorking(other.status)) {
          closeOrder(other, "CANCELLED",
              "The position was closed, so the remaining sell orders for it were cancelled.", quote.asOf());
        }
      }
    }
    return new Fill(order.id, order.symbol, order.side, quantity, price, value, fee, booking.spreadCost(),
        booking.realizedPnl(), quote, ledger.cash());
  }

  /** Places an evaluated, accepted order: fills what is marketable now, then rests or cancels the rest. */
  public static List<Fill> placeOrder(Book book, WorkingOrder order, InstrumentTerms terms, MarketQuote quote,
      Map<String, Double> depthUsed, Instant now) {
    book.orders().add(order);
    List<Fill> fills = new ArrayList<>();
    boolean marketable = order.type == OrderType.MARKET || (order.type == OrderType.LIMIT && order.limitPrice != null
        && ExecutionRules.limitIsMarketable(order.side, order.limitPrice, quote.quote()));
    if (marketable) {
      Fill fill = fillOrder(book, order, terms, quote, depthUsed);
      if (fill != null) fills.add(fill);
    }
    if (order.type == OrderType.MARKET && isWorking(order.status)) {
      closeOrder(order, "CANCELLED", "Only " + units(order.filledQuantity) + " of " + units(order.quantity)
          + " units were available at the best price; the rest was cancelled.", now);
    } else if (isWorking(order.status)) {
      order.expiresAt = now.plus(Duration.ofDays(ORDER_EXPIRY_DAYS));
    }
    return fills;
  }

  /**
   * Matches working orders against each quote period that started after the last match, oldest first; within a
   * period, orders are handled in submission order with fresh liquidity.
   */
  public static List<Fill> matchWorkingOrders(Book book, List<Period> periods,
      Function<String, InstrumentTerms> termsOf) {
    List<Fill> fills = new ArrayList<>();
    for (Period period : periods) {
      List<WorkingOrder> working = book.orders().stream().filter(o -> isWorking(o.status)).toList();
      if (working.isEmpty()) break;
      Map<String, Double> depthUsed = new HashMap<>();
      for (WorkingOrder order : working) {
        if (!isWorking(order.status)) continue;
        if (order.expiresAt != null && !order.expiresAt.isAfter(period.asOf())) {
          closeOrder(order, "EXPIRED",
              "The order expired after " + ORDER_EXPIRY_DAYS + " days without filling completely.",
              order.expiresAt);
          continue;
        }
        InstrumentTerms terms = termsOf.apply(order.symbol);
        MarketQuote quote = period.quotes().get(order.symbol);
        if (quote == null || !"ACTIVE".equals(terms.status())) continue;
        OrderRules.RestingOrderAction action = OrderRules.restingOrderAction(
            new OrderRules.RestingOrder(order.type, order.side, order.limitPrice, order.stopPrice, order.triggered),
            quote.quote());
        if (action.triggered() != order.triggered) {
          order.triggered = action.triggered();
          order.changed = true;
        }
        if (action.execute()) {
          Fill fill = fillOrder(book, order, terms, quote, depthUsed);
          if (fill != null) fills.add(fill);
        }
      }
    }
    return fills;
  }

  public static Double averagePrice(WorkingOrder order) {
    return order.filledQuantity > 0 ? Money.divRound(order.filledValue, order.filledQuantity) : null;
  }
}
