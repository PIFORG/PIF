package com.pif.api.learning.engine;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Mission and scenario definitions (apps/api/src/learning/engine/types.ts). Optional numbers are null when absent. */
public final class Definitions {

  private Definitions() {}

  public static final List<String> LEVELS = List.of("ROOKIE", "STRATEGIST", "COMMANDER");

  public static final List<String> COMPETENCIES = List.of("MARKET_UNDERSTANDING", "TRADING_EXECUTION", "RISK_MANAGEMENT",
      "DIVERSIFICATION", "STRATEGIC_REASONING");

  public static final List<String> RATIONALES = List.of("LIMIT_DOWNSIDE", "DIVERSIFY", "REACT_TO_NEWS", "TAKE_PROFIT",
      "REBALANCE", "LONG_TERM_VIEW", "FOLLOW_MOMENTUM");

  public record AssetDefinition(String symbol, String name, String sector, double initialPrice, double driftPerStep,
      double volPerStep, double beta, double spreadBps, double depth) {}

  public record Shock(String symbol, double move) {}

  public record EventRegime(int steps, Double volMultiplier, Double driftShiftPerStep, Double spreadMultiplier,
      Double depthMultiplier, List<String> symbols) {}

  public record MarketEventDefinition(String id, int step, String kind, String sentiment, String headline, String body,
      boolean unconfirmed, List<Shock> shocks, EventRegime regime) {}

  public record StressScenarioDefinition(String id, String name, String description, List<Shock> shocks) {}

  public record ScenarioDefinition(int steps, String stepLabel, int historySteps, List<AssetDefinition> assets,
      List<MarketEventDefinition> events, List<StressScenarioDefinition> stressScenarios, long seed,
      String provenance) {}

  /** {@code json} is the rules object exactly as the catalog writes it (property order included). */
  public record MissionRules(List<String> allowedOrderTypes, double feeBps, double minFee, Double maxPositionWeightPct,
      boolean allowStressTest, boolean requireConfidence, Map<String, Object> json) {

    /** Builds the rules from alternating key/value pairs, in catalog order. */
    public static MissionRules of(Object... keyValues) {
      Map<String, Object> json = new LinkedHashMap<>();
      for (int i = 0; i < keyValues.length; i += 2) json.put((String) keyValues[i], keyValues[i + 1]);
      @SuppressWarnings("unchecked")
      List<String> types = (List<String>) json.get("allowedOrderTypes");
      Object maxWeight = json.get("maxPositionWeightPct");
      return new MissionRules(types, ((Number) json.get("feeBps")).doubleValue(),
          ((Number) json.get("minFee")).doubleValue(),
          maxWeight == null ? null : ((Number) maxWeight).doubleValue(),
          Boolean.TRUE.equals(json.get("allowStressTest")), Boolean.TRUE.equals(json.get("requireConfidence")),
          java.util.Collections.unmodifiableMap(json));
    }
  }

  /** One objective; only the fields of its kind are set. */
  public record ObjectiveDefinition(String id, String kind, String label, boolean required, String side,
      String orderType, Integer minCount, Double limitPct, Integer fromStep, Integer count, Double pct,
      Integer beforeStep, String eventId, Integer withinSteps) {

    public static ObjectiveDefinition of(String id, String kind, String label, boolean required) {
      return new ObjectiveDefinition(id, kind, label, required, null, null, null, null, null, null, null, null, null,
          null);
    }

    public ObjectiveDefinition side(String value) {
      return new ObjectiveDefinition(id, kind, label, required, value, orderType, minCount, limitPct, fromStep, count,
          pct, beforeStep, eventId, withinSteps);
    }

    public ObjectiveDefinition orderType(String value) {
      return new ObjectiveDefinition(id, kind, label, required, side, value, minCount, limitPct, fromStep, count, pct,
          beforeStep, eventId, withinSteps);
    }

    public ObjectiveDefinition minCount(int value) {
      return new ObjectiveDefinition(id, kind, label, required, side, orderType, value, limitPct, fromStep, count, pct,
          beforeStep, eventId, withinSteps);
    }

    public ObjectiveDefinition limitPct(double value) {
      return new ObjectiveDefinition(id, kind, label, required, side, orderType, minCount, value, fromStep, count, pct,
          beforeStep, eventId, withinSteps);
    }

    public ObjectiveDefinition fromStep(int value) {
      return new ObjectiveDefinition(id, kind, label, required, side, orderType, minCount, limitPct, value, count, pct,
          beforeStep, eventId, withinSteps);
    }

    public ObjectiveDefinition count(int value) {
      return new ObjectiveDefinition(id, kind, label, required, side, orderType, minCount, limitPct, fromStep, value,
          pct, beforeStep, eventId, withinSteps);
    }

    public ObjectiveDefinition pct(double value) {
      return new ObjectiveDefinition(id, kind, label, required, side, orderType, minCount, limitPct, fromStep, count,
          value, beforeStep, eventId, withinSteps);
    }

    public ObjectiveDefinition beforeStep(int value) {
      return new ObjectiveDefinition(id, kind, label, required, side, orderType, minCount, limitPct, fromStep, count,
          pct, value, eventId, withinSteps);
    }

    public ObjectiveDefinition event(String value, int within) {
      return new ObjectiveDefinition(id, kind, label, required, side, orderType, minCount, limitPct, fromStep, count,
          pct, beforeStep, value, within);
    }
  }

  public record ScoringWeights(double risk, double decision, double reasoning, double execution) {}

  public record ScoringConfig(ScoringWeights weights, double passThreshold, Double concentrationLimitPct,
      double riskLimitPct, double maxReasonableTrades) {}

  public record CompetencyWeight(String competency, double weight) {}

  public record InitialPosition(String symbol, double quantity) {}

  public record Briefing(String context, List<String> rules, List<String> tips) {}

  public record FailureRule(String kind, double limitPct) {}

  public record MissionDefinition(String slug, int version, int order, String title, String level,
      String availability, String summary, int estimatedMinutes, List<CompetencyWeight> competencies,
      List<String> learningOutcomes, Briefing briefing, String currency, double initialCash,
      List<InitialPosition> initialPositions, ScenarioDefinition scenario, MissionRules rules,
      List<ObjectiveDefinition> objectives, List<FailureRule> failure, ScoringConfig scoring, String mentorMode,
      String relatedStorySlug) {}
}
