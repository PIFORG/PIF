package com.pif.api.actuarial;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Capital économique pédagogique à partir d'une distribution de pertes agrégées.
 * Convention : capital = VaR_α(S) − E[S], borné à zéro (pas de capital négatif).
 * Ce n'est pas une exigence réglementaire Solvabilité II / CIMA.
 */
public final class EconomicCapital {

  public static final String VERSION = "economic-capital-v1";

  public record Input(
      Frequency.Assumptions frequency,
      Severity.Assumptions severity,
      double confidenceLevel,
      double horizonYears,
      String label) {}

  public record Sensitivity(String parameter, double baseValue, double shockedValue, double capitalDelta) {}

  public record Result(
      String modelVersion,
      String convention,
      String currency,
      String label,
      double confidenceLevel,
      double horizonYears,
      double expectedLoss,
      double valueAtRisk,
      double tailValueAtRisk,
      double economicCapital,
      double capitalRatio,
      List<Sensitivity> sensitivities,
      Map<String, Object> aggregateSummary) {}

  private EconomicCapital() {}

  public static Result compute(Input input) {
    return compute(input, true);
  }

  private static Result compute(Input input, boolean withSensitivities) {
    if (!(input.confidenceLevel() > 0.5 && input.confidenceLevel() < 1.0)) {
      throw new AssumptionException("le niveau de confiance doit être dans (0,5 ; 1)");
    }
    if (!(input.horizonYears() > 0 && input.horizonYears() <= 10)) {
      throw new AssumptionException("l'horizon doit être dans (0 ; 10] années");
    }
    Frequency.Model freq = Frequency.model(input.frequency());
    Severity.Model sev = Severity.model(input.severity());
    Aggregate.Moments moments = Aggregate.moments(freq, sev);
    Aggregate.Distribution dist = Aggregate.distribution(freq, sev);
    if (!dist.available()) {
      throw new AssumptionException(
          "distribution agrégée indisponible : " + (dist.reason() == null ? "raison inconnue" : dist.reason()));
    }
    Double var1 = Aggregate.quantile(dist.lattice(), input.confidenceLevel());
    Double tvar1 = Aggregate.tvar(dist.lattice(), input.confidenceLevel());
    if (var1 == null) {
      throw new AssumptionException("VaR indisponible pour cette distribution (masse insuffisante sur le réseau)");
    }
    double mean = money(moments.mean() * input.horizonYears());
    double var = money(var1 * input.horizonYears());
    double tvar = money((tvar1 == null ? var1 : tvar1) * input.horizonYears());
    double capital = Math.max(0, money(var - mean));
    double ratio = mean == 0 ? 0 : money(capital / mean);

    List<Sensitivity> sens = new ArrayList<>();
    if (withSensitivities) {
      sens.add(shockSeverityMean(input, capital));
      sens.add(shockFrequency(input, capital));
      sens.add(shockConfidence(input, capital));
    }

    Map<String, Object> summary = new LinkedHashMap<>();
    summary.put("method", dist.lattice().method());
    summary.put("meanOneYear", money(moments.mean()));
    summary.put("sdOneYear", money(moments.sd()));
    summary.put("capturedMass", dist.lattice().capturedMass());

    return new Result(
        VERSION,
        "VaR(α) − E[S], borné à 0 ; horizon appliqué linéairement (approximation pédagogique).",
        Presets.CURRENCY,
        input.label() == null || input.label().isBlank() ? "Scénario capital" : input.label().trim(),
        input.confidenceLevel(),
        input.horizonYears(),
        mean,
        var,
        tvar,
        capital,
        ratio,
        sens,
        summary);
  }

  public static Map<String, Object> toJson(Result r) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("modelVersion", r.modelVersion());
    m.put("convention", r.convention());
    m.put("currency", r.currency());
    m.put("label", r.label());
    m.put("confidenceLevel", r.confidenceLevel());
    m.put("horizonYears", r.horizonYears());
    m.put("expectedLoss", r.expectedLoss());
    m.put("valueAtRisk", r.valueAtRisk());
    m.put("tailValueAtRisk", r.tailValueAtRisk());
    m.put("economicCapital", r.economicCapital());
    m.put("capitalToExpectedLoss", r.capitalRatio());
    m.put(
        "disclaimer",
        "Capital de risque pédagogique. Ne constitue pas une exigence réglementaire ni un reporting Solvabilité.");
    List<Map<String, Object>> sens = new ArrayList<>();
    for (Sensitivity s : r.sensitivities()) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("parameter", s.parameter());
      row.put("baseValue", s.baseValue());
      row.put("shockedValue", s.shockedValue());
      row.put("capitalDelta", s.capitalDelta());
      sens.add(row);
    }
    m.put("sensitivities", sens);
    m.put("aggregate", r.aggregateSummary());
    return m;
  }

  private static double money(double v) {
    return Math.round(v * 1000.0) / 1000.0;
  }

  private static Sensitivity shockSeverityMean(Input base, double capital0) {
    Severity.Assumptions sev = base.severity();
    double shockedMean = sev.mean() * 1.1;
    Severity.Assumptions shocked = new Severity.Assumptions(sev.family(), shockedMean, sev.cv());
    double capital1 =
        compute(new Input(base.frequency(), shocked, base.confidenceLevel(), base.horizonYears(), base.label()), false)
            .economicCapital();
    return new Sensitivity("severity.mean", sev.mean(), shockedMean, money(capital1 - capital0));
  }

  private static Sensitivity shockFrequency(Input base, double capital0) {
    Frequency.Assumptions f = base.frequency();
    Frequency.Assumptions shocked;
    double baseParam;
    double shockedParam;
    if ("POISSON".equals(f.family())) {
      baseParam = f.intensity() == null ? 0 : f.intensity();
      shockedParam = baseParam * 1.1;
      shocked = new Frequency.Assumptions(f.family(), f.policies(), f.years(), f.probability(), shockedParam);
    } else {
      baseParam = f.probability() == null ? 0 : f.probability();
      shockedParam = Math.min(0.999, baseParam * 1.1);
      shocked = new Frequency.Assumptions(f.family(), f.policies(), f.years(), shockedParam, f.intensity());
    }
    double capital1 =
        compute(new Input(shocked, base.severity(), base.confidenceLevel(), base.horizonYears(), base.label()), false)
            .economicCapital();
    return new Sensitivity("frequency", baseParam, shockedParam, money(capital1 - capital0));
  }

  private static Sensitivity shockConfidence(Input base, double capital0) {
    double shockedLevel = Math.min(0.999, base.confidenceLevel() + 0.005);
    double capital1 =
        compute(new Input(base.frequency(), base.severity(), shockedLevel, base.horizonYears(), base.label()), false)
            .economicCapital();
    return new Sensitivity("confidenceLevel", base.confidenceLevel(), shockedLevel, money(capital1 - capital0));
  }
}
