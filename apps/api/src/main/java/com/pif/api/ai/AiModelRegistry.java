package com.pif.api.ai;

import com.pif.api.stress.ml.Explanations;
import com.pif.api.stress.ml.GradientBoostedTrees;
import com.pif.api.stress.ml.LinearModel;
import com.pif.api.stress.ml.Metrics;
import com.pif.api.stress.ml.Regressor;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/** Lazy-trained market-return models with chronological evaluation and explanations. */
final class AiModelRegistry {

  static final String MODEL_GBM = "market-return-gbm";
  static final String MODEL_LINEAR = "market-return-linear";
  static final long SEED = 20261115L;
  static final int DAYS = 520;

  record Fitted(
      String id,
      String title,
      Regressor model,
      Map<String, Object> card,
      double[] featureMeans,
      AiDataset.Split split) {}

  private final AtomicReference<Map<String, Fitted>> models = new AtomicReference<>();

  Map<String, Fitted> ensure() {
    Map<String, Fitted> current = models.get();
    if (current != null) return current;
    synchronized (this) {
      current = models.get();
      if (current != null) return current;
      current = train();
      models.set(current);
      return current;
    }
  }

  private Map<String, Fitted> train() {
    AiDataset.Split split = AiDataset.build(SEED, DAYS);
    double[][] xTrain = AiDataset.matrix(split.train());
    double[] yTrain = AiDataset.targets(split.train());
    double[][] xVal = AiDataset.matrix(split.validation());
    double[] yVal = AiDataset.targets(split.validation());
    double[][] xTest = AiDataset.matrix(split.test());
    double[] yTest = AiDataset.targets(split.test());

    Regressor.MeanModel mean = Regressor.MeanModel.fit(yTrain);
    LinearModel linear = LinearModel.fit(xTrain, yTrain);
    GradientBoostedTrees gbm = GradientBoostedTrees.fit(xTrain, yTrain, xVal, yVal,
        new GradientBoostedTrees.Params(120, 0.08, 3, 15, 0.85, 25, SEED));

    double[] means = featureMeans(xTrain);
    Map<String, Fitted> out = new LinkedHashMap<>();
    out.put(MODEL_LINEAR, new Fitted(MODEL_LINEAR, "Régression linéaire (rendement J+1)", linear,
        card(MODEL_LINEAR, "Régression linéaire", "OLS sur caractéristiques standardisées", linear, mean, xTrain,
            yTrain, xVal, yVal, xTest, yTest, split),
        means, split));
    out.put(MODEL_GBM, new Fitted(MODEL_GBM, "Gradient boosting (rendement J+1)", gbm,
        card(MODEL_GBM, "Gradient boosting", "Arbres boostés avec arrêt anticipé sur validation", gbm, mean, xTrain,
            yTrain, xVal, yVal, xTest, yTest, split),
        means, split));
    return out;
  }

  private static Map<String, Object> card(String id, String title, String method, Regressor model,
      Regressor.MeanModel mean, double[][] xTrain, double[] yTrain, double[][] xVal, double[] yVal, double[][] xTest,
      double[] yTest, AiDataset.Split split) {
    Explanations.Importance[] importance = Explanations.permutationImportance(model, xTest, yTest, 8, SEED + 7);
    List<Map<String, Object>> global = new ArrayList<>();
    for (int i = 0; i < AiDataset.FEATURE_NAMES.length; i++) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("feature", AiDataset.FEATURE_NAMES[i]);
      row.put("importanceMean", round6(importance[i].mean()));
      row.put("importanceStd", round6(importance[i].std()));
      global.add(row);
    }
    Map<String, Object> card = new LinkedHashMap<>();
    card.put("id", id);
    card.put("title", title);
    card.put("method", method);
    card.put("target", "Rendement journalier suivant (simulé)");
    card.put("dataProvenance", "Série synthétique déterministe (graine " + SEED + ") — pas des cotations réelles.");
    card.put("split", Map.of(
        "train", split.train().size(),
        "validation", split.validation().size(),
        "test", split.test().size(),
        "protocol", "Découpage chronologique 60/20/20 — aucune donnée future dans l'entraînement."));
    card.put("metrics", Map.of(
        "train", metrics(model, xTrain, yTrain),
        "validation", metrics(model, xVal, yVal),
        "test", metrics(model, xTest, yTest),
        "baselineMeanTest", metrics(mean, xTest, yTest)));
    card.put("globalImportance", global);
    card.put("limitations", List.of(
        "Les prix sont synthétiques ; les métriques ne mesurent pas la performance sur marchés réels.",
        "Le modèle prédit un rendement journalier, pas un conseil d'investissement.",
        "L'importance par permutation décrit la dépendance du modèle, pas la causalité économique."));
    return card;
  }

  private static Map<String, Object> metrics(Regressor model, double[][] x, double[] y) {
    double[] p = model.predictAll(x);
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("rmse", round6(Metrics.rmse(y, p)));
    m.put("mae", round6(Metrics.mae(y, p)));
    m.put("r2", round6(Metrics.r2(y, p)));
    m.put("n", y.length);
    return m;
  }

  private static double[] featureMeans(double[][] x) {
    int p = x[0].length;
    double[] m = new double[p];
    for (double[] row : x) for (int j = 0; j < p; j++) m[j] += row[j] / x.length;
    return m;
  }

  private static double round6(double v) {
    return Math.round(v * 1_000_000.0) / 1_000_000.0;
  }
}
