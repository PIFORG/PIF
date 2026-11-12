package com.pif.api.learning.engine;

import com.pif.api.finance.Risk;
import com.pif.api.learning.engine.Definitions.MarketEventDefinition;
import com.pif.api.learning.engine.Definitions.ObjectiveDefinition;
import com.pif.api.learning.engine.SimState.Order;
import com.pif.api.learning.engine.SimState.StepRecord;
import com.pif.api.learning.engine.Simulator.Context;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Objective evaluation (apps/api/src/learning/engine/objectives.ts). PENDING: nothing decisive yet. ON_TRACK:
 * satisfied so far, can still be lost. AT_RISK: currently violated but still recoverable. MET / NOT_MET: final
 * outcome. FAILED: irrecoverably violated before the end.
 */
public final class Objectives {

  private Objectives() {}

  public record ObjectiveResult(String id, String kind, String label, boolean required, String status, String detail) {
    public Map<String, Object> toJson() {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("id", id);
      out.put("kind", kind);
      out.put("label", label);
      out.put("required", required);
      out.put("status", status);
      out.put("detail", detail);
      return out;
    }
  }

  private record Evaluation(String status, String detail) {}

  public static boolean isSatisfied(String status) {
    return "MET".equals(status) || "ON_TRACK".equals(status);
  }

