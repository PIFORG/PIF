package com.pif.api.stress;

import com.pif.api.stress.BankProfile.CreditSegment;
import com.pif.api.stress.BankProfile.Liability;
import com.pif.api.stress.BankProfile.PlsSegment;
import com.pif.api.stress.BankProfile.Treasury;
import com.pif.api.stress.StressEngine.Impact;
import com.pif.api.stress.StressEngine.Outcome;
import com.pif.api.stress.StressEngine.Ratios;
import com.pif.api.stress.ml.ScenarioDataset;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.ToDoubleFunction;
import org.springframework.stereotype.Service;

/**
 * Bank stress-testing views. Every figure is computed by {@link StressEngine} on request; nothing is stored or
 * hard-coded. Amounts are in millions of dinars (M DT), ratios as fractions.
 */
@Service
public class StressService {

  private final StressModelService models;

  public StressService(StressModelService models) {
    this.models = models;
  }

  static final double[] SENSITIVITY_INTENSITIES = {0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2};

  static final List<String> ASSUMPTIONS = List.of(
      "Banques fictives à visée pédagogique : bilans, paramètres et sensibilités sont des hypothèses, pas des "
          + "données de banques réelles ni une estimation statistique.",
      "Horizon d'un an, bilan statique : pas de croissance, pas de dividende, pas de réaction de la direction.",
      "Pertes de crédit attendues = PD × LGD × EAD. La PD réagit au chômage, au PIB et, pour la part à taux "
          + "variable, aux taux (modèle satellite logit-linéaire aux coefficients supposés) ; la LGD réagit aux "
          + "prix immobiliers par la valeur des garanties.",
      "Obligations et sukuk réévalués par la duration (−D × Δy) pour la part en juste valeur ; actions réévaluées "
          + "par la variation de leur prix ; ces deux effets passent directement par les fonds propres.",
      "Marge : modèle d'impasse de taux (actifs moins passifs révisés dans l'année × Δtaux).",
      "Actifs pondérés : pondérations forfaitaires inspirées de l'approche standard ; expositions nouvellement en "
          + "défaut pondérées à 150 % nettes de la perte ; risque opérationnel = 15 % du produit net bancaire × 12,5.",
      "Liquidité à 30 jours : actifs liquides de haute qualité sur sorties nettes ; entrées plafonnées à 75 % des "
          + "sorties.",
      "Banque participative : marges de mourabaha fixes ; risque commercial déplacé couvert d'abord par la réserve "
          + "PER ; pertes sur les actifs financés par les comptes participatifs prises par la réserve IRR puis "
          + "partagées avec les titulaires ; facteur alpha appliqué aux actifs pondérés (formule simplifiée "
          + "inspirée de l'IFSB).");

  static final List<String> LIMITATIONS = List.of(
      "Les seuils (CET1 7 %, coussin 2,5 %, levier 3 %, LCR 100 %) servent de repères pédagogiques inspirés de "
          + "Bâle III ; le modèle ne prétend à aucune conformité réglementaire.",
      "Les coefficients de sensibilité ne sont pas estimés sur des données historiques : les résultats illustrent "
          + "des mécanismes, ils ne prévoient pas le comportement d'une banque réelle.",
      "La décomposition de Shapley explique l'arithmétique de ce modèle déterministe ; elle ne constitue pas une "
          + "preuve causale. Les effets d'interaction sont répartis à parts égales entre les facteurs concernés.",
      "Le volet IA est un émulateur appris sur des scénarios synthétiques calculés par ce moteur : il en reproduit "
          + "les résultats sans rien apprendre des banques réelles. Le résultat du moteur reste la référence.",
      "Les exécutions ne sont pas enregistrées : un résultat se reproduit à l'identique à partir du scénario.");

  // ------------------------------------------------------------------ catalog

