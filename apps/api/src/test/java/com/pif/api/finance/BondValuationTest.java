package com.pif.api.finance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class BondValuationTest {

  @Test
  void tndbAtParNearYieldHasCleanNearFace() {
    BondValuation.BondQuote q = BondValuation.value(BondValuation.tndbDefault(), 0);
    assertTrue(q.cleanPrice() < 100.0, "yield > coupon => clean < face");
    assertTrue(q.cleanPrice() > 90.0);
    assertEquals(0.0, q.accruedInterest());
    assertEquals(q.cleanPrice(), q.dirtyPrice());
    assertEquals(5.0, q.nextCoupon());
    assertTrue(q.macaulayDurationYears() > 7.0 && q.macaulayDurationYears() < 10.0);
    assertTrue(q.modifiedDuration() > 0);
  }

  @Test
  void accruedInterestGrowsThroughCouponPeriod() {
    BondValuation.BondQuote mid = BondValuation.value(BondValuation.tndbDefault(), 0.5);
    assertTrue(mid.accruedInterest() > 2.0);
    assertTrue(mid.dirtyPrice() > mid.cleanPrice());
  }

  @Test
  void fxConversionUsesMoneyPrecision() {
    double eur = 100.0;
    double eurt = 3.35;
    double tnd = Money.fromAmount(Money.toAmount(eur * eurt));
    assertEquals(335.0, tnd);
  }
}
