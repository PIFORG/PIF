package com.pif.api.stress;

import com.pif.api.stress.ml.Explanations;
import com.pif.api.stress.ml.GradientBoostedTrees;
import com.pif.api.stress.ml.LinearModel;
import com.pif.api.stress.ml.Metrics;
import com.pif.api.stress.ml.Regressor;
import com.pif.api.stress.ml.ScenarioDataset;
import com.pif.api.stress.ml.ScenarioDataset.Data;
import com.pif.api.stress.ml.ScenarioDataset.Target;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Machine-learning emulator of the stress engine (cahier §3.5.3) and its explanations (§3.6).
 *
 * <p>Protocol: scenarios are sampled with fixed seeds and evaluated by {@link StressEngine}; four disjoint sets are
 * generated — training, validation (early stopping only), test (same distribution, never seen) and extrapolation
 * (full accepted ranges, more severe than training). Three models are compared on each target: the training mean,
 * a linear regression and gradient-boosted trees. The models learn the engine, not real banks: their accuracy
 * measures fidelity to the engine. Training runs once, on first use, and is fully reproducible.
 */
@Service
public class StressModelService {

  public static final String MODEL_VERSION = "pif-stress-emulator-1.0.0";
  static final int TRAIN = 3000;
  static final int VALIDATION = 800;
  static final int TEST = 1500;
  static final int EXTRAPOLATION = 800;
  static final long SEED_TRAIN = 101;
  static final long SEED_VALIDATION = 202;
  static final long SEED_TEST = 303;
  static final long SEED_EXTRAPOLATION = 404;
  static final long SEED_PERMUTATION = 505;
  static final int PERMUTATION_REPEATS = 3;
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(StressModelService.class);

  /** The fitted models of one target. */
  record Fitted(Regressor mean, LinearModel linear, GradientBoostedTrees gbm) {}

  record Trained(Map<Target, Fitted> models, Map<String, Object> card) {}

  private volatile Trained trained;

  Trained trained() {
    Trained t = trained;
    if (t == null) {
      synchronized (this) {
        t = trained;
        if (t == null) {
          t = train();
          trained = t;
        }
      }
    }
    return t;
  }

  public Map<String, Object> card() {
    return trained().card();
  }

  /** True once the background training has finished; previews never wait for it. */
  public boolean ready() {
    return trained != null;
  }

  /**
   * Instant model estimate for both banks, used while the user is still adjusting the shocks. Returns
   * {@code ready: false} instead of blocking when the model is still training. The exact engine result remains the
   * reference and is computed separately.
   */
  public Map<String, Object> preview(StressFactors f) {
    Map<String, Object> out = new LinkedHashMap<>();
    Trained t = trained;
    out.put("ready", t != null);
    out.put("modelVersion", MODEL_VERSION);
    out.put("factors", f.toJson());
    if (t == null) {
      out.put("banks", List.of());
      return out;
    }
    List<Object> banks = new ArrayList<>();
    for (BankProfile bank : BankProfile.ALL) {
      StressEngine.Ratios base = StressEngine.run(bank, StressFactors.NEUTRAL).ratios();
      double[] x = ScenarioDataset.features(f, bank);
      double cet1Change = t.models().get(Target.CET1_CHANGE_PP).gbm().predict(x);
      double lcrChange = t.models().get(Target.LCR_CHANGE_PP).gbm().predict(x);
      Map<String, Object> b = new LinkedHashMap<>();
      b.put("id", bank.id());
      b.put("cet1ChangePp", StressService.round(cet1Change, 6));
      b.put("lcrChangePp", StressService.round(lcrChange, 6));
      b.put("cet1Ratio", StressService.round(base.cet1Ratio() + cet1Change / 100, 6));
      b.put("lcr", StressService.round(base.lcr() + lcrChange / 100, 6));
      b.put("baselineCet1Ratio", StressService.round(base.cet1Ratio(), 6));
      b.put("baselineLcr", StressService.round(base.lcr(), 6));
      banks.add(b);
    }
    out.put("banks", banks);
    out.put("outsideTrainingRange", outsideTrainingRange(f));
    return out;
  }

