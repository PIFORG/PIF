package com.pif.api.stress;

import com.pif.api.stress.BankProfile.CreditSegment;
import com.pif.api.stress.BankProfile.Liability;
import com.pif.api.stress.BankProfile.Participative;
import com.pif.api.stress.BankProfile.PlsSegment;
import com.pif.api.stress.BankProfile.Treasury;
import java.util.ArrayList;
import java.util.List;

/**
 * Deterministic one-year bank stress test. A pure function of (bank profile, scenario factors): no randomness, no
 * stored state, so a run is reproduced exactly from its inputs.
 *
 * <p>Steps: credit risk (macro satellite on PD, collateral effect on LGD, expected loss PD × LGD × EAD); market
 * revaluation (bonds by duration, equities by price change, both through equity); net margin income by repricing
 * gap; fees; participative-bank mechanisms (displaced commercial risk, loss sharing with investment accounts, alpha
 * on risk-weighted assets); projected capital, risk-weighted assets, leverage and 30-day liquidity coverage.
 */
public final class StressEngine {

  public static final String MODEL_VERSION = "pif-bank-stress-1.0.0";
  public static final double CET1_MINIMUM = 0.07;
  public static final double CET1_BUFFER = 0.025;
  public static final double LEVERAGE_MINIMUM = 0.03;
  public static final double LCR_MINIMUM = 1.0;
  static final double DEFAULTED_RISK_WEIGHT = 1.5;
  static final double INTERBANK_RISK_WEIGHT = 0.2;
  static final double EQUITY_RISK_WEIGHT = 2.5;
  static final double OPERATIONAL_RWA_FACTOR = 12.5 * 0.15;
  static final double LOAN_INFLOW_30D = 0.01;
  static final double INFLOW_CAP = 0.75;
  static final double MAX_PD = 0.999;

  private StressEngine() {}

  public record SegmentResult(String key, String label, double ead, double pdBase, double pdStressed,
      double lgdBase, double lgdStressed, double eclBase, double eclStressed, double residualValueLoss,
      double newlyDefaulted) {}

  public record PlsResult(String key, String label, double exposure, double lossRateBase, double lossRateStressed,
      double lossBase, double lossStressed) {}

  /** One component of the change in capital, M DT; negative reduces CET1. */
  public record Impact(String key, String label, double amount) {}

  public record Ratios(double cet1, double rwa, double cet1Ratio, double totalExposure, double leverageRatio,
      double hqla, double netOutflows, double lcr) {}

  public record Outcome(StressFactors factors, List<SegmentResult> credit, List<PlsResult> pls,
      double creditCost, double marginIncome, double feesAndOther, double dcrCost, double perUsed,
      double psiaPoolLoss, double irrUsed, double psiaAbsorbed, double preTaxIncome, double tax, double netIncome,
      double bondRevaluation, double equityRevaluation, List<Impact> impacts, Ratios ratios) {}

  static double logit(double p) {
    return Math.log(p / (1 - p));
  }

  static double logistic(double x) {
    return 1 / (1 + Math.exp(-x));
  }

