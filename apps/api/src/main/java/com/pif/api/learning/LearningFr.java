package com.pif.api.learning;

import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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

  /**
   * Replaces {@code {0}}, {@code {1}}… in the overlay text. Unlike {@link MessageFormat}, apostrophes are ordinary
   * characters here: French text is full of them ("l'ordre"), and MessageFormat would silently drop them together
   * with the placeholder that follows.
   */
  public static String format(String key, String fallback, Object... args) {
    return fill(get(key, fallback), args);
  }

  static String fill(String template, Object... args) {
    String out = template;
    for (int i = 0; i < args.length; i++) out = out.replace("{" + i + "}", String.valueOf(args[i]));
    return out;
  }

  /** French number text: non-breaking space between thousands, decimal comma, at most two decimals. */
  public static String number(double value) {
    DecimalFormatSymbols symbols = new DecimalFormatSymbols(Locale.FRENCH);
    symbols.setGroupingSeparator(' ');
    symbols.setDecimalSeparator(',');
    DecimalFormat format = new DecimalFormat("#,##0.##", symbols);
    format.setRoundingMode(RoundingMode.HALF_UP);
    return format.format(value);
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

  /**
   * French caption of a story scene. {@code values} are the amounts the scene computes (StoryCatalog.captionValues);
   * they fill the caption's placeholders as French numbers, so the story never shows a raw "{0}".
   */
  public static String sceneCaption(String storySlug, String sceneId, String fallback, List<Double> values) {
    Object[] args = values.stream().map(LearningFr::number).toArray();
    return fill(get("story.scene." + storySlug + "." + sceneId, fallback), args);
  }

  /**
   * French copy of a scene's visual: chart and outcome labels, headline text and lesson points are translated when
   * the overlay has them; numbers, series and types are left untouched.
   */
  public static Map<String, Object> sceneVisual(String storySlug, String sceneId, Map<String, Object> visual) {
    String base = "story.visual." + storySlug + "." + sceneId + ".";
    Map<String, Object> out = new LinkedHashMap<>(visual);
    for (String field : List.of("label", "text")) {
      if (out.get(field) instanceof String original) out.put(field, get(base + field, original));
    }
    if (out.get("points") instanceof List<?> points) {
      List<Object> translated = new ArrayList<>();
      for (int i = 0; i < points.size(); i++) {
        Object point = points.get(i);
        translated.add(point instanceof String original ? get(base + "point." + i, original) : point);
      }
      out.put("points", translated);
    }
    return out;
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
