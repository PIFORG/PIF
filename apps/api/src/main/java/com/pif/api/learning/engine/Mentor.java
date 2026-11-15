package com.pif.api.learning.engine;

import com.pif.api.finance.Money;
import com.pif.api.learning.LearningFr;
import com.pif.api.learning.engine.Assessments.Assessment;
import com.pif.api.learning.engine.Assessments.Calibration;
import com.pif.api.learning.engine.Assessments.CalibrationSignal;
import com.pif.api.learning.engine.Assessments.ComponentScore;
import com.pif.api.learning.engine.Assessments.Consistency;
import com.pif.api.learning.engine.Definitions.FailureRule;
import com.pif.api.learning.engine.Definitions.MarketEventDefinition;
import com.pif.api.learning.engine.Definitions.MissionDefinition;
import com.pif.api.learning.engine.Definitions.ObjectiveDefinition;
import com.pif.api.learning.engine.Objectives.ObjectiveResult;
import com.pif.api.learning.engine.SimState.Order;
import com.pif.api.learning.engine.SimState.StepRecord;
import com.pif.api.learning.engine.Simulator.Context;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** The rule-based mentor (apps/api/src/learning/engine/mentor.ts). */
public final class Mentor {

  private Mentor() {}

  public static final String RULE_BASED_MENTOR_LABEL = "Mentor par règles (aucun fournisseur IA configuré)";

