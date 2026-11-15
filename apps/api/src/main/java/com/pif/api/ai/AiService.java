package com.pif.api.ai;

import com.pif.api.security.AuthUser;
import com.pif.api.stress.ml.Explanations;
import com.pif.api.trading.PortfoliosService;
import com.pif.api.web.ApiException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class AiService {

  private final AiModelRegistry registry = new AiModelRegistry();
  private final PortfoliosService portfolios;

  @Autowired
  public AiService(ObjectProvider<PortfoliosService> portfolios) {
    this.portfolios = portfolios == null ? null : portfolios.getIfAvailable();
  }

  /** Constructeur de test sans portefeuille lié. */
  AiService(PortfoliosService portfolios) {
    this.portfolios = portfolios;
  }

  public Map<String, Object> overview() {
    Map<String, AiModelRegistry.Fitted> models = registry.ensure();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("title", "Analyses IA — Market Trading Room");
    body.put("disclaimer",
        "Tous les modèles s'entraînent sur des séries synthétiques reproductibles. Ce n'est ni un conseil "
            + "d'investissement ni une prédiction de marchés réels.");
    body.put("models", models.values().stream().map(f -> Map.of(
        "id", f.id(),
        "title", f.title(),
        "testR2", ((Map<?, ?>) ((Map<?, ?>) f.card().get("metrics")).get("test")).get("r2"))).toList());
    body.put("capabilities", List.of("predictions", "recommendations", "agent", "sentiment", "explanations"));
    body.put("modelKinds", List.of(
        Map.of("id", "linear", "label", "Régression linéaire", "trained", true),
        Map.of("id", "gbm", "label", "Gradient boosting", "trained", true),
        Map.of("id", "gbm-baseline", "label", "Mouvement brownien géométrique (référence)", "trained", false),
        Map.of("id", "sentiment-lexicon", "label", "Analyse lexicale déterministe", "trained", false),
        Map.of("id", "rule-agent", "label", "Agent à règles sur prédiction GBM", "trained", false)));
    return body;
  }

  public Map<String, Object> model(String id) {
    return fitted(id).card();
  }

  public Map<String, Object> importance(String id) {
    AiModelRegistry.Fitted fitted = fitted(id);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("modelId", fitted.id());
    body.put("method", "permutation_importance");
    body.put("features", fitted.card().get("globalImportance"));
    body.put("note", "Hausse du RMSE hors échantillon lorsque la variable est mélangée.");
    return body;
  }

  public Map<String, Object> insights() {
    return insights(null);
  }

  public Map<String, Object> insights(AuthUser user) {
    AiModelRegistry.Fitted gbm = fitted(AiModelRegistry.MODEL_GBM);
    AiDataset.Sample last = gbm.split().test().get(gbm.split().test().size() - 1);
    double prediction = gbm.model().predict(last.x());
    List<Map<String, Object>> items = new ArrayList<>();
    items.add(insight("insight-dernier-test", "PREDICTION",
        "Prédiction de rendement J+1 (échantillon de test)",
        "Le modèle GBM estime un rendement suivant de " + pct(prediction) + " sur la dernière observation de test ("
            + last.day() + ").",
        confidenceFromError(gbm), gbm.id(), last));

    Map<String, Object> portfolioCtx = portfolioContext(user);
    items.add(recommendationInsight(gbm, last, portfolioCtx));

    Map<String, Object> agent = agentProposal(gbm, last, portfolioCtx);
    items.add(insight("insight-agent", "AGENT",
        "Proposition de l'agent à règles",
        (String) agent.get("rationale"),
        (Double) agent.get("confidence"), gbm.id(), last));

    List<Map<String, Object>> sentiments = SentimentLexicon.SYNTHETIC_HEADLINES.stream()
        .map(SentimentLexicon::score)
        .map(SentimentLexicon::asMap)
        .toList();
    double avg = sentiments.stream().mapToDouble(s -> ((Number) s.get("score")).doubleValue()).average().orElse(0);
    items.add(insight("insight-sentiment", "SENTIMENT",
        "Sentiment synthétique (méthode lexicale)",
        "Score moyen lexique = " + round4(avg) + " (" + (avg > 0.15 ? "positif" : avg < -0.15 ? "négatif" : "neutre")
            + ") sur " + sentiments.size()
            + " titres fictifs. Méthode déterministe — pas un modèle de langage entraîné.",
        0.5, null, null));

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("insights", items);
    body.put("sentimentFeed", sentiments);
    body.put("agent", agent);
    body.put("agentEvaluation", agentWalkForward(gbm));
    body.put("portfolioContext", portfolioCtx);
    body.put("disclaimer",
        "Les insights sont produits par des modèles entraînés hors ligne sur données synthétiques, "
            + "complétés éventuellement par le portefeuille simulé de l'utilisateur.");
    return body;
  }

  public Map<String, Object> explanation(String insightId) {
    AiModelRegistry.Fitted gbm = fitted(AiModelRegistry.MODEL_GBM);
    AiDataset.Sample last = gbm.split().test().get(gbm.split().test().size() - 1);
    if (!insightId.startsWith("insight-")) {
      throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Insight introuvable.");
    }
    double[] x = last.x();
    double[] reference = gbm.featureMeans();
    int[] players = new int[x.length];
    for (int i = 0; i < players.length; i++) players[i] = i;
    double[] phi = Explanations.shapley(gbm.model(), x, reference, players);
    double pred = gbm.model().predict(x);
    double base = gbm.model().predict(reference);
    double sum = 0;
    List<Map<String, Object>> contributions = new ArrayList<>();
    for (int i = 0; i < phi.length; i++) {
      sum += phi[i];
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("feature", AiDataset.FEATURE_NAMES[i]);
      row.put("value", round6(x[i]));
      row.put("contribution", round6(phi[i]));
      row.put("direction", phi[i] >= 0 ? "HAUSSE_PREDICTION" : "BAISSE_PREDICTION");
      contributions.add(row);
    }
    contributions.sort((a, b) -> Double.compare(Math.abs((Double) b.get("contribution")),
        Math.abs((Double) a.get("contribution"))));

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("insightId", insightId);
    body.put("modelId", gbm.id());
    body.put("method", "shapley_interventional");
    body.put("prediction", round6(pred));
    body.put("baseline", round6(base));
    body.put("sumContributions", round6(sum));
    body.put("identityCheck", Math.abs((pred - base) - sum) < 1e-9);
    body.put("contributions", contributions);
    body.put("summary", summaryFr(contributions, pred));
    body.put("limitations", List.of(
        "Valeurs de Shapley exactes sur les variables retenues, avec référence = moyenne d'entraînement.",
        "Elles expliquent le modèle, pas le marché réel."));
    return body;
  }

  public Map<String, Object> predictLatest() {
    AiModelRegistry.Fitted gbm = fitted(AiModelRegistry.MODEL_GBM);
    AiModelRegistry.Fitted linear = fitted(AiModelRegistry.MODEL_LINEAR);
    AiDataset.Sample last = gbm.split().test().get(gbm.split().test().size() - 1);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("day", last.day());
    body.put("features", featureMap(last.x()));
    body.put("predictionGbm", round6(gbm.model().predict(last.x())));
    body.put("predictionLinear", round6(linear.model().predict(last.x())));
    body.put("actualNextReturn", round6(last.y()));
    body.put("note",
        "Observation de test chronologique ; la cible réelle est connue pour l'évaluation, pas pour l'entraînement.");
    return body;
  }

  private AiModelRegistry.Fitted fitted(String id) {
    AiModelRegistry.Fitted f = registry.ensure().get(id);
    if (f == null) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Modèle introuvable : " + id);
    return f;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> portfolioContext(AuthUser user) {
    Map<String, Object> ctx = new LinkedHashMap<>();
    ctx.put("available", false);
    if (user == null || portfolios == null) {
      ctx.put("reason", "Aucun portefeuille chargé pour cette requête.");
      return ctx;
    }
    try {
      Map<String, Object> list = portfolios.list(user);
      List<Map<String, Object>> items = (List<Map<String, Object>>) list.get("portfolios");
      if (items == null || items.isEmpty()) {
        ctx.put("reason", "Créez un portefeuille simulé pour lier les recommandations à vos positions.");
        return ctx;
      }
      Map<String, Object> pf = items.get(0);
      List<Map<String, Object>> positions = (List<Map<String, Object>>) pf.get("positions");
      double maxWeight = 0;
      String topSymbol = null;
      int count = positions == null ? 0 : positions.size();
      if (positions != null) {
        for (Map<String, Object> p : positions) {
          Number w = (Number) p.get("weight");
          double weight = w == null ? 0 : w.doubleValue();
          if (weight > maxWeight) {
            maxWeight = weight;
            topSymbol = (String) p.get("symbol");
          }
        }
      }
      ctx.put("available", true);
      ctx.put("portfolioId", pf.get("id"));
      ctx.put("name", pf.get("name"));
      ctx.put("equity", pf.get("equity"));
      ctx.put("positionCount", count);
      ctx.put("maxWeight", round4(maxWeight));
      ctx.put("topSymbol", topSymbol);
      ctx.put("cashWeight", equityCashWeight(pf));
      return ctx;
    } catch (RuntimeException ex) {
      ctx.put("reason", "Impossible de lire le portefeuille pour la recommandation.");
      return ctx;
    }
  }

  private static double equityCashWeight(Map<String, Object> pf) {
    Number equity = (Number) pf.get("equity");
    Number cash = (Number) pf.get("cash");
    if (equity == null || cash == null || equity.doubleValue() <= 0) return 0;
    return round4(cash.doubleValue() / equity.doubleValue());
  }

  private static Map<String, Object> recommendationInsight(AiModelRegistry.Fitted gbm, AiDataset.Sample last,
      Map<String, Object> portfolioCtx) {
    boolean linked = Boolean.TRUE.equals(portfolioCtx.get("available"));
    String detail;
    double confidence = 0.55;
    if (linked) {
      double maxW = ((Number) portfolioCtx.get("maxWeight")).doubleValue();
      String top = (String) portfolioCtx.get("topSymbol");
      int n = ((Number) portfolioCtx.get("positionCount")).intValue();
      if (maxW > 0.35) {
        detail = "Portefeuille « " + portfolioCtx.get("name") + " » : " + top + " pèse "
            + pct(maxW)
            + " de l'actif net. Au-delà de 35 %, la règle pédagogique recommande de réduire la concentration "
            + "(aucune opération réelle). Prédiction GBM J+1 = " + pct(gbm.model().predict(last.x())) + ".";
        confidence = 0.7;
      } else if (n < 3) {
        detail = "Portefeuille lié avec " + n
            + " position(s). Objectif pédagogique : viser au moins trois lignes pour limiter le risque idiosyncratique. "
            + "Prédiction GBM J+1 = " + pct(gbm.model().predict(last.x())) + ".";
      } else {
        detail = "Portefeuille lié (« " + portfolioCtx.get("name") + " », " + n
            + " positions, poids max " + pct(maxW)
            + "). Aucun dépassement de concentration critique. Prédiction GBM J+1 = "
            + pct(gbm.model().predict(last.x())) + ".";
        confidence = 0.6;
      }
    } else {
      detail = "Lorsque le momentum 20 jours et l'écart à la moyenne sont élevés ensemble, le modèle tend à anticiper "
          + "un retour. Sans portefeuille connecté : " + portfolioCtx.getOrDefault("reason", "")
          + " En simulation, limitez la concentration sur un seul symbole fictif.";
    }
    return insight("insight-reco-concentration", "RECOMMENDATION",
        linked ? "Recommandation liée au portefeuille simulé" : "Recommandation pédagogique de diversification",
        detail, confidence, gbm.id(), last);
  }

  private static Map<String, Object> agentProposal(AiModelRegistry.Fitted gbm, AiDataset.Sample last,
      Map<String, Object> portfolioCtx) {
    double pred = gbm.model().predict(last.x());
    String action = pred > 0.002 ? "ACHETER" : pred < -0.002 ? "VENDRE" : "CONSERVER";
    double confidence = Math.min(0.85, 0.45 + Math.abs(pred) * 40);
    if (Boolean.TRUE.equals(portfolioCtx.get("available"))) {
      double maxW = ((Number) portfolioCtx.get("maxWeight")).doubleValue();
      if ("ACHETER".equals(action) && maxW > 0.4) {
        action = "CONSERVER";
        confidence = Math.min(confidence, 0.5);
      }
    }
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("action", action);
    m.put("confidence", round4(confidence));
    m.put("predictedReturn", round6(pred));
    m.put("policy", "regle_seuil_gbm_plus_contrainte_concentration");
    m.put("rationale", "L'agent à règles propose " + action.toLowerCase(Locale.ROOT)
        + " car la prédiction GBM de rendement J+1 vaut " + pct(pred)
        + (Boolean.TRUE.equals(portfolioCtx.get("available"))
            ? " et la contrainte de concentration du portefeuille simulé a été appliquée."
            : " sur la dernière observation de test.")
        + " Décision informative uniquement — pas d'accès aux prix futurs.");
    m.put("humanInTheLoop", true);
    m.put("kind", "RULE_AGENT");
    return m;
  }

  /** Directional accuracy of the rule agent vs a always-hold baseline on the chronological test set. */
  private static Map<String, Object> agentWalkForward(AiModelRegistry.Fitted gbm) {
    List<AiDataset.Sample> test = gbm.split().test();
    int correct = 0;
    int actionable = 0;
    double pnlProxy = 0;
    double holdPnl = 0;
    for (AiDataset.Sample s : test) {
      double pred = gbm.model().predict(s.x());
      String action = pred > 0.002 ? "ACHETER" : pred < -0.002 ? "VENDRE" : "CONSERVER";
      holdPnl += 0;
      if ("CONSERVER".equals(action)) continue;
      actionable++;
      boolean right = ("ACHETER".equals(action) && s.y() > 0) || ("VENDRE".equals(action) && s.y() < 0);
      if (right) correct++;
      pnlProxy += "ACHETER".equals(action) ? s.y() : -s.y();
    }
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("method", "walk_forward_test_set");
    m.put("samples", test.size());
    m.put("actionable", actionable);
    m.put("directionalAccuracy", actionable == 0 ? null : round4(correct / (double) actionable));
    m.put("ruleAgentCumulativeSignedReturn", round6(pnlProxy));
    m.put("holdBaselineCumulativeReturn", round6(holdPnl));
    m.put("note",
        "Évaluation hors échantillon sur série synthétique. L'agent n'est pas un réseau entraîné de bout en bout.");
    return m;
  }

  private static Map<String, Object> insight(String id, String kind, String title, String detail, double confidence,
      String modelId, AiDataset.Sample sample) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", id);
    m.put("kind", kind);
    m.put("title", title);
    m.put("detail", detail);
    m.put("confidence", round4(confidence));
    m.put("modelId", modelId);
    m.put("hasExplanation", modelId != null);
    if (sample != null) m.put("day", sample.day());
    return m;
  }

  private static double confidenceFromError(AiModelRegistry.Fitted fitted) {
    @SuppressWarnings("unchecked")
    Map<String, Object> test = (Map<String, Object>) ((Map<?, ?>) fitted.card().get("metrics")).get("test");
    double r2 = ((Number) test.get("r2")).doubleValue();
    return round4(Math.max(0.35, Math.min(0.9, 0.5 + 0.4 * Math.max(0, r2))));
  }

  private static Map<String, Object> featureMap(double[] x) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < AiDataset.FEATURE_NAMES.length; i++) m.put(AiDataset.FEATURE_NAMES[i], round6(x[i]));
    return m;
  }

  private static String summaryFr(List<Map<String, Object>> contributions, double pred) {
    String top = (String) contributions.get(0).get("feature");
    double c = (Double) contributions.get(0).get("contribution");
    return "Prédiction " + pct(pred) + ". Principale contribution : " + top + " (" + (c >= 0 ? "+" : "") + round6(c)
        + ").";
  }

  private static String pct(double v) {
    return String.format(Locale.FRANCE, "%+.2f %%", v * 100);
  }

  private static double round4(double v) {
    return Math.round(v * 10_000.0) / 10_000.0;
  }

  private static double round6(double v) {
    return Math.round(v * 1_000_000.0) / 1_000_000.0;
  }
}
