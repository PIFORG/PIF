package com.pif.api.web;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * Request-body validation with the observable behaviour of the NestJS global ValidationPipe
 * (whitelist + forbidNonWhitelisted + transform + implicit conversion) and class-validator's
 * default messages. Constraints are listed per field in the order class-validator reports them
 * (bottom decorator first).
 */
public final class Validation {

  private Validation() {}

  /** Parses a JSON object body. Non-JSON content types and empty bodies are treated as {}. */
  public static Map<String, Object> parseBody(ObjectMapper mapper, String raw, String contentType) {
    if (raw == null || raw.isBlank() || contentType == null || !contentType.toLowerCase().contains("json")) {
      return new LinkedHashMap<>();
    }
    Object parsed;
    try {
      parsed = mapper.readValue(raw, Object.class);
    } catch (JacksonException e) {
      throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
          Messages.get("validation.body.not_json"));
    }
    if (parsed instanceof Map<?, ?> map) {
      Map<String, Object> body = new LinkedHashMap<>();
      map.forEach((k, v) -> body.put(String.valueOf(k), v));
      return body;
    }
    return new LinkedHashMap<>();
  }

  public static final class Checker {
    private final Map<String, Object> body;
    private final List<String> errors = new ArrayList<>();

    public Checker(Map<String, Object> body, Set<String> allowed) {
      this.body = body;
      for (String key : body.keySet()) {
        if (!allowed.contains(key)) errors.add(Messages.format("validation.property_forbidden", key));
      }
    }

    public boolean present(String field) {
      return body.get(field) != null;
    }

    /** Implicit conversion of class-transformer for `string` properties. */
    public Object stringValue(String field) {
      Object v = body.get(field);
      if (v instanceof Number || v instanceof Boolean) return String.valueOf(v);
      if (v instanceof Map<?, ?>) return "[object Object]";
      return v;
    }

    public Object raw(String field) {
      return body.get(field);
    }

    public void add(String message) {
      errors.add(message);
    }

    public void requireValid() {
      if (!errors.isEmpty()) throw ApiException.validation(List.copyOf(errors));
    }
  }

  private static final Pattern JS_TRIM = Pattern.compile(
      "^[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+"
          + "|[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+$");

  /** String.prototype.trim(): JavaScript's whitespace set, which differs from Java's strip(). */
  public static String jsTrim(String s) {
    return s == null ? null : JS_TRIM.matcher(s).replaceAll("");
  }

  /** normalizeEmail of apps/api/src/common/crypto/email.util.ts. */
  public static String normalizeEmail(String email) {
    return jsTrim(email).toLowerCase(java.util.Locale.ROOT);
  }

  public static boolean isString(Object v) {
    return v instanceof String;
  }

  public static boolean minLength(Object v, int min) {
    return v instanceof String s && s.codePointCount(0, s.length()) >= min;
  }

  public static boolean maxLength(Object v, int max) {
    return v instanceof String s && s.codePointCount(0, s.length()) <= max;
  }

  public static boolean matches(Object v, Pattern pattern) {
    return v instanceof String s && pattern.matcher(s).find();
  }

  public static boolean isIn(Object v, Collection<String> values) {
    return v instanceof String s && values.contains(s);
  }

  public static String mustBeString(String field) {
    return Messages.format("validation.must_be_string", field);
  }

  public static String longerThan(String field, int min) {
    return Messages.format("validation.longer_than", field, min);
  }

  public static String shorterThan(String field, int max) {
    return Messages.format("validation.shorter_than", field, max);
  }

  public static String oneOf(String field, Collection<String> values) {
    return Messages.format("validation.one_of", field, String.join(", ", values));
  }

  public static String mustBeEmail(String field) {
    return Messages.format("validation.email", field);
  }

  public static String mustMatch(String field, String regex) {
    return Messages.format("validation.regex", field, regex);
  }

  public static String mustBeBoolean(String field) {
    return Messages.format("validation.boolean", field);
  }

  public static String mustBeIsoDate(String field) {
    return Messages.format("validation.iso_date", field);
  }

  public static String mustBeInteger(String field) {
    return Messages.format("validation.integer", field);
  }

  public static String mustBeNumber(String field) {
    return Messages.format("validation.number_constraints", field);
  }

  public static String notGreaterThan(String field, Object max) {
    return Messages.format("validation.not_greater", field, max);
  }

  public static String notLessThan(String field, Object min) {
    return Messages.format("validation.not_less", field, min);
  }

  private static final Pattern LOCAL_PART =
      Pattern.compile("^[a-z\\d!#$%&'*+\\-/=?^_`{|}~]+(\\.[a-z\\d!#$%&'*+\\-/=?^_`{|}~]+)*$", Pattern.CASE_INSENSITIVE);
  private static final Pattern DOMAIN_LABEL = Pattern.compile("^[a-z\\u00a1-\\uffff0-9-]+$", Pattern.CASE_INSENSITIVE);
  private static final Pattern TLD = Pattern.compile("^([a-z\\u00a1-\\uffff]{2,}|xn[a-z0-9-]{2,})$", Pattern.CASE_INSENSITIVE);

  /**
   * validator.js isEmail with class-validator defaults (no display name, TLD required,
   * no IP-literal domains, 64-octet local part, 254-octet address).
   */
  public static boolean isEmail(Object v) {
    if (!(v instanceof String s) || s.length() > 254) return false;
    int at = s.lastIndexOf('@');
    if (at <= 0 || at == s.length() - 1) return false;
    String local = s.substring(0, at);
    String domain = s.substring(at + 1);
    if (local.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 64) return false;
    if (domain.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 254) return false;
    if (!LOCAL_PART.matcher(local).matches()) return false;
    String[] labels = domain.split("\\.", -1);
    if (labels.length < 2) return false;
    String tld = labels[labels.length - 1];
    if (!TLD.matcher(tld).matches() || tld.contains(" ")) return false;
    for (String label : labels) {
      if (label.isEmpty() || label.length() > 63) return false;
      if (!DOMAIN_LABEL.matcher(label).matches()) return false;
      if (label.startsWith("-") || label.endsWith("-")) return false;
    }
    return true;
  }
}