  public Map<String, Object> catalog() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("modelVersion", StressEngine.MODEL_VERSION);
    out.put("horizon", "1 an");
    out.put("unit", "M DT");
    out.put("thresholds", thresholds());
    List<Object> factors = new ArrayList<>();
    for (StressFactors.Definition d : StressFactors.DEFINITIONS) {
      Map<String, Object> f = new LinkedHashMap<>();
      f.put("key", d.key());
      f.put("label", d.label());
      f.put("unit", d.unit());
      f.put("neutral", d.neutral());
      f.put("min", d.min());
      f.put("max", d.max());
      f.put("description", d.description());
      factors.add(f);
    }
    out.put("factors", factors);
    List<Object> presets = new ArrayList<>();
    for (StressFactors.Preset p : StressFactors.PRESETS) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", p.id());
      m.put("name", p.name());
      m.put("description", p.description());
      m.put("factors", p.factors().toJson());
      presets.add(m);
    }
    out.put("presets", presets);
    out.put("maxIntensity", StressDtos.MAX_INTENSITY);
    out.put("banks", BankProfile.ALL.stream().map(StressService::bankJson).toList());
    out.put("assumptions", ASSUMPTIONS);
    out.put("limitations", LIMITATIONS);
    return out;
  }

  static Map<String, Object> thresholds() {
    Map<String, Object> t = new LinkedHashMap<>();
    t.put("cet1Minimum", StressEngine.CET1_MINIMUM);
    t.put("cet1Buffer", StressEngine.CET1_BUFFER);
    t.put("leverageMinimum", StressEngine.LEVERAGE_MINIMUM);
    t.put("lcrMinimum", StressEngine.LCR_MINIMUM);
    return t;
  }

  static Map<String, Object> bankJson(BankProfile b) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", b.id());
    out.put("name", b.name());
    out.put("kind", b.kind());
    out.put("kindLabel", kindLabel(b));
    out.put("description", b.description());
    out.put("specificities", b.specificities());
    out.put("balanceSheet", balanceSheet(b));
    out.put("initial", ratiosJson(StressEngine.initial(b)));
    if (b.participative() != null) {
      BankProfile.Participative p = b.participative();
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("alpha", p.alpha());
      m.put("dcrPassThrough", p.dcrPassThrough());
      m.put("lossAbsorption", p.lossAbsorption());
      m.put("profitEqualisationReserve", p.profitEqualisationReserve());
      m.put("investmentRiskReserve", p.investmentRiskReserve());
      out.put("participative", m);
    }
    return out;
  }

  static String kindLabel(BankProfile b) {
    return b.participative() == null ? "Banque conventionnelle" : "Banque non conventionnelle (participative)";
  }

  static Map<String, Object> balanceSheet(BankProfile b) {
    Treasury t = b.treasury();
    List<Object> assets = new ArrayList<>();
    assets.add(line("cash", "Caisse et banque centrale", t.cash(), "LIQUIDITY"));
    assets.add(line("interbank", "Placements interbancaires", t.interbank(), "LIQUIDITY"));
    assets.add(line("bonds", t.bondLabel(), t.sovereignBonds(), "SECURITIES"));
    assets.add(line("equities", "Actions détenues", t.equityHoldings(), "SECURITIES"));
    for (CreditSegment s : b.credit()) assets.add(line(s.key(), s.label(), s.ead(), "FINANCING"));
    for (PlsSegment s : b.pls()) assets.add(line(s.key(), s.label(), s.exposure(), "FINANCING"));
    assets.add(line("other", "Autres actifs", t.otherAssets(), "OTHER"));
    List<Object> liabilities = new ArrayList<>();
    for (Liability l : b.liabilities()) liabilities.add(line(l.key(), l.label(), l.amount(), l.kind()));
    if (b.participative() != null) {
      liabilities.add(line("per", "Réserve d'égalisation des profits (PER)",
          b.participative().profitEqualisationReserve(), "PSIA_RESERVE"));
      liabilities.add(line("irr", "Réserve pour risque d'investissement (IRR)",
          b.participative().investmentRiskReserve(), "PSIA_RESERVE"));
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("assets", assets);
    out.put("liabilities", liabilities);
    out.put("cet1", b.cet1());
    out.put("totalAssets", b.totalAssets());
    out.put("totalLiabilitiesAndEquity", b.totalLiabilities() + b.cet1());
    return out;
  }

  private static Map<String, Object> line(String key, String label, double amount, String group) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("key", key);
    m.put("label", label);
    m.put("amount", amount);
    m.put("group", group);
    return m;
  }

  // ------------------------------------------------------------------ run

  public Map<String, Object> run(StressDtos.RunRequest request) {
    StressFactors factors = request.factors().scaled(request.intensity());
    StressFactors.Preset preset = request.presetId() == null ? null : StressFactors.preset(request.presetId());

    Map<String, Object> out = new LinkedHashMap<>();
    out.put("modelVersion", StressEngine.MODEL_VERSION);
    out.put("method", "Moteur déterministe de tests de résistance à un an ; estimation par un émulateur appris "
        + "(gradient boosting) affichée à côté du résultat exact");
    Map<String, Object> scenario = new LinkedHashMap<>();
    scenario.put("presetId", preset == null ? null : preset.id());
    scenario.put("name", preset == null ? "Scénario personnalisé" : preset.name());
    scenario.put("description", preset == null ? "Chocs définis facteur par facteur." : preset.description());
    scenario.put("intensity", request.intensity());
    scenario.put("factors", factors.toJson());
    scenario.put("activeFactors", activeFactors(factors));
    out.put("scenario", scenario);

    Map<String, BankRun> runs = new LinkedHashMap<>();
    for (BankProfile b : BankProfile.ALL) runs.put(b.id(), bankRun(b, factors, models));
    out.put("banks", runs.values().stream().map(BankRun::json).toList());
    out.put("comparison", comparison(runs.get(BankProfile.CONVENTIONAL.id()),
        runs.get(BankProfile.PARTICIPATIVE.id())));
    out.put("sensitivity", sensitivity(request.factors()));
    out.put("thresholds", thresholds());
    out.put("assumptions", ASSUMPTIONS);
    out.put("limitations", LIMITATIONS);
    return out;
  }

  private static List<Object> activeFactors(StressFactors f) {
    List<Object> out = new ArrayList<>();
    for (int i = 0; i < StressFactors.DEFINITIONS.size(); i++) {
      StressFactors.Definition d = StressFactors.DEFINITIONS.get(i);
      if (f.get(i) != d.neutral()) out.add(d.key());
    }
    return out;
  }

  /** Everything computed for one bank under one scenario. */
  record BankRun(BankProfile bank, Outcome baseline, Outcome stressed, Ratios initial, double[] cet1Shapley,
      double[] lcrShapley, Map<String, Object> json) {}

  static BankRun bankRun(BankProfile b, StressFactors f, StressModelService models) {
    Outcome baseline = StressEngine.run(b, StressFactors.NEUTRAL);
    Outcome stressed = StressEngine.run(b, f);
    Ratios initial = StressEngine.initial(b);
    ToDoubleFunction<Outcome> cet1 = o -> o.ratios().cet1Ratio();
    ToDoubleFunction<Outcome> lcr = o -> o.ratios().lcr();
    double[] cet1Phi = StressAttribution.shapley(b, f, cet1);
    double[] lcrPhi = StressAttribution.shapley(b, f, lcr);

    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", b.id());
    out.put("name", b.name());
    out.put("kind", b.kind());
    out.put("kindLabel", kindLabel(b));
    Map<String, Object> projections = new LinkedHashMap<>();
    projections.put("initial", ratiosJson(initial));
    projections.put("baseline", projectionJson(baseline));
    projections.put("stressed", projectionJson(stressed));
    out.put("projections", projections);
    out.put("resilience", resilience(baseline, stressed));
    out.put("capitalBridge", capitalBridge(b, stressed));
    out.put("credit", stressed.credit().stream().map(StressService::segmentJson).toList());
    out.put("profitAndLossSharing", stressed.pls().stream().map(StressService::plsJson).toList());
    if (b.participative() != null) out.put("participativeMechanisms", mechanisms(b, stressed));
    Map<String, Object> attribution = new LinkedHashMap<>();
    attribution.put("method", "SHAPLEY_EXACT");
    attribution.put("methodLabel", "Décomposition de Shapley exacte (256 combinaisons de facteurs)");
    attribution.put("reference", "Projection à un an du scénario central (aucun choc)");
    attribution.put("cet1Ratio", contributions(cet1Phi));
    attribution.put("lcr", contributions(lcrPhi));
    attribution.put("cet1RatioTotal", stressed.ratios().cet1Ratio() - baseline.ratios().cet1Ratio());
    attribution.put("lcrTotal", stressed.ratios().lcr() - baseline.ratios().lcr());
    attribution.put("explanation", explainAttribution(cet1Phi, stressed.ratios().cet1Ratio()
        - baseline.ratios().cet1Ratio()));
    out.put("attribution", attribution);
    if (models != null) {
      Map<ScenarioDataset.Target, Double> exact = Map.of(
          ScenarioDataset.Target.CET1_CHANGE_PP, 100 * (stressed.ratios().cet1Ratio() - baseline.ratios().cet1Ratio()),
          ScenarioDataset.Target.LCR_CHANGE_PP, 100 * (stressed.ratios().lcr() - baseline.ratios().lcr()));
      Map<ScenarioDataset.Target, double[]> exactPhi = Map.of(
          ScenarioDataset.Target.CET1_CHANGE_PP, scaled(cet1Phi, 100),
          ScenarioDataset.Target.LCR_CHANGE_PP, scaled(lcrPhi, 100));
      out.put("aiEstimate", models.estimate(b, f, exact, exactPhi));
    }
    return new BankRun(b, baseline, stressed, initial, cet1Phi, lcrPhi, out);
  }

  private static double[] scaled(double[] v, double k) {
    double[] out = new double[v.length];
    for (int i = 0; i < v.length; i++) out[i] = v[i] * k;
    return out;
  }

  static Map<String, Object> ratiosJson(Ratios r) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("cet1", round(r.cet1(), 3));
    m.put("rwa", round(r.rwa(), 3));
    m.put("cet1Ratio", round(r.cet1Ratio(), 6));
    m.put("totalExposure", round(r.totalExposure(), 3));
    m.put("leverageRatio", round(r.leverageRatio(), 6));
    m.put("hqla", round(r.hqla(), 3));
    m.put("netOutflows", round(r.netOutflows(), 3));
    m.put("lcr", round(r.lcr(), 6));
    return m;
  }

  static Map<String, Object> projectionJson(Outcome o) {
    Map<String, Object> m = ratiosJson(o.ratios());
    m.put("netIncome", round(o.netIncome(), 3));
    m.put("preTaxIncome", round(o.preTaxIncome(), 3));
    m.put("creditCost", round(o.creditCost(), 3));
    m.put("marginIncome", round(o.marginIncome(), 3));
    m.put("feesAndOther", round(o.feesAndOther(), 3));
    m.put("bondRevaluation", round(o.bondRevaluation(), 3));
    m.put("equityRevaluation", round(o.equityRevaluation(), 3));
    return m;
  }

  static Map<String, Object> resilience(Outcome baseline, Outcome stressed) {
    Ratios r = stressed.ratios();
    List<Object> checks = new ArrayList<>();
    checks.add(check("cet1Ratio", "Ratio CET1", r.cet1Ratio(), StressEngine.CET1_MINIMUM));
    checks.add(check("leverageRatio", "Ratio de levier", r.leverageRatio(), StressEngine.LEVERAGE_MINIMUM));
    checks.add(check("lcr", "Ratio de liquidité à 30 jours (LCR)", r.lcr(), StressEngine.LCR_MINIMUM));
    boolean breached = r.cet1Ratio() < StressEngine.CET1_MINIMUM || r.leverageRatio() < StressEngine.LEVERAGE_MINIMUM
        || r.lcr() < StressEngine.LCR_MINIMUM;
    boolean bufferUsed = r.cet1Ratio() < StressEngine.CET1_MINIMUM + StressEngine.CET1_BUFFER;
    String status = breached ? "VULNERABLE" : bufferUsed ? "UNDER_WATCH" : "RESILIENT";
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("status", status);
    m.put("statusLabel", switch (status) {
      case "VULNERABLE" -> "Vulnérable : au moins un seuil franchi";
      case "UNDER_WATCH" -> "Sous surveillance : coussin de conservation entamé";
      default -> "Résiliente : seuils et coussin respectés";
    });
    m.put("checks", checks);
    m.put("cet1DepletionPp", round(100 * (baseline.ratios().cet1Ratio() - r.cet1Ratio()), 6));
    m.put("capitalShortfall", round(Math.max(0, StressEngine.CET1_MINIMUM * r.rwa() - r.cet1()), 3));
    m.put("liquidityShortfall", round(Math.max(0, StressEngine.LCR_MINIMUM * r.netOutflows() - r.hqla()), 3));
    return m;
  }

  private static Map<String, Object> check(String key, String label, double value, double threshold) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("key", key);
    m.put("label", label);
    m.put("value", round(value, 6));
    m.put("threshold", threshold);
    m.put("ok", value >= threshold);
    return m;
  }

  /** From capital at the start to stressed capital at one year; the steps add up exactly. */
  static Map<String, Object> capitalBridge(BankProfile b, Outcome o) {
    List<Object> steps = new ArrayList<>();
    double sum = 0;
    for (Impact i : o.impacts()) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("key", i.key());
      m.put("label", i.label());
      m.put("amount", round(i.amount(), 3));
      steps.add(m);
      sum += i.amount();
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("start", b.cet1());
    out.put("steps", steps);
    out.put("end", round(b.cet1() + sum, 3));
    return out;
  }

  static Map<String, Object> segmentJson(StressEngine.SegmentResult s) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("key", s.key());
    m.put("label", s.label());
    m.put("ead", s.ead());
    m.put("pdBase", round(s.pdBase(), 8));
    m.put("pdStressed", round(s.pdStressed(), 8));
    m.put("lgdBase", round(s.lgdBase(), 8));
    m.put("lgdStressed", round(s.lgdStressed(), 8));
    m.put("eclBase", round(s.eclBase(), 3));
    m.put("eclStressed", round(s.eclStressed(), 3));
    m.put("residualValueLoss", round(s.residualValueLoss(), 3));
    m.put("newlyDefaulted", round(s.newlyDefaulted(), 3));
    return m;
  }

  static Map<String, Object> plsJson(StressEngine.PlsResult s) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("key", s.key());
    m.put("label", s.label());
    m.put("exposure", s.exposure());
    m.put("lossRateBase", round(s.lossRateBase(), 8));
    m.put("lossRateStressed", round(s.lossRateStressed(), 8));
    m.put("lossBase", round(s.lossBase(), 3));
    m.put("lossStressed", round(s.lossStressed(), 3));
    return m;
  }

  static Map<String, Object> mechanisms(BankProfile b, Outcome o) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("psia", b.psia());
    m.put("psiaShareOfAssets", round(b.psia() / b.totalAssets(), 6));
    m.put("alpha", b.participative().alpha());
    m.put("perUsed", round(o.perUsed(), 3));
    m.put("dcrCost", round(o.dcrCost(), 3));
    m.put("psiaPoolLoss", round(o.psiaPoolLoss(), 3));
    m.put("irrUsed", round(o.irrUsed(), 3));
    m.put("psiaAbsorbed", round(o.psiaAbsorbed(), 3));
    return m;
  }

  static List<Object> contributions(double[] phi) {
    List<Object> out = new ArrayList<>();
    for (int i = 0; i < phi.length; i++) {
      StressFactors.Definition d = StressFactors.DEFINITIONS.get(i);
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("factor", d.key());
      m.put("label", d.label());
      m.put("value", round(phi[i], 9));
      out.add(m);
    }
    return out;
  }

  /** Plain-French reading of the CET1 contributions, from the computed values only. */
  static List<String> explainAttribution(double[] phi, double total) {
    List<String> out = new ArrayList<>();
    if (Math.abs(total) < 1e-9) {
      out.add("Aucun choc actif : le ratio CET1 projeté est celui du scénario central.");
      return out;
    }
    out.add("Le ratio CET1 projeté varie de " + pp(total) + " par rapport au scénario central.");
    List<Integer> order = new ArrayList<>();
    for (int i = 0; i < phi.length; i++) if (Math.abs(phi[i]) >= 1e-6) order.add(i);
    order.sort(Comparator.comparingDouble(i -> phi[i]));
    int shown = 0;
    for (int i : order) {
      if (phi[i] >= 0 || shown == 3) break;
      out.add("« " + StressFactors.DEFINITIONS.get(i).label() + " » explique " + pp(phi[i]) + " ("
          + fr(100 * phi[i] / total, 0) + " % de la variation).");
      shown++;
    }
    for (int i : order) {
      if (phi[i] > 0) {
        out.add("« " + StressFactors.DEFINITIONS.get(i).label() + " » joue en sens inverse : " + pp(phi[i]) + ".");
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ comparison

  static Map<String, Object> comparison(BankRun conv, BankRun part) {
    Ratios c = conv.stressed().ratios();
    Ratios p = part.stressed().ratios();
    double convDepletion = conv.baseline().ratios().cet1Ratio() - c.cet1Ratio();
    double partDepletion = part.baseline().ratios().cet1Ratio() - p.cet1Ratio();

    Map<String, Object> out = new LinkedHashMap<>();
    Map<String, Object> metrics = new LinkedHashMap<>();
    metrics.put("cet1Ratio", diff(c.cet1Ratio(), p.cet1Ratio()));
    metrics.put("cet1DepletionPp", diff(100 * convDepletion, 100 * partDepletion));
    metrics.put("leverageRatio", diff(c.leverageRatio(), p.leverageRatio()));
    metrics.put("lcr", diff(c.lcr(), p.lcr()));
    metrics.put("netIncome", diff(conv.stressed().netIncome(), part.stressed().netIncome()));
    metrics.put("creditCost", diff(conv.stressed().creditCost(), part.stressed().creditCost()));
    out.put("metrics", metrics);

    List<Object> gaps = new ArrayList<>();
    List<Integer> order = new ArrayList<>();
    for (int i = 0; i < StressAttribution.FACTORS; i++) {
      double gap = part.cet1Shapley()[i] - conv.cet1Shapley()[i];
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("factor", StressFactors.DEFINITIONS.get(i).key());
      m.put("label", StressFactors.DEFINITIONS.get(i).label());
      m.put("conventional", round(conv.cet1Shapley()[i], 9));
      m.put("participative", round(part.cet1Shapley()[i], 9));
      m.put("gap", round(gap, 9));
      gaps.add(m);
      order.add(i);
    }
    out.put("factorGaps", gaps);

    List<String> explanation = new ArrayList<>();
    if (Math.abs(convDepletion) < 1e-9 && Math.abs(partDepletion) < 1e-9) {
      explanation.add("Aucun choc actif : les deux banques suivent leur scénario central.");
    } else {
      String more = partDepletion > convDepletion ? "la banque participative" : "la banque conventionnelle";
      explanation.add("Sous ce scénario, le ratio CET1 baisse de " + fr(100 * convDepletion, 2)
          + " pp pour la banque conventionnelle et de " + fr(100 * partDepletion, 2)
          + " pp pour la banque participative : " + more + " est la plus touchée.");
      order.sort(Comparator.comparingDouble(i -> -Math.abs(part.cet1Shapley()[i] - conv.cet1Shapley()[i])));
      int shown = 0;
      for (int i : order) {
        double gap = part.cet1Shapley()[i] - conv.cet1Shapley()[i];
        if (Math.abs(gap) < 1e-5 || shown == 3) break;
        explanation.add("« " + StressFactors.DEFINITIONS.get(i).label() + " » pèse " + pp(conv.cet1Shapley()[i])
            + " sur la banque conventionnelle contre " + pp(part.cet1Shapley()[i])
            + " sur la banque participative." + mechanismHint(i, conv, part));
        shown++;
      }
    }
    Outcome po = part.stressed();
    if (po.psiaAbsorbed() + po.irrUsed() > 1e-6) {
      explanation.add("Les comptes participatifs et la réserve IRR ont absorbé " + fr(po.psiaAbsorbed()
          + po.irrUsed(), 1) + " M DT de pertes que la banque conventionnelle supporte seule.");
    }
    if (po.dcrCost() + po.perUsed() > 1e-6) {
      explanation.add("Le risque commercial déplacé coûte " + fr(po.dcrCost() + po.perUsed(), 1)
          + " M DT, dont " + fr(po.perUsed(), 1) + " M DT couverts par la réserve PER.");
    }
    out.put("explanation", explanation);
    return out;
  }

  /** A one-sentence mechanism note, stated only when the computed numbers show it. */
  private static String mechanismHint(int factor, BankRun conv, BankRun part) {
    String key = StressFactors.DEFINITIONS.get(factor).key();
    Outcome c = conv.stressed();
    Outcome p = part.stressed();
    return switch (key) {
      case "rateShockBps" -> " Réévaluation des titres : " + fr(c.bondRevaluation(), 1) + " M DT contre "
          + fr(p.bondRevaluation(), 1) + " M DT ; risque commercial déplacé côté participatif : "
          + fr(p.dcrCost(), 1) + " M DT.";
      case "equityShockPct" -> p.pls().isEmpty() ? ""
          : " Le financement en partenariat (moucharaka) partage les pertes comme une participation : coût "
              + fr(p.pls().stream().mapToDouble(s -> s.lossStressed() - s.lossBase()).sum(), 1) + " M DT.";
      case "runoffMultiplier" -> " LCR : " + fr(100 * c.ratios().lcr(), 1) + " % contre "
          + fr(100 * p.ratios().lcr(), 1) + " %.";
      default -> " Coût du risque : " + fr(c.creditCost(), 1) + " M DT contre " + fr(p.creditCost(), 1) + " M DT.";
    };
  }

  private static Map<String, Object> diff(double conventional, double participative) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("conventional", round(conventional, 6));
    m.put("participative", round(participative, 6));
    m.put("difference", round(participative - conventional, 6));
    return m;
  }

  /** CET1 ratio and LCR of both banks as the shock intensity grows. */
  static List<Object> sensitivity(StressFactors factors) {
    List<Object> out = new ArrayList<>();
    for (double k : SENSITIVITY_INTENSITIES) {
      StressFactors f = factors.scaled(k);
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("intensity", k);
      for (BankProfile b : BankProfile.ALL) {
        Ratios r = StressEngine.run(b, f).ratios();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("cet1Ratio", round(r.cet1Ratio(), 6));
        v.put("lcr", round(r.lcr(), 6));
        m.put(b.id(), v);
      }
      out.add(m);
    }
    return out;
  }

  // ------------------------------------------------------------------ formatting

  static double round(double v, int digits) {
    if (Double.isNaN(v) || Double.isInfinite(v)) return v;
    double r = BigDecimal.valueOf(v).setScale(digits, RoundingMode.HALF_UP).doubleValue();
    return r == 0 ? 0 : r;
  }

  /** French number: non-breaking thousands space, decimal comma. */
  static String fr(double v, int digits) {
    DecimalFormatSymbols symbols = new DecimalFormatSymbols(Locale.FRENCH);
    symbols.setGroupingSeparator(' ');
    symbols.setDecimalSeparator(',');
    symbols.setMinusSign('−');
    DecimalFormat f = new DecimalFormat(digits == 0 ? "#,##0" : "#,##0." + "0".repeat(digits), symbols);
    f.setRoundingMode(RoundingMode.HALF_UP);
    String s = f.format(v);
    return s.equals("−0") || s.matches("−0,0+") ? s.substring(1) : s;
  }

  /** A ratio change as signed percentage points. */
  static String pp(double ratioChange) {
    String s = fr(100 * ratioChange, 2);
    return (ratioChange > 0 ? "+" : "") + s + " pp";
  }
}
