package com.pif.api.learning.engine;

import com.pif.api.learning.engine.Definitions.MarketEventDefinition;
import com.pif.api.learning.engine.Definitions.MissionDefinition;
import com.pif.api.learning.engine.Definitions.ScoringConfig;
import com.pif.api.learning.engine.Definitions.ScoringWeights;
import com.pif.api.learning.engine.Metrics.PortfolioMetrics;
import com.pif.api.learning.engine.Objectives.ObjectiveResult;
import com.pif.api.learning.engine.SimState.Fill;
import com.pif.api.learning.engine.SimState.Order;
import com.pif.api.learning.engine.SimState.OrderContext;
import com.pif.api.learning.engine.SimState.StepRecord;
import com.pif.api.learning.engine.Simulator.Context;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Session assessment (apps/api/src/learning/engine/assessment.ts). */
public final class Assessments {

  private Assessments() {}

  public static final String ASSESSMENT_ENGINE_VERSION = "assessment-1.1";
  /** Fewer outcome observations than this are reported but not read as calibration. */
  public static final int CALIBRATION_MIN_ORDERS = 10;
  public static final double HIGH_CONFIDENCE = 80;
  private static final int UNCONFIRMED_NEWS_WINDOW = 2;
  private static final List<String> COMPONENT_KEYS = List.of("risk", "decision", "reasoning", "execution");

