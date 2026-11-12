package com.pif.api.learning.engine;

import com.pif.api.finance.Booking;
import com.pif.api.finance.Execution;
import com.pif.api.finance.ExecutionRules;
import com.pif.api.finance.Holding;
import com.pif.api.finance.Ledger;
import com.pif.api.finance.Money;
import com.pif.api.finance.OrderRules;
import com.pif.api.finance.OrderSide;
import com.pif.api.finance.OrderType;
import com.pif.api.finance.PreTrade;
import com.pif.api.finance.Quote;
import com.pif.api.finance.Risk;
import com.pif.api.finance.Valuation;
import com.pif.api.learning.engine.Definitions.AssetDefinition;
import com.pif.api.learning.engine.Definitions.FailureRule;
import com.pif.api.learning.engine.Definitions.InitialPosition;
import com.pif.api.learning.engine.Definitions.MarketEventDefinition;
import com.pif.api.learning.engine.Definitions.MissionDefinition;
import com.pif.api.learning.engine.Definitions.Shock;
import com.pif.api.learning.engine.Definitions.StressScenarioDefinition;
import com.pif.api.learning.engine.SimState.BreakdownLine;
import com.pif.api.learning.engine.SimState.DomainEvent;
import com.pif.api.learning.engine.SimState.Fill;
import com.pif.api.learning.engine.SimState.Order;
import com.pif.api.learning.engine.SimState.OrderContext;
import com.pif.api.learning.engine.SimState.PlacedQuote;
import com.pif.api.learning.engine.SimState.StepRecord;
import com.pif.api.learning.engine.SimState.StressTestResult;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The deterministic mission engine (apps/api/src/learning/engine/simulator.ts). */
public final class Simulator {

  private Simulator() {}

  /** A command that is malformed or not allowed in the current state. It is not recorded. */
  public static final class SimulationError extends RuntimeException {
    private final String code;

    public SimulationError(String code, String message) {
      super(message);
      this.code = code;
    }

    public String code() {
      return code;
    }
  }

  public record Context(MissionDefinition mission, MarketPath market, double feeBps, double minFee) {}

  /** REJECTED means the market refused the order (recorded as evidence); the command itself was valid. */
  public record CommandResult(SimState state, String outcome, String message, List<DomainEvent> events) {}

  public record RecordedCommand(int seq, Command command) {}

  /** The order exactly as it would be recorded, and the market's refusal reason when there is one. */
  public record OrderCheck(Order order, Quote quote, String rejectionCode, String rejectionReason) {}

  public record Estimate(double price, double notional, double fee, double total) {}

  public record OrderPreview(int seq, boolean accepted, String code, String message, Estimate estimate,
      List<String> warnings) {}

  private static final double MAX_QUANTITY = 1_000_000;
  private static final double PROTECTION_COVERAGE = 0.5;
  private static final int TREND_LOOKBACK = 5;
  private static final int EVENT_RECENCY = 2;
  private static final double CONCENTRATION_WARNING_PCT = 40;

  public static Context createContext(MissionDefinition mission) {
    return createContext(mission, MarketPath.generate(mission.scenario()));
  }

  public static Context createContext(MissionDefinition mission, MarketPath market) {
    return new Context(mission, market, mission.rules().feeBps(), Money.toAmount(mission.rules().minFee()));
  }

  static String dt(double millimes) {
    return Js.toFixed(Money.fromAmount(millimes), 3);
  }

  private static void emit(SimState state, String type, int commandSeq, Map<String, Object> data) {
    state.events.add(new DomainEvent(type, state.step, commandSeq, data));
  }