  static double clamp(double v, double lo, double hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /** Stressed PD: logit-linear macro satellite, then the direct default multiplier, capped below 1. */
  static double stressedPd(CreditSegment s, StressFactors f) {
    double shift = s.unemploymentBeta() * f.unemploymentShockPp() + s.gdpBeta() * (-f.gdpShockPp())
        + s.rateBeta() * s.floatingShare() * (f.rateShockBps() / 100);
    return Math.min(MAX_PD, logistic(logit(s.pd()) + shift) * f.defaultMultiplier());
  }

  /** Stressed LGD: collateral loses value with property prices (rises in price do not lower LGD). */
  static double stressedLgd(CreditSegment s, StressFactors f) {
    double decline = Math.max(0, -f.propertyShockPct() / 100);
    return clamp(s.lgd() + s.collateralSensitivity() * decline, 0, 1);
  }

  static double plsLossRate(PlsSegment s, StressFactors f) {
    double equityDecline = Math.max(0, -f.equityShockPct() / 100);
    double gdpShortfall = Math.max(0, -f.gdpShockPp());
    double propertyDecline = Math.max(0, -f.propertyShockPct() / 100);
    return clamp(s.baseLossRate() + s.equityBeta() * equityDecline + s.gdpBeta() * gdpShortfall / 100
        + s.propertyBeta() * propertyDecline, 0, 1);
  }

  /** Rate-sensitive assets minus rate-sensitive liabilities repricing within the year (repricing gap). */
  static double repricingGap(BankProfile b) {
    Treasury t = b.treasury();
    double assets = t.cash() * t.cashRepricing() + t.interbank() + t.sovereignBonds() * t.bondRepricing();
    for (CreditSegment s : b.credit()) assets += s.ead() * s.floatingShare();
    double liabilities = 0;
    for (Liability l : b.liabilities()) liabilities += l.amount() * l.rateBeta();
    return assets - liabilities;
  }

  public static Outcome run(BankProfile b, StressFactors f) {
    Treasury t = b.treasury();
    Participative p = b.participative();
    double dr = f.rateShockBps() / 10_000;
    double revenueChange = f.revenueShockPct() / 100;
    double propertyDecline = Math.max(0, -f.propertyShockPct() / 100);

    // Credit risk.
    List<SegmentResult> credit = new ArrayList<>();
    double creditCost = 0;
    double incrementalCredit = 0;
    for (CreditSegment s : b.credit()) {
      double pdS = stressedPd(s, f);
      double lgdS = stressedLgd(s, f);
      double eclBase = s.pd() * s.lgd() * s.ead();
      double eclS = pdS * lgdS * s.ead();
      double residual = s.ead() * s.residualValueShare() * propertyDecline;
      double defaulted = s.ead() * Math.max(0, pdS - s.pd());
      credit.add(new SegmentResult(s.key(), s.label(), s.ead(), s.pd(), pdS, s.lgd(), lgdS, eclBase, eclS, residual,
          defaulted));
      creditCost += eclS + residual;
      incrementalCredit += (eclS - eclBase) + residual;
    }
    List<PlsResult> pls = new ArrayList<>();
    for (PlsSegment s : b.pls()) {
      double rate = plsLossRate(s, f);
      double lossBase = s.exposure() * s.baseLossRate();
      double lossS = s.exposure() * rate;
      pls.add(new PlsResult(s.key(), s.label(), s.exposure(), s.baseLossRate(), rate, lossBase, lossS));
      creditCost += lossS;
      incrementalCredit += lossS - lossBase;
    }

    // Income.
    double marginIncome = b.income().netMarginIncome() + dr * repricingGap(b);
    double feesAndOther = (b.income().fees() + b.income().otherIncome()) * (1 + revenueChange);

    double dcrCost = 0;
    double perUsed = 0;
    double psiaPoolLoss = 0;
    double irrUsed = 0;
    double psiaAbsorbed = 0;
    double psiaShare = 0;
    if (p != null) {
      psiaShare = b.psia() / b.totalAssets();
      double gross = Math.max(0, dr) * p.dcrPassThrough() * b.psia();
      perUsed = Math.min(p.profitEqualisationReserve(), gross);
      dcrCost = gross - perUsed;
      psiaPoolLoss = Math.max(0, incrementalCredit) * psiaShare;
      irrUsed = Math.min(p.investmentRiskReserve(), psiaPoolLoss);
      psiaAbsorbed = (psiaPoolLoss - irrUsed) * p.lossAbsorption();
    }

    double preTax = marginIncome + feesAndOther - b.income().operatingCosts() - creditCost - dcrCost + irrUsed
        + psiaAbsorbed;
    double tax = preTax > 0 ? preTax * b.income().taxRate() : 0;
    double netIncome = preTax - tax;

    double bondRevaluation = -t.sovereignBonds() * t.bondFairValueShare() * t.bondDuration() * dr;
    double equityRevaluation = t.equityHoldings() * f.equityShockPct() / 100;
    double cet1 = b.cet1() + netIncome + bondRevaluation + equityRevaluation;

    // Risk-weighted assets.
    double rwa = t.interbank() * INTERBANK_RISK_WEIGHT + t.otherAssets()
        + t.equityHoldings() * (1 + f.equityShockPct() / 100) * EQUITY_RISK_WEIGHT;
    for (int i = 0; i < b.credit().size(); i++) {
      CreditSegment s = b.credit().get(i);
      SegmentResult r = credit.get(i);
      rwa += (s.ead() - r.newlyDefaulted()) * s.riskWeight()
          + r.newlyDefaulted() * (1 - r.lgdStressed()) * DEFAULTED_RISK_WEIGHT;
    }
    for (PlsSegment s : b.pls()) rwa += s.exposure() * s.riskWeight();
    double grossIncome = b.income().netMarginIncome() + b.income().fees() + b.income().otherIncome();
    rwa += grossIncome * OPERATIONAL_RWA_FACTOR;
    if (p != null) rwa *= 1 - (1 - p.alpha()) * psiaShare;

    double exposure = b.totalAssets();

    // 30-day liquidity coverage.
    double hqla = t.cash() + t.sovereignBonds() * Math.max(0, 1 - t.bondDuration() * Math.max(0, dr));
    double outflows = 0;
    for (Liability l : b.liabilities()) outflows += l.amount() * Math.min(1, l.runoff30d() * f.runoffMultiplier());
    double loans = 0;
    for (CreditSegment s : b.credit()) loans += s.ead();
    double inflows = Math.min(INFLOW_CAP * outflows, t.interbank() + loans * LOAN_INFLOW_30D);
    double netOutflows = Math.max(1e-9, outflows - inflows);

    Ratios ratios = new Ratios(cet1, rwa, cet1 / rwa, exposure, cet1 / exposure, hqla, netOutflows,
        hqla / netOutflows);

    List<Impact> impacts = new ArrayList<>();
    impacts.add(new Impact("marginIncome", p == null ? "Marge nette d'intérêts" : "Marge nette de financement",
        marginIncome));
    impacts.add(new Impact("feesAndOther", "Commissions et autres revenus", feesAndOther));
    impacts.add(new Impact("operatingCosts", "Charges d'exploitation", -b.income().operatingCosts()));
    impacts.add(new Impact("creditCost", p == null ? "Coût du risque de crédit" : "Coût du risque de financement",
        -creditCost));
    if (p != null) {
      impacts.add(new Impact("dcrCost", "Risque commercial déplacé (après réserve PER)", -dcrCost));
      impacts.add(new Impact("irrUsed", "Réserve pour risque d'investissement (IRR) utilisée", irrUsed));
      impacts.add(new Impact("psiaAbsorbed", "Pertes absorbées par les comptes participatifs", psiaAbsorbed));
    }
    impacts.add(new Impact("tax", "Impôt", -tax));
    impacts.add(new Impact("bondRevaluation", "Réévaluation des " + t.bondLabel().toLowerCase(java.util.Locale.ROOT),
        bondRevaluation));
    impacts.add(new Impact("equityRevaluation", "Réévaluation des actions détenues", equityRevaluation));

    return new Outcome(f, List.copyOf(credit), List.copyOf(pls), creditCost, marginIncome, feesAndOther, dcrCost,
        perUsed, psiaPoolLoss, irrUsed, psiaAbsorbed, preTax, tax, netIncome, bondRevaluation, equityRevaluation,
        List.copyOf(impacts), ratios);
  }

  /** Ratios at the start of the horizon, before any projection. */
  public static Ratios initial(BankProfile b) {
    Outcome base = run(b, StressFactors.NEUTRAL);
    double cet1 = b.cet1();
    Ratios r = base.ratios();
    return new Ratios(cet1, r.rwa(), cet1 / r.rwa(), r.totalExposure(), cet1 / r.totalExposure(), r.hqla(),
        r.netOutflows(), r.lcr());
  }
}
