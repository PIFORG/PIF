package com.pif.api.ai;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Rule-based French financial sentiment on synthetic headlines (educational, not a live news feed). */
final class SentimentLexicon {

  private static final Map<String, Double> WEIGHTS = Map.ofEntries(
      Map.entry("hausse", 0.8),
      Map.entry("rebond", 0.7),
      Map.entry("croissance", 0.6),
      Map.entry("bénéfice", 0.5),
      Map.entry("dividende", 0.4),
      Map.entry("optimisme", 0.6),
      Map.entry("record", 0.5),
      Map.entry("baisse", -0.8),
      Map.entry("krach", -1.0),
      Map.entry("récession", -0.9),
      Map.entry("perte", -0.6),
      Map.entry("défaut", -0.7),
      Map.entry("inquiétude", -0.5),
      Map.entry("volatilité", -0.3),
      Map.entry("inflation", -0.4));

  /** Deterministic synthetic French headlines for the lab (not scraped live news). */
  static final List<String> SYNTHETIC_HEADLINES = List.of(
      "Hausse des bénéfices bancaires et dividende en hausse sur le marché simulé",
      "Inquiétude croissante face à l'inflation et à la volatilité des indices fictifs",
      "Rebond technique après une baisse marquée des valeurs industrielles simulées",
      "Risque de récession : les analystes fictifs signalent un défaut sectoriel possible",
      "Croissance du crédit et optimisme mesuré sur les matières premières du simulateur",
      "Pertes importantes annoncées dans un scénario de krach actions pédagogique",
      "Record de volumes sur le titre fictif CTB après publication de résultats",
      "Volatilité accrue des obligations fictives après rumeur de hausse des taux");

  private SentimentLexicon() {}

  record Score(String headline, double score, String label, List<String> tokens) {}

  static Score score(String headline) {
    String lower = headline.toLowerCase(Locale.ROOT);
    double s = 0;
    List<String> hit = new java.util.ArrayList<>();
    for (var e : WEIGHTS.entrySet()) {
      if (lower.contains(e.getKey())) {
        s += e.getValue();
        hit.add(e.getKey());
      }
    }
    double clamped = Math.max(-1, Math.min(1, s / Math.max(1, hit.size())));
    String label = clamped > 0.15 ? "POSITIF" : clamped < -0.15 ? "NEGATIF" : "NEUTRE";
    return new Score(headline, clamped, label, hit);
  }

  static Map<String, Object> asMap(Score score) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("headline", score.headline());
    m.put("score", round4(score.score()));
    m.put("label", score.label());
    m.put("tokens", score.tokens());
    m.put("source", "SYNTHETIC_LEXICON");
    m.put("note", "Titre synthétique pédagogique — ce n'est pas une actualité de marché réelle.");
    return m;
  }

  private static double round4(double v) {
    return Math.round(v * 10_000.0) / 10_000.0;
  }
}
