package com.pif.api.learning.engine;

import java.util.Map;

/**
 * French wording of the engine's stable codes (order side, order type, stated rationale, step unit) for the messages
 * it writes. Display text only: the codes themselves are what the engine stores, compares and scores.
 */
final class Wording {

  private static final Map<String, String> RATIONALES = Map.of(
      "LIMIT_DOWNSIDE", "limiter la baisse",
      "DIVERSIFY", "diversifier",
      "REACT_TO_NEWS", "réagir à l'actualité",
      "TAKE_PROFIT", "prendre des bénéfices",
      "REBALANCE", "rééquilibrer",
      "LONG_TERM_VIEW", "vision long terme",
      "FOLLOW_MOMENTUM", "suivre la tendance");

  private Wording() {}

  /** "achat" or "vente". */
  static String side(String side) {
    return "SELL".equals(side) ? "vente" : "achat";
  }

  /** "au marché", "à cours limité" or "stop". */
  static String orderType(String type) {
    return switch (type) {
      case "LIMIT" -> "à cours limité";
      case "STOP" -> "stop";
      default -> "au marché";
    };
  }

  /** The rationale the learner stated, in the words the order ticket shows; unknown codes are shown as they are. */
  static String rationale(String rationale) {
    return RATIONALES.getOrDefault(rationale, rationale);
  }

  /** The side of the quote a market order trades against: buys pay the ask, sells receive the bid. */
  static String bestPriceFor(String side) {
    return "BUY".equals(side) ? "meilleur prix vendeur" : "meilleur prix acheteur";
  }

  private static boolean weekly(String stepLabel) {
    return "week".equals(stepLabel);
  }

  /** "Passage au jour 3 sur 5." / "Passage à la semaine 3 sur 5." */
  static String movedTo(String stepLabel, int step, int steps) {
    return (weekly(stepLabel) ? "Passage à la semaine " : "Passage au jour ") + step + " sur " + steps + ".";
  }

  /** "Dernier jour atteint" / "Dernière semaine atteinte". */
  static String lastStepReached(String stepLabel) {
    return weekly(stepLabel) ? "Dernière semaine atteinte" : "Dernier jour atteint";
  }

  /** "au dernier jour" / "à la dernière semaine". */
  static String toLastStep(String stepLabel) {
    return weekly(stepLabel) ? "à la dernière semaine" : "au dernier jour";
  }
}
