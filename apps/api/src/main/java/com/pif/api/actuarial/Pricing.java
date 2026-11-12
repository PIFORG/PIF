package com.pif.api.actuarial;

import static com.pif.api.actuarial.Frequency.num;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Premium build-up for one portfolio and one cover period (apps/api/src/actuarial/models/pricing.ts), all amounts in
 * the portfolio currency:
 *
 * <pre>
 *   pure premium           E[S] = E[N]·E[X]           (claim costs inflated by (1 + i)^years)
 *   risk (safety) loading  RL = θ·E[S]  (expected-value principle)  or  k·sd(S)  (standard-deviation principle)
 *   fixed expenses         F = fixed + perPolicy·n
 *   technical premium      P_T = E[S] + RL + F
 *   gross (commercial)     P_G = P_T / (1 − v − m)
 * </pre>
 *
 * v (variable expenses: commissions, premium taxes) and m (profit margin) are shares of the gross premium itself, which
 * is why the equation is solved rather than loaded additively. Expected underwriting result = P_G − E[S] − F − v·P_G =
 * RL + m·P_G. Investment income, reinsurance and the cost of capital are out of scope for this model.
 */
final class Pricing {

  static final List<String> RISK_LOADING_METHODS = List.of("NONE", "EXPECTED_VALUE", "STANDARD_DEVIATION");

  private Pricing() {}

  /** Pricing assumptions; a null number or string is a field the request left undefined. */
  record Assumptions(Frequency.Assumptions frequency, Severity.Assumptions severity, Double annualRate,
      Double inflationYears, Double fixed, Double perPolicy, Double variableRate, Double profitMarginRate,
      String riskLoadingMethod, Double riskLoadingParameter) {

    /** The object the TypeScript service stores and echoes: undefined fields are left out, as JSON.stringify does. */
    Map<String, Object> toJson() {
      Map<String, Object> frequencyJson = new LinkedHashMap<>();
      putDefined(frequencyJson, "family", frequency.family());
      putDefined(frequencyJson, "policies", frequency.policies());
      putDefined(frequencyJson, "years", frequency.years());
      if ("BINOMIAL".equals(frequency.family())) putDefined(frequencyJson, "probability", frequency.probability());
      else putDefined(frequencyJson, "intensity", frequency.intensity());
      Map<String, Object> severityJson = new LinkedHashMap<>();
      putDefined(severityJson, "family", severity.family());
      putDefined(severityJson, "mean", severity.mean());
      if (!"DETERMINISTIC".equals(severity.family())) putDefined(severityJson, "cv", severity.cv());
      Map<String, Object> inflation = new LinkedHashMap<>();
      putDefined(inflation, "annualRate", annualRate);
      putDefined(inflation, "years", inflationYears);
      Map<String, Object> expenses = new LinkedHashMap<>();
      putDefined(expenses, "fixed", fixed);
      putDefined(expenses, "perPolicy", perPolicy);
      putDefined(expenses, "variableRate", variableRate);
      Map<String, Object> riskLoading = new LinkedHashMap<>();
      putDefined(riskLoading, "method", riskLoadingMethod);
      putDefined(riskLoading, "parameter", riskLoadingParameter);
      Map<String, Object> json = new LinkedHashMap<>();
      json.put("frequency", frequencyJson);
      json.put("severity", severityJson);
      json.put("inflation", inflation);
      json.put("expenses", expenses);
      putDefined(json, "profitMarginRate", profitMarginRate);
      json.put("riskLoading", riskLoading);
      return json;
    }

    private static void putDefined(Map<String, Object> map, String key, Object value) {
      if (value != null) map.put(key, value);
    }
  }

  record Ratios(double loss, double expense, double combined) {}

  /** claimsBudget is the premium left for claims after all expenses: P_G − F − v·P_G. */
  record PremiumBreakdown(double expectedClaims, double riskLoading, double fixedExpenses, double technicalPremium,
      double grossPremium, double variableExpenses, double profitMargin, double expectedUnderwritingResult,
      double claimsBudget, Ratios ratios) {}

  static PremiumBreakdown premiumBreakdown(Assumptions input, double policies, Aggregate.Moments moments) {
    double fixed = num(input.fixed());
    double perPolicy = num(input.perPolicy());
    double v = num(input.variableRate());
    double m = num(input.profitMarginRate());
    double parameter = num(input.riskLoadingParameter());
    String method = input.riskLoadingMethod();
    if (fixed < 0 || perPolicy < 0) throw new AssumptionException("expenses cannot be negative");
    if (v < 0 || m < 0 || v + m >= 1) {
      throw new AssumptionException("variable expense rate plus profit margin must be at least 0 and below 100%");
    }
    if (parameter < 0) throw new AssumptionException("risk loading parameter cannot be negative");
    if ("EXPECTED_VALUE".equals(method) && parameter > 1) {
      throw new AssumptionException("the expected-value loading θ must be at most 1 (100% of expected claims)");
    }

    double expectedClaims = moments.mean();
    double riskLoading = "EXPECTED_VALUE".equals(method) ? parameter * moments.mean()
        : "STANDARD_DEVIATION".equals(method) ? parameter * moments.sd() : 0;
    double fixedExpenses = fixed + perPolicy * policies;
    double technicalPremium = expectedClaims + riskLoading + fixedExpenses;
    double grossPremium = technicalPremium / (1 - v - m);
    double variableExpenses = v * grossPremium;
    double profitMargin = m * grossPremium;
    double expectedUnderwritingResult = grossPremium - expectedClaims - fixedExpenses - variableExpenses;
    return new PremiumBreakdown(expectedClaims, riskLoading, fixedExpenses, technicalPremium, grossPremium,
        variableExpenses, profitMargin, expectedUnderwritingResult, grossPremium - fixedExpenses - variableExpenses,
        new Ratios(ratio(expectedClaims, grossPremium), ratio(fixedExpenses + variableExpenses, grossPremium),
            ratio(expectedClaims + fixedExpenses + variableExpenses, grossPremium)));
  }

