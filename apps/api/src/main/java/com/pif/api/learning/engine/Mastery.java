package com.pif.api.learning.engine;

import com.pif.api.learning.engine.Definitions.CompetencyWeight;
import com.pif.api.learning.engine.Definitions.MissionDefinition;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Competency mastery and mission recommendations (engine/mastery.ts and engine/recommendations.ts). */
public final class Mastery {

  private Mastery() {}

  public static final double RECENCY_DECAY = 0.8;
  public static final double ASSISTED_FACTOR = 0.7;
  /** Competencies not targeted by a mission are still observed, at reduced weight. */
  public static final double NON_TARGET_WEIGHT = 0.3;

  public static final Map<String, String> COMPETENCY_LABELS = Map.of(
      "MARKET_UNDERSTANDING", "Market Understanding",
      "TRADING_EXECUTION", "Trading Execution",
      "RISK_MANAGEMENT", "Risk Management",
      "DIVERSIFICATION", "Portfolio Diversification",
      "STRATEGIC_REASONING", "Strategic Reasoning");

  /** {@code at} is the ordering key; larger is more recent. */
  public record Observation(String competency, double score, double weight, boolean assisted, double at) {}

  public record CompetencyMastery(String competency, Double score, Double unassistedScore, Double assistedScore,
      double evidence, String evidenceLevel, int observations, Double trend) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("competency", competency);
      out.put("score", score);
      out.put("unassistedScore", unassistedScore);
      out.put("assistedScore", assistedScore);
      out.put("evidence", evidence);
      out.put("evidenceLevel", evidenceLevel);
      out.put("observations", observations);
      out.put("trend", trend);
      return out;
    }
  }

  public record MissionProgress(String slug, int attempts, boolean passed, Double bestScore) {}

  public record Recommendation(String slug, String title, String level, String reason) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("slug", slug);
      out.put("title", title);
      out.put("level", level);
      out.put("reason", reason);
      return out;
    }
  }

  private record Mean(Double score, double evidence) {}

  private static Mean weightedMean(List<Observation> items, double assistedFactor) {
    List<Observation> ordered = new ArrayList<>(items);
    ordered.sort((a, b) -> Js.compare(a.at(), b.at()));
    double num = 0;
    double den = 0;
    for (int i = 0; i < ordered.size(); i++) {
      Observation o = ordered.get(i);
      double w = o.weight() * (o.assisted() ? assistedFactor : 1) * StrictMath.pow(RECENCY_DECAY, ordered.size() - 1 - i);
      num += o.score() * w;
      den += w;
    }
    return new Mean(den > 0 ? Js.round((num / den) * 10) / 10 : null, den);
  }

  private static String evidenceLevel(double totalWeight) {
    if (totalWeight == 0) return "NONE";
    if (totalWeight < 1.5) return "EMERGING";
    if (totalWeight < 3) return "DEVELOPING";
    return "ESTABLISHED";
  }

  public static List<CompetencyMastery> computeMastery(List<Observation> observations) {
    List<CompetencyMastery> out = new ArrayList<>();
    for (String competency : Definitions.COMPETENCIES) {
      List<Observation> own = new ArrayList<>();
      for (Observation o : observations) {
        if (o.competency().equals(competency)) own.add(o);
      }
      own.sort((a, b) -> Js.compare(a.at(), b.at()));
      Mean all = weightedMean(own, ASSISTED_FACTOR);
      Double previous = own.size() > 1 ? weightedMean(own.subList(0, own.size() - 1), ASSISTED_FACTOR).score() : null;
      double rawEvidence = 0;
      for (Observation o : own) rawEvidence = rawEvidence + o.weight() * (o.assisted() ? ASSISTED_FACTOR : 1);
      out.add(new CompetencyMastery(
          competency,
          all.score(),
          weightedMean(own.stream().filter(o -> !o.assisted()).toList(), 1).score(),
          weightedMean(own.stream().filter(Observation::assisted).toList(), 1).score(),
          Js.round(rawEvidence * 100) / 100,
          evidenceLevel(rawEvidence),
          own.size(),
          previous != null && all.score() != null ? Js.round((all.score() - previous) * 10) / 10 : null));
    }
    return out;
  }

  /**
   * Highest level the learner is advised to play. Levels are soft gates: a level opens when every implemented mission
   * of the level below is passed, or immediately for experienced learners.
   */
  public static String unlockedLevel(List<MissionDefinition> missions, Map<String, MissionProgress> progress,
      String experience) {
    List<String> levels = Definitions.LEVELS;
    int index = "ADVANCED".equals(experience) ? 2 : "INTERMEDIATE".equals(experience) ? 1 : 0;
    for (int i = index; i < levels.size() - 1; i++) {
      String level = levels.get(i);
      List<MissionDefinition> core = missions.stream()
          .filter(m -> m.level().equals(level) && "IMPLEMENTED".equals(m.availability())).toList();
      boolean allPassed = core.stream().allMatch(m -> {
        MissionProgress p = progress.get(m.slug());
        return p != null && p.passed();
      });
      if (!core.isEmpty() && allPassed) index = i + 1;
      else break;
    }
    return levels.get(index);
  }

  public static List<Recommendation> recommend(List<MissionDefinition> missions, Map<String, MissionProgress> progress,
      List<CompetencyMastery> mastery, String experience) {
    return recommend(missions, progress, mastery, experience, 3);
  }

  private record Ranked(double priority, Recommendation rec) {}

  public static List<Recommendation> recommend(List<MissionDefinition> missions, Map<String, MissionProgress> progress,
      List<CompetencyMastery> mastery, String experience, int limit) {
    List<String> levels = Definitions.LEVELS;
    int unlocked = levels.indexOf(unlockedLevel(missions, progress, experience));
    Map<String, CompetencyMastery> masteryOf = new HashMap<>();
    for (CompetencyMastery m : mastery) masteryOf.put(m.competency(), m);
    List<CompetencyMastery> scored = new ArrayList<>(mastery.stream().filter(m -> m.score() != null).toList());
    scored.sort((a, b) -> Js.compare(a.score(), b.score()));
    CompetencyMastery weakest = scored.isEmpty() ? null : scored.get(0);

    List<Ranked> ranked = new ArrayList<>();
    for (MissionDefinition m : missions) {
      MissionProgress p = progress.get(m.slug());
      if ("PLANNED".equals(m.availability()) || levels.indexOf(m.level()) > unlocked || (p != null && p.passed())) {
        continue;
      }
      double need = 0;
      for (CompetencyWeight c : m.competencies()) {
        CompetencyMastery cm = masteryOf.get(c.competency());
        double score = cm == null || cm.score() == null ? 50 : cm.score();
        need = need + c.weight() * (100 - score);
      }
      need = need / 100;
      double levelBonus = levels.indexOf(m.level()) == unlocked ? 0.5 : 0;
      boolean targetsWeakest = weakest != null && m.competencies().stream()
          .anyMatch(c -> c.competency().equals(weakest.competency()) && c.weight() >= 0.7);
      double priority = need + levelBonus + (targetsWeakest ? 0.5 : 0)
          + ("IMPLEMENTED".equals(m.availability()) ? 0.25 : 0) - m.order() * 0.01;
      int attempts = p == null ? 0 : p.attempts();
      String reason = targetsWeakest
          ? "Targets your weakest competency: " + COMPETENCY_LABELS.get(weakest.competency()) + " ("
              + Js.str(weakest.score()) + "/100)."
          : attempts > 0
              ? "You have attempted this mission " + attempts + " time(s) without passing yet."
              : "Next mission on your learning path.";
      ranked.add(new Ranked(priority, new Recommendation(m.slug(), m.title(), m.level(), reason)));
    }
    ranked.sort((a, b) -> Js.compare(b.priority(), a.priority()));
    return ranked.stream().limit(limit).map(Ranked::rec).toList();
  }
}
