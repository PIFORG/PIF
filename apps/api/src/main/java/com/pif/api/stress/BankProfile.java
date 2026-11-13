package com.pif.api.stress;

import java.util.List;

/**
 * A fictional bank balance sheet and risk profile, in millions of dinars (M DT). Both profiles have the same total
 * assets (10 000 M DT), the same capital (900 M DT) and comparable financing books, so a scenario applied to both
 * isolates the effect of the business model. Every figure is a pedagogical assumption, not data of a real bank.
 */
public record BankProfile(String id, String name, String kind, String description, List<String> specificities,
    Treasury treasury, List<CreditSegment> credit, List<PlsSegment> pls, List<Liability> liabilities,
    double cet1, Income income, Participative participative) {

  /**
   * Credit exposure valued by expected loss PD × LGD × EAD. {@code floatingShare}: share repricing with market
   * rates within the year (drives both income and the borrower's payment shock). {@code collateralSensitivity}:
   * LGD points added per unit of property-price decline. {@code residualValueShare}: share of the exposure that is
   * the lessor's own asset (ijara), revalued with property prices. Betas: change in logit(PD) per percentage point
   * of unemployment, of GDP shortfall and of rate rise on the floating part.
   */
  public record CreditSegment(String key, String label, double ead, double pd, double lgd, double riskWeight,
      double floatingShare, double collateralSensitivity, double residualValueShare, double unemploymentBeta,
      double gdpBeta, double rateBeta) {}

  /**
   * Profit-and-loss sharing financing (musharaka, mudaraba): the bank is a partner, so it bears a share of the
   * venture's losses instead of a credit loss. Loss rate = base + equityBeta × equity decline + gdpBeta × GDP
   * shortfall (pp) + propertyBeta × property decline.
   */
  public record PlsSegment(String key, String label, double exposure, double baseLossRate, double equityBeta,
      double gdpBeta, double propertyBeta, double riskWeight) {}

  /** Liquid assets, securities and other assets. Bonds/sukuk at fair value through equity for {@code bondFairValueShare}. */
  public record Treasury(double cash, double cashRepricing, double interbank, double sovereignBonds,
      String bondLabel, double bondDuration, double bondFairValueShare, double bondRepricing, double equityHoldings,
      double otherAssets) {}

  /**
   * {@code rateBeta}: share of a rate change passed to the funding cost within the year. {@code runoff30d}:
   * share withdrawn over 30 days in the reference liquidity stress. {@code kind}: DEPOSIT, PSIA, WHOLESALE or OTHER.
   */
  public record Liability(String key, String label, String kind, double amount, double rateBeta, double runoff30d) {}

  /** One-year baseline income statement (M DT) and the tax rate on a positive pre-tax result. */
  public record Income(double netMarginIncome, double fees, double otherIncome, double operatingCosts,
      double taxRate) {}

  /**
   * Participative-bank parameters. {@code alpha}: share of the risk of PSIA-funded assets kept in the capital
   * denominator (IFSB-style alpha). {@code dcrPassThrough}: share of a market-rate rise the bank must pay to
   * investment-account holders to keep them (displaced commercial risk). {@code lossAbsorption}: share of losses on
   * PSIA-funded assets actually borne by the holders. {@code profitEqualisationReserve} and
   * {@code investmentRiskReserve}: reserves held for the holders, used before the bank's own capital.
   */
  public record Participative(double alpha, double dcrPassThrough, double lossAbsorption,
      double profitEqualisationReserve, double investmentRiskReserve) {}

  public double totalAssets() {
    double sum = treasury.cash + treasury.interbank + treasury.sovereignBonds + treasury.equityHoldings
        + treasury.otherAssets;
    for (CreditSegment s : credit) sum += s.ead;
    for (PlsSegment s : pls) sum += s.exposure;
    return sum;
  }

  public double totalLiabilities() {
    double sum = 0;
    for (Liability l : liabilities) sum += l.amount;
    if (participative != null) {
      sum += participative.profitEqualisationReserve + participative.investmentRiskReserve;
    }
    return sum;
  }

  public double psia() {
    double sum = 0;
    for (Liability l : liabilities) if ("PSIA".equals(l.kind)) sum += l.amount;
    return sum;
  }

  public static final BankProfile CONVENTIONAL = new BankProfile("CONVENTIONAL", "Banque conventionnelle fictive",
      "CONVENTIONAL",
      "Banque commerciale universelle financée par des dépôts rémunérés et des emprunts de marché. Ses crédits "
          + "portent intérêt, en partie à taux variable.",
      List.of(
          "Crédits à intérêt, dont une large part à taux variable : la marge suit les taux, mais les emprunteurs "
              + "à taux variable subissent la hausse de leurs échéances.",
          "Dépôts à terme et financements de marché rémunérés au taux du marché.",
          "Portefeuille obligataire souverain de duration 4,5 ans, valorisé en partie à la juste valeur.",
          "Toutes les pertes reviennent aux actionnaires : les déposants ne partagent pas le risque."),
      new Treasury(800, 0.5, 400, 1800, "Obligations souveraines", 4.5, 0.6, 0.2, 300, 300),
      List.of(
          new CreditSegment("mortgage", "Crédits immobiliers aux ménages", 2200, 0.015, 0.20, 0.35, 0.6, 0.6, 0,
              0.15, 0.10, 0.10),
          new CreditSegment("consumer", "Crédits à la consommation", 1300, 0.04, 0.60, 0.75, 0.3, 0, 0, 0.20, 0.10,
              0.08),
          new CreditSegment("sme", "Crédits aux PME", 1600, 0.05, 0.45, 1.00, 0.7, 0.25, 0, 0.12, 0.18, 0.12),
          new CreditSegment("corporate", "Crédits aux grandes entreprises", 1300, 0.025, 0.40, 1.00, 0.8, 0.15, 0,
              0.06, 0.20, 0.08)),
      List.of(),
      List.of(
          new Liability("sight", "Dépôts à vue des particuliers", "DEPOSIT", 2900, 0.2, 0.07),
          new Liability("term", "Dépôts à terme et épargne", "DEPOSIT", 2800, 0.8, 0.10),
          new Liability("corporate", "Dépôts des entreprises", "DEPOSIT", 1600, 0.6, 0.40),
          new Liability("interbank", "Emprunts interbancaires", "WHOLESALE", 900, 1.0, 1.00),
          new Liability("bonds", "Obligations émises", "WHOLESALE", 700, 0.3, 0),
          new Liability("other", "Autres passifs", "OTHER", 200, 0, 0)),
      900,
      new Income(330, 120, 30, 240, 0.25),
      null);

  public static final BankProfile PARTICIPATIVE = new BankProfile("PARTICIPATIVE", "Banque participative fictive",
      "PARTICIPATIVE",
      "Banque non conventionnelle de type participatif (finance islamique) : elle ne prête pas à intérêt mais "
          + "finance par vente à marge (mourabaha), location (ijara) et partenariat (moucharaka, moudaraba). "
          + "Les comptes d'investissement participatifs partagent ses résultats.",
      List.of(
          "Mourabaha : vente avec une marge fixée au contrat ; la marge ne suit pas les taux et l'échéance du client "
              + "ne change pas.",
          "Ijara : location dont une partie des loyers est révisable ; la banque reste propriétaire du bien et "
              + "porte sa valeur résiduelle.",
          "Moucharaka et moudaraba : la banque est associée et partage les pertes du projet financé (risque proche "
              + "des actions).",
          "Comptes d'investissement participatifs (PSIA) : non garantis, ils partagent une partie des pertes des "
              + "actifs qu'ils financent, après des réserves dédiées (PER, IRR).",
          "Risque commercial déplacé : si les taux du marché montent, la banque doit reverser une partie de sa part "
              + "de profit pour retenir les titulaires de comptes participatifs.",
          "Moins d'instruments liquides éligibles : la banque détient davantage de liquidités et moins de titres."),
      new Treasury(1200, 0.5, 400, 900, "Sukuk souverains", 3.0, 0.6, 0.3, 300, 600),
      List.of(
          new CreditSegment("murabaha-home", "Mourabaha immobilière", 2500, 0.015, 0.20, 0.35, 0, 0.6, 0, 0.15,
              0.10, 0.10),
          new CreditSegment("murabaha-consumer", "Mourabaha de biens de consommation", 1400, 0.04, 0.60, 0.75, 0, 0,
              0, 0.20, 0.10, 0.08),
          new CreditSegment("ijara", "Ijara (location avec option d'achat)", 1700, 0.03, 0.35, 1.00, 0.5, 0.3, 0.2,
              0.12, 0.15, 0.10)),
      List.of(new PlsSegment("musharaka", "Moucharaka et moudaraba (partage des pertes et profits)", 1000, 0.015,
          0.5, 1.5, 0.2, 2.5)),
      List.of(
          new Liability("current", "Comptes courants (garantis, non rémunérés)", "DEPOSIT", 2600, 0, 0.07),
          new Liability("psia", "Comptes d'investissement participatifs (PSIA)", "PSIA", 4600, 0, 0.10),
          new Liability("corporate", "Comptes courants des entreprises", "DEPOSIT", 1000, 0, 0.40),
          new Liability("interbank", "Financements interbancaires (wakala)", "WHOLESALE", 400, 1.0, 1.00),
          new Liability("sukuk", "Sukuk émis", "WHOLESALE", 200, 0.3, 0),
          new Liability("other", "Autres passifs", "OTHER", 200, 0, 0)),
      900,
      new Income(320, 110, 30, 250, 0.25),
      new Participative(0.5, 0.6, 0.5, 60, 40));

  public static final List<BankProfile> ALL = List.of(CONVENTIONAL, PARTICIPATIVE);

  public static BankProfile find(String id) {
    for (BankProfile b : ALL) if (b.id.equals(id)) return b;
    return null;
  }
}
