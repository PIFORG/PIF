package com.pif.api.learning;

import com.pif.api.finance.Holding;
import com.pif.api.finance.Money;
import com.pif.api.finance.Quote;
import com.pif.api.learning.engine.Command;
import com.pif.api.learning.engine.Definitions.AssetDefinition;
import com.pif.api.learning.engine.Definitions.CompetencyWeight;
import com.pif.api.learning.engine.Definitions.FailureRule;
import com.pif.api.learning.engine.Definitions.InitialPosition;
import com.pif.api.learning.engine.Definitions.MarketEventDefinition;
import com.pif.api.learning.engine.Definitions.MissionDefinition;
import com.pif.api.learning.engine.Definitions.ObjectiveDefinition;
import com.pif.api.learning.engine.Definitions.ScoringWeights;
import com.pif.api.learning.engine.Definitions.StressScenarioDefinition;
import com.pif.api.learning.engine.Js;
import com.pif.api.learning.engine.MarketPath;
import com.pif.api.learning.engine.Metrics;
import com.pif.api.learning.engine.Metrics.PortfolioMetrics;
import com.pif.api.learning.engine.Objectives;
import com.pif.api.learning.engine.SimState;
import com.pif.api.learning.engine.SimState.Fill;
import com.pif.api.learning.engine.SimState.Order;
import com.pif.api.learning.engine.SimState.StepRecord;
import com.pif.api.learning.engine.SimState.StressTestResult;
import com.pif.api.learning.engine.Simulator;
import com.pif.api.learning.engine.Simulator.Context;
import com.pif.api.learning.engine.Simulator.OrderPreview;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Response shapes of apps/api/src/learning/learning.view.ts, with TypeScript property order. */
public final class LearningViews {

  private LearningViews() {}

  private static double dt(double millimes) {
    return Money.fromAmount(millimes);
  }

