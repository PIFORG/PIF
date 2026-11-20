package com.pif.api.rooms;

import com.pif.api.finance.Money;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Deterministic pedagogical economy rules for Market Rooms.
 * Three distinct balances: fictional capital, learning points, virtual credit debt.
 */
public final class RoomEconomy {

  private RoomEconomy() {}

  public record Rules(
      double initialCapital,
      double pointsToCapitalRate,
      double maxConversionCapital,
      int conversionCooldownHours,
      double baseCreditLimitPct,
      double maxCreditOutstandingPct,
      int minLearningPointsForCredit,
      int maxParticipants,
      int durationMinutes,
      String marketScope,
      String crisisEpisodeId,
      String simStartDate,
      String simEndDate) {

    public static Rules defaults() {
      return new Rules(
          100_000,
          10.0,
          5_000,
          1,
          20.0,
          50.0,
          50,
          12,
          90,
          "FICTIONAL",
          null,
          null,
          null);
    }

    @SuppressWarnings("unchecked")
    public static Rules fromJson(Map<String, Object> raw) {
      Rules d = defaults();
      if (raw == null || raw.isEmpty()) return d;
      return new Rules(
          num(raw.get("initialCapital"), d.initialCapital()),
          num(raw.get("pointsToCapitalRate"), d.pointsToCapitalRate()),
          num(raw.get("maxConversionCapital"), d.maxConversionCapital()),
          (int) num(raw.get("conversionCooldownHours"), d.conversionCooldownHours()),
          num(raw.get("baseCreditLimitPct"), d.baseCreditLimitPct()),
          num(raw.get("maxCreditOutstandingPct"), d.maxCreditOutstandingPct()),
          (int) num(raw.get("minLearningPointsForCredit"), d.minLearningPointsForCredit()),
          (int) num(raw.get("maxParticipants"), d.maxParticipants()),
          (int) num(raw.get("durationMinutes"), d.durationMinutes()),
          str(raw.get("marketScope"), d.marketScope()),
          str(raw.get("crisisEpisodeId"), d.crisisEpisodeId()),
          str(raw.get("simStartDate"), d.simStartDate()),
          str(raw.get("simEndDate"), d.simEndDate()));
    }

    public Map<String, Object> toJson() {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("initialCapital", initialCapital);
      m.put("pointsToCapitalRate", pointsToCapitalRate);
      m.put("maxConversionCapital", maxConversionCapital);
      m.put("conversionCooldownHours", conversionCooldownHours);
      m.put("baseCreditLimitPct", baseCreditLimitPct);
      m.put("maxCreditOutstandingPct", maxCreditOutstandingPct);
      m.put("minLearningPointsForCredit", minLearningPointsForCredit);
      m.put("maxParticipants", maxParticipants);
      m.put("durationMinutes", durationMinutes);
      m.put("marketScope", marketScope);
      m.put("crisisEpisodeId", crisisEpisodeId);
      m.put("simStartDate", simStartDate);
      m.put("simEndDate", simEndDate);
      m.put("disclaimer",
          "Capital, points et crédit sont entièrement fictifs. Aucune transaction réelle.");
      return m;
    }

    public long initialCapitalMillimes() {
      return (long) Money.toAmount(initialCapital);
    }

    public long maxConversionMillimes() {
      return (long) Money.toAmount(maxConversionCapital);
    }
  }

  /** Credit ceiling in millimes based on rules + learning points (no opaque scoring). */
  public static long creditCeilingMillimes(Rules rules, int learningPoints, long alreadyDrawn) {
    long base = (long) Math.round(rules.initialCapitalMillimes() * (rules.baseCreditLimitPct() / 100.0));
    if (learningPoints < rules.minLearningPointsForCredit()) return 0;
    // Transparent bonus: +5% of initial capital per 100 points above threshold, capped.
    int extraBuckets = Math.max(0, (learningPoints - rules.minLearningPointsForCredit()) / 100);
    long bonus = (long) Math.round(rules.initialCapitalMillimes() * 0.05 * Math.min(extraBuckets, 4));
    long ceiling = Math.min(
        base + bonus,
        (long) Math.round(rules.initialCapitalMillimes() * (rules.maxCreditOutstandingPct() / 100.0)));
    return Math.max(0, ceiling - alreadyDrawn);
  }

  public static long conversionCapitalMillimes(Rules rules, int pointsToSpend) {
    if (pointsToSpend <= 0 || rules.pointsToCapitalRate() <= 0) return 0;
    double capital = pointsToSpend / rules.pointsToCapitalRate();
    long millimes = (long) Money.toAmount(capital);
    return Math.min(millimes, rules.maxConversionMillimes());
  }

  public static int pointsNeededForCapital(Rules rules, double capitalDesired) {
    if (rules.pointsToCapitalRate() <= 0) return Integer.MAX_VALUE;
    return (int) Math.ceil(capitalDesired * rules.pointsToCapitalRate());
  }

  /**
   * Trading return excluding external capital (point conversions + outstanding credit).
   * tradingReturn = (grossEquity − externalCapital − initialCapital) / initialCapital.
   */
  public static double tradingReturnPct(double grossEquity, double initialCapital, double externalCapital) {
    double base = Math.max(1.0, initialCapital);
    return ((grossEquity - externalCapital - initialCapital) / base) * 100.0;
  }

  /**
   * Pedagogical leaderboard score in [0, 100].
   * Weights: performance 30%, risk 25%, learning 30%, discipline 15%.
   * Risk component penalises drawdown — excessive risk is not rewarded.
   */
  public static double pedagogicalScore(
      double tradingReturnPct,
      double maxDrawdownPct,
      int learningPoints,
      int missionsCompleted,
      boolean tradingLocked) {
    double ret = clamp(50 + tradingReturnPct * 2.0, 0, 100);
    double risk = clamp(100 - Math.abs(maxDrawdownPct) * 4.0, 0, 100);
    double learn = clamp(learningPoints / 2.0 + missionsCompleted * 8.0, 0, 100);
    double discipline = tradingLocked ? 35 : 80;
    return round1(0.30 * ret + 0.25 * risk + 0.30 * learn + 0.15 * discipline);
  }

  public static Map<String, Object> scoreExplanation() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("fr",
        "Score = 30% rendement trading (hors conversions et crédit) + 25% maîtrise du risque (drawdown) "
            + "+ 30% points/missions + 15% discipline. Un crédit ou des points convertis n'augmentent pas "
            + "artificiellement le rendement. Une prise de risque excessive baisse le volet risque.");
    m.put("weights", Map.of(
        "performance", 0.30,
        "risk", 0.25,
        "learning", 0.30,
        "discipline", 0.15));
    return m;
  }

  public static String levelFromPoints(int points) {
    if (points >= 800) return "EXPERT";
    if (points >= 400) return "ADVANCED";
    if (points >= 200) return "INTERMEDIATE";
    if (points >= 50) return "LEARNER";
    return "BEGINNER";
  }

  private static double num(Object v, double fallback) {
    if (v instanceof Number n) return n.doubleValue();
    if (v instanceof String s) {
      try {
        return Double.parseDouble(s);
      } catch (NumberFormatException e) {
        return fallback;
      }
    }
    return fallback;
  }

  private static String str(Object v, String fallback) {
    return v == null ? fallback : String.valueOf(v);
  }

  private static double clamp(double v, double lo, double hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  private static double round1(double v) {
    return Math.round(v * 10.0) / 10.0;
  }
}
