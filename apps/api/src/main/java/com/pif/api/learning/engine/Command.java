package com.pif.api.learning.engine;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A session command (the Command union of apps/api/src/learning/engine/types.ts). {@code limitPrice} and
 * {@code stopPrice} are null when absent; {@code confidence} distinguishes an absent property
 * ({@code hasConfidence == false}) from an explicit null, which the engine refuses.
 */
public record Command(String type, String symbol, String side, String orderType, Double quantity, Double limitPrice,
    Double stopPrice, String rationale, boolean hasConfidence, Double confidence, String orderId, String scenarioId) {

  public static Command placeOrder(String symbol, String side, String orderType, double quantity, Double limitPrice,
      Double stopPrice, String rationale, boolean hasConfidence, Double confidence) {
    return new Command("PLACE_ORDER", symbol, side, orderType, quantity, limitPrice, stopPrice, rationale,
        hasConfidence, confidence, null, null);
  }

  public static Command cancelOrder(String orderId) {
    return new Command("CANCEL_ORDER", null, null, null, null, null, null, null, false, null, orderId, null);
  }

  public static Command stressTest(String scenarioId) {
    return new Command("RUN_STRESS_TEST", null, null, null, null, null, null, null, false, null, null, scenarioId);
  }

  public static Command of(String type) {
    return new Command(type, null, null, null, null, null, null, null, false, null, null, null);
  }

  public boolean isPlaceOrder() {
    return "PLACE_ORDER".equals(type);
  }

  /** The command object as the NestJS service builds it (toCommand) and stores it. */
  public Map<String, Object> toJson() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("type", type);
    switch (type) {
      case "PLACE_ORDER" -> {
        out.put("symbol", symbol);
        out.put("side", side);
        out.put("orderType", orderType);
        out.put("quantity", quantity);
        if (limitPrice != null) out.put("limitPrice", limitPrice);
        if (stopPrice != null) out.put("stopPrice", stopPrice);
        out.put("rationale", rationale);
        if (hasConfidence) out.put("confidence", confidence);
      }
      case "CANCEL_ORDER" -> out.put("orderId", orderId);
      case "RUN_STRESS_TEST" -> out.put("scenarioId", scenarioId);
      default -> {}
    }
    return out;
  }

  /** Reads a stored command payload (or a fixture command). */
  public static Command fromJson(Map<String, ?> json) {
    return new Command((String) json.get("type"), (String) json.get("symbol"), (String) json.get("side"),
        (String) json.get("orderType"), number(json.get("quantity")), number(json.get("limitPrice")),
        number(json.get("stopPrice")), (String) json.get("rationale"), json.containsKey("confidence"),
        number(json.get("confidence")), (String) json.get("orderId"), (String) json.get("scenarioId"));
  }

  private static Double number(Object value) {
    if (value == null) return null;
    if (value instanceof Number n) return n.doubleValue();
    if (value instanceof String s) return Double.valueOf(s);
    throw new IllegalArgumentException("Not a number: " + value);
  }
}