  private static Map<String, Object> data(Object... keyValues) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i < keyValues.length; i += 2) out.put((String) keyValues[i], keyValues[i + 1]);
    return out;
  }

  public static boolean isMarketClosed(Context ctx, SimState state) {
    return state.step >= ctx.mission().scenario().steps();
  }

  /** Holdings valued at the current mid. */
  public static Map<String, Double> marketValues(Context ctx, SimState state) {
    return Valuation.marketValues(state.positions, symbol -> ctx.market().quoteAt(state.step, symbol).mid());
  }

  public static double equityOf(Context ctx, SimState state) {
    return Valuation.equityOf(state.cash, marketValues(ctx, state));
  }

  public static double heldQuantity(SimState state, String symbol) {
    return Ledger.heldQuantity(state.positions, symbol);
  }

  /** Cash committed to open buy limit orders (limit price × remaining quantity + commission). */
  public static double reservedCash(Context ctx, SimState state) {
    List<PreTrade.OpenBuyLimit> openBuys = new ArrayList<>();
    for (Order o : state.orders) {
      if ("OPEN".equals(o.status) && "BUY".equals(o.side) && o.limitPrice != null) {
        openBuys.add(new PreTrade.OpenBuyLimit(o.limitPrice, o.quantity - o.filledQuantity));
      }
    }
    return PreTrade.reservedCash(openBuys, new PreTrade.FeeSchedule(ctx.feeBps(), ctx.minFee()));
  }

  private static double stopCoverage(SimState state, String symbol) {
    double sum = 0;
    for (Order o : state.orders) {
      if ("OPEN".equals(o.status) && "STOP".equals(o.type) && o.symbol.equals(symbol)) {
        sum = sum + o.quantity - o.filledQuantity;
      }
    }
    return sum;
  }

  private static StepRecord snapshot(Context ctx, SimState state) {
    Map<String, Double> values = marketValues(ctx, state);
    double equity = Valuation.equityOf(state.cash, values);
    List<String> heldSymbols = new ArrayList<>(values.keySet());
    heldSymbols.sort(null);
    List<String> protectedSymbols = new ArrayList<>();
    for (String s : heldSymbols) {
      if (stopCoverage(state, s) >= Math.ceil(heldQuantity(state, s) * PROTECTION_COVERAGE)) protectedSymbols.add(s);
    }
    return new StepRecord(state.step, equity, state.cash, values, Valuation.maxWeight(values, equity),
        Valuation.exposure(values, equity), List.copyOf(heldSymbols), List.copyOf(protectedSymbols));
  }

  private static void recordStep(Context ctx, SimState state) {
    StepRecord record = snapshot(ctx, state);
    int n = state.history.size();
    if (n > 0 && state.history.get(n - 1).step() == state.step) state.history.set(n - 1, record);
    else state.history.add(record);
  }

  public static SimState initialState(Context ctx) {
    SimState state = new SimState();
    state.status = "ACTIVE";
    state.step = 0;
    state.cash = Money.toAmount(ctx.mission().initialCash());
    state.positions = new LinkedHashMap<>();
    state.orders = new ArrayList<>();
    state.realizedPnl = 0;
    state.feesPaid = 0;
    state.spreadCostPaid = 0;
    state.initialEquity = 0;
    state.history = new ArrayList<>();
    state.events = new ArrayList<>();
    state.stressTests = new ArrayList<>();
    state.hintsUsed = 0;
    state.lastCommandSeq = 0;
    state.failureReason = null;
    state.liquidityUsed = new LinkedHashMap<>();
    for (InitialPosition p : ctx.mission().initialPositions()) {
      state.positions.put(p.symbol(), new Holding(p.symbol(), p.quantity(),
          Money.notional(ctx.market().quoteAt(0, p.symbol()).mid(), p.quantity())));
    }
    state.initialEquity = equityOf(ctx, state);
    emit(state, "MISSION_STARTED", 0, data("initialEquity", state.initialEquity, "missionVersion",
        ctx.mission().version()));
    recordStep(ctx, state);
    return state;
  }

  /* ------------------------------------------------------------------ execution */

  private static void cancelOrder(SimState state, Order order, int seq, String reason) {
    cancelOrder(state, order, seq, reason, "CANCELLED");
  }

  private static void cancelOrder(SimState state, Order order, int seq, String reason, String status) {
    order.status = order.filledQuantity > 0 && "CANCELLED".equals(status) ? "PARTIALLY_FILLED" : status;
    order.statusReason = reason;
    emit(state, "EXPIRED".equals(status) ? "ORDER_EXPIRED" : "ORDER_CANCELLED", seq,
        data("orderId", order.id, "symbol", order.symbol, "filledQuantity", order.filledQuantity, "reason", reason));
  }

  private static OrderSide side(String side) {
    return "BUY".equals(side) ? OrderSide.BUY : OrderSide.SELL;
  }

  /** Fills as much of the order as the step's top-of-book liquidity allows. Returns the units filled. */
  private static double execute(Context ctx, SimState state, Order order, Quote quote, int seq) {
    double held = heldQuantity(state, order.symbol);
    if ("SELL".equals(order.side) && held == 0) {
      cancelOrder(state, order, seq, "The position was already closed, so this sell order was cancelled.");
      return 0;
    }
    String key = order.symbol + ":" + order.side;
    Double used = state.liquidityUsed.get(key);
    double quantity = OrderRules.fillableQuantity(side(order.side), order.quantity - order.filledQuantity, held,
        ExecutionRules.remainingDepth(quote, used == null ? 0 : used));
    if (quantity <= 0) return 0;

    double price = ExecutionRules.executionPrice(side(order.side), quote);
    double value = Money.notional(price, quantity);
    double fee = Money.commission(value, ctx.feeBps(), ctx.minFee());
    if ("BUY".equals(order.side) && value + fee > state.cash) {
      cancelOrder(state, order, seq, "Not enough cash to complete this fill.");
      return 0;
    }
    Ledger ledger = new Ledger(state.cash, state.positions, state.realizedPnl, state.feesPaid, state.spreadCostPaid);
    Booking booking = Ledger.bookExecution(ledger,
        new Execution(order.symbol, side(order.side), price, quantity, fee, quote.mid()));
    state.cash = ledger.cash();
    state.positions = new LinkedHashMap<>(ledger.positions());
    state.realizedPnl = ledger.realizedPnl();
    state.feesPaid = ledger.feesPaid();
    state.spreadCostPaid = ledger.spreadCostPaid();
    double spreadCost = booking.spreadCost();
    Holding position = state.positions.get(order.symbol);
    state.liquidityUsed.put(key, (used == null ? 0 : used) + quantity);
    order.filledQuantity += quantity;
    order.fills.add(new Fill(state.step, price, quantity, fee, spreadCost));
    if (order.filledQuantity == order.quantity) order.status = "FILLED";

    emit(state, "ORDER_FILLED", seq, data("orderId", order.id, "symbol", order.symbol, "side", order.side,
        "orderType", order.type, "price", price, "quantity", quantity, "fee", fee, "spreadCost", spreadCost,
        "complete", "FILLED".equals(order.status)));

    if ("SELL".equals(order.side) && position.quantity() == 0) {
      for (Order other : state.orders) {
        if (other != order && "OPEN".equals(other.status) && "SELL".equals(other.side)
            && other.symbol.equals(order.symbol)) {
          cancelOrder(state, other, seq, "The position was closed, so the remaining sell orders for it were cancelled.");
        }
      }
    }
    return quantity;
  }

  /* ------------------------------------------------------------------ commands */

  private static OrderContext orderContext(Context ctx, SimState state, String symbol, Quote quote) {
    Map<String, Double> values = marketValues(ctx, state);
    double equity = equityOf(ctx, state);
    String largestSymbol = null;
    double largestValue = 0;
    List<String> sorted = new ArrayList<>(values.keySet());
    sorted.sort(null);
    for (String s : sorted) {
      double v = values.get(s);
      if (v > largestValue) {
        largestSymbol = s;
        largestValue = v;
      }
    }
    Holding position = state.positions.get(symbol);
    double past = ctx.market().quoteAt(Math.max(-ctx.market().historySteps(), state.step - TREND_LOOKBACK), symbol).mid();
    MarketEventDefinition recent = null;
    for (MarketEventDefinition e : ctx.mission().scenario().events()) {
      if (e.step() <= state.step && e.step() > state.step - EVENT_RECENCY && (recent == null || e.step() > recent.step())) {
        recent = e;
      }
    }
    AssetDefinition asset = null;
    for (AssetDefinition a : ctx.mission().scenario().assets()) {
      if (a.symbol().equals(symbol)) {
        asset = a;
        break;
      }
    }
    Double value = values.get(symbol);
    return new OrderContext(
        equity > 0 ? (value == null ? 0 : value) / equity : 0,
        largestSymbol,
        equity > 0 ? largestValue / equity : 0,
        values.size(),
        position != null && position.quantity() > 0
            ? (quote.bid() * position.quantity() - position.costBasis()) / position.costBasis()
            : null,
        quote.mid() / past - 1,
        recent == null ? null : recent.id(),
        recent == null ? null : recent.sentiment(),
        ((quote.ask() - quote.bid()) / quote.mid()) * 10_000,
        asset == null ? 0 : asset.spreadBps(),
        quote.depth());
  }

  /**
   * Validates an order against the current state without changing it. Throws SimulationError for commands that would
   * not be recorded at all. Order placement and the pre-trade preview both use this.
   */
  public static OrderCheck checkPlaceOrder(Context ctx, SimState state, Command command, int seq) {
    MissionDefinition mission = ctx.mission();
    MarketPath market = ctx.market();
    if (isMarketClosed(ctx, state)) {
      throw new SimulationError("MARKET_CLOSED", "The mission horizon has ended. Finish the mission to see your assessment.");
    }
    if (!market.symbols().contains(command.symbol())) {
      throw new SimulationError("UNKNOWN_SYMBOL", command.symbol() + " is not traded in this mission.");
    }
    Double quantity = command.quantity();
    if (quantity == null || !Js.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new SimulationError("INVALID_QUANTITY", "Quantity must be a whole number between 1 and 1000000.");
    }
    if (!mission.rules().allowedOrderTypes().contains(command.orderType())) {
      throw new SimulationError("ORDER_TYPE_NOT_ALLOWED", command.orderType() + " orders are not available in this mission.");
    }
    Double confidence = command.confidence();
    if (command.hasConfidence() && (confidence == null || !Js.isInteger(confidence) || confidence < 0 || confidence > 100)) {
      throw new SimulationError("INVALID_CONFIDENCE", "Confidence must be a whole number from 0 to 100.");
    }
    if (mission.rules().requireConfidence() && !command.hasConfidence()) {
      throw new SimulationError("CONFIDENCE_REQUIRED",
          "This mission asks how sure you are: rate your confidence on every order.");
    }

    Quote quote = market.quoteAt(state.step, command.symbol());
    Double limitPrice = null;
    Double stopPrice = null;
    if ("LIMIT".equals(command.orderType())) {
      if (command.limitPrice() == null || !(command.limitPrice() > 0)) {
        throw new SimulationError("INVALID_PRICE", "A limit order needs a positive limit price.");
      }
      limitPrice = Money.toAmount(command.limitPrice());
      if (!OrderRules.limitWithinBand(limitPrice, quote.mid(), 50)) {
        throw new SimulationError("INVALID_PRICE", "The limit price must be within 50 % of the current price.");
      }
    }
    if ("STOP".equals(command.orderType())) {
      if (!"SELL".equals(command.side())) {
        throw new SimulationError("INVALID_ORDER", "Stop orders protect long positions, so only SELL stops are available.");
      }
      if (command.stopPrice() == null || !(command.stopPrice() > 0)) {
        throw new SimulationError("INVALID_PRICE", "A stop order needs a positive stop price.");
      }
      stopPrice = Money.toAmount(command.stopPrice());
      if (!OrderRules.stopBelowBid(stopPrice, quote)) {
        throw new SimulationError("INVALID_PRICE", "The stop price must be below the current bid (" + dt(quote.bid())
            + " DT); otherwise it would trigger immediately.");
      }
    }

    Order order = new Order();
    order.id = "o" + seq;
    order.seq = seq;
    order.symbol = command.symbol();
    order.side = command.side();
    order.type = command.orderType();
    order.quantity = quantity;
    order.filledQuantity = 0;
    order.limitPrice = limitPrice;
    order.stopPrice = stopPrice;
    order.triggered = false;
    order.status = "OPEN";
    order.createdStep = state.step;
    order.rationale = command.rationale();
    order.confidence = confidence;
    order.fills = new ArrayList<>();
    order.statusReason = null;
    order.placedQuote = new PlacedQuote(quote.bid(), quote.ask(), quote.mid());
    order.context = orderContext(ctx, state, command.symbol(), quote);

    PreTrade.Rejection rejection = PreTrade.checkOrder(new PreTrade.PreTradeInput(
        side(order.side),
        order.quantity,
        "BUY".equals(order.side) && "LIMIT".equals(order.type) && limitPrice != null
            ? limitPrice
            : ExecutionRules.executionPrice(side(order.side), quote),
        quote.mid(),
        heldQuantity(state, order.symbol),
        pendingBuys(state, order.symbol),
        state.cash - reservedCash(ctx, state),
        equityOf(ctx, state),
        new PreTrade.FeeSchedule(ctx.feeBps(), ctx.minFee()),
        mission.rules().maxPositionWeightPct()));
    if (rejection == null) return new OrderCheck(order, quote, null, null);
    String reason = switch (rejection) {
      case PreTrade.InsufficientPosition r -> "You hold " + Js.str(r.held()) + " " + order.symbol
          + "; short selling is not available in this mission.";
      case PreTrade.InsufficientCash r -> "This order needs " + dt(r.needed()) + " DT including fees; "
          + dt(r.available()) + " DT is available.";
      case PreTrade.PositionLimit r -> "This order would put " + Js.toFixed(r.weightPct(), 1) + " % of your equity in "
          + order.symbol + "; the mission limit is " + Js.str(r.limitPct()) + " %.";
    };
    return new OrderCheck(order, quote, rejection.code(), reason);
  }

  private static double pendingBuys(SimState state, String symbol) {
    double sum = 0;
    for (Order o : state.orders) {
      if ("OPEN".equals(o.status) && "BUY".equals(o.side) && o.symbol.equals(symbol)) {
        sum = sum + o.quantity - o.filledQuantity;
      }
    }
    return sum;
  }

  /**
   * Pre-trade preview: runs exactly the checks of order placement on the current state, without recording anything,
   * and adds advisory warnings about liquidity, concentration and order type.
   */
  public static OrderPreview previewOrder(Context ctx, SimState state, Command command) {
    int seq = state.lastCommandSeq;
    if (!"ACTIVE".equals(state.status)) {
      return new OrderPreview(seq, false, "SESSION_CLOSED", "This mission session has already ended.", null, List.of());
    }
    OrderCheck check;
    try {
      check = checkPlaceOrder(ctx, state, command, seq + 1);
    } catch (SimulationError error) {
      return new OrderPreview(seq, false, error.code(), error.getMessage(), null, List.of());
    }
    Order order = check.order();
    Quote quote = check.quote();
    double price = order.limitPrice != null ? order.limitPrice
        : order.stopPrice != null ? order.stopPrice : ExecutionRules.executionPrice(side(order.side), quote);
    PreTrade.PreTradeEstimate e = PreTrade.estimateOrder(side(order.side), price, order.quantity,
        new PreTrade.FeeSchedule(ctx.feeBps(), ctx.minFee()));
    Estimate estimate = new Estimate(price, e.notional(), e.fee(), e.total());
    if (check.rejectionCode() != null) {
      return new OrderPreview(seq, false, check.rejectionCode(), check.rejectionReason(), estimate, List.of());
    }

    List<String> warnings = new ArrayList<>();
    double held = heldQuantity(state, order.symbol);
    if ("BUY".equals(order.side)) {
      double weightPct = (Money.notional(quote.mid(), held + pendingBuys(state, order.symbol) + order.quantity)
          / equityOf(ctx, state)) * 100;
      if (weightPct > CONCENTRATION_WARNING_PCT) {
        warnings.add(order.symbol + " would be about " + Js.toFixed(weightPct, 1) + " % of your equity.");
      }
    } else if (!"STOP".equals(order.type)) {
      double committed = 0;
      for (Order o : state.orders) {
        if ("OPEN".equals(o.status) && "SELL".equals(o.side) && !"STOP".equals(o.type) && o.symbol.equals(order.symbol)) {
          committed = committed + o.quantity - o.filledQuantity;
        }
      }
      if (committed > 0 && committed + order.quantity > held) {
        warnings.add("Open sell orders already cover " + Js.str(committed) + " of your " + Js.str(held) + " "
            + order.symbol + "; whichever fills first leaves less for the others.");
      }
    }
    if ("MARKET".equals(order.type)) {
      Double used = state.liquidityUsed.get(order.symbol + ":" + order.side);
      double available = Math.max(0, ExecutionRules.remainingDepth(quote, used == null ? 0 : used));
      if (order.quantity > available) {
        warnings.add("Only " + com.pif.api.web.JsNumbers.toLocaleEnUs(available) + " units are offered at the best "
            + ("BUY".equals(order.side) ? "ask" : "bid")
            + " now; a market order fills that much and cancels the rest.");
      }
    }
    if ("LIMIT".equals(order.type) && order.limitPrice != null) {
      warnings.add(ExecutionRules.limitIsMarketable(side(order.side), order.limitPrice, quote)
          ? "This limit is marketable and should fill now, at the best price available up to your limit."
          : "This limit rests until the market reaches your price or the mission ends.");
    }
    if ("STOP".equals(order.type)) {
      warnings.add("A stop sells at the bid once it is reached. After a gap, that can be below your stop price.");
    }
    return new OrderPreview(seq, true, null, null, estimate, List.copyOf(warnings));
  }

  private record Outcome(String outcome, String message) {}

  private static Outcome placeOrder(Context ctx, SimState state, Command command, int seq) {
    OrderCheck check = checkPlaceOrder(ctx, state, command, seq);
    Order order = check.order();
    Quote quote = check.quote();
    Double limitPrice = order.limitPrice;
    Double stopPrice = order.stopPrice;

    if (check.rejectionCode() != null) {
      order.status = "REJECTED";
      order.statusReason = check.rejectionReason();
      state.orders.add(order);
      emit(state, "ORDER_REJECTED", seq, data("orderId", order.id, "symbol", order.symbol, "side", order.side,
          "orderType", order.type, "code", check.rejectionCode(), "reason", check.rejectionReason()));
      return new Outcome("REJECTED", check.rejectionReason());
    }

    state.orders.add(order);
    emit(state, "ORDER_ACCEPTED", seq, data("orderId", order.id, "symbol", order.symbol, "side", order.side,
        "orderType", order.type, "quantity", order.quantity, "limitPrice", limitPrice, "stopPrice", stopPrice,
        "rationale", order.rationale, "confidence", order.confidence));

    if ("MARKET".equals(order.type)) {
      double filled = execute(ctx, state, order, quote, seq);
      if ("FILLED".equals(order.status)) {
        return new Outcome("ACCEPTED", "Filled " + Js.str(order.quantity) + " " + order.symbol + " at "
            + dt(order.fills.get(0).price()) + " DT.");
      }
      if ("OPEN".equals(order.status)) {
        String book = "BUY".equals(order.side) ? "ask" : "bid";
        cancelOrder(state, order, seq, "Only " + Js.str(filled) + " of " + Js.str(order.quantity)
            + " units were available at the best " + book
            + "; market orders are immediate-or-cancel, so the rest was cancelled.");
      }
      return new Outcome("ACCEPTED", order.statusReason == null ? "" : order.statusReason);
    }

    if ("LIMIT".equals(order.type) && limitPrice != null) {
      if (ExecutionRules.limitIsMarketable(side(order.side), limitPrice, quote)) {
        execute(ctx, state, order, quote, seq);
        if ("FILLED".equals(order.status)) {
          return new Outcome("ACCEPTED", "Limit order filled immediately at " + dt(order.fills.get(0).price()) + " DT.");
        }
        if ("OPEN".equals(order.status)) {
          return new Outcome("ACCEPTED", "Partially filled " + Js.str(order.filledQuantity)
              + " units; the rest rests in the book at " + dt(limitPrice) + " DT.");
        }
        return new Outcome("ACCEPTED", order.statusReason == null ? "" : order.statusReason);
      }
      return new Outcome("ACCEPTED", "Limit order resting at " + dt(limitPrice)
          + " DT until the market reaches it or the mission ends.");
    }
    return new Outcome("ACCEPTED", "Stop order armed at " + dt(stopPrice == null ? 0 : stopPrice)
        + " DT. It sells at the bid once the bid falls to or below the stop.");
  }

  private static String advance(Context ctx, SimState state, int seq) {
    if (isMarketClosed(ctx, state)) {
      throw new SimulationError("MARKET_CLOSED", "This is the final step. Finish the mission to see your assessment.");
    }
    state.step += 1;
    state.liquidityUsed = new LinkedHashMap<>();

    for (MarketEventDefinition event : ctx.mission().scenario().events()) {
      if (event.step() == state.step) {
        emit(state, "MARKET_EVENT", seq, data("eventId", event.id(), "kind", event.kind(), "sentiment",
            event.sentiment(), "headline", event.headline()));
      }
    }

    List<Order> resting = new ArrayList<>();
    for (Order o : state.orders) {
      if ("OPEN".equals(o.status)) resting.add(o);
    }
    resting.sort((a, b) -> Integer.compare(a.seq, b.seq));
    for (Order order : resting) {
      if (!"OPEN".equals(order.status)) continue;
      Quote quote = ctx.market().quoteAt(state.step, order.symbol);
      OrderRules.RestingOrderAction action = OrderRules.restingOrderAction(new OrderRules.RestingOrder(
          OrderType.valueOf(order.type), side(order.side), order.limitPrice, order.stopPrice, order.triggered), quote);
      order.triggered = action.triggered();
      if (action.execute()) execute(ctx, state, order, quote, seq);
    }

    emit(state, "STEP_ADVANCED", seq, data("step", state.step));

    String label = ctx.mission().scenario().stepLabel();
    if (isMarketClosed(ctx, state)) {
      for (Order order : state.orders) {
        if ("OPEN".equals(order.status)) {
          cancelOrder(state, order, seq, "The mission horizon ended before this order completed.", "EXPIRED");
        }
      }
      return "Final " + label + " reached. Review your portfolio, then finish the mission.";
    }
    return "Moved to " + label + " " + state.step + " of " + ctx.mission().scenario().steps() + ".";
  }

  private static Double shockFor(StressScenarioDefinition scenario, String symbol) {
    for (Shock s : scenario.shocks()) {
      if (s.symbol().equals(symbol)) return s.move();
    }
    return null;
  }

  private static String runStressTest(Context ctx, SimState state, String scenarioId, int seq) {
    if (!ctx.mission().rules().allowStressTest()) {
      throw new SimulationError("STRESS_TEST_UNAVAILABLE", "Stress tests are not part of this mission.");
    }
    StressScenarioDefinition scenario = null;
    for (StressScenarioDefinition s : ctx.mission().scenario().stressScenarios()) {
      if (s.id().equals(scenarioId)) {
        scenario = s;
        break;
      }
    }
    if (scenario == null) throw new SimulationError("UNKNOWN_SCENARIO", "Unknown stress scenario.");
    StressScenarioDefinition chosen = scenario;
    Risk.StressResult stress = Risk.stressImpact(marketValues(ctx, state), symbol -> {
      Double own = shockFor(chosen, symbol);
      if (own != null) return own;
      Double wildcard = shockFor(chosen, "*");
      return wildcard != null ? wildcard : 0;
    });
    double equity = equityOf(ctx, state);
    List<BreakdownLine> breakdown = stress.breakdown().stream()
        .map(l -> new BreakdownLine(l.symbol(), l.value(), l.shockPct(), l.impact())).toList();
    StressTestResult result = new StressTestResult(scenarioId, scenario.name(), state.step, stress.impact(),
        equity > 0 ? (stress.impact() / equity) * 100 : 0, breakdown);
    state.stressTests.add(result);
    emit(state, "STRESS_TEST_RUN", seq, data("scenarioId", scenarioId, "impact", stress.impact(), "impactPct",
        result.impactPct()));
    return scenario.name() + ": estimated impact " + dt(stress.impact()) + " DT (" + Js.toFixed(result.impactPct(), 2)
        + " % of equity).";
  }

  private static void checkFailure(Context ctx, SimState state, int seq) {
    double equity = equityOf(ctx, state);
    for (FailureRule rule : ctx.mission().failure()) {
      double floor = state.initialEquity * (1 - rule.limitPct() / 100);
      if (equity <= floor) {
        state.status = "FAILED";
        state.failureReason = "Equity fell to " + dt(equity) + " DT, breaching the " + Js.str(rule.limitPct())
            + " % maximum-loss rule (" + dt(Js.round(floor)) + " DT).";
        for (Order order : state.orders) {
          if ("OPEN".equals(order.status)) {
            cancelOrder(state, order, seq, "The mission ended because the loss limit was breached.");
          }
        }
        emit(state, "MISSION_FAILED", seq, data("reason", state.failureReason, "equity", equity));
        return;
      }
    }
  }

  /**
   * Applies one command to a copy of {@code previous}. Throws SimulationError for invalid commands (nothing is
   * recorded); market rejections are returned as REJECTED and are part of the log.
   */
  public static CommandResult applyCommand(Context ctx, SimState previous, Command command, int seq) {
    if (seq != previous.lastCommandSeq + 1) {
      throw new SimulationError("SEQUENCE_CONFLICT", "The session changed since you last loaded it.");
    }
    if (!"ACTIVE".equals(previous.status)) {
      throw new SimulationError("SESSION_CLOSED", "This mission session has already ended.");
    }
    if (command == null) {
      throw new IllegalArgumentException("Cannot read properties of undefined (reading 'type')");
    }

    SimState state = previous.copy();
    int firstEvent = state.events.size();
    String outcome = "ACCEPTED";
    String message;

    switch (String.valueOf(command.type())) {
      case "PLACE_ORDER" -> {
        Outcome placed = placeOrder(ctx, state, command, seq);
        outcome = placed.outcome();
        message = placed.message();
      }
      case "CANCEL_ORDER" -> {
        Order order = null;
        for (Order o : state.orders) {
          if (o.id.equals(command.orderId())) {
            order = o;
            break;
          }
        }
        if (order == null || !"OPEN".equals(order.status)) {
          throw new SimulationError("ORDER_NOT_OPEN", "Only open orders can be cancelled.");
        }
        cancelOrder(state, order, seq, "Cancelled by you.");
        message = "Order " + order.id + " cancelled.";
      }
      case "ADVANCE" -> message = advance(ctx, state, seq);
      case "FINISH" -> {
        if (!isMarketClosed(ctx, state)) {
          throw new SimulationError("MISSION_NOT_OVER",
              "Advance to the final " + ctx.mission().scenario().stepLabel() + " before finishing.");
        }
        state.status = "COMPLETED";
        emit(state, "MISSION_COMPLETED", seq, data("equity", equityOf(ctx, state)));
        message = "Mission completed.";
      }
      case "RUN_STRESS_TEST" -> message = runStressTest(ctx, state, command.scenarioId(), seq);
      case "REQUEST_HINT" -> {
        state.hintsUsed += 1;
        emit(state, "HINT_REQUESTED", seq, data("hintsUsed", state.hintsUsed));
        message = "Hint requested.";
      }
      default -> throw new SimulationError("UNKNOWN_COMMAND", "Unknown command " + command.type() + ".");
    }

    state.lastCommandSeq = seq;
    recordStep(ctx, state);
    if ("ACTIVE".equals(state.status)) {
      checkFailure(ctx, state, seq);
      recordStep(ctx, state);
    }
    return new CommandResult(state, outcome, message, List.copyOf(state.events.subList(firstEvent, state.events.size())));
  }

  /** Rebuilds a session from its command log. Identical inputs always produce identical state. */
  public static SimState replay(Context ctx, List<RecordedCommand> commands) {
    SimState state = initialState(ctx);
    List<RecordedCommand> sorted = new ArrayList<>(commands);
    sorted.sort((a, b) -> Integer.compare(a.seq(), b.seq()));
    for (RecordedCommand c : sorted) state = applyCommand(ctx, state, c.command(), c.seq()).state();
    return state;
  }
}
