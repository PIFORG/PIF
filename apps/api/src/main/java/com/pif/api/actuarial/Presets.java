package com.pif.api.actuarial;

import java.util.List;

/** Fictional teaching portfolios of apps/api/src/actuarial/models/presets.ts; none is calibrated on real insurer data. */
final class Presets {

  /** Version stamped on every saved scenario so results can be traced to the formulas that produced them. */
  static final String MODEL_VERSION = "pif-actuarial-1.0.0";
  static final String CURRENCY = "TND";

  private Presets() {}

  record Preset(String id, String name, String description, String provenance, Pricing.Assumptions assumptions) {}

  static final List<Preset> ALL = List.of(
      new Preset("reference-deterministic", "Portefeuille de référence (coût déterministe)",
          "1 000 polices, probabilité annuelle de sinistre 5 %, chaque sinistre coûte 1 200 TND, frais fixes 20 000 TND, "
              + "chargement valeur espérée 15 %. Sinistres attendus 60 000 ; chargement 9 000 ; prime 89 000 (89 par police).",
          "FICTIONAL",
          new Pricing.Assumptions(new Frequency.Assumptions("BINOMIAL", 1000.0, 1.0, 0.05, null),
              new Severity.Assumptions("DETERMINISTIC", 1200.0, null), 0.0, 0.0, 20_000.0, 0.0, 0.0, 0.0,
              "EXPECTED_VALUE", 0.15)),
      new Preset("motor-gamma", "Auto dommages (coût gamma)",
          "5 000 véhicules, 0,08 sinistre par véhicule-an, coût gamma de moyenne 1 800 TND et CV 0,9, inflation sinistres 4 %, "
              + "commissions et taxes 15 % de la prime, marge bénéficiaire 5 %.",
          "FICTIONAL",
          new Pricing.Assumptions(new Frequency.Assumptions("POISSON", 5000.0, 1.0, null, 0.08),
              new Severity.Assumptions("GAMMA", 1800.0, 0.9), 0.04, 1.0, 60_000.0, 12.0, 0.15, 0.05,
              "STANDARD_DEVIATION", 0.5)),
      new Preset("home-lognormal", "Habitation incendie et dégâts des eaux (coût lognormal)",
          "8 000 foyers, 0,03 sinistre par foyer-an, coût lognormal à queue épaisse (moyenne 4 500 TND, CV 2,5), "
              + "inflation sinistres 3 %, frais variables 20 %, marge bénéficiaire 5 %.",
          "FICTIONAL",
          new Pricing.Assumptions(new Frequency.Assumptions("POISSON", 8000.0, 1.0, null, 0.03),
              new Severity.Assumptions("LOGNORMAL", 4500.0, 2.5), 0.03, 1.0, 80_000.0, 8.0, 0.2, 0.05,
              "STANDARD_DEVIATION", 1.0)));
}
