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
      new Preset("reference-deterministic", "Reference portfolio (deterministic cost)",
          "1,000 policies, 5% annual claim probability, every claim costs 1,200 TND, 20,000 TND fixed expenses, 15% "
              + "expected-value loading. Expected claims 60,000; loading 9,000; premium 89,000 (89 per policy).",
          "FICTIONAL",
          new Pricing.Assumptions(new Frequency.Assumptions("BINOMIAL", 1000.0, 1.0, 0.05, null),
              new Severity.Assumptions("DETERMINISTIC", 1200.0, null), 0.0, 0.0, 20_000.0, 0.0, 0.0, 0.0,
              "EXPECTED_VALUE", 0.15)),
      new Preset("motor-gamma", "Motor own-damage book (gamma cost)",
          "5,000 vehicles, 0.08 claims per vehicle-year, gamma claim cost with mean 1,800 TND and CV 0.9, 4% claim "
              + "inflation, commissions and taxes 15% of premium, 5% profit margin.",
          "FICTIONAL",
          new Pricing.Assumptions(new Frequency.Assumptions("POISSON", 5000.0, 1.0, null, 0.08),
              new Severity.Assumptions("GAMMA", 1800.0, 0.9), 0.04, 1.0, 60_000.0, 12.0, 0.15, 0.05,
              "STANDARD_DEVIATION", 0.5)),
      new Preset("home-lognormal", "Home fire and water damage (lognormal cost)",
          "8,000 homes, 0.03 claims per home-year, heavy-tailed lognormal claim cost with mean 4,500 TND and CV 2.5, "
              + "3% claim inflation, 20% variable expenses, 5% profit margin.",
          "FICTIONAL",
          new Pricing.Assumptions(new Frequency.Assumptions("POISSON", 8000.0, 1.0, null, 0.03),
              new Severity.Assumptions("LOGNORMAL", 4500.0, 2.5), 0.03, 1.0, 80_000.0, 8.0, 0.2, 0.05,
              "STANDARD_DEVIATION", 1.0)));
}
