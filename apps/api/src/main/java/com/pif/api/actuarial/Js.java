package com.pif.api.actuarial;

import com.pif.api.web.JsNumbers;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.core.json.JsonFactory;

/**
 * The few JavaScript value semantics the actuarial request handling depends on. Request values are held as parsed
 * JSON: {@link Map} for objects, {@link List} for arrays, {@link Double} for every number, {@link String},
 * {@link Boolean} and Java null for JSON null. {@link #UNDEFINED} stands for a hole of a sparse array, and
 * {@link Sparse} for an array whose length is too large to hold element by element.
 */
final class Js {

  static final Object UNDEFINED = new Object() {
    @Override
    public String toString() {
      return "undefined";
    }
  };

  /** An array created from an object with a very large index key: only its length and defined elements matter. */
  record Sparse(long length, List<Object> values) {}

  /** A TypeError of the TypeScript service: answered as 500 INTERNAL_ERROR, as Nest does. */
  static final class TypeError extends RuntimeException {
    TypeError(String message) {
      super(message, null, false, false);
    }
  }

  private Js() {}

  /** An object literal: keys and values alternate, in property order. */
  static Map<String, Object> obj(Object... keyValues) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < keyValues.length; i += 2) map.put((String) keyValues[i], keyValues[i + 1]);
    return map;
  }

  static List<Double> list(double[] values) {
    List<Double> list = new ArrayList<>(values.length);
    for (double v : values) list.add(v);
    return list;
  }

  static List<List<Double>> rows(Double[][] values) {
    List<List<Double>> rows = new ArrayList<>(values.length);
    for (Double[] row : values) rows.add(Arrays.asList(row));
    return rows;
  }

  static boolean isArray(Object value) {
    return value instanceof List<?> || value instanceof Sparse;
  }

  static long length(Object array) {
    return array instanceof Sparse sparse ? sparse.length() : ((List<?>) array).size();
  }

  /** {@code o[key]} for a property read; reading from undefined or null is a TypeError. */
  static Object get(Object target, String key) {
    if (target == null || target == UNDEFINED) throw new TypeError("Cannot read properties of " + target);
    if (target instanceof Map<?, ?> map) return map.containsKey(key) ? map.get(key) : UNDEFINED;
    return UNDEFINED;
  }

  /** {@code o?.[key]}. */
  static Object getOptional(Object target, String key) {
    if (target == null || target == UNDEFINED) return UNDEFINED;
    return get(target, key);
  }

  static boolean nullish(Object value) {
    return value == null || value == UNDEFINED;
  }

  /** A number field: undefined becomes null (the models read it as NaN); other values are numbers after validation. */
  static Double number(Object value) {
    return value instanceof Double d ? d : null;
  }

  /** A string field: undefined becomes null. */
  static String string(Object value) {
    return value instanceof String s ? s : null;
  }

  /** {@code Math.min(...values)} and {@code Math.max(...values)}: NaN if any value is NaN. */
  static double min(List<Double> values) {
    double result = Double.POSITIVE_INFINITY;
    for (double v : values) {
      if (Double.isNaN(v)) return Double.NaN;
      result = Math.min(result, v);
    }
    return result;
  }

  static double max(List<Double> values) {
    double result = Double.NEGATIVE_INFINITY;
    for (double v : values) {
      if (Double.isNaN(v)) return Double.NaN;
      result = Math.max(result, v);
    }
    return result;
  }

  static double max(double[] values) {
    double result = Double.NEGATIVE_INFINITY;
    for (double v : values) {
      if (Double.isNaN(v)) return Double.NaN;
      result = Math.max(result, v);
    }
    return result;
  }

  /** {@code JSON.stringify} of parsed request values: no whitespace, JavaScript number text, holes as null. */
  static String stringify(Object value) {
    StringBuilder out = new StringBuilder();
    write(out, value);
    return out.toString();
  }

  private static void write(StringBuilder out, Object value) {
    if (value == null || value == UNDEFINED) {
      out.append("null");
    } else if (value instanceof Double d) {
      String text = JsNumbers.toJson(d);
      out.append(text == null ? "null" : text);
    } else if (value instanceof Boolean b) {
      out.append(b);
    } else if (value instanceof String s) {
      quote(out, s);
    } else if (value instanceof List<?> list) {
      out.append('[');
      for (int i = 0; i < list.size(); i++) {
        if (i > 0) out.append(',');
        write(out, list.get(i));
      }
      out.append(']');
    } else if (value instanceof Map<?, ?> map) {
      out.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> e : map.entrySet()) {
        if (e.getValue() == UNDEFINED) continue;
        if (!first) out.append(',');
        first = false;
        quote(out, String.valueOf(e.getKey()));
        out.append(':');
        write(out, e.getValue());
      }
      out.append('}');
    } else {
      throw new IllegalArgumentException("Not a JSON value: " + value.getClass());
    }
  }

  private static void quote(StringBuilder out, String s) {
    out.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (c < 0x20 || (Character.isSurrogate(c) && !wellFormedPair(s, i))) {
            out.append(String.format("\\u%04x", (int) c));
          } else {
            out.append(c);
          }
        }
      }
    }
    out.append('"');
  }

  private static boolean wellFormedPair(String s, int i) {
    char c = s.charAt(i);
    if (Character.isHighSurrogate(c)) return i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1));
    return i > 0 && Character.isHighSurrogate(s.charAt(i - 1));
  }

  /**
   * Parse a jsonb document the way {@code JSON.parse} does. Jackson's untyped reader is not the same
   * correctly-rounded conversion, so a stored actuarial number came back one ulp away from NestJS.
   * Every number is {@link Double#parseDouble} of the token text; key order is kept.
   */
  private static final JsonFactory JSON = new JsonFactory();

  static Map<String, Object> readObject(String text) {
    try (JsonParser parser = JSON.createParser(text)) {
      if (parser.nextToken() != JsonToken.START_OBJECT) throw new IllegalArgumentException("Expected a JSON object");
      return object(parser);
    }
  }

  private static Map<String, Object> object(JsonParser parser) {
    Map<String, Object> map = new LinkedHashMap<>();
    while (parser.nextToken() != JsonToken.END_OBJECT) {
      String key = parser.currentName();
      parser.nextToken();
      map.put(key, value(parser));
    }
    return map;
  }

  private static List<Object> array(JsonParser parser) {
    List<Object> list = new ArrayList<>();
    while (parser.nextToken() != JsonToken.END_ARRAY) list.add(value(parser));
    return list;
  }

  private static Object value(JsonParser parser) {
    JsonToken token = parser.currentToken();
    if (token == JsonToken.START_OBJECT) return object(parser);
    if (token == JsonToken.START_ARRAY) return array(parser);
    if (token == JsonToken.VALUE_STRING) return parser.getText();
    if (token == JsonToken.VALUE_NUMBER_INT || token == JsonToken.VALUE_NUMBER_FLOAT) return Double.valueOf(Double.parseDouble(parser.getText()));
    if (token == JsonToken.VALUE_TRUE) return Boolean.TRUE;
    if (token == JsonToken.VALUE_FALSE) return Boolean.FALSE;
    if (token == JsonToken.VALUE_NULL) return null;
    throw new IllegalArgumentException("Unexpected JSON token " + token);
  }
}
