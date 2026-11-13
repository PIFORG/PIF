package com.pif.api.stress;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The eight macro-financial risk factors of a stress scenario, over a one-year horizon. Each factor has a neutral
 * value (no shock); a scenario is the vector of stressed values. Units are the ones a user types:
 * basis points for rates, percentage changes for prices and revenues, percentage points for unemployment and GDP,
 * plain multipliers for default and run-off intensity.
 */
public record StressFactors(double rateShockBps, double equityShockPct, double unemploymentShockPp,
    double gdpShockPp, double propertyShockPct, double revenueShockPct, double defaultMultiplier,
    double runoffMultiplier) {

  /** One factor: identifier, French label, unit, neutral value and accepted range. */
  public record Definition(String key, String label, String unit, double neutral, double min, double max,
      String description) {}

  public static final List<Definition> DEFINITIONS = List.of(
      new Definition("rateShockBps", "Choc de taux d'intérêt", "pb", 0, -300, 800,
          "Variation parallèle des taux de marché et du taux directeur, en points de base."),
      new Definition("equityShockPct", "Variation des marchés actions", "%", 0, -80, 20,
          "Variation de valeur des actions détenues ; une valeur négative est une baisse."),
      new Definition("unemploymentShockPp", "Hausse du chômage", "pp", 0, -3, 15,
          "Variation du taux de chômage en points de pourcentage."),
      new Definition("gdpShockPp", "Croissance du PIB", "pp", 0, -15, 5,
          "Écart de croissance du PIB réel par rapport au scénario central ; négatif = récession."),
      new Definition("propertyShockPct", "Prix de l'immobilier", "%", 0, -70, 20,
          "Variation des prix immobiliers ; une baisse réduit la valeur des garanties."),
      new Definition("revenueShockPct", "Revenus de commissions", "%", 0, -80, 20,
          "Variation des commissions et autres revenus hors marge."),
      new Definition("defaultMultiplier", "Hausse directe des défauts", "×", 1, 0.5, 5,
          "Multiplicateur appliqué aux probabilités de défaut après l'effet macroéconomique."),
      new Definition("runoffMultiplier", "Intensité du choc de liquidité", "×", 1, 0.5, 5,
          "Multiplicateur des taux de retrait des dépôts et financements sur 30 jours."));

  public static final StressFactors NEUTRAL = new StressFactors(0, 0, 0, 0, 0, 0, 1, 1);

  /** A named preset scenario. */
  public record Preset(String id, String name, String description, StressFactors factors) {}

  public static final List<Preset> PRESETS = List.of(
      new Preset("baseline", "Scénario central", "Aucun choc : projection à un an des résultats courants.", NEUTRAL),
      new Preset("rate-shock", "Choc de taux", "Hausse brutale de 300 pb des taux de marché.",
          new StressFactors(300, 0, 0, 0, 0, 0, 1, 1)),
      new Preset("market-crash", "Krach boursier", "Les actions perdent 35 % ; les commissions reculent de 10 %.",
          new StressFactors(0, -35, 0, 0, 0, -10, 1, 1)),
      new Preset("recession", "Récession économique",
          "PIB −4 pp, chômage +3 pp, immobilier −10 %, commissions −15 %.",
          new StressFactors(0, -10, 3, -4, -10, -15, 1.2, 1)),
      new Preset("default-wave", "Hausse des défauts", "Défauts des emprunteurs doublés, chômage +1 pp.",
          new StressFactors(0, 0, 1, 0, 0, 0, 2, 1)),
      new Preset("asset-quality", "Dégradation des actifs",
          "Immobilier −30 % (garanties dévalorisées) et défauts ×1,5.",
          new StressFactors(0, 0, 0, 0, -30, 0, 1.5, 1)),
      new Preset("revenue-drop", "Baisse des revenus", "Commissions et revenus hors marge −40 %.",
          new StressFactors(0, 0, 0, 0, 0, -40, 1, 1)),
      new Preset("liquidity-run", "Choc de liquidité", "Retraits de dépôts ×2,5 et actions −10 %.",
          new StressFactors(0, -10, 0, 0, 0, 0, 1, 2.5)),
      new Preset("combined-severe", "Scénario combiné sévère",
          "Taux +250 pb, actions −40 %, chômage +4 pp, PIB −5 pp, immobilier −25 %, commissions −25 %, "
              + "défauts ×1,5, retraits ×2.",
          new StressFactors(250, -40, 4, -5, -25, -25, 1.5, 2)));

  public static Preset preset(String id) {
    for (Preset p : PRESETS) if (p.id().equals(id)) return p;
    return null;
  }

  public double get(int index) {
    return switch (index) {
      case 0 -> rateShockBps;
      case 1 -> equityShockPct;
      case 2 -> unemploymentShockPp;
      case 3 -> gdpShockPp;
      case 4 -> propertyShockPct;
      case 5 -> revenueShockPct;
      case 6 -> defaultMultiplier;
      case 7 -> runoffMultiplier;
      default -> throw new IndexOutOfBoundsException(index);
    };
  }

  static StressFactors of(double[] v) {
    return new StressFactors(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
  }

  double[] toArray() {
    double[] v = new double[DEFINITIONS.size()];
    for (int i = 0; i < v.length; i++) v[i] = get(i);
    return v;
  }

  /** Every shock scaled by {@code intensity} around its neutral value (0 = no shock, 1 = as defined). */
  public StressFactors scaled(double intensity) {
    double[] v = toArray();
    for (int i = 0; i < v.length; i++) {
      Definition d = DEFINITIONS.get(i);
      v[i] = Math.max(d.min(), Math.min(d.max(), d.neutral() + intensity * (v[i] - d.neutral())));
    }
    return of(v);
  }

  /** Factors in {@code mask} take this scenario's value; the others stay neutral. */
  StressFactors only(int mask) {
    double[] v = toArray();
    for (int i = 0; i < v.length; i++) if ((mask & (1 << i)) == 0) v[i] = DEFINITIONS.get(i).neutral();
    return of(v);
  }

  public Map<String, Object> toJson() {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i < DEFINITIONS.size(); i++) out.put(DEFINITIONS.get(i).key(), get(i));
    return out;
  }
}
