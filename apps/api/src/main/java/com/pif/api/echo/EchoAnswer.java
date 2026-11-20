package com.pif.api.echo;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Typed ÉCHO response. The front end renders these fields; it never parses {@link #answer} text.
 *
 * <p>Every number shown to the user comes through {@link #evidence} with its {@link Kind}, so observed data,
 * calculations, model outputs, assumptions and simulations are never blended.
 */
public final class EchoAnswer {

  /** Nature of a piece of evidence — displayed as a badge next to the value. */
  public enum Kind {
    OBSERVED("Donnée observée"),
    CALCULATED("Calcul"),
    MODEL("Résultat de modèle"),
    ASSUMPTION("Hypothèse"),
    SIMULATION("Simulation"),
    INTERPRETATION("Interprétation");

    final String label;

    Kind(String label) {
      this.label = label;
    }
  }

  public static final String ENGINE = "echo-deterministic-v1";

  final String intent;
  String answer;
  String speech;
  final List<Map<String, Object>> evidence = new ArrayList<>();
  final List<Map<String, Object>> riskFlags = new ArrayList<>();
  final List<Map<String, Object>> actions = new ArrayList<>();
  final List<String> limitations = new ArrayList<>();
  final List<Map<String, Object>> sources = new ArrayList<>();
  final List<String> tools = new ArrayList<>();
  Map<String, Object> context = new LinkedHashMap<>();
  Map<String, Object> visualization;
  Map<String, Object> scenario;
  Map<String, Object> clarification;
  String dataAsOf;
  /** COMPLETE, PARTIAL (some data missing), NO_DATA, CLARIFICATION, REFUSED. */
  String status = "COMPLETE";

  EchoAnswer(String intent) {
    this.intent = intent;
  }

  EchoAnswer text(String text) {
    this.answer = text;
    return this;
  }

  EchoAnswer speech(String text) {
    this.speech = text;
    return this;
  }

  EchoAnswer status(String s) {
    this.status = s;
    return this;
  }

  EchoAnswer asOf(String iso) {
    if (iso != null && (dataAsOf == null || iso.compareTo(dataAsOf) < 0)) dataAsOf = iso;
    return this;
  }

  EchoAnswer evidence(Kind kind, String label, Object value, String unit, String source) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("kind", kind.name());
    m.put("kindLabel", kind.label);
    m.put("label", label);
    m.put("value", value);
    m.put("unit", unit);
    m.put("source", source);
    evidence.add(m);
    return this;
  }

  EchoAnswer flag(String code, String severity, String message, Map<String, Object> basis) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("code", code);
    m.put("severity", severity);
    m.put("message", message);
    m.put("basis", basis);
    riskFlags.add(m);
    return this;
  }

  /** A follow-up question ÉCHO can answer (sent back as a new message). */
  EchoAnswer ask(String label, String question) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("kind", "ASK");
    m.put("label", label);
    m.put("question", question);
    actions.add(m);
    return this;
  }

  /** A link to an existing module. ÉCHO never performs the action itself. */
  EchoAnswer navigate(String label, String route) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("kind", "NAVIGATE");
    m.put("label", label);
    m.put("route", route);
    actions.add(m);
    return this;
  }

  EchoAnswer limitation(String text) {
    if (!limitations.contains(text)) limitations.add(text);
    return this;
  }

  EchoAnswer source(String module, String method, Map<String, Object> provenance) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("module", module);
    m.put("method", method);
    m.put("provenance", provenance);
    sources.add(m);
    return this;
  }

  EchoAnswer tool(String name) {
    if (!tools.contains(name)) tools.add(name);
    return this;
  }

  EchoAnswer clarify(String question, List<Map<String, Object>> options) {
    this.status = "CLARIFICATION";
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("question", question);
    m.put("options", options);
    this.clarification = m;
    return this;
  }

  EchoAnswer chart(String type, String title, List<Map<String, Object>> points, String unit) {
    if (points == null || points.size() < 2) return this;
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", type);
    m.put("title", title);
    m.put("unit", unit);
    m.put("points", points);
    this.visualization = m;
    return this;
  }

  EchoAnswer scenario(Map<String, Object> s) {
    this.scenario = s;
    return this;
  }

  Map<String, Object> toJson() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("intent", intent);
    m.put("status", status);
    m.put("answer", answer);
    m.put("speech", speech == null ? answer : speech);
    m.put("context", context);
    m.put("evidence", evidence);
    m.put("dataAsOf", dataAsOf);
    m.put("riskFlags", riskFlags);
    m.put("suggestedActions", actions);
    m.put("visualization", visualization);
    m.put("scenario", scenario);
    m.put("clarification", clarification);
    m.put("limitations", limitations);
    m.put("sources", sources);
    m.put("toolsUsed", tools);
    m.put("engine", ENGINE);
    return m;
  }
}