  private static double ratio(double x, double grossPremium) {
    return grossPremium > 0 ? x / grossPremium : 0;
  }

  /**
   * probabilityOfUnderwritingLoss = P(S > claims budget), the probability that the period closes with an underwriting
   * loss; probabilityClaimsExceedPremium = P(S > gross premium).
   */
  record Model(double trend, Frequency.Model frequency, Severity.Model severity, Aggregate.Moments moments,
      PremiumBreakdown premium, Aggregate.Distribution distribution, Double probabilityOfUnderwritingLoss,
      Double probabilityClaimsExceedPremium) {}

  static Model build(Assumptions input, boolean withDistribution) {
    double trend = Severity.trendFactor(num(input.annualRate()), num(input.inflationYears()));
    Frequency.Model frequency = Frequency.model(input.frequency());
    Severity.Model severity = Severity.model(new Severity.Assumptions(input.severity().family(),
        num(input.severity().mean()) * trend, input.severity().cv()));
    Aggregate.Moments moments = Aggregate.moments(frequency, severity);
    PremiumBreakdown premium = premiumBreakdown(input, frequency.policies, moments);
    Aggregate.Distribution distribution = withDistribution ? Aggregate.distribution(frequency, severity)
        : new Aggregate.Distribution(null, "Not requested.");
    return new Model(trend, frequency, severity, moments, premium, distribution,
        exceed(distribution, premium.claimsBudget()), exceed(distribution, premium.grossPremium()));
  }

  private static Double exceed(Aggregate.Distribution distribution, double threshold) {
    return distribution.available() ? Aggregate.exceedance(distribution.lattice(), threshold) : null;
  }

  record Driver(String id, String label) {}

  static final List<Driver> SENSITIVITY_DRIVERS = List.of(
      new Driver("frequency", "Claim frequency +10%"),
      new Driver("severity", "Average claim cost +10%"),
      new Driver("expenses", "Fixed and per-policy expenses +10%"),
      new Driver("variable", "Variable expense rate +1 point"),
      new Driver("loading", "Risk loading parameter +10%"));

  static Assumptions shock(Assumptions input, String driver) {
    Frequency.Assumptions f = input.frequency();
    Severity.Assumptions s = input.severity();
    return switch (driver) {
      case "frequency" -> {
        Frequency.Assumptions next = "BINOMIAL".equals(f.family())
            ? new Frequency.Assumptions(f.family(), f.policies(), f.years(),
                Math.min(0.999999, (f.probability() == null ? 0 : f.probability()) * 1.1), f.intensity())
            : new Frequency.Assumptions(f.family(), f.policies(), f.years(), f.probability(),
                (f.intensity() == null ? 0 : f.intensity()) * 1.1);
        yield new Assumptions(next, s, input.annualRate(), input.inflationYears(), input.fixed(), input.perPolicy(),
            input.variableRate(), input.profitMarginRate(), input.riskLoadingMethod(), input.riskLoadingParameter());
      }
      case "severity" -> new Assumptions(f, new Severity.Assumptions(s.family(), num(s.mean()) * 1.1, s.cv()),
          input.annualRate(), input.inflationYears(), input.fixed(), input.perPolicy(), input.variableRate(),
          input.profitMarginRate(), input.riskLoadingMethod(), input.riskLoadingParameter());
      case "expenses" -> new Assumptions(f, s, input.annualRate(), input.inflationYears(), num(input.fixed()) * 1.1,
          num(input.perPolicy()) * 1.1, input.variableRate(), input.profitMarginRate(), input.riskLoadingMethod(),
          input.riskLoadingParameter());
      case "variable" -> new Assumptions(f, s, input.annualRate(), input.inflationYears(), input.fixed(),
          input.perPolicy(), num(input.variableRate()) + 0.01, input.profitMarginRate(), input.riskLoadingMethod(),
          input.riskLoadingParameter());
      case "loading" -> new Assumptions(f, s, input.annualRate(), input.inflationYears(), input.fixed(),
          input.perPolicy(), input.variableRate(), input.profitMarginRate(), input.riskLoadingMethod(),
          num(input.riskLoadingParameter()) * 1.1);
      default -> throw new IllegalArgumentException(driver);
    };
  }

  /** resultAtBasePremium is the expected underwriting result if the shock happens but the base premium is kept. */
  record SensitivityLine(String driver, String label, double repricedGrossPremium, double premiumChange,
      double resultAtBasePremium) {}

  /** One-at-a-time sensitivities, computed from moments only. */
  static List<SensitivityLine> sensitivities(Assumptions input, PremiumBreakdown base) {
    List<SensitivityLine> lines = new ArrayList<>();
    for (Driver driver : SENSITIVITY_DRIVERS) {
      Assumptions assumptions = shock(input, driver.id());
      PremiumBreakdown p = build(assumptions, false).premium();
      double v = num(assumptions.variableRate());
      lines.add(new SensitivityLine(driver.id(), driver.label(), p.grossPremium(),
          p.grossPremium() / base.grossPremium() - 1,
          base.grossPremium() - p.expectedClaims() - p.fixedExpenses() - v * base.grossPremium()));
    }
    return lines;
  }
}
