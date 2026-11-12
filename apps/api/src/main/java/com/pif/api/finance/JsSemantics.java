package com.pif.api.finance;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The JavaScript semantics the TypeScript financial core relies on that Java does not share:
 * {@code Math.round}, {@code Number.isInteger} and the iteration order of a plain object
 * ({@code Record<string, …>}), which decides the order of floating-point sums.
 */
public final class JsSemantics {

  private static final long MAX_ARRAY_INDEX = 4_294_967_294L;

  private JsSemantics() {}

  /** {@code Math.round}: nearest integer, ties toward +∞, and −0 for −0.5 ≤ x &lt; 0. */
  public static double round(double x) {
    if (!Double.isFinite(x) || x == 0) return x;
    if (x > 0 && x < 0.5) return 0.0;
    if (x < 0 && x >= -0.5) return -0.0;
    double floor = Math.floor(x);
    return x - floor >= 0.5 ? floor + 1 : floor;
  }

  /** {@code Number.isInteger}. */
  public static boolean isInteger(double x) {
    return Double.isFinite(x) && Math.floor(x) == x;
  }

  /**
   * Entries in the order {@code Object.entries} would list them for an object built by inserting
   * the map's keys in its iteration order: array-index keys ("0" … "4294967294") ascending, then
   * every other key in insertion order. Pass an insertion-ordered map (e.g. {@link LinkedHashMap}).
   */
  public static <V> List<Map.Entry<String, V>> entries(Map<String, V> map) {
    List<Map.Entry<String, V>> indexKeys = new ArrayList<>();
    List<Map.Entry<String, V>> otherKeys = new ArrayList<>(map.size());
    for (Map.Entry<String, V> entry : map.entrySet()) (isArrayIndex(entry.getKey()) ? indexKeys : otherKeys).add(entry);
    if (indexKeys.isEmpty()) return otherKeys;
    indexKeys.sort(Comparator.comparingLong(e -> Long.parseLong(e.getKey())));
    indexKeys.addAll(otherKeys);
    return indexKeys;
  }

  public static <V> List<V> values(Map<String, V> map) {
    List<V> values = new ArrayList<>(map.size());
    for (Map.Entry<String, V> entry : entries(map)) values.add(entry.getValue());
    return values;
  }

  public static <V> Map<String, V> inPropertyOrder(Map<String, V> map) {
    Map<String, V> ordered = new LinkedHashMap<>();
    for (Map.Entry<String, V> entry : entries(map)) ordered.put(entry.getKey(), entry.getValue());
    return ordered;
  }

  public static boolean isArrayIndex(String key) {
    int length = key.length();
    if (length == 0 || length > 10) return false;
    if (key.charAt(0) == '0') return length == 1;
    for (int i = 0; i < length; i++) {
      char c = key.charAt(i);
      if (c < '0' || c > '9') return false;
    }
    return Long.parseLong(key) <= MAX_ARRAY_INDEX;
  }
}
