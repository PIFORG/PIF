package com.pif.api.learning.engine;

import com.pif.api.finance.Money;
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

  public static final String RULE_BASED_MENTOR_LABEL = "Rule-based mentor (no AI provider configured)";

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
      return new Diagnosis("NEAR_LOSS_LIMIT", "Loss limit",
          List.of("You are down " + pct(lossPct) + "; the mission fails at " + Js.str(maxLoss) + " %."),
          "You have used most of your loss budget. With " + pct(current.exposure() * 100) + " of equity invested, a "
              + "further 10 % fall in your holdings would cost about " + pct(current.exposure() * 10) + " of equity. "
              + "Reducing exposure or adding stops limits how much more you can lose.",
          List.of("How much further can your portfolio fall before the mission fails?",
              "Which position contributes most to that risk?"));
    }

    for (ObjectiveResult atRisk : objectives) {
      if (!"AT_RISK".equals(atRisk.status())) continue;
      return new Diagnosis("OBJECTIVE_AT_RISK", atRisk.label(), List.of(atRisk.detail()),
          "This objective is currently not satisfied: " + atRisk.detail()
              + " Fix it before you advance, because the end-of-day snapshot is what counts.",
          List.of("Which of your positions breaks this rule right now?",
              "What is the smallest change that would satisfy it?"));
    }

    List<Order> ratedAll = state.orders.stream()
        .filter(o -> !"REJECTED".equals(o.status) && o.confidence != null).toList();
    List<Order> rated = ratedAll.subList(Math.max(0, ratedAll.size() - 3), ratedAll.size());
    double sum = 0;
    for (Order o : rated) sum = sum + o.confidence;
    double meanConfidence = rated.isEmpty() ? 0 : sum / rated.size();
    if (rated.size() >= 2 && meanConfidence >= 80) {
      return new Diagnosis("HIGH_CONFIDENCE", "Confidence",
          List.of("Your last " + rated.size() + " orders averaged " + Js.toFixed(meanConfidence, 0)
              + " % stated confidence."),
          "You are rating your recent orders as near-certain. Markets rarely justify that: high confidence should be "
              + "rare and backed by evidence you could explain to someone who disagrees. Consider sizing positions as "
              + "if you could be wrong.",
          List.of("What do you know that the rest of the market does not?",
              "If this view turned out wrong tomorrow, how much would it cost you?"));
    }

    MarketEventDefinition recent = null;
    for (MarketEventDefinition e : mission.scenario().events()) {
      if (e.step() <= state.step && e.step() >= state.step - 1 && !"POSITIVE".equals(e.sentiment())) recent = e;
    }
    if (recent != null) {
      int from = recent.step();
      boolean answered = state.orders.stream().anyMatch(o -> o.createdStep >= from && !"REJECTED".equals(o.status));
      if (!answered) {
        return new Diagnosis("UNANSWERED_EVENT", "Market event",
            List.of("Headline: “" + recent.headline() + "”.", "You have not placed an order since it was published."),
            "A headline just changed the picture. Holding can be a valid choice, but it should be a decision: check "
                + "which of your holdings are exposed and whether your loss limit still holds.",
            List.of("Does this news change the long-term value of what you hold, or only its short-term price?",
                "If you did nothing, what would your plan be if prices fell another 5 %?"));
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
        return new Diagnosis("STRESS_TEST_DUE", "Stress test",
            List.of(deadline == null ? "No stress test run yet."
                : "A stress test is required before step " + deadline + "; you are at step " + state.step + "."),
            "Run a stress test to see what a severe but plausible shock would cost your current portfolio. Compare the "
                + "estimated loss with your loss limit.",
            List.of("If equities fell 20 % tomorrow, would you still be inside your loss limit?",
                "Which scenario worries you most for this portfolio, and why?"));
      }
    }

    Double concentrationLimit = mission.scoring().concentrationLimitPct();
    if (current.maxWeight() * 100 > (concentrationLimit == null ? 40 : concentrationLimit)) {
      List<Map.Entry<String, Double>> entries = new ArrayList<>(current.marketValue().entrySet());
      entries.sort((a, b) -> Js.compare(b.getValue(), a.getValue()));
      String largest = entries.isEmpty() ? "undefined" : entries.get(0).getKey();
      return new Diagnosis("CONCENTRATED", "Concentration",
          List.of(largest + " is " + pct(current.maxWeight() * 100) + " of your equity."),
          "One position dominates your portfolio. A bad surprise in " + largest + " alone would hit your whole account. "
              + "Spreading capital across less related assets reduces that single-name risk.",
          List.of("What would happen to your account if " + largest + " fell 20 %?",
              "Which asset in this market behaves least like your largest holding?"));
    }

    if (mission.rules().allowedOrderTypes().contains("STOP") && !current.heldSymbols().isEmpty()
        && current.protectedSymbols().isEmpty()) {
      return new Diagnosis("UNPROTECTED", "Protection",
          List.of("You hold " + String.join(", ", current.heldSymbols()) + " with no stop orders."),
          "None of your holdings has a stop. A stop sell triggers when the bid falls to your level; remember it executes "
              + "at the next bid, which can be lower after a gap.",
          List.of("At what price would you admit your idea for this position was wrong?",
              "How much would you lose if that happened?"));
    }

    if (current.exposure() < 0.3 && mission.objectives().stream().anyMatch(o -> "MIN_INVESTED".equals(o.kind()))) {
      return new Diagnosis("IDLE_CASH", "Exposure",
          List.of("Only " + pct(current.exposure() * 100) + " of your equity is invested."),
          "Most of your capital is in cash. That avoids losses, but this mission asks you to stay invested — the skill "
              + "is managing risk while invested, not avoiding the market.",
          List.of("What would make you comfortable investing more?",
              "How could you invest while still limiting your downside?"));
    }

    return new Diagnosis("PLAN_CHECK", "Your plan",
        List.of("Equity " + Js.toFixed(Money.fromAmount(equity), 3) + " DT, " + pct(current.exposure() * 100)
            + " invested, " + current.heldSymbols().size() + " asset(s) held."),
        "Your portfolio meets the visible rules right now. Before advancing, restate your plan: what you expect, and "
            + "what you will do if you are wrong.",
        List.of("What is your plan for the next few steps?", "What signal would make you change it?"));
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
    String label = last.rationale.replace('_', ' ').toLowerCase(Locale.ROOT);
    String fact = "Last order: " + last.side + " " + Js.str(last.quantity) + " " + last.symbol + " (" + last.type
        + "), reason “" + label + "”.";
    return check.consistent()
        ? new Critique(fact, "Your last order is consistent with the reason you gave ("
            + check.why().toLowerCase(Locale.ROOT) + "). Now argue the other side: what is the strongest case that it "
            + "was a mistake?", "What evidence would prove this decision wrong, and are you watching for it?")
        : new Critique(fact, "Your stated reason does not match the order: " + check.why()
            + " Either the reason or the order needs to change.", "Which was your real motivation for this order?");
  }

  public static MentorMessage mentorDuringSession(Context ctx, SimState state, String mode) {
    Diagnosis d = diagnose(ctx, state);
    if ("GUIDED".equals(mode)) {
      return new MentorMessage(mode, "RULE_BASED", RULE_BASED_MENTOR_LABEL, d.topic(), d.guided(), List.of(),
          d.facts(), d.ruleId());
    }
    if ("SOCRATIC".equals(mode)) {
      return new MentorMessage(mode, "RULE_BASED", RULE_BASED_MENTOR_LABEL, d.topic(),
          "Think it through before acting — these questions point at what matters most right now.", d.socratic(),
          d.facts(), d.ruleId());
    }
    Critique c = critique(state);
    if (c == null) {
      return new MentorMessage(mode, "RULE_BASED", RULE_BASED_MENTOR_LABEL, d.topic(),
          "You have not placed an order yet. " + d.guided(),
          List.of("What would have to be true for doing nothing to be the best choice?"), d.facts(), d.ruleId());
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
    String stated = "Stated confidence " + Js.toFixed(c.meanConfidence(), 0) + " % on " + c.orders()
        + " rated order(s)";
    String outcome = "MARKET_ADJUSTED".equals(c.method()) && c.interpretable() && c.hitRate() != null
        ? stated + "; " + Js.toFixed(c.hitRate(), 0) + " % of " + c.observations()
            + " beat the mission's equal-weight market by the end (retrospective, not scored)"
        : stated + "; too few outcomes to read as over- or under-confidence (not scored)";
    List<String> out = new ArrayList<>();
    out.add(outcome);
    for (CalibrationSignal s : c.signals()) out.add("Confidence review: " + s.detail());
    return out;
  }

  public static MentorMessage mentorDebrief(Context ctx, SimState state, Assessment assessment) {
    String outcome = assessment.failedByRule()
        ? "The mission ended early: " + assessment.failureReason()
        : assessment.passed()
            ? "You passed with " + Js.str(assessment.total()) + "/100."
            : "You scored " + Js.str(assessment.total()) + "/100; " + (assessment.requiredObjectivesMet()
                ? "the pass mark is " + Js.str(assessment.passThreshold()) + "."
                : "some required objectives were not met.");
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
            ? "Your weakest area was " + weakest.key() + " (" + Js.str(weakest.score())
                + "/100). What would you do differently there?"
            : "What would you do differently next time?",
        "Which decision are you most proud of, and was it good process or good luck?",
        "Open the Time Machine and rewind to step " + rewindStep
            + ": how would an alternative decision have changed your risk, not just your return?");
    List<String> parts = new ArrayList<>();
    parts.add(outcome);
    assessment.strengths().stream().limit(1).forEach(s -> parts.add("Strength — " + s));
    assessment.improvements().stream().limit(2).forEach(s -> parts.add("To improve — " + s));
    List<String> evidence = new ArrayList<>();
    evidence.add("Return " + Js.toFixed(assessment.metrics().totalReturnPct(), 2) + " %");
    evidence.add("Max drawdown " + Js.toFixed(assessment.metrics().maxDrawdownPct(), 2) + " %");
    evidence.add("Fills " + assessment.metrics().fills());
    evidence.add("Hints used " + assessment.hintsUsed());
    evidence.addAll(calibrationEvidence(assessment.calibration()));
    return new MentorMessage("DEBRIEF", "RULE_BASED", RULE_BASED_MENTOR_LABEL, "Mission debrief", String.join(" ", parts),
        Simulator.isMarketClosed(ctx, state) || !"ACTIVE".equals(state.status) ? questions : questions.subList(0, 2),
        List.copyOf(evidence), "DEBRIEF");
  }
}