  private static Evaluation evaluate(Context ctx, SimState state, ObjectiveDefinition objective) {
    boolean fin = !"ACTIVE".equals(state.status);
    StepRecord current = state.history.get(state.history.size() - 1);

    switch (objective.kind()) {
      case "EXECUTE_ORDER": {
        int count = 0;
        for (Order o : state.orders) {
          if (o.filledQuantity > 0 && (objective.side() == null || objective.side().isEmpty() || o.side.equals(objective.side()))
              && (objective.orderType() == null || objective.orderType().isEmpty() || o.type.equals(objective.orderType()))) {
            count++;
          }
        }
        int needed = objective.minCount() == null ? 1 : objective.minCount();
        return open(fin, count >= needed, count + " qualifying order(s) executed.",
            count + " of " + needed + " qualifying order(s) executed so far.");
      }
      case "PROTECTIVE_STOP": {
        boolean protectedOnce = state.history.stream().anyMatch(h -> !h.protectedSymbols().isEmpty())
            || state.orders.stream().anyMatch(o -> "STOP".equals(o.type) && o.filledQuantity > 0);
        return open(fin, protectedOnce, "A stop order protected a position.",
            "No position has been protected by a stop order yet.");
      }
      case "MAX_DRAWDOWN": {
        double dd = Risk.maxDrawdown(Metrics.equitySeries(state)) * 100;
        String limit = Js.str(objective.limitPct());
        return holding(fin, dd <= objective.limitPct(), "Maximum drawdown " + Js.toFixed(dd, 2) + " % (limit " + limit + " %).",
            "Drawdown reached " + Js.toFixed(dd, 2) + " %, above the " + limit + " % limit.");
      }
      case "MAX_LOSS": {
        double worst = Double.POSITIVE_INFINITY;
        for (StepRecord h : state.history) worst = Math.min(worst, h.equity());
        double lossPct = Math.max(0, ((state.initialEquity - worst) / state.initialEquity) * 100);
        String limit = Js.str(objective.limitPct());
        return holding(fin, lossPct < objective.limitPct(),
            "Largest loss from the start " + Js.toFixed(lossPct, 2) + " % (limit " + limit + " %).",
            "Loss reached " + Js.toFixed(lossPct, 2) + " %, breaching the " + limit + " % limit.");
      }
      case "MAX_POSITION_WEIGHT": {
        String limit = Js.str(objective.limitPct());
        int fromStep = objective.fromStep();
        for (StepRecord h : state.history) {
          if (h.step() >= fromStep && (fin || h.step() < state.step) && h.maxWeight() * 100 > objective.limitPct()) {
            return new Evaluation("FAILED", "At step " + h.step() + " one position was "
                + Js.toFixed(h.maxWeight() * 100, 1) + " % of equity (limit " + limit + " %).");
          }
        }
        if (!fin && current.maxWeight() * 100 > objective.limitPct() && state.step >= fromStep) {
          return new Evaluation("AT_RISK", "One position is " + Js.toFixed(current.maxWeight() * 100, 1)
              + " % of equity; bring it under " + limit + " % before advancing.");
        }
        if (!fin && state.step < fromStep) {
          return new Evaluation("PENDING", "The " + limit + " % limit applies from step " + fromStep + ".");
        }
        return new Evaluation(fin ? "MET" : "ON_TRACK", "Every position stayed at or below " + limit + " % of equity.");
      }
      case "MIN_ASSETS_HELD": {
        int held = current.heldSymbols().size();
        int count = objective.count();
        if (fin) {
          return held >= count ? new Evaluation("MET", "You ended holding " + held + " assets.")
              : new Evaluation("NOT_MET", "You ended holding " + held + " of " + count + " assets.");
        }
        return held >= count ? new Evaluation("ON_TRACK", "Holding " + held + " assets.")
            : new Evaluation("PENDING", "Holding " + held + " of " + count + " assets.");
      }
      case "MIN_INVESTED": {
        List<StepRecord> judged = new ArrayList<>();
        for (StepRecord h : state.history) {
          if (h.step() >= 1) judged.add(h);
        }
        List<StepRecord> sample = judged.isEmpty() ? List.of(current) : judged;
        double sum = 0;
        for (StepRecord h : sample) sum = sum + h.exposure();
        double exposure = (sum / sample.size()) * 100;
        boolean ok = exposure >= objective.pct();
        String detail = "Average exposure " + Js.toFixed(exposure, 1) + " % from step 1 (target "
            + Js.str(objective.pct()) + " %).";
        if (fin) return new Evaluation(ok ? "MET" : "NOT_MET", detail);
        return new Evaluation(ok ? "ON_TRACK" : "AT_RISK", detail);
      }
      case "RUN_STRESS_TEST": {
        Integer deadline = objective.beforeStep();
        boolean done = state.stressTests.stream().anyMatch(t -> deadline == null || t.step() < deadline);
        if (done) return new Evaluation("MET", "You stress-tested the portfolio in time.");
        if (deadline != null && state.step >= deadline) {
          return new Evaluation(fin ? "NOT_MET" : "FAILED", "No stress test was run before step " + deadline + ".");
        }
        return new Evaluation(fin ? "NOT_MET" : "PENDING",
            deadline == null ? "No stress test run yet." : "Run a stress test before step " + deadline + ".");
      }
      case "REACT_TO_EVENT": {
        MarketEventDefinition event = null;
        for (MarketEventDefinition e : ctx.mission().scenario().events()) {
          if (e.id().equals(objective.eventId())) {
            event = e;
            break;
          }
        }
        if (event == null) return new Evaluation("NOT_MET", "The referenced event is not part of this scenario.");
        int start = event.step();
        int end = event.step() + objective.withinSteps();
        boolean reacted = state.orders.stream()
            .anyMatch(o -> !"REJECTED".equals(o.status) && o.createdStep >= start && o.createdStep <= end);
        if (reacted) return new Evaluation("MET", "You acted on “" + event.headline() + "”.");
        if (state.step < event.step()) return new Evaluation(fin ? "NOT_MET" : "PENDING", "Watch the news feed.");
        if (state.step > end || fin) {
          return new Evaluation(fin ? "NOT_MET" : "FAILED",
              "No decision within " + objective.withinSteps() + " step(s) of the event.");
        }
        return new Evaluation("PENDING", "Decide how to respond before step " + (end + 1) + ".");
      }
      case "MAX_TRADES": {
        long trades = state.orders.stream().filter(o -> o.filledQuantity > 0).count();
        int count = objective.count();
        return holding(fin, trades <= count, trades + " executed order(s) (limit " + count + ").",
            trades + " executed orders exceed the limit of " + count + ".");
      }
      default:
        throw new IllegalArgumentException("Unknown objective kind " + objective.kind());
    }
  }

  private static Evaluation open(boolean fin, boolean done, String detail, String pendingDetail) {
    return done ? new Evaluation("MET", detail) : new Evaluation(fin ? "NOT_MET" : "PENDING", pendingDetail);
  }

  private static Evaluation holding(boolean fin, boolean ok, String okDetail, String failDetail) {
    return ok ? new Evaluation(fin ? "MET" : "ON_TRACK", okDetail) : new Evaluation("FAILED", failDetail);
  }

  public static List<ObjectiveResult> evaluate(Context ctx, SimState state) {
    List<ObjectiveResult> out = new ArrayList<>();
    for (ObjectiveDefinition objective : ctx.mission().objectives()) {
      Evaluation e = evaluate(ctx, state, objective);
      out.add(new ObjectiveResult(objective.id(), objective.kind(), objective.label(), objective.required(), e.status(),
          e.detail()));
    }
    return out;
  }
}
