package com.pif.api.learning;

import java.text.MessageFormat;
import java.util.Locale;
import java.util.MissingResourceException;
import java.util.ResourceBundle;

/** French display overlay for missions/stories. Stable slugs/IDs unchanged; English catalog remains the source of truth for engine logic. */
public final class LearningFr {

  private static final ResourceBundle BUNDLE =
      ResourceBundle.getBundle("learning_fr", Locale.FRENCH);

  private LearningFr() {}

  public static String get(String key, String fallback) {
    try {
      return BUNDLE.getString(key);
    } catch (MissingResourceException e) {
      return fallback;
    }
  }

  public static String format(String key, String fallback, Object... args) {
    return MessageFormat.format(get(key, fallback), args);
  }

  public static String missionTitle(String slug, String fallback) {
    return get("mission." + slug + ".title", fallback);
  }

  public static String missionSummary(String slug, String fallback) {
    return get("mission." + slug + ".summary", fallback);
  }

  public static String missionBriefingContext(String slug, String fallback) {
    return get("mission." + slug + ".briefing.context", fallback);
  }

  public static String storyTitle(String slug, String fallback) {
    return get("story." + slug + ".title", fallback);
  }

  public static String storySummary(String slug, String fallback) {
    return get("story." + slug + ".summary", fallback);
  }

  public static String sceneCaption(String storySlug, String sceneId, String fallback) {
    return get("story.scene." + storySlug + "." + sceneId, fallback);
  }

  public static String provenance(String fallback) {
    return get("provenance", fallback);
  }

  public static String stressName(String id, String fallback) {
    return get("stress." + id + ".name", fallback);
  }

  public static String stressDescription(String id, String fallback) {
    return get("stress." + id + ".description", fallback);
  }

  public static String sectorLabel(String sector) {
    return com.pif.api.market.MarketDisplay.sectorLabel(sector);
  }

  public static String strategyLabel(String strategy) {
    if (strategy == null) return null;
    return switch (strategy) {
      case "HOLD" -> get("strategy.hold", "Conserver sans trader");
      case "MANUAL" -> get("strategy.manual", "Reprendre la main");
      default -> strategy;
    };
  }

  public static String timemachineCompareNote() {
    return get("timemachine.compare.note",
        "Les rejouages utilisent exactement le même chemin de marché. Ce sont des exercices contrefactuels avec "
            + "rétrospection : ils ne modifient jamais votre profil de compétences.");
  }

  public static String profileCalibrationNote(int minimumOrders) {
    return format("profile.calibration.note",
        "Rétrospectif et hors score. Chaque ordre noté est comparé au marché à poids égaux de la mission "
            + "depuis l'exécution jusqu'à la fin. En dessous de " + minimumOrders
            + " ordres, le signal est surtout du bruit ; un résultat défavorable seul n'est pas une preuve de surconfiance.",
        minimumOrders);
  }
}