  /** Briefing data that is safe to show before and during a mission: no future prices or events. */
  public static Map<String, Object> missionBriefing(MissionDefinition mission) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("slug", mission.slug());
    out.put("version", mission.version());
    out.put("order", mission.order());
    out.put("title", LearningFr.missionTitle(mission.slug(), mission.title()));
    out.put("level", mission.level());
    out.put("availability", mission.availability());
    out.put("summary", LearningFr.missionSummary(mission.slug(), mission.summary()));
    out.put("estimatedMinutes", mission.estimatedMinutes());
    out.put("competencies", competencies(mission));
    List<String> outcomes = new ArrayList<>();
    List<String> rawOutcomes = mission.learningOutcomes();
    for (int i = 0; i < rawOutcomes.size(); i++) {
      outcomes.add(LearningFr.get("mission." + mission.slug() + ".outcome." + i, rawOutcomes.get(i)));
    }
    out.put("learningOutcomes", outcomes);
    Map<String, Object> briefing = new LinkedHashMap<>();
    briefing.put("context", LearningFr.missionBriefingContext(mission.slug(), mission.briefing().context()));
    List<String> rules = new ArrayList<>();
    List<String> rawRules = mission.briefing().rules();
    for (int i = 0; i < rawRules.size(); i++) {
      rules.add(LearningFr.get("mission." + mission.slug() + ".briefing.rule." + i, rawRules.get(i)));
    }
    List<String> tips = new ArrayList<>();
    List<String> rawTips = mission.briefing().tips();
    for (int i = 0; i < rawTips.size(); i++) {
      tips.add(LearningFr.get("mission." + mission.slug() + ".briefing.tip." + i, rawTips.get(i)));
    }
    briefing.put("rules", rules);
    briefing.put("tips", tips);
    out.put("briefing", briefing);
    out.put("currency", mission.currency());
    out.put("initialCash", mission.initialCash());
    List<Map<String, Object>> positions = new ArrayList<>();
    for (InitialPosition p : mission.initialPositions()) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("symbol", p.symbol());
      row.put("quantity", p.quantity());
      positions.add(row);
    }
    out.put("initialPositions", positions);
    out.put("steps", mission.scenario().steps());
    out.put("stepLabel", mission.scenario().stepLabel());
    List<Map<String, Object>> assets = new ArrayList<>();
    for (AssetDefinition a : mission.scenario().assets()) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("symbol", a.symbol());
      row.put("name", a.name());
      row.put("sector", a.sector());
      row.put("sectorLabel", LearningFr.sectorLabel(a.sector()));
      assets.add(row);
    }
    out.put("assets", assets);
    out.put("rules", mission.rules().json());
    List<Map<String, Object>> objectives = new ArrayList<>();
    for (ObjectiveDefinition o : mission.objectives()) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("id", o.id());
      row.put("kind", o.kind());
      row.put("label", LearningFr.get("mission." + mission.slug() + ".objective." + o.id(), o.label()));
      row.put("required", o.required());
      objectives.add(row);
    }
    out.put("objectives", objectives);
    List<Map<String, Object>> failure = new ArrayList<>();
    for (FailureRule f : mission.failure()) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("kind", f.kind());
      row.put("limitPct", f.limitPct());
      failure.add(row);
    }
    out.put("failure", failure);
    Map<String, Object> scoring = new LinkedHashMap<>();
    scoring.put("weights", weights(mission.scoring().weights()));
    scoring.put("passThreshold", mission.scoring().passThreshold());
    out.put("scoring", scoring);
    out.put("mentorMode", mission.mentorMode());
    out.put("relatedStorySlug", mission.relatedStorySlug());
    out.put("provenance", LearningFr.provenance(mission.scenario().provenance()));
    return out;
  }

  public static List<Map<String, Object>> competencies(MissionDefinition mission) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (CompetencyWeight c : mission.competencies()) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("competency", c.competency());
      row.put("weight", c.weight());
      out.add(row);
    }
    return out;
  }

  private static Map<String, Object> weights(ScoringWeights w) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("risk", w.risk());
    out.put("decision", w.decision());
    out.put("reasoning", w.reasoning());
    out.put("execution", w.execution());
    return out;
  }

  public static Map<String, Object> orderView(Order o) {
    double filledValue = 0;
    double fees = 0;
    for (Fill f : o.fills) {
      filledValue = filledValue + f.price() * f.quantity();
    }
    for (Fill f : o.fills) fees = fees + f.fee();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", o.id);
    out.put("seq", o.seq);
    out.put("symbol", o.symbol);
    out.put("side", o.side);
    out.put("type", o.type);
    out.put("quantity", o.quantity);
    out.put("filledQuantity", o.filledQuantity);
    out.put("averageFillPrice", o.filledQuantity > 0 ? dt(Js.round(filledValue / o.filledQuantity)) : null);
    out.put("limitPrice", o.limitPrice == null ? null : dt(o.limitPrice));
    out.put("stopPrice", o.stopPrice == null ? null : dt(o.stopPrice));
    out.put("triggered", o.triggered);
    out.put("status", o.status);
    out.put("statusReason", o.statusReason);
    out.put("createdStep", o.createdStep);
    out.put("rationale", o.rationale);
    out.put("confidence", o.confidence);
    out.put("fees", dt(fees));
    List<Map<String, Object>> fills = new ArrayList<>();
    for (Fill f : o.fills) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("step", f.step());
      row.put("price", dt(f.price()));
      row.put("quantity", f.quantity());
      row.put("fee", dt(f.fee()));
      fills.add(row);
    }
    out.put("fills", fills);
    return out;
  }

  /** Metrics with amounts in DT; property order of the engine metrics. */
  public static Map<String, Object> metricsView(PortfolioMetrics m) {
    Map<String, Object> out = m.toJson();
    out.put("equity", dt(m.equity()));
    out.put("cash", dt(m.cash()));
    out.put("invested", dt(m.invested()));
    out.put("realizedPnl", dt(m.realizedPnl()));
    out.put("unrealizedPnl", dt(m.unrealizedPnl()));
    out.put("var95", m.var95() == null ? null : dt(m.var95()));
    out.put("es95", m.es95() == null ? null : dt(m.es95()));
    out.put("feesPaid", dt(m.feesPaid()));
    out.put("spreadCost", dt(m.spreadCost()));
    return out;
  }

  public static Map<String, Object> metricsView(Context ctx, SimState state) {
    return metricsView(Metrics.compute(ctx, state));
  }

  /** Everything the Mission Player needs, limited to information available at the current step. */
  public static Map<String, Object> sessionState(Context ctx, SimState state) {
    MissionDefinition mission = ctx.mission();
    MarketPath market = ctx.market();
    int step = state.step;
    Map<String, Double> values = Simulator.marketValues(ctx, state);
    double equity = Simulator.equityOf(ctx, state);
    double reserved = Simulator.reservedCash(ctx, state);

    Map<String, Object> out = new LinkedHashMap<>();
    out.put("step", step);
    out.put("steps", mission.scenario().steps());
    out.put("stepLabel", mission.scenario().stepLabel());
    out.put("marketClosed", Simulator.isMarketClosed(ctx, state));
    out.put("status", state.status);
    out.put("failureReason", state.failureReason);
    List<Map<String, Object>> quotes = new ArrayList<>();
    Map<String, Object> priceHistory = new LinkedHashMap<>();
    for (AssetDefinition a : mission.scenario().assets()) {
      Quote q = market.quoteAt(step, a.symbol());
      Quote previous = market.quoteAt(step - 1 >= -market.historySteps() ? step - 1 : step, a.symbol());
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("symbol", a.symbol());
      row.put("name", a.name());
      row.put("sector", a.sector());
      row.put("sectorLabel", LearningFr.sectorLabel(a.sector()));
      row.put("bid", dt(q.bid()));
      row.put("ask", dt(q.ask()));
      row.put("mid", dt(q.mid()));
      row.put("depth", q.depth());
      row.put("spreadBps", Js.round(((q.ask() - q.bid()) / q.mid()) * 10_000 * 10) / 10);
      row.put("changePct", ((q.mid() - previous.mid()) / previous.mid()) * 100);
      quotes.add(row);
      List<Map<String, Object>> series = new ArrayList<>();
      for (MarketPath.MidPoint p : market.midSeriesUpTo(step, a.symbol())) {
        Map<String, Object> point = new LinkedHashMap<>();
        point.put("step", p.step());
        point.put("mid", dt(p.mid()));
        series.add(point);
      }
      priceHistory.put(a.symbol(), series);
    }
    out.put("quotes", quotes);
    out.put("priceHistory", priceHistory);

    Map<String, Object> portfolio = new LinkedHashMap<>();
    portfolio.put("cash", dt(state.cash));
    portfolio.put("reservedCash", dt(reserved));
    portfolio.put("availableCash", dt(state.cash - reserved));
    portfolio.put("equity", dt(equity));
    portfolio.put("initialEquity", dt(state.initialEquity));
    portfolio.put("realizedPnl", dt(state.realizedPnl));
    portfolio.put("feesPaid", dt(state.feesPaid));
    List<Holding> held = new ArrayList<>();
    for (Holding p : state.positions.values()) {
      if (p.quantity() > 0) held.add(p);
    }
    held.sort((a, b) -> a.symbol().compareTo(b.symbol()));
    List<Map<String, Object>> positions = new ArrayList<>();
    for (Holding p : held) {
      double value = values.getOrDefault(p.symbol(), 0.0);
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("symbol", p.symbol());
      row.put("quantity", p.quantity());
      row.put("averageCost", dt(Js.round(p.costBasis() / p.quantity())));
      row.put("costBasis", dt(p.costBasis()));
      row.put("marketValue", dt(value));
      row.put("unrealizedPnl", dt(value - p.costBasis()));
      row.put("weightPct", equity > 0 ? (value / equity) * 100 : 0);
      positions.add(row);
    }
    portfolio.put("positions", positions);
    out.put("portfolio", portfolio);

    List<Map<String, Object>> orders = new ArrayList<>();
    for (int i = state.orders.size() - 1; i >= 0; i--) orders.add(orderView(state.orders.get(i)));
    out.put("orders", orders);

    List<MarketEventDefinition> published = new ArrayList<>();
    for (MarketEventDefinition e : mission.scenario().events()) {
      if (e.step() <= step) published.add(e);
    }
    published.sort((a, b) -> Integer.compare(b.step(), a.step()));
    List<Map<String, Object>> news = new ArrayList<>();
    for (MarketEventDefinition e : published) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("id", e.id());
      row.put("step", e.step());
      row.put("kind", e.kind());
      row.put("sentiment", e.sentiment());
      row.put("headline", LearningFr.get("mission." + mission.slug() + ".event." + e.id() + ".headline", e.headline()));
      row.put("body", LearningFr.get("mission." + mission.slug() + ".event." + e.id() + ".body", e.body()));
      news.add(row);
    }
    out.put("news", news);
    out.put("objectives", Objectives.evaluate(ctx, state).stream().map(Objectives.ObjectiveResult::toJson).toList());
    out.put("metrics", metricsView(ctx, state));
    out.put("equityCurve", equityCurve(state));
    List<Map<String, Object>> scenarios = new ArrayList<>();
    if (mission.rules().allowStressTest()) {
      for (StressScenarioDefinition s : mission.scenario().stressScenarios()) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", s.id());
        row.put("name", LearningFr.stressName(s.id(), s.name()));
        row.put("description", LearningFr.stressDescription(s.id(), s.description()));
        scenarios.add(row);
      }
    }
    out.put("stressScenarios", scenarios);
    List<Map<String, Object>> tests = new ArrayList<>();
    for (StressTestResult t : state.stressTests) {
      Map<String, Object> row = t.toJson();
      row.put("impact", dt(t.impact()));
      List<Map<String, Object>> breakdown = new ArrayList<>();
      for (SimState.BreakdownLine b : t.breakdown()) {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("symbol", b.symbol());
        line.put("value", dt(b.value()));
        line.put("shockPct", b.shockPct());
        line.put("impact", dt(b.impact()));
        breakdown.add(line);
      }
      row.put("breakdown", breakdown);
      tests.add(row);
    }
    out.put("stressTests", tests);
    out.put("hintsUsed", state.hintsUsed);
    return out;
  }

  public static List<Map<String, Object>> equityCurve(SimState state) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (StepRecord h : state.history) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("step", h.step());
      row.put("equity", dt(h.equity()));
      row.put("exposurePct", h.exposure() * 100);
      out.add(row);
    }
    return out;
  }

  public static Map<String, Object> orderPreviewView(OrderPreview preview) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("seq", preview.seq());
    out.put("accepted", preview.accepted());
    out.put("code", preview.code());
    out.put("message", preview.message());
    Simulator.Estimate e = preview.estimate();
    if (e == null) {
      out.put("estimate", null);
    } else {
      Map<String, Object> estimate = new LinkedHashMap<>();
      estimate.put("price", dt(e.price()));
      estimate.put("notional", dt(e.notional()));
      estimate.put("fee", dt(e.fee()));
      estimate.put("total", dt(e.total()));
      out.put("estimate", estimate);
    }
    out.put("warnings", preview.warnings());
    return out;
  }

  public static String describeCommand(Command command) {
    switch (command.type()) {
      case "PLACE_ORDER": {
        // Display text only: the quantity and prices are the command's own values, printed as the engine prints them.
        String side = "SELL".equals(command.side()) ? LearningFr.get("cmd.side.sell", "Vente")
            : LearningFr.get("cmd.side.buy", "Achat");
        String terms = "LIMIT".equals(command.orderType())
            ? LearningFr.format("cmd.order.limit", "à cours limité à {0} DT", jsText(command.limitPrice()))
            : "STOP".equals(command.orderType())
                ? LearningFr.format("cmd.order.stop", "stop à {0} DT", jsText(command.stopPrice()))
                : LearningFr.get("cmd.order.market", "au marché");
        return side + " " + jsText(command.quantity()) + " " + command.symbol() + " " + terms;
      }
      case "CANCEL_ORDER":
        return LearningFr.format("cmd.cancel", "Annuler l'ordre {0}", command.orderId());
      case "ADVANCE":
        return LearningFr.get("cmd.advance", "Avancer d'une séance");
      case "FINISH":
        return LearningFr.get("cmd.finish", "Terminer la mission");
      case "RUN_STRESS_TEST":
        return LearningFr.format("cmd.stress", "Test de résistance : {0}",
            LearningFr.stressName(command.scenarioId(), command.scenarioId()));
      case "REQUEST_HINT":
        return LearningFr.get("cmd.hint", "Question posée au mentor");
      default:
        return null;
    }
  }

  private static String jsText(Double value) {
    return value == null ? "undefined" : Js.str(value);
  }
}
