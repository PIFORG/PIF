package com.pif.api.market;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Pedagogical fundamental statements for fictional instruments. Figures are deterministic and labelled as
 * synthetic; they are not filings of any real listed company.
 */
public final class FundamentalsCatalog {

  public record Statement(String symbol, String company, String currency, int fiscalYear, double revenue,
      double earnings, double totalDebt, double equity, double sharesOutstanding, double bookValuePerShare,
      List<Map<String, Object>> history) {}

  private FundamentalsCatalog() {}

  public static Statement of(String symbol) {
    FictionalUniverse.FictionalInstrument inst = FictionalUniverse.INSTRUMENTS.get(symbol);
    if (inst == null) return null;
    int seed = Math.floorMod(symbol.hashCode(), 10_000);
    double revenue = round2(80 + (seed % 400) + inst.initialPrice() * 12);
    double margin = 0.06 + (seed % 20) / 100.0;
    double earnings = round2(revenue * margin);
    double equity = round2(revenue * (0.4 + (seed % 15) / 100.0));
    double debt = round2(equity * (0.3 + (seed % 50) / 100.0));
    double shares = round2(5 + (seed % 40));
    double bvps = shares == 0 ? 0 : round2(equity / shares);
    List<Map<String, Object>> history = new ArrayList<>();
    double r = revenue * 0.82;
    double e = earnings * 0.75;
    for (int y = 0; y < 4; y++) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("fiscalYear", 2022 + y);
      row.put("revenue", round2(r));
      row.put("earnings", round2(e));
      history.add(row);
      r *= 1.07 + (seed % 5) / 100.0;
      e *= 1.05 + (seed % 4) / 100.0;
    }
    return new Statement(symbol, inst.name(), "TND", 2025, revenue, earnings, debt, equity, shares, bvps, history);
  }

  public static Map<String, Object> view(Statement s, Double price) {
    Map<String, Object> ratios = new LinkedHashMap<>();
    double pe = price != null && s.earnings() != 0 && s.sharesOutstanding() != 0
        ? round4(price / (s.earnings() / s.sharesOutstanding()))
        : Double.NaN;
    double roe = s.equity() == 0 ? Double.NaN : round4(s.earnings() / s.equity());
    double de = s.equity() == 0 ? Double.NaN : round4(s.totalDebt() / s.equity());
    double npm = s.revenue() == 0 ? Double.NaN : round4(s.earnings() / s.revenue());
    double pb = price != null && s.bookValuePerShare() != 0 ? round4(price / s.bookValuePerShare()) : Double.NaN;
    ratios.put("priceToEarnings", finite(pe));
    ratios.put("returnOnEquity", finite(roe));
    ratios.put("debtToEquity", finite(de));
    ratios.put("netProfitMargin", finite(npm));
    ratios.put("priceToBook", finite(pb));

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("symbol", s.symbol());
    body.put("company", s.company());
    body.put("currency", s.currency());
    body.put("fiscalYear", s.fiscalYear());
    body.put("statements", Map.of(
        "revenue", s.revenue(),
        "earnings", s.earnings(),
        "totalDebt", s.totalDebt(),
        "equity", s.equity(),
        "sharesOutstandingMillions", s.sharesOutstanding(),
        "bookValuePerShare", s.bookValuePerShare()));
    body.put("ratios", ratios);
    body.put("priceUsed", price);
    body.put("history", s.history());
    body.put("provenance", Map.of(
        "kind", "SYNTHETIC_PEDAGOGICAL",
        "description", "Etats financiers fictifs pour l'apprentissage — aucune entreprise cotee reelle."));
    body.put("limitations", List.of(
        "Ces chiffres ne sont pas des publications reglementaires.",
        "Ils servent uniquement a illustrer les ratios et la comparaison pedagogique.",
        "Ne pas les presenter comme des donnees de marche authentiques."));
    return body;
  }

  private static Object finite(double v) {
    return Double.isFinite(v) ? v : null;
  }

  private static double round2(double v) {
    return Math.round(v * 100.0) / 100.0;
  }

  private static double round4(double v) {
    return Math.round(v * 10_000.0) / 10_000.0;
  }
}