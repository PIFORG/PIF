package com.pif.api.actuarial;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ALM pédagogique : actualisation des flux d'actifs et de passifs, durations de Macaulay/modifiée,
 * écart de duration et choc de taux parallèle. Outil d'apprentissage, pas un moteur réglementaire.
 */
public final class Alm {

  public static final String VERSION = "alm-v1";

  public record CashFlow(int year, double amount, String label) {}

  public record Input(
      String label,
      double discountRate,
      double rateShock,
      List<CashFlow> assets,
      List<CashFlow> liabilities) {}

  public record Bucket(
      String side,
      double presentValue,
      double macaulayDuration,
      double modifiedDuration,
      double totalNominal) {}

  public record Result(
      String modelVersion,
      String convention,
      String currency,
      String label,
      double discountRate,
      double rateShock,
      Bucket assets,
      Bucket liabilities,
      double surplus,
      double durationGap,
      double surplusAfterShock,
      double liquidityGapYear1) {}

  private Alm() {}

  public static Result compute(Input input) {
    if (!(input.discountRate() > -0.05 && input.discountRate() < 0.5)) {
      throw new AssumptionException("le taux d'actualisation doit être dans (−5 % ; 50 %)");
    }
    if (input.assets() == null || input.assets().isEmpty()) {
      throw new AssumptionException("au moins un flux d'actif est requis");
    }
    if (input.liabilities() == null || input.liabilities().isEmpty()) {
      throw new AssumptionException("au moins un flux de passif est requis");
    }
    Bucket assets = bucket("ACTIF", input.assets(), input.discountRate());
    Bucket liabilities = bucket("PASSIF", input.liabilities(), input.discountRate());
    double surplus = money(assets.presentValue() - liabilities.presentValue());
    double gap = money(assets.macaulayDuration() - liabilities.macaulayDuration());

    Bucket assetsShock = bucket("ACTIF", input.assets(), input.discountRate() + input.rateShock());
    Bucket liabilitiesShock = bucket("PASSIF", input.liabilities(), input.discountRate() + input.rateShock());
    double surplusShock = money(assetsShock.presentValue() - liabilitiesShock.presentValue());

    double assetY1 = year1(input.assets());
    double liabY1 = year1(input.liabilities());
    double liquidity = money(assetY1 - liabY1);

    return new Result(
        VERSION,
        "Actualisation à taux unique ; duration de Macaulay ; choc parallèle de taux. Pédagogique uniquement.",
        Presets.CURRENCY,
        input.label() == null || input.label().isBlank() ? "Scénario ALM" : input.label().trim(),
        input.discountRate(),
        input.rateShock(),
        assets,
        liabilities,
        surplus,
        gap,
        surplusShock,
        liquidity);
  }

  public static Map<String, Object> toJson(Result r) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("modelVersion", r.modelVersion());
    m.put("convention", r.convention());
    m.put("currency", r.currency());
    m.put("label", r.label());
    m.put("discountRate", r.discountRate());
    m.put("rateShock", r.rateShock());
    m.put("assets", bucketJson(r.assets()));
    m.put("liabilities", bucketJson(r.liabilities()));
    m.put("surplus", r.surplus());
    m.put("durationGapYears", r.durationGap());
    m.put("surplusAfterRateShock", r.surplusAfterShock());
    m.put("liquidityGapYear1", r.liquidityGapYear1());
    m.put(
        "disclaimer",
        "ALM pédagogique à courbe plate. Ne remplace pas un modèle de gestion actif-passif réglementaire.");
    return m;
  }

  private static Map<String, Object> bucketJson(Bucket b) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("side", b.side());
    m.put("presentValue", b.presentValue());
    m.put("macaulayDuration", b.macaulayDuration());
    m.put("modifiedDuration", b.modifiedDuration());
    m.put("totalNominal", b.totalNominal());
    return m;
  }

  private static Bucket bucket(String side, List<CashFlow> flows, double rate) {
    double pv = 0;
    double weighted = 0;
    double nominal = 0;
    for (CashFlow f : flows) {
      if (f.year() < 0) throw new AssumptionException("les années de flux ne peuvent pas être négatives");
      double df = 1.0 / Math.pow(1.0 + rate, f.year());
      double p = f.amount() * df;
      pv += p;
      weighted += f.year() * p;
      nominal += f.amount();
    }
    double mac = pv == 0 ? 0 : weighted / pv;
    double mod = rate <= -1 ? 0 : mac / (1.0 + rate);
    return new Bucket(side, money(pv), money(mac), money(mod), money(nominal));
  }

  private static double money(double v) {
    return Math.round(v * 1000.0) / 1000.0;
  }

  private static double year1(List<CashFlow> flows) {
    double sum = 0;
    for (CashFlow f : flows) if (f.year() == 1) sum += f.amount();
    return sum;
  }

  /** Portefeuille pédagogique par défaut (obligation notionnelle vs engagements). */
  public static Input demo() {
    List<CashFlow> assets = new ArrayList<>();
    assets.add(new CashFlow(1, 5_000, "Coupon"));
    assets.add(new CashFlow(2, 5_000, "Coupon"));
    assets.add(new CashFlow(3, 5_000, "Coupon"));
    assets.add(new CashFlow(4, 5_000, "Coupon"));
    assets.add(new CashFlow(5, 105_000, "Remboursement"));
    List<CashFlow> liabilities = new ArrayList<>();
    liabilities.add(new CashFlow(1, 8_000, "Prestations"));
    liabilities.add(new CashFlow(2, 9_000, "Prestations"));
    liabilities.add(new CashFlow(3, 10_000, "Prestations"));
    liabilities.add(new CashFlow(4, 12_000, "Prestations"));
    liabilities.add(new CashFlow(5, 70_000, "Prestations"));
    return new Input("Exemple ALM notionnel", 0.05, 0.01, assets, liabilities);
  }
}
