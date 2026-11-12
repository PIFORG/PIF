package com.pif.api.learning.engine;

import com.pif.api.finance.Holding;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Session state (SimulationState of apps/api/src/learning/engine/types.ts). Mutable like the TypeScript object;
 * {@link #copy()} is the {@code structuredClone} the engine applies before every command. The {@code toJson} methods
 * give the objects with the TypeScript property order.
 */
public final class SimState {

  public String status;
  public int step;
  public double cash;
  public Map<String, Holding> positions;
  public List<Order> orders;
  public double realizedPnl;
  public double feesPaid;
  public double spreadCostPaid;
  public double initialEquity;
  public List<StepRecord> history;
  public List<DomainEvent> events;
  public List<StressTestResult> stressTests;
  public int hintsUsed;
  public int lastCommandSeq;
  public String failureReason;
  public Map<String, Double> liquidityUsed;

  public record Fill(int step, double price, double quantity, double fee, double spreadCost) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("step", step);
      out.put("price", price);
      out.put("quantity", quantity);
      out.put("fee", fee);
      out.put("spreadCost", spreadCost);
      return out;
    }
  }

  public record PlacedQuote(double bid, double ask, double mid) {}

  public record OrderContext(double symbolWeight, String largestSymbol, double largestWeight, int heldCount,
      Double positionGain, double trend, String recentEventId, String recentEventSentiment, double spreadBps,
      double baseSpreadBps, double depth) {

    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("symbolWeight", symbolWeight);
      out.put("largestSymbol", largestSymbol);
      out.put("largestWeight", largestWeight);
      out.put("heldCount", heldCount);
      out.put("positionGain", positionGain);
      out.put("trend", trend);
      out.put("recentEventId", recentEventId);
      out.put("recentEventSentiment", recentEventSentiment);
      out.put("spreadBps", spreadBps);
      out.put("baseSpreadBps", baseSpreadBps);
      out.put("depth", depth);
      return out;
    }
  }

  public static final class Order {
    public String id;
    public int seq;
    public String symbol;
    public String side;
    public String type;
    public double quantity;
    public double filledQuantity;
    public Double limitPrice;
    public Double stopPrice;
    public boolean triggered;
    public String status;
    public int createdStep;
    public String rationale;
    public Double confidence;
    public List<Fill> fills;
    public String statusReason;
    public PlacedQuote placedQuote;
    public OrderContext context;

    Order copy() {
      Order o = new Order();
      o.id = id;
      o.seq = seq;
      o.symbol = symbol;
      o.side = side;
      o.type = type;
      o.quantity = quantity;
      o.filledQuantity = filledQuantity;
      o.limitPrice = limitPrice;
      o.stopPrice = stopPrice;
      o.triggered = triggered;
      o.status = status;
      o.createdStep = createdStep;
      o.rationale = rationale;
      o.confidence = confidence;
      o.fills = new ArrayList<>(fills);
      o.statusReason = statusReason;
      o.placedQuote = placedQuote;
      o.context = context;
      return o;
    }

    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("id", id);
      out.put("seq", seq);
      out.put("symbol", symbol);
      out.put("side", side);
      out.put("type", type);
      out.put("quantity", quantity);
      out.put("filledQuantity", filledQuantity);
      out.put("limitPrice", limitPrice);
      out.put("stopPrice", stopPrice);
      out.put("triggered", triggered);
      out.put("status", status);
      out.put("createdStep", createdStep);
      out.put("rationale", rationale);
      out.put("confidence", confidence);
      out.put("fills", fills.stream().map(Fill::toJson).toList());
      out.put("statusReason", statusReason);
      Map<String, Object> quote = new LinkedHashMap<>();
      quote.put("bid", placedQuote.bid());
      quote.put("ask", placedQuote.ask());
      quote.put("mid", placedQuote.mid());
      out.put("placedQuote", quote);
      out.put("context", context.toJson());
      return out;
    }
  }

  public record StepRecord(int step, double equity, double cash, Map<String, Double> marketValue, double maxWeight,
      double exposure, List<String> heldSymbols, List<String> protectedSymbols) {

    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("step", step);
      out.put("equity", equity);
      out.put("cash", cash);
      out.put("marketValue", new LinkedHashMap<>(marketValue));
      out.put("maxWeight", maxWeight);
      out.put("exposure", exposure);
      out.put("heldSymbols", heldSymbols);
      out.put("protectedSymbols", protectedSymbols);
      return out;
    }
  }

  /** {@code data} holds strings, numbers, booleans and nulls in TypeScript property order. */
  public record DomainEvent(String type, int step, int commandSeq, Map<String, Object> data) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("type", type);
      out.put("step", step);
      out.put("commandSeq", commandSeq);
      out.put("data", data);
      return out;
    }
  }

  public record BreakdownLine(String symbol, double value, double shockPct, double impact) {}

  public record StressTestResult(String scenarioId, String name, int step, double impact, double impactPct,
      List<BreakdownLine> breakdown) {

    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("scenarioId", scenarioId);
      out.put("name", name);
      out.put("step", step);
      out.put("impact", impact);
      out.put("impactPct", impactPct);
      out.put("breakdown", breakdown.stream().map(b -> {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("symbol", b.symbol());
        line.put("value", b.value());
        line.put("shockPct", b.shockPct());
        line.put("impact", b.impact());
        return line;
      }).toList());
      return out;
    }
  }

  public SimState copy() {
    SimState s = new SimState();
    s.status = status;
    s.step = step;
    s.cash = cash;
    s.positions = new LinkedHashMap<>();
    positions.forEach((symbol, h) -> s.positions.put(symbol, new Holding(h.symbol(), h.quantity(), h.costBasis())));
    s.orders = new ArrayList<>(orders.size());
    for (Order o : orders) s.orders.add(o.copy());
    s.realizedPnl = realizedPnl;
    s.feesPaid = feesPaid;
    s.spreadCostPaid = spreadCostPaid;
    s.initialEquity = initialEquity;
    s.history = new ArrayList<>(history);
    s.events = new ArrayList<>(events);
    s.stressTests = new ArrayList<>(stressTests);
    s.hintsUsed = hintsUsed;
    s.lastCommandSeq = lastCommandSeq;
    s.failureReason = failureReason;
    s.liquidityUsed = new LinkedHashMap<>(liquidityUsed);
    return s;
  }

  public Map<String, Object> toJson() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("status", status);
    out.put("step", step);
    out.put("cash", cash);
    Map<String, Object> pos = new LinkedHashMap<>();
    positions.forEach((symbol, h) -> {
      Map<String, Object> p = new LinkedHashMap<>();
      p.put("symbol", h.symbol());
      p.put("quantity", h.quantity());
      p.put("costBasis", h.costBasis());
      pos.put(symbol, p);
    });
    out.put("positions", pos);
    out.put("orders", orders.stream().map(Order::toJson).toList());
    out.put("realizedPnl", realizedPnl);
    out.put("feesPaid", feesPaid);
    out.put("spreadCostPaid", spreadCostPaid);
    out.put("initialEquity", initialEquity);
    out.put("history", history.stream().map(StepRecord::toJson).toList());
    out.put("events", events.stream().map(DomainEvent::toJson).toList());
    out.put("stressTests", stressTests.stream().map(StressTestResult::toJson).toList());
    out.put("hintsUsed", hintsUsed);
    out.put("lastCommandSeq", lastCommandSeq);
    out.put("failureReason", failureReason);
    out.put("liquidityUsed", new LinkedHashMap<>(liquidityUsed));
    return out;
  }
}
