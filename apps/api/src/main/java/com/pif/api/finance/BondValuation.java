package com.pif.api.finance;

/**
 * Valorisation notionnelle d'une obligation à coupon fixe (prix sale approximé par
 * actualisation des flux, sans modèle de courbe complète — usage pédagogique / marché fictif).
 */
public final class BondValuation {

  public record BondTerms(
      double faceValue,
      double annualCouponRate,
      int couponsPerYear,
      int yearsToMaturity,
      double yieldToMaturity) {}

  public record BondQuote(
      double cleanPrice,
      double accruedInterest,
      double dirtyPrice,
      double macaulayDurationYears,
      double modifiedDuration,
      double nextCoupon) {}

  private BondValuation() {}

  /**
   * Prix théorique juste après un coupon (intérêts courus nuls) sauf {@code yearFractionSinceLastCoupon}
   * dans {@code [0, 1/couponsPerYear)}.
   */
  public static BondQuote value(BondTerms terms, double yearFractionSinceLastCoupon) {
    if (terms.faceValue() <= 0 || terms.couponsPerYear() < 1 || terms.yearsToMaturity() < 1) {
      throw new IllegalArgumentException("Paramètres d'obligation invalides.");
    }
    int n = terms.yearsToMaturity() * terms.couponsPerYear();
    double c = terms.faceValue() * terms.annualCouponRate() / terms.couponsPerYear();
    double y = terms.yieldToMaturity() / terms.couponsPerYear();
    double pv = 0;
    double weighted = 0;
    for (int k = 1; k <= n; k++) {
      double df = 1.0 / Math.pow(1.0 + y, k);
      double cash = c + (k == n ? terms.faceValue() : 0);
      pv += cash * df;
      weighted += (k / (double) terms.couponsPerYear()) * cash * df;
    }
    double period = 1.0 / terms.couponsPerYear();
    double frac = Math.max(0, Math.min(period, yearFractionSinceLastCoupon));
    double accrued = c * (frac / period);
    // Prix en unités monétaires décimales (comme les mids marché), pas en millimes.
    double clean = roundPrice(pv);
    double dirty = roundPrice(clean + accrued);
    double mac = pv == 0 ? 0 : weighted / pv;
    double mod = y == -1 ? 0 : mac / (1.0 + y);
    return new BondQuote(clean, roundPrice(accrued), dirty, roundPrice(mac), roundPrice(mod), roundPrice(c));
  }

  private static double roundPrice(double value) {
    return Money.fromAmount(Money.toAmount(value));
  }

  /** Convention pédagogique TNDB : nominal 100, coupon 5 %, annuel, 10 ans, rendement 5,2 %. */
  public static BondTerms tndbDefault() {
    return new BondTerms(100.0, 0.05, 1, 10, 0.052);
  }
}