  public record Evidence(String label, Double score, String detail) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("label", label);
      out.put("score", score);
      out.put("detail", detail);
      return out;
    }
  }

  public record ComponentScore(String key, Double score, double configuredWeight, double appliedWeight,
      List<Evidence> evidence) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("key", key);
      out.put("score", score);
      out.put("configuredWeight", configuredWeight);
      out.put("appliedWeight", appliedWeight);
      out.put("evidence", evidence.stream().map(Evidence::toJson).toList());
      return out;
    }
  }

  public record CalibrationSignal(String id, int orders, String detail) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("id", id);
      out.put("orders", orders);
      out.put("detail", detail);
      return out;
    }
  }

  /**
   * Retrospective confidence review, never part of the score. The outcome side is market-adjusted: a buy counts as
   * favourable when its asset beat the mission's equal-weight universe from the fill to the end (a sell, when it
   * lagged).
   */
  public record Calibration(String method, int orders, int observations, int minimumOrders, boolean interpretable,
      Double meanConfidence, Double hitRate, Double brierScore, List<CalibrationSignal> signals) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("method", method);
      out.put("orders", orders);
      out.put("observations", observations);
      out.put("minimumOrders", minimumOrders);
      out.put("interpretable", interpretable);
      out.put("meanConfidence", meanConfidence);
      out.put("hitRate", hitRate);
      out.put("brierScore", brierScore);
      out.put("signals", signals.stream().map(CalibrationSignal::toJson).toList());
      return out;
    }
  }

  public record Assessment(String engineVersion, String missionSlug, int missionVersion, double total, boolean passed,
      double passThreshold, boolean failedByRule, String failureReason, boolean requiredObjectivesMet,
      List<ObjectiveResult> objectives, List<ComponentScore> components, Map<String, Double> competencyScores,
      boolean assisted, int hintsUsed, PortfolioMetrics metrics, List<String> strengths, List<String> improvements,
      Calibration calibration) {

    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("engineVersion", engineVersion);
      out.put("missionSlug", missionSlug);
      out.put("missionVersion", missionVersion);
      out.put("total", total);
      out.put("passed", passed);
      out.put("passThreshold", passThreshold);
      out.put("failedByRule", failedByRule);
      out.put("failureReason", failureReason);
      out.put("requiredObjectivesMet", requiredObjectivesMet);
      out.put("objectives", objectives.stream().map(ObjectiveResult::toJson).toList());
      out.put("components", components.stream().map(ComponentScore::toJson).toList());
      out.put("competencyScores", new LinkedHashMap<>(competencyScores));
      out.put("assisted", assisted);
      out.put("hintsUsed", hintsUsed);
      out.put("metrics", metrics.toJson());
      out.put("strengths", strengths);
      out.put("improvements", improvements);
      out.put("calibration", calibration.toJson());
      return out;
    }
  }

  private static double mid(Context ctx, int step, String symbol) {
    return ctx.market().quoteAt(step, symbol).mid();
  }

  private static List<CalibrationSignal> confidenceSignals(Context ctx, SimState state, int fills) {
    List<Order> rated = new ArrayList<>();
    for (Order o : state.orders) {
      if (!"REJECTED".equals(o.status) && o.confidence != null) rated.add(o);
    }
    List<CalibrationSignal> signals = new ArrayList<>();

    List<MarketEventDefinition> rumours = new ArrayList<>();
    for (MarketEventDefinition e : ctx.mission().scenario().events()) {
      if (e.unconfirmed() && e.step() <= state.step) rumours.add(e);
    }
    int onRumour = 0;
    for (Order o : rated) {
      if (o.confidence < HIGH_CONFIDENCE) continue;
      boolean near = rumours.stream().anyMatch(e -> o.createdStep >= e.step()
          && o.createdStep <= e.step() + UNCONFIRMED_NEWS_WINDOW
          && e.shocks().stream().anyMatch(s -> s.symbol().equals(o.symbol) || "*".equals(s.symbol())));
      if (near) onRumour++;
    }
    if (onRumour > 0) {
      signals.add(new CalibrationSignal("CONFIDENT_ON_UNCONFIRMED_NEWS", onRumour, onRumour + " order(s) rated 80 % or "
          + "more within 2 days of an unconfirmed report about the same asset."));
    }

    Set<Double> levels = new HashSet<>();
    for (Order o : rated) levels.add(o.confidence == 0 ? 0.0 : o.confidence);
    if (rated.size() >= 3 && levels.size() == 1) {
      signals.add(new CalibrationSignal("UNVARYING_CONFIDENCE", rated.size(), "All " + rated.size()
          + " rated orders carried the same " + Js.str(rated.get(0).confidence) + " % confidence, so it did not "
          + "separate stronger decisions from weaker ones."));
    }

    double sum = 0;
    for (Order o : rated) sum = sum + o.confidence;
    double mean = rated.isEmpty() ? 0 : sum / rated.size();
    double reasonable = ctx.mission().scoring().maxReasonableTrades();
    if (!rated.isEmpty() && mean >= HIGH_CONFIDENCE && fills > reasonable) {
      signals.add(new CalibrationSignal("CONFIDENT_OVERTRADING", rated.size(), "Average confidence "
          + Js.toFixed(mean, 0) + " % with " + fills + " fills, more than the " + Js.str(reasonable)
          + " that start to look like overtrading."));
    }
    return signals;
  }

  public static Calibration calibrationOf(Context ctx, SimState state, int fills) {
    List<Order> rated = new ArrayList<>();
    for (Order o : state.orders) {
      if (o.confidence != null && o.filledQuantity > 0) rated.add(o);
    }
    int end = state.step;
    List<String> universe = ctx.mission().scenario().assets().stream().map(a -> a.symbol()).toList();

    List<double[]> outcomes = new ArrayList<>();
    for (Order o : rated) {
      List<Fill> compared = o.fills.stream().filter(f -> f.step() < end).toList();
      double quantity = 0;
      for (Fill f : compared) quantity = quantity + f.quantity();
      if (quantity == 0) continue;
      double sign = "BUY".equals(o.side) ? 1 : -1;
      double excess = 0;
      for (Fill f : compared) {
        double benchmark = 0;
        for (String symbol : universe) benchmark = benchmark + mid(ctx, end, symbol) / mid(ctx, f.step(), symbol) - 1;
        benchmark = benchmark / universe.size();
        excess = excess + f.quantity() * sign * (mid(ctx, end, o.symbol) / mid(ctx, f.step(), o.symbol) - 1 - benchmark);
      }
      excess = excess / quantity;
      outcomes.add(new double[] {o.confidence / 100, excess > 0 ? 1 : 0});
    }

    Double meanConfidence = null;
    if (!rated.isEmpty()) {
      double sum = 0;
      for (Order o : rated) sum = sum + o.confidence;
      meanConfidence = sum / rated.size();
    }
    Double hitRate = null;
    Double brier = null;
    if (!outcomes.isEmpty()) {
      double hits = 0;
      double squares = 0;
      for (double[] o : outcomes) {
        hits = hits + o[1];
        squares = squares + StrictMath.pow(o[0] - o[1], 2);
      }
      hitRate = (hits / outcomes.size()) * 100;
      brier = squares / outcomes.size();
    }
    return new Calibration("MARKET_ADJUSTED", rated.size(), outcomes.size(), CALIBRATION_MIN_ORDERS,
        outcomes.size() >= CALIBRATION_MIN_ORDERS, meanConfidence, hitRate, brier, confidenceSignals(ctx, state, fills));
  }

  static double clamp(double value) {
    return Math.min(100, Math.max(0, value));
  }

  /** Weighted mean of the parts that apply; null when none apply. */
  private static Double blend(Double[] scores, double[] weights) {
    double weight = 0;
    for (int i = 0; i < scores.length; i++) {
      if (scores[i] != null && weights[i] > 0) weight = weight + weights[i];
    }
    if (weight == 0) return null;
    double sum = 0;
    for (int i = 0; i < scores.length; i++) {
      if (scores[i] != null && weights[i] > 0) sum = sum + scores[i] * weights[i];
    }
    return sum / weight;
  }

  public record Consistency(boolean consistent, String why) {}

  /** Whether a stated rationale matches the order, judged only on what was visible at placement. */
  public static Consistency rationaleConsistent(Order order) {
    OrderContext c = order.context;
    boolean sell = "SELL".equals(order.side);
    boolean buy = "BUY".equals(order.side);
    switch (String.valueOf(order.rationale)) {
      case "LIMIT_DOWNSIDE":
        return sell ? new Consistency(true, "Selling or a stop reduces exposure to further falls.")
            : new Consistency(false, "A buy adds exposure; it does not limit downside.");
      case "DIVERSIFY":
        if (buy) {
          boolean ok = c.symbolWeight() < 0.2 && !order.symbol.equals(c.largestSymbol());
          return new Consistency(ok, ok ? "Bought an under-weighted asset."
              : "Added to an asset that was already a large share of the portfolio.");
        }
        return order.symbol.equals(c.largestSymbol()) ? new Consistency(true, "Trimmed the largest position.")
            : new Consistency(false, "Selling a smaller position increases concentration in the largest one.");
      case "REACT_TO_NEWS":
        return c.recentEventId() != null && !c.recentEventId().isEmpty()
            ? new Consistency(true, "Placed shortly after a published headline.")
            : new Consistency(false, "No headline had been published in the previous two steps.");
      case "TAKE_PROFIT": {
        boolean ok = sell && (c.positionGain() == null ? 0 : c.positionGain()) > 0;
        return new Consistency(ok, ok ? "Sold a position that showed a gain." : "There was no unrealised gain to take.");
      }
      case "REBALANCE": {
        boolean ok = sell ? order.symbol.equals(c.largestSymbol())
            : c.heldCount() == 0 || c.symbolWeight() < c.largestWeight();
        return new Consistency(ok, ok ? "Moved weights toward balance." : "The order made the portfolio less balanced.");
      }
      case "LONG_TERM_VIEW": {
        boolean ok = buy || "STOP".equals(order.type);
        return new Consistency(ok, ok ? "Building or protecting a long-term holding."
            : "Selling outright contradicts a long-term view.");
      }
      case "FOLLOW_MOMENTUM": {
        boolean ok = (buy && c.trend() > 0) || (sell && c.trend() < 0);
        return new Consistency(ok, ok ? "Traded in the direction of the recent trend." : "Traded against the recent trend.");
      }
      default:
        throw new IllegalArgumentException("Unknown rationale " + order.rationale);
    }
  }

  private static List<Evidence> riskComponent(Context ctx, SimState state, PortfolioMetrics metrics) {
    MissionDefinition mission = ctx.mission();
    ScoringConfig scoring = mission.scoring();
    double limit = scoring.riskLimitPct();
    double dd = metrics.maxDrawdownPct();
    double drawdownScore = dd <= limit * 0.5 ? 100 : dd >= limit * 1.5 ? 0 : (100 * (limit * 1.5 - dd)) / limit;
    List<Evidence> evidence = new ArrayList<>();
    evidence.add(new Evidence("Drawdown control", "FAILED".equals(state.status) ? 0 : drawdownScore,
        "Maximum drawdown " + Js.toFixed(dd, 2) + " % against a " + Js.str(limit) + " % reference."));

    List<StepRecord> judged = state.history.stream().filter(h -> h.step() >= 1).toList();
    if (scoring.concentrationLimitPct() != null && !judged.isEmpty()) {
      double cap = scoring.concentrationLimitPct();
      int within = (int) judged.stream().filter(h -> h.maxWeight() * 100 <= cap).count();
      evidence.add(new Evidence("Concentration discipline", ((double) within / judged.size()) * 100,
          within + " of " + judged.size() + " days with every position at or below " + Js.str(cap) + " %."));
    }

    if (mission.rules().allowedOrderTypes().contains("STOP")) {
      List<StepRecord> exposed = state.history.stream().filter(h -> !h.heldSymbols().isEmpty()).toList();
      if (!exposed.isEmpty()) {
        double sum = 0;
        for (StepRecord h : exposed) sum = sum + (double) h.protectedSymbols().size() / h.heldSymbols().size();
        double coverage = sum / exposed.size();
        evidence.add(new Evidence("Downside protection", clamp((coverage / 0.5) * 100),
            "On average " + Js.toFixed(coverage * 100, 0) + " % of holdings were covered by a stop."));
      }
    }
    return evidence;
  }

  private static List<Evidence> decisionComponent(Context ctx, SimState state, List<ObjectiveResult> objectives,
      PortfolioMetrics metrics) {
    double totalWeight = 0;
    double metWeight = 0;
    int met = 0;
    for (ObjectiveResult o : objectives) {
      double w = o.required() ? 2 : 1;
      totalWeight = totalWeight + w;
      if (Objectives.isSatisfied(o.status())) {
        metWeight = metWeight + w;
        met++;
      }
    }
    List<Evidence> evidence = new ArrayList<>();
    evidence.add(new Evidence("Objectives achieved", totalWeight != 0 ? (metWeight / totalWeight) * 100 : null,
        met + " of " + objectives.size() + " objectives met (required objectives count double)."));

    List<MarketEventDefinition> relevant = new ArrayList<>();
    for (MarketEventDefinition e : ctx.mission().scenario().events()) {
      if ("POSITIVE".equals(e.sentiment()) || e.step() > state.step) continue;
      StepRecord record = null;
      for (StepRecord h : state.history) {
        if (h.step() == e.step() - 1) {
          record = h;
          break;
        }
      }
      if (record != null && !record.heldSymbols().isEmpty()) relevant.add(e);
    }
    if (!relevant.isEmpty()) {
      int reviewed = 0;
      for (MarketEventDefinition e : relevant) {
        int from = e.step();
        int to = e.step() + 2;
        boolean acted = state.orders.stream()
            .anyMatch(o -> !"REJECTED".equals(o.status) && o.createdStep >= from && o.createdStep <= to)
            || state.stressTests.stream().anyMatch(t -> t.step() >= from && t.step() <= to);
        if (acted) reviewed++;
      }
      evidence.add(new Evidence("Response to adverse events", ((double) reviewed / relevant.size()) * 100,
          "You reviewed or acted on " + reviewed + " of " + relevant.size() + " adverse event(s) within two steps."));
    }

    double reasonable = ctx.mission().scoring().maxReasonableTrades();
    double excess = Math.max(0, metrics.fills() - reasonable);
    evidence.add(new Evidence("Trading discipline", clamp(100 - excess * 15), metrics.fills()
        + " fill(s); more than " + Js.str(reasonable) + " starts to look like overtrading."));
    return evidence;
  }

  private static List<Evidence> reasoningComponent(Context ctx, SimState state) {
    List<Order> decided = state.orders.stream().filter(o -> !"REJECTED".equals(o.status)).toList();
    List<Evidence> evidence = new ArrayList<>();
    if (!decided.isEmpty()) {
      int consistent = (int) decided.stream().filter(o -> rationaleConsistent(o).consistent()).count();
      evidence.add(new Evidence("Rationale consistency", ((double) consistent / decided.size()) * 100,
          consistent + " of " + decided.size() + " order(s) matched the reason you gave at the time."));
    }
    if (ctx.mission().rules().allowStressTest()) {
      int ran = state.stressTests.size();
      evidence.add(new Evidence("Evidence before action", ran > 0 ? 100.0 : 0.0,
          ran > 0 ? "You ran " + ran + " stress test(s)." : "You did not run a stress test."));
    }
    return evidence;
  }

  private static List<Evidence> executionComponent(SimState state, PortfolioMetrics metrics) {
    List<Evidence> evidence = new ArrayList<>();
    if (state.orders.isEmpty()) return evidence;
    evidence.add(new Evidence("Order validity",
        (1 - (double) metrics.ordersRejected() / metrics.ordersPlaced()) * 100,
        metrics.ordersRejected() + " of " + metrics.ordersPlaced() + " order(s) rejected by the market rules."));

    List<Order> executed = state.orders.stream().filter(o -> !"REJECTED".equals(o.status)).toList();
    if (!executed.isEmpty()) {
      int appropriate = 0;
      for (Order o : executed) {
        if (!"MARKET".equals(o.type)) {
          appropriate++;
          continue;
        }
        boolean stressed = o.context.spreadBps() > o.context.baseSpreadBps() * 2;
        if (!stressed && o.quantity <= o.context.depth()) appropriate++;
      }
      evidence.add(new Evidence("Order type choice", ((double) appropriate / executed.size()) * 100,
          appropriate + " of " + executed.size() + " order(s) suited the liquidity at the time (market orders in wide "
              + "spreads or larger than displayed depth count against you)."));
    }

    double traded = 0;
    for (Order o : state.orders) {
      for (Fill f : o.fills) traded = traded + f.price() * f.quantity();
    }
    if (traded > 0) {
      double costBps = ((metrics.feesPaid() + metrics.spreadCost()) / traded) * 10_000;
      evidence.add(new Evidence("Cost efficiency", clamp(((150 - costBps) / 110) * 100),
          "Commissions and spread cost " + Js.toFixed(costBps, 0) + " bps of traded value."));
    }
    return evidence;
  }

  private static Double score(List<Evidence> evidence) {
    Double[] scores = new Double[evidence.size()];
    double[] weights = new double[evidence.size()];
    for (int i = 0; i < scores.length; i++) {
      scores[i] = evidence.get(i).score();
      weights[i] = 1;
    }
    return blend(scores, weights);
  }

  private static double configuredWeight(ScoringWeights w, String key) {
    return switch (key) {
      case "risk" -> w.risk();
      case "decision" -> w.decision();
      case "reasoning" -> w.reasoning();
      default -> w.execution();
    };
  }

  private static Double find(Map<String, List<Evidence>> byKey, String key, String label) {
    for (Evidence e : byKey.get(key)) {
      if (e.label().equals(label)) return e.score();
    }
    return null;
  }

  private static Double tenth(Double value) {
    return value == null ? null : Js.round(value * 10) / 10;
  }

  private record Ranked(Evidence evidence, double score) {}

  public static Assessment assessSession(Context ctx, SimState state) {
    MissionDefinition mission = ctx.mission();
    PortfolioMetrics metrics = Metrics.compute(ctx, state);
    List<ObjectiveResult> objectives = Objectives.evaluate(ctx, state);

    Map<String, List<Evidence>> byKey = new LinkedHashMap<>();
    byKey.put("risk", riskComponent(ctx, state, metrics));
    byKey.put("decision", decisionComponent(ctx, state, objectives, metrics));
    byKey.put("reasoning", reasoningComponent(ctx, state));
    byKey.put("execution", executionComponent(state, metrics));
    if (state.orders.isEmpty()) {
      Evidence none = new Evidence("No decisions", 0.0,
          "No orders were placed, so there is no reasoning or execution to credit.");
      byKey.get("reasoning").add(none);
      byKey.get("execution").add(none);
    }
    double usableWeight = 0;
    Map<String, Double> rawScores = new LinkedHashMap<>();
    for (String key : COMPONENT_KEYS) {
      Double s = score(byKey.get(key));
      rawScores.put(key, s);
      if (s != null) usableWeight = usableWeight + configuredWeight(mission.scoring().weights(), key);
    }
    List<ComponentScore> components = new ArrayList<>();
    for (String key : COMPONENT_KEYS) {
      Double s = rawScores.get(key);
      double configured = configuredWeight(mission.scoring().weights(), key);
      components.add(new ComponentScore(key, tenth(s), configured,
          s == null || usableWeight == 0 ? 0 : (configured / usableWeight) * 100, List.copyOf(byKey.get(key))));
    }
    double weighted = 0;
    for (ComponentScore c : components) {
      weighted = weighted + (c.score() == null ? 0 : c.score()) * (c.appliedWeight() / 100);
    }
    double total = Js.round(weighted * 10) / 10;

    boolean failedByRule = "FAILED".equals(state.status);
    boolean requiredObjectivesMet = objectives.stream().filter(ObjectiveResult::required)
        .allMatch(o -> Objectives.isSatisfied(o.status()));
    boolean passed = !failedByRule && requiredObjectivesMet && total >= mission.scoring().passThreshold();

    Double objectivesScore = find(byKey, "decision", "Objectives achieved");
    Map<String, Double> rawCompetencies = new LinkedHashMap<>();
    rawCompetencies.put("RISK_MANAGEMENT", components.get(0).score());
    rawCompetencies.put("TRADING_EXECUTION", components.get(3).score());
    rawCompetencies.put("MARKET_UNDERSTANDING", blend(
        new Double[] {find(byKey, "decision", "Response to adverse events"), find(byKey, "reasoning", "Rationale consistency")},
        new double[] {1, 1}));
    Double concentration = find(byKey, "risk", "Concentration discipline");
    rawCompetencies.put("DIVERSIFICATION", concentration != null ? concentration
        : metrics.effectiveAssets() != null
            ? (Double) clamp((metrics.effectiveAssets() / Math.min(4, mission.scenario().assets().size())) * 100)
            : null);
    rawCompetencies.put("STRATEGIC_REASONING", blend(new Double[] {components.get(2).score(), objectivesScore},
        new double[] {1, 1}));
    Map<String, Double> competencyScores = new LinkedHashMap<>();
    rawCompetencies.forEach((k, v) -> competencyScores.put(k, tenth(v)));

    List<Ranked> all = new ArrayList<>();
    for (ComponentScore c : components) {
      for (Evidence e : c.evidence()) {
        if (e.score() != null) all.add(new Ranked(e, e.score()));
      }
    }
    List<Ranked> strong = new ArrayList<>(all.stream().filter(r -> r.score() >= 80).toList());
    strong.sort((a, b) -> Js.compare(b.score(), a.score()));
    List<Ranked> weak = new ArrayList<>(all.stream().filter(r -> r.score() < 60).toList());
    weak.sort((a, b) -> Js.compare(a.score(), b.score()));
    List<String> strengths = strong.stream().limit(3)
        .map(r -> r.evidence().label() + ": " + r.evidence().detail()).toList();
    List<String> improvements = weak.stream().limit(3)
        .map(r -> r.evidence().label() + ": " + r.evidence().detail()).toList();

    return new Assessment(ASSESSMENT_ENGINE_VERSION, mission.slug(), mission.version(), total, passed,
        mission.scoring().passThreshold(), failedByRule, state.failureReason, requiredObjectivesMet, objectives,
        components, competencyScores, state.hintsUsed > 0, state.hintsUsed, metrics, strengths, improvements,
        calibrationOf(ctx, state, metrics.fills()));
  }
}