  static List<Object> outsideTrainingRange(StressFactors f) {
    List<Object> outside = new ArrayList<>();
    for (int i = 0; i < StressFactors.DEFINITIONS.size(); i++) {
      double v = f.get(i);
      StressFactors.Definition d = StressFactors.DEFINITIONS.get(i);
      if (v != d.neutral() && (v < ScenarioDataset.TRAINING_RANGE[i][0] || v > ScenarioDataset.TRAINING_RANGE[i][1])) {
        outside.add(d.key());
      }
    }
    return outside;
  }

  /** Trains in the background once the application is up, so the first user request does not wait for it. */
  @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
  public void warmUp() {
    Thread.ofVirtual().name("stress-emulator-training").start(() -> {
      long start = System.nanoTime();
      trained();
      log.info("Stress-test emulator trained in {} ms.", (System.nanoTime() - start) / 1_000_000);
    });
  }

  static Trained train() {
    Data train = ScenarioDataset.generate(SEED_TRAIN, TRAIN, false);
    Data validation = ScenarioDataset.generate(SEED_VALIDATION, VALIDATION, false);
    Data test = ScenarioDataset.generate(SEED_TEST, TEST, false);
    Data extrapolation = ScenarioDataset.generate(SEED_EXTRAPOLATION, EXTRAPOLATION, true);

    Map<Target, Fitted> models = new LinkedHashMap<>();
    Map<String, Object> targets = new LinkedHashMap<>();
    Map<Target, double[][]> testPredictions = new LinkedHashMap<>();
    Map<Target, double[][]> extraPredictions = new LinkedHashMap<>();
    for (Target target : Target.values()) {
      double[] yTrain = train.target(target);
      Regressor mean = Regressor.MeanModel.fit(yTrain);
      LinearModel linear = LinearModel.fit(train.x(), yTrain);
      GradientBoostedTrees gbm = GradientBoostedTrees.fit(train.x(), yTrain, validation.x(),
          validation.target(target), GradientBoostedTrees.DEFAULT);
      Fitted fitted = new Fitted(mean, linear, gbm);
      models.put(target, fitted);

      Map<String, Object> t = new LinkedHashMap<>();
      t.put("target", target.name());
      t.put("label", target.label);
      Map<String, Object> splits = new LinkedHashMap<>();
      splits.put("validation", evaluate(fitted, validation, target));
      splits.put("test", evaluate(fitted, test, target));
      splits.put("extrapolation", evaluate(fitted, extrapolation, target));
      t.put("metrics", splits);
      t.put("permutationImportance", importance(fitted, test, target));
      t.put("linearCoefficients", coefficients(linear));
      t.put("boostingRounds", gbm.rounds());
      t.put("validationCurve", downsample(gbm.validationCurve(), 40));
      targets.put(target.name(), t);
      testPredictions.put(target, predictions(fitted, test));
      extraPredictions.put(target, predictions(fitted, extrapolation));
    }

    Map<String, Object> card = new LinkedHashMap<>();
    card.put("modelVersion", MODEL_VERSION);
    card.put("engineVersion", StressEngine.MODEL_VERSION);
    card.put("purpose", "Émulateur du moteur de tests de résistance : estime en une fraction de seconde l'érosion "
        + "du CET1 et la variation du LCR d'une banque pour un scénario donné, et explique cette estimation.");
    card.put("nature", "Modèle d'apprentissage automatique entraîné sur des scénarios synthétiques calculés par le "
        + "moteur déterministe. Il apprend le moteur, pas des banques réelles : sa précision mesure sa fidélité au "
        + "moteur, et ses erreurs s'ajoutent aux limites du moteur.");
    card.put("protocol", protocol(train, validation, test, extrapolation));
    card.put("models", modelDescriptions());
    card.put("targets", targets);
    card.put("breachDetection", breachDetection(test, extrapolation, testPredictions, extraPredictions));
    card.put("limitations", List.of(
        "Données synthétiques : les performances mesurent la reproduction du moteur, pas une capacité de prévision "
            + "sur des banques réelles.",
        "Les arbres de décision n'extrapolent pas : au-delà des plages d'entraînement, l'erreur augmente nettement "
            + "(voir le jeu « extrapolation »). Une estimation hors domaine est signalée.",
        "L'importance par permutation mesure ce sur quoi le modèle s'appuie ; elle ne prouve aucune causalité. "
            + "Quand des facteurs sont liés, elle peut répartir l'importance de façon trompeuse.",
        "Les valeurs de Shapley du modèle utilisent un seul point de référence (scénario sans choc) ; une autre "
            + "référence donnerait une autre décomposition.",
        "Le moteur exact reste la référence : chaque estimation est affichée à côté du résultat du moteur."));
    return new Trained(models, card);
  }