  public record MentorMessage(String mode, String source, String sourceLabel, String topic, String message,
      List<String> questions, List<String> evidence, String ruleId) {

    /** During a session the rule id follows the topic; in a debrief it comes last. */
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("mode", mode);
      out.put("source", source);
      out.put("sourceLabel", sourceLabel);
      out.put("topic", topic);
      boolean debrief = "DEBRIEF".equals(mode);
      if (!debrief) out.put("ruleId", ruleId);
      out.put("message", message);
      out.put("questions", questions);
      out.put("evidence", evidence);
      if (debrief) out.put("ruleId", ruleId);
      return out;
    }
  }

  public record Diagnosis(String ruleId, String topic, List<String> facts, String guided, List<String> socratic) {}

  private static String pct(double value) {
    return Js.toFixed(value, 1) + " %";
  }

  /**
   * Diagnoses the most important issue using only information visible to the learner now. Rules are checked in
   * priority order; the first that applies wins.
   */
  public static Diagnosis diagnose(Context ctx, SimState state) {
    MissionDefinition mission = ctx.mission();
    double equity = Simulator.equityOf(ctx, state);
    double lossPct = ((state.initialEquity - equity) / state.initialEquity) * 100;
    StepRecord current = state.history.get(state.history.size() - 1);
    List<ObjectiveResult> objectives = Objectives.evaluate(ctx, state);
    Double maxLoss = null;
    for (FailureRule f : mission.failure()) {
      if ("MAX_LOSS".equals(f.kind())) {
        maxLoss = f.limitPct();
        break;
      }
    }

    if (maxLoss != null && lossPct >= maxLoss * 0.7) {
      return new Diagnosis("NEAR_LOSS_LIMIT", "Limite de perte",
          List.of("Vous êtes en baisse de " + pct(lossPct) + " ; la mission échoue à " + Js.str(maxLoss) + " %."),
          "Vous avez consommé une grande partie de votre budget de perte. Avec " + pct(current.exposure() * 100)
              + " des fonds propres investis, une baisse supplémentaire de 10 % sur vos positions coûterait environ "
              + pct(current.exposure() * 10) + " des fonds propres. Réduire l'exposition ou placer des stops limite "
              + "ce que vous pouvez encore perdre.",
          List.of("Jusqu'où votre portefeuille peut-il encore baisser avant l'échec de la mission ?",
              "Quelle position contribue le plus à ce risque ?"));
    }

    for (ObjectiveResult atRisk : objectives) {
      if (!"AT_RISK".equals(atRisk.status())) continue;
      return new Diagnosis("OBJECTIVE_AT_RISK", atRisk.label(), List.of(atRisk.detail()),
          "Cet objectif n'est pas satisfait pour l'instant : " + atRisk.detail()
              + " Corrigez-le avant d'avancer : c'est le snapshot de fin de journée qui compte.",
          List.of("Quelle position enfreint cette règle maintenant ?",
              "Quel est le plus petit changement pour la respecter ?"));
    }

    List<Order> ratedAll = state.orders.stream()
        .filter(o -> !"REJECTED".equals(o.status) && o.confidence != null).toList();
    List<Order> rated = ratedAll.subList(Math.max(0, ratedAll.size() - 3), ratedAll.size());
    double sum = 0;
    for (Order o : rated) sum = sum + o.confidence;
    double meanConfidence = rated.isEmpty() ? 0 : sum / rated.size();
    if (rated.size() >= 2 && meanConfidence >= 80) {
      return new Diagnosis("HIGH_CONFIDENCE", "Confiance",
          List.of("Vos " + rated.size() + " derniers ordres affichent en moyenne "
              + Js.toFixed(meanConfidence, 0) + " % de confiance déclarée."),
          "Vous notez vos ordres récents comme quasi certains. Les marchés le justifient rarement : une confiance "
              + "élevée doit rester rare et s'appuyer sur des éléments que vous pourriez expliquer à quelqu'un qui "
              + "n'est pas d'accord. Dimensionnez comme si vous pouviez avoir tort.",
          List.of("Que savez-vous que le reste du marché ignore ?",
              "Si cette vue se révélait fausse demain, combien cela vous coûterait-il ?"));
    }

    MarketEventDefinition recent = null;
    for (MarketEventDefinition e : mission.scenario().events()) {
      if (e.step() <= state.step && e.step() >= state.step - 1 && !"POSITIVE".equals(e.sentiment())) recent = e;
    }
    if (recent != null) {
      int from = recent.step();
      boolean answered = state.orders.stream().anyMatch(o -> o.createdStep >= from && !"REJECTED".equals(o.status));
      if (!answered) {
        String headline = LearningFr.get("mission." + mission.slug() + ".event." + recent.id() + ".headline",
            recent.headline());
        return new Diagnosis("UNANSWERED_EVENT", "Actualité",
            List.of("Titre : « " + headline + " ».", "Vous n'avez passé aucun ordre depuis sa publication."),
            "Un titre vient de changer la donne. Conserver peut être un choix valide, mais ce doit être une décision : "
                + "vérifiez quelles positions sont exposées et si votre limite de perte tient toujours.",
            List.of("Cette nouvelle change-t-elle la valeur à long terme de ce que vous détenez, ou seulement le prix court terme ?",
                "Si vous ne faisiez rien, que feriez-vous si les cours baissaient encore de 5 % ?"));
      }
    }

    ObjectiveDefinition stressObjective = null;
    for (ObjectiveDefinition o : mission.objectives()) {
      if ("RUN_STRESS_TEST".equals(o.kind())) {
        stressObjective = o;
        break;
      }
    }
    if (stressObjective != null && state.stressTests.isEmpty()) {
      Integer deadline = stressObjective.beforeStep();
      if (deadline == null || state.step >= deadline - 3) {
        return new Diagnosis("STRESS_TEST_DUE", "Test de résistance",
            List.of(deadline == null ? "Aucun test de résistance lancé pour l'instant."
                : "Un test est requis avant la séance " + deadline + " ; vous êtes à la séance " + state.step + "."),
            "Lancez un test de résistance pour estimer ce qu'un choc sévère mais plausible coûterait à votre portefeuille "
                + "actuel. Comparez la perte estimée à votre limite de perte.",
            List.of("Si les actions baissaient de 20 % demain, resteriez-vous dans votre limite de perte ?",
                "Quel scénario vous inquiète le plus pour ce portefeuille, et pourquoi ?"));
      }
    }

    Double concentrationLimit = mission.scoring().concentrationLimitPct();
    if (current.maxWeight() * 100 > (concentrationLimit == null ? 40 : concentrationLimit)) {
      List<Map.Entry<String, Double>> entries = new ArrayList<>(current.marketValue().entrySet());
      entries.sort((a, b) -> Js.compare(b.getValue(), a.getValue()));
      String largest = entries.isEmpty() ? "undefined" : entries.get(0).getKey();
      return new Diagnosis("CONCENTRATED", "Concentration",
          List.of(largest + " représente " + pct(current.maxWeight() * 100) + " de vos fonds propres."),
          "Une position domine le portefeuille. Une mauvaise surprise sur " + largest + " seule toucherait tout le "
              + "compte. Répartir le capital sur des actifs moins corrélés réduit ce risque de ligne unique.",
          List.of("Que se passerait-il si " + largest + " baissait de 20 % ?",
              "Quel actif de ce marché se comporte le moins comme votre plus grosse ligne ?"));
    }

    if (mission.rules().allowedOrderTypes().contains("STOP") && !current.heldSymbols().isEmpty()
        && current.protectedSymbols().isEmpty()) {
      return new Diagnosis("UNPROTECTED", "Protection",
          List.of("Vous détenez " + String.join(", ", current.heldSymbols()) + " sans ordre stop."),
          "Aucune position n'a de stop. Un ordre stop de vente se déclenche quand le prix acheteur atteint votre "
              + "seuil ; il s'exécute au prix acheteur suivant, qui peut être plus bas après un gap.",
          List.of("À quel prix admettriez-vous que votre idée sur cette position était fausse ?",
              "Combien perdriez-vous dans ce cas ?"));
    }

    if (current.exposure() < 0.3 && mission.objectives().stream().anyMatch(o -> "MIN_INVESTED".equals(o.kind()))) {
      return new Diagnosis("IDLE_CASH", "Exposition",
          List.of("Seulement " + pct(current.exposure() * 100) + " de vos fonds propres sont investis."),
          "La majeure partie de votre capital est en liquidités. Cela évite les pertes, mais cette mission demande "
              + "de rester investi — l'enjeu est de gérer le risque en étant investi, pas d'éviter le marché.",
          List.of("Qu'est-ce qui vous rendrait à l'aise pour investir davantage ?",
              "Comment investir tout en limitant votre risque de baisse ?"));
    }

    return new Diagnosis("PLAN_CHECK", "Votre plan",
        List.of("Fonds propres " + Js.toFixed(Money.fromAmount(equity), 3) + " DT, "
            + pct(current.exposure() * 100) + " investis, " + current.heldSymbols().size() + " actif(s) détenu(s)."),
        "Votre portefeuille respecte les règles visibles pour l'instant. Avant d'avancer, reformulez votre plan : "
            + "ce que vous attendez, et ce que vous ferez si vous avez tort.",
        List.of("Quel est votre plan pour les prochaines séances ?",
            "Quel signal vous ferait le modifier ?"));
  }

  private record Critique(String fact, String message, String question) {}

  private static Critique critique(SimState state) {
    Order last = null;
    for (int i = state.orders.size() - 1; i >= 0; i--) {
      if (!"REJECTED".equals(state.orders.get(i).status)) {
        last = state.orders.get(i);
        break;
      }
    }
    if (last == null) return null;
    Consistency check = Assessments.rationaleConsistent(last);
    String fact = "Dernier ordre : " + Wording.side(last.side) + " de " + Js.str(last.quantity) + " " + last.symbol
        + " (" + Wording.orderType(last.type) + "), motif « " + Wording.rationale(last.rationale) + " ».";
    return check.consistent()
        ? new Critique(fact, "Votre dernier ordre est cohérent avec la raison indiquée ("
            + check.why().toLowerCase(Locale.ROOT) + "). Maintenant arguez l'inverse : quel est le meilleur argument "
            + "pour dire que c'était une erreur ?",
            "Quelles preuves montreraient que cette décision était fausse, et les surveillez-vous ?")
        : new Critique(fact, "La raison indiquée ne correspond pas à l'ordre : " + check.why()
            + " Modifiez la raison ou l'ordre.",
            "Quelle était votre vraie motivation pour cet ordre ?");
  }

  public static MentorMessage mentorDuringSession(Context ctx, SimState state, String mode) {
    Diagnosis d = diagnose(ctx, state);
    if ("GUIDED".equals(mode)) {
      return new MentorMessage(mode, "RULE_BASED", RULE_BASED_MENTOR_LABEL, d.topic(), d.guided(), List.of(),
          d.facts(), d.ruleId());
    }
    if ("SOCRATIC".equals(mode)) {
      return new MentorMessage(mode, "RULE_BASED", RULE_BASED_MENTOR_LABEL, d.topic(),
          "Réfléchissez avant d'agir — ces questions ciblent ce qui compte le plus maintenant.", d.socratic(),
          d.facts(), d.ruleId());
    }
    Critique c = critique(state);
    if (c == null) {
      return new MentorMessage(mode, "RULE_BASED", RULE_BASED_MENTOR_LABEL, d.topic(),
          "Vous n'avez pas encore passé d'ordre. " + d.guided(),
          List.of("Que faudrait-il pour que ne rien faire soit le meilleur choix ?"), d.facts(), d.ruleId());
    }
    List<String> questions = new ArrayList<>();
    questions.add(c.question());
    questions.addAll(d.socratic().subList(0, Math.min(1, d.socratic().size())));
    List<String> evidence = new ArrayList<>();
    evidence.add(c.fact());
    evidence.addAll(d.facts());
    return new MentorMessage(mode, "RULE_BASED", RULE_BASED_MENTOR_LABEL, d.topic(), c.message(),
        List.copyOf(questions), List.copyOf(evidence), "CRITIQUE_" + d.ruleId());
  }

  private static List<String> calibrationEvidence(Calibration c) {
    if (c.orders() == 0 || c.meanConfidence() == null) return List.of();
    String stated = "Confiance déclarée " + Js.toFixed(c.meanConfidence(), 0) + " % sur " + c.orders()
        + " ordre(s) noté(s)";
    String outcome = "MARKET_ADJUSTED".equals(c.method()) && c.interpretable() && c.hitRate() != null
        ? stated + " ; " + Js.toFixed(c.hitRate(), 0) + " % sur " + c.observations()
            + " battent le marché à poids égaux de la mission à la fin (rétrospectif, non noté)"
        : stated + " ; trop peu de résultats pour juger sur- ou sous-confiance (non noté)";
    List<String> out = new ArrayList<>();
    out.add(outcome);
    for (CalibrationSignal s : c.signals()) out.add("Revue de confiance : " + s.detail());
    return out;
  }

  public static MentorMessage mentorDebrief(Context ctx, SimState state, Assessment assessment) {
    String outcome = assessment.failedByRule()
        ? "La mission s'est arrêtée plus tôt : " + assessment.failureReason()
        : assessment.passed()
            ? "Mission réussie avec " + Js.str(assessment.total()) + "/100."
            : "Score " + Js.str(assessment.total()) + "/100 ; " + (assessment.requiredObjectivesMet()
                ? "la note de passage est " + Js.str(assessment.passThreshold()) + "."
                : "certains objectifs obligatoires ne sont pas atteints.");
    List<ComponentScore> scored = new ArrayList<>(assessment.components().stream().filter(c -> c.score() != null).toList());
    scored.sort((a, b) -> Js.compare(a.score(), b.score()));
    ComponentScore weakest = scored.isEmpty() ? null : scored.get(0);
    int rewindStep = 0;
    for (Order o : state.orders) {
      if (!"REJECTED".equals(o.status)) {
        rewindStep = o.createdStep;
        break;
      }
    }
    List<String> questions = List.of(
        weakest != null
            ? "Votre point le plus faible était " + weakest.key() + " (" + Js.str(weakest.score())
                + "/100). Que feriez-vous différemment ?"
            : "Que feriez-vous différemment la prochaine fois ?",
        "De quelle décision êtes-vous le plus fier, et s'agissait-il d'un bon processus ou de la chance ?",
        "Ouvrez la Time Machine et revenez à la séance " + rewindStep
            + " : comment une décision alternative aurait-elle changé votre risque, pas seulement votre rendement ?");
    List<String> parts = new ArrayList<>();
    parts.add(outcome);
    assessment.strengths().stream().limit(1).forEach(s -> parts.add("Point fort — " + s));
    assessment.improvements().stream().limit(2).forEach(s -> parts.add("À améliorer — " + s));
    List<String> evidence = new ArrayList<>();
    evidence.add("Rendement " + Js.toFixed(assessment.metrics().totalReturnPct(), 2) + " %");
    evidence.add("Drawdown max. " + Js.toFixed(assessment.metrics().maxDrawdownPct(), 2) + " %");
    evidence.add("Exécutions " + assessment.metrics().fills());
    evidence.add("Indices utilisés " + assessment.hintsUsed());
    evidence.addAll(calibrationEvidence(assessment.calibration()));
    return new MentorMessage("DEBRIEF", "RULE_BASED", RULE_BASED_MENTOR_LABEL, "Bilan de mission", String.join(" ", parts),
        Simulator.isMarketClosed(ctx, state) || !"ACTIVE".equals(state.status) ? questions : questions.subList(0, 2),
        List.copyOf(evidence), "DEBRIEF");
  }
}