  private static Map<String, Object> protocol(Data train, Data validation, Data test, Data extrapolation) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("features", ScenarioDataset.FEATURES);
    p.put("rowsPerScenario", BankProfile.ALL.size());
    p.put("trainingRows", train.size());
    p.put("validationRows", validation.size());
    p.put("testRows", test.size());
    p.put("extrapolationRows", extrapolation.size());
    p.put("seeds", Map.of("train", SEED_TRAIN, "validation", SEED_VALIDATION, "test", SEED_TEST,
        "extrapolation", SEED_EXTRAPOLATION, "permutation", SEED_PERMUTATION,
        "boosting", GradientBoostedTrees.DEFAULT.seed()));
    p.put("neutralProbability", ScenarioDataset.NEUTRAL_PROBABILITY);
    List<Object> ranges = new ArrayList<>();
    for (int i = 0; i < StressFactors.DEFINITIONS.size(); i++) {
      StressFactors.Definition d = StressFactors.DEFINITIONS.get(i);
      Map<String, Object> r = new LinkedHashMap<>();
      r.put("factor", d.key());
      r.put("label", d.label());
      r.put("trainingMin", ScenarioDataset.TRAINING_RANGE[i][0]);
      r.put("trainingMax", ScenarioDataset.TRAINING_RANGE[i][1]);
      r.put("acceptedMin", d.min());
      r.put("acceptedMax", d.max());
      ranges.add(r);
    }
    p.put("samplingRanges", ranges);
    p.put("description", List.of(
        "Chaque scénario tire chaque facteur : neutre avec une probabilité de 40 %, sinon uniformément dans sa plage "
            + "d'entraînement. Il est évalué pour les deux banques par le moteur exact.",
        "Quatre jeux disjoints, générés avec des graines différentes : entraînement, validation (utilisée seulement "
            + "pour l'arrêt précoce), test (même distribution, jamais vu) et extrapolation (plages complètes, plus "
            + "sévères que l'entraînement).",
        "Aucun hyperparamètre n'est réglé sur le jeu de test."));
    return p;
  }

  private static List<Object> modelDescriptions() {
    GradientBoostedTrees.Params g = GradientBoostedTrees.DEFAULT;
    return List.of(
        Map.of("id", "MEAN", "label", "Moyenne d'entraînement",
            "description", "Prédit toujours la moyenne : le plancher qu'un modèle utile doit battre."),
        Map.of("id", "LINEAR", "label", "Régression linéaire",
            "description", "Moindres carrés sur facteurs standardisés : un coefficient par facteur, aucune "
                + "interaction. Modèle de référence transparent."),
        Map.of("id", "GBM", "label", "Arbres de régression avec gradient boosting",
            "description", "Somme d'arbres de profondeur " + g.maxDepth() + " ajustés successivement sur les résidus "
                + "(taux d'apprentissage " + g.learningRate() + ", sous-échantillonnage " + g.subsample()
                + ", au moins " + g.minLeaf() + " observations par feuille, arrêt précoce après " + g.patience()
                + " itérations sans progrès sur la validation, au plus " + g.maxRounds() + " itérations ; le nombre "
                + "retenu est indiqué pour chaque cible). Capte les interactions et les effets non linéaires."));
  }

  private static Map<String, Object> evaluate(Fitted f, Data data, Target target) {
    double[] y = data.target(target);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("MEAN", scores(y, f.mean().predictAll(data.x())));
    out.put("LINEAR", scores(y, f.linear().predictAll(data.x())));
    out.put("GBM", scores(y, f.gbm().predictAll(data.x())));
    return out;
  }

  private static Map<String, Object> scores(double[] y, double[] p) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("mae", StressService.round(Metrics.mae(y, p), 6));
    m.put("rmse", StressService.round(Metrics.rmse(y, p), 6));
    m.put("r2", StressService.round(Metrics.r2(y, p), 6));
    return m;
  }

  private static double[][] predictions(Fitted f, Data data) {
    return new double[][] {f.linear().predictAll(data.x()), f.gbm().predictAll(data.x())};
  }

  private static List<Object> importance(Fitted f, Data test, Target target) {
    Explanations.Importance[] gbm = Explanations.permutationImportance(f.gbm(), test.x(), test.target(target),
        PERMUTATION_REPEATS, SEED_PERMUTATION);
    Explanations.Importance[] lin = Explanations.permutationImportance(f.linear(), test.x(), test.target(target),
        PERMUTATION_REPEATS, SEED_PERMUTATION);
    List<Object> out = new ArrayList<>();
    for (int j = 0; j < ScenarioDataset.FEATURES.size(); j++) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("feature", ScenarioDataset.FEATURES.get(j));
      m.put("label", featureLabel(j));
      m.put("gbm", StressService.round(gbm[j].mean(), 6));
      m.put("gbmStd", StressService.round(gbm[j].std(), 6));
      m.put("linear", StressService.round(lin[j].mean(), 6));
      out.add(m);
    }
    return out;
  }

  private static List<Object> coefficients(LinearModel linear) {
    double[] std = linear.standardisedCoefficients();
    double[] unit = linear.unitCoefficients();
    List<Object> out = new ArrayList<>();
    for (int j = 0; j < std.length; j++) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("feature", ScenarioDataset.FEATURES.get(j));
      m.put("label", featureLabel(j));
      m.put("perStandardDeviation", StressService.round(std[j], 6));
      m.put("perUnit", StressService.round(unit[j], 8));
      out.add(m);
    }
    return out;
  }

  static String featureLabel(int j) {
    return j < StressFactors.DEFINITIONS.size() ? StressFactors.DEFINITIONS.get(j).label()
        : "Banque participative (0/1)";
  }

  private static List<Object> downsample(double[] curve, int points) {
    List<Object> out = new ArrayList<>();
    if (curve.length == 0) return out;
    int step = Math.max(1, curve.length / points);
    for (int i = 0; i < curve.length; i += step) out.add(List.of(i + 1, StressService.round(curve[i], 6)));
    if ((curve.length - 1) % step != 0) {
      out.add(List.of(curve.length, StressService.round(curve[curve.length - 1], 6)));
    }
    return out;
  }

  /** A row breaches when its CET1 ratio falls below 7 % or its LCR below 100 %. */
  static boolean breach(double baseCet1, double cet1ChangePp, double baseLcr, double lcrChangePp) {
    return baseCet1 + cet1ChangePp / 100 < StressEngine.CET1_MINIMUM
        || baseLcr + lcrChangePp / 100 < StressEngine.LCR_MINIMUM;
  }

  private static Map<String, Object> breachDetection(Data test, Data extrapolation, Map<Target, double[][]> testPred,
      Map<Target, double[][]> extraPred) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("definition", "Franchissement d'un seuil : ratio CET1 sous 7 % ou LCR sous 100 % à un an. Le modèle "
        + "prédit les deux variations ; le franchissement prédit est comparé au franchissement calculé par le moteur.");
    out.put("test", classification(test, testPred));
    out.put("extrapolation", classification(extrapolation, extraPred));
    return out;
  }

  private static Map<String, Object> classification(Data data, Map<Target, double[][]> pred) {
    double[] cet1 = data.target(Target.CET1_CHANGE_PP);
    double[] lcr = data.target(Target.LCR_CHANGE_PP);
    boolean[] actual = new boolean[data.size()];
    for (int i = 0; i < actual.length; i++) {
      actual[i] = breach(data.baselineCet1()[i], cet1[i], data.baselineLcr()[i], lcr[i]);
    }
    Map<String, Object> out = new LinkedHashMap<>();
    String[] names = {"LINEAR", "GBM"};
    for (int m = 0; m < names.length; m++) {
      boolean[] predicted = new boolean[actual.length];
      for (int i = 0; i < actual.length; i++) {
        predicted[i] = breach(data.baselineCet1()[i], pred.get(Target.CET1_CHANGE_PP)[m][i],
            data.baselineLcr()[i], pred.get(Target.LCR_CHANGE_PP)[m][i]);
      }
      Metrics.Classification c = Metrics.classify(actual, predicted);
      Map<String, Object> s = new LinkedHashMap<>();
      s.put("rows", actual.length);
      s.put("actualBreaches", c.positives());
      s.put("truePositive", c.truePositive());
      s.put("falsePositive", c.falsePositive());
      s.put("falseNegative", c.falseNegative());
      s.put("trueNegative", c.trueNegative());
      s.put("precision", nanToNull(c.precision()));
      s.put("recall", nanToNull(c.recall()));
      s.put("accuracy", StressService.round(c.accuracy(), 6));
      out.put(names[m], s);
    }
    return out;
  }

  private static Object nanToNull(double v) {
    return Double.isNaN(v) ? null : StressService.round(v, 6);
  }

  // ------------------------------------------------------------------ per-scenario estimate

  /**
   * Model estimates for one bank under one scenario, next to the engine's exact values, with the model's local
   * Shapley explanation and its agreement with the engine's own Shapley decomposition.
   */
  Map<String, Object> estimate(BankProfile bank, StressFactors f, Map<Target, Double> engine,
      Map<Target, double[]> engineShapleyPp) {
    Trained t = trained();
    double[] x = ScenarioDataset.features(f, bank);
    double[] reference = ScenarioDataset.features(StressFactors.NEUTRAL, bank);
    int[] players = new int[StressFactors.DEFINITIONS.size()];
    for (int i = 0; i < players.length; i++) players[i] = i;

    Map<String, Object> out = new LinkedHashMap<>();
    out.put("outsideTrainingRange", outsideTrainingRange(f));
    for (Target target : Target.values()) {
      Fitted fitted = t.models().get(target);
      double gbm = fitted.gbm().predict(x);
      double linear = fitted.linear().predict(x);
      double exact = engine.get(target);
      double[] phiModel = Explanations.shapley(fitted.gbm(), x, reference, players);
      double[] phiEngine = engineShapleyPp.get(target);
      List<Object> contributions = new ArrayList<>();
      double absGap = 0;
      double absEngine = 0;
      for (int i = 0; i < players.length; i++) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("factor", StressFactors.DEFINITIONS.get(i).key());
        c.put("label", StressFactors.DEFINITIONS.get(i).label());
        c.put("model", StressService.round(phiModel[i], 6));
        c.put("engine", StressService.round(phiEngine[i], 6));
        contributions.add(c);
        absGap += Math.abs(phiModel[i] - phiEngine[i]);
        absEngine += Math.abs(phiEngine[i]);
      }
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("label", target.label);
      m.put("gbm", StressService.round(gbm, 6));
      m.put("linear", StressService.round(linear, 6));
      m.put("engine", StressService.round(exact, 6));
      m.put("gbmError", StressService.round(gbm - exact, 6));
      m.put("linearError", StressService.round(linear - exact, 6));
      m.put("modelReference", StressService.round(fitted.gbm().predict(reference), 6));
      m.put("contributions", contributions);
      m.put("explanationGap", absEngine < 1e-9 ? null : StressService.round(absGap / absEngine, 6));
      // With no engine change there is nothing to explain, so the comparison of top factors is undefined.
      m.put("sameTopFactor", absEngine < 1e-9 ? null : topFactor(phiModel) == topFactor(phiEngine));
      out.put(target.name(), m);
    }
    return out;
  }

  private static int topFactor(double[] phi) {
    int best = 0;
    for (int i = 1; i < phi.length; i++) if (Math.abs(phi[i]) > Math.abs(phi[best])) best = i;
    return best;
  }
}
