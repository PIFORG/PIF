package com.pif.api.admin;

import static com.pif.api.web.Validation.isIn;
import static com.pif.api.web.Validation.isString;
import static com.pif.api.web.Validation.matches;
import static com.pif.api.web.Validation.maxLength;
import static com.pif.api.web.Validation.minLength;
import static com.pif.api.web.Validation.mustBeInteger;
import static com.pif.api.web.Validation.mustBeIsoDate;
import static com.pif.api.web.Validation.mustBeString;
import static com.pif.api.web.Validation.notGreaterThan;
import static com.pif.api.web.Validation.notLessThan;
import static com.pif.api.web.Validation.oneOf;
import static com.pif.api.web.Validation.shorterThan;
import com.pif.api.web.Messages;
import static com.pif.api.web.ApiDocs.number;
import static com.pif.api.web.ApiDocs.object;
import static com.pif.api.web.ApiDocs.optionalQuery;
import static com.pif.api.web.ApiDocs.pattern;
import static com.pif.api.web.ApiDocs.prop;
import static com.pif.api.web.ApiDocs.text;
import static com.pif.api.web.ApiDocs.uuid;

import com.pif.api.web.ApiDocs;
import com.pif.api.web.Validation;
import com.pif.api.web.Validation.Checker;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * DTOs of apps/api/src/admin/admin.controller.ts. Query strings arrive as strings (or arrays for repeated keys, as
 * Express 5's simple query parser produces), then follow class-transformer's implicit conversion and class-validator.
 */
public final class AdminDtos {

  static final List<String> USER_STATUSES =
      List.of("PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "DEACTIVATED", "PENDING_DELETION");
  static final List<String> USER_ROLES = List.of("INVESTOR", "ADMIN");
  static final List<String> AUDIT_OUTCOMES = List.of("SUCCESS", "FAILURE", "DENIED");

  /** OpenAPI request schemas, named and shaped like the legacy-NestJS-DTO-parity output of the admin DTOs. */
  public static Map<String, Schema<?>> openApiSchemas() {
    Map<String, Schema<?>> s = new LinkedHashMap<>();
    s.put("UpdateStatusDto", object(List.of("status", "reason"), prop("status", ApiDocs.oneOf(USER_STATUSES)),
        prop("reason", text(3, 200))));
    s.put("UpdateRoleDto", object(List.of("role", "password"), prop("role", ApiDocs.oneOf(USER_ROLES)),
        prop("password", text(null, 256)), prop("totpCode", pattern("^\\d{6}$"))));
    return s;
  }

  /** OpenAPI query parameters of ListUsersQueryDto and AuditQueryDto, in declaration order. */
  public static Map<String, List<Parameter>> openApiQueries() {
    return Map.of(
        "ListUsersQueryDto", List.of(
            optionalQuery("page", number(1, null)), optionalQuery("pageSize", number(1, 100)),
            optionalQuery("q", text(null, 120)), optionalQuery("status", ApiDocs.oneOf(USER_STATUSES)),
            optionalQuery("role", ApiDocs.oneOf(USER_ROLES)),
            optionalQuery("emailVerified", ApiDocs.oneOf(List.of("true", "false")))),
        "AuditQueryDto", List.of(
            optionalQuery("page", number(1, null)), optionalQuery("pageSize", number(1, 100)),
            optionalQuery("eventType", pattern(EVENT_TYPE.pattern())),
            optionalQuery("outcome", ApiDocs.oneOf(AUDIT_OUTCOMES)),
            optionalQuery("actorUserId", uuid()), optionalQuery("subjectUserId", uuid()),
            optionalQuery("from", text()), optionalQuery("to", text())));
  }

  private static final Pattern SIX_DIGITS = Pattern.compile("^\\d{6}$");
  private static final Pattern EVENT_TYPE = Pattern.compile("^[A-Z][A-Z0-9_]{0,79}$");
  /** validator.js isUUID with the default version "all". */
  private static final Pattern UUID_ALL = Pattern.compile("^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}"
      + "-[0-9a-f]{12}|0{8}-0{4}-0{4}-0{4}-0{12}|f{8}-f{4}-f{4}-f{4}-f{12})$", Pattern.CASE_INSENSITIVE);

  private AdminDtos() {}

  public record UserQuery(int page, int pageSize, String q, String status, String role, String emailVerified) {}

  public record AuditQuery(int page, int pageSize, String eventType, String outcome, String actorUserId,
      String subjectUserId, Instant from, Instant to) {}

  public record StatusChange(String status, String reason) {}

  public record RoleChange(String role, String password, String totpCode) {}

  /** Request parameters as Express exposes them: one value → string, repeated → array. */
  public static Map<String, Object> query(Map<String, String[]> params) {
    Map<String, Object> out = new LinkedHashMap<>();
    params.forEach((k, v) -> out.put(k, v.length == 1 ? v[0] : List.of(v)));
    return out;
  }

  public static UserQuery listUsers(Map<String, Object> query) {
    Checker c = new Checker(query, Set.of("page", "pageSize", "q", "status", "role", "emailVerified"));
    Double page = pageField(c, "page", false);
    Double pageSize = pageField(c, "pageSize", true);
    Object q = c.raw("q");
    if (q != null) {
      if (!maxLength(q, 120)) c.add(shorterThan("q", 120));
      if (!isString(q)) c.add(mustBeString("q"));
    }
    Object status = enumField(c, "status", USER_STATUSES);
    Object role = enumField(c, "role", USER_ROLES);
    Object emailVerified = c.raw("emailVerified");
    if (emailVerified != null && !isIn(emailVerified, List.of("true", "false"))) {
      c.add(oneOf("emailVerified", List.of("true", "false")));
    }
    c.requireValid();
    return new UserQuery(pageOrDefault(page), pageSizeOrDefault(pageSize), (String) q, (String) status, (String) role,
        (String) emailVerified);
  }

  public static AuditQuery auditEvents(Map<String, Object> query) {
    Checker c = new Checker(query,
        Set.of("page", "pageSize", "eventType", "outcome", "actorUserId", "subjectUserId", "from", "to"));
    Double page = pageField(c, "page", false);
    Double pageSize = pageField(c, "pageSize", true);
    Object eventType = c.raw("eventType");
    if (eventType != null && !matches(eventType, EVENT_TYPE)) c.add(Messages.get("validation.event_type_invalid"));
    Object outcome = enumField(c, "outcome", AUDIT_OUTCOMES);
    Object actor = uuidField(c, "actorUserId");
    Object subject = uuidField(c, "subjectUserId");
    Object from = isoField(c, "from");
    Object to = isoField(c, "to");
    c.requireValid();
    return new AuditQuery(pageOrDefault(page), pageSizeOrDefault(pageSize), emptyToNull(eventType),
        emptyToNull(outcome), emptyToNull(actor), emptyToNull(subject), jsDate("from", (String) from),
        jsDate("to", (String) to));
  }

  public static StatusChange updateStatus(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("status", "reason"));
    Object status = c.stringValue("status");
    if (!isIn(status, USER_STATUSES)) c.add(oneOf("status", USER_STATUSES));
    Object reason = c.stringValue("reason");
    if (reason instanceof String s) reason = Validation.jsTrim(s);
    if (!maxLength(reason, 200)) c.add(shorterThan("reason", 200));
    if (!minLength(reason, 3)) c.add(Messages.get("validation.reason_min"));
    if (!isString(reason)) c.add(mustBeString("reason"));
    c.requireValid();
    return new StatusChange((String) status, (String) reason);
  }

  public static RoleChange updateRole(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("role", "password", "totpCode"));
    Object role = c.stringValue("role");
    if (!isIn(role, USER_ROLES)) c.add(oneOf("role", USER_ROLES));
    Object password = c.stringValue("password");
    if (!maxLength(password, 256)) c.add(shorterThan("password", 256));
    if (!isString(password)) c.add(mustBeString("password"));
    Object totp = c.stringValue("totpCode");
    if (totp != null && !matches(totp, SIX_DIGITS)) c.add(Messages.get("validation.authenticator_digits"));
    c.requireValid();
    return new RoleChange((String) role, (String) password, (String) totp);
  }

  // ---------- field rules ----------

  /** @Type(() => Number) @IsInt() @Min(1) [@Max(100)], reported bottom decorator first. */
  private static Double pageField(Checker c, String field, boolean withMax) {
    Object raw = c.raw(field);
    if (raw == null) return null;
    Double value = raw instanceof String s ? jsNumber(s) : null;
    if (withMax && !(value != null && value <= 100)) c.add(notGreaterThan(field, 100));
    if (!(value != null && value >= 1)) c.add(notLessThan(field, 1));
    if (!(value != null && !value.isInfinite() && !value.isNaN() && value == Math.rint(value))) {
      c.add(mustBeInteger(field));
    }
    return value;
  }

  private static Object enumField(Checker c, String field, List<String> values) {
    Object raw = c.raw(field);
    if (raw != null && !isIn(raw, values)) c.add(oneOf(field, values));
    return raw;
  }

  private static Object uuidField(Checker c, String field) {
    Object raw = c.raw(field);
    if (raw != null && !matches(raw, UUID_ALL)) c.add(Messages.format("validation.uuid", field));
    return raw;
  }

  private static Object isoField(Checker c, String field) {
    Object raw = c.raw(field);
    if (raw != null && !(raw instanceof String s && isIso8601Strict(s))) {
      c.add(mustBeIsoDate(field));
    }
    return raw;
  }

  private static int pageOrDefault(Double page) {
    return page == null ? 1 : (int) Math.min(Integer.MAX_VALUE, Math.max(1, page));
  }

  private static int pageSizeOrDefault(Double pageSize) {
    return pageSize == null ? 20 : (int) Math.min(100, Math.max(1, pageSize));
  }

  /** The service tests these with JavaScript truthiness: "" behaves as absent. */
  private static String emptyToNull(Object value) {
    return value instanceof String s && !s.isEmpty() ? s : null;
  }

  // ---------- JavaScript semantics ----------

  private static final Pattern JS_DECIMAL =
      Pattern.compile("^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?$");

  /** Number(string). */
  public static double jsNumber(String input) {
    String s = Validation.jsTrim(input);
    if (s.isEmpty()) return 0;
    switch (s) {
      case "Infinity", "+Infinity":
        return Double.POSITIVE_INFINITY;
      case "-Infinity":
        return Double.NEGATIVE_INFINITY;
      default:
        break;
    }
    try {
      if (s.length() > 2 && s.charAt(0) == '0') {
        char prefix = Character.toLowerCase(s.charAt(1));
        int radix = prefix == 'x' ? 16 : prefix == 'o' ? 8 : prefix == 'b' ? 2 : 0;
        if (radix != 0) return new java.math.BigInteger(s.substring(2), radix).doubleValue();
      }
      if (JS_DECIMAL.matcher(s).matches()) return Double.parseDouble(s);
    } catch (NumberFormatException e) {
      return Double.NaN;
    }
    return Double.NaN;
  }

  private static final String JS_SPACE = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F"
      + "\\u205F\\u3000\\uFEFF";

  /** validator.js isISO8601 (non-strict separator), copied verbatim apart from JavaScript's \s set. */
  private static final Pattern ISO8601 = Pattern.compile("^([\\+-]?\\d{4}(?!\\d{2}\\b))((-?)((0[1-9]|1[0-2])(\\3([12]\\d"
      + "|0[1-9]|3[01]))?|W([0-4]\\d|5[0-3])(-?[1-7])?|(00[1-9]|0[1-9]\\d|[12]\\d{2}|3([0-5]\\d|6[1-6])))([T" + JS_SPACE
      + "]((([01]\\d|2[0-3])((:?)[0-5]\\d)?|24:?00)([\\.,]\\d+(?!:))?)?(\\17[0-5]\\d([\\.,]\\d+)?)?([zZ]|([\\+-])"
      + "([01]\\d|2[0-3]):?([0-5]\\d)?)?)?)?$");
  private static final Pattern ORDINAL = Pattern.compile("^(\\d{4})-?(\\d{3})([ T]{1}\\.*|$)");
  private static final Pattern YMD = Pattern.compile("(\\d{4})-?(\\d{0,2})-?(\\d*)");

  /** isISO8601(str, { strict: true }): the pattern plus a calendar check (rejects 2026-02-30). */
  public static boolean isIso8601Strict(String s) {
    if (!ISO8601.matcher(s).matches()) return false;
    Matcher ordinal = ORDINAL.matcher(s);
    if (ordinal.find()) {
      int year = Integer.parseInt(ordinal.group(1));
      int day = Integer.parseInt(ordinal.group(2));
      boolean leap = year % 4 == 0 && year % 100 != 0 || year % 400 == 0;
      return day <= (leap ? 366 : 365);
    }
    Matcher m = YMD.matcher(s);
    if (!m.find()) return true;
    int year = Integer.parseInt(m.group(1));
    int month = m.group(2).isEmpty() ? 0 : Integer.parseInt(m.group(2));
    int day = m.group(3).isEmpty() ? 0 : parseDay(m.group(3));
    if (month == 0 || day == 0) return true;
    try {
      LocalDate.of(year, month, day);
      return true;
    } catch (DateTimeException e) {
      return false;
    }
  }

  private static int parseDay(String digits) {
    // Number("0" + day).slice(-2) in the original only matters for one-digit days, which the pattern forbids.
    return digits.length() > 9 ? Integer.MAX_VALUE : Integer.parseInt(digits);
  }

  private static final Pattern ES_DATE = Pattern.compile("^(\\d{4})(?:-(\\d{2})(?:-(\\d{2}))?)?$");
  private static final Pattern ES_DATE_TIME = Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})"
      + "(?::(\\d{2})(?:\\.(\\d+))?)?(Z|[+-]\\d{2}:\\d{2})?$", Pattern.CASE_INSENSITIVE);

  /**
   * new Date(value) for the ISO forms V8 parses: date-only forms are UTC, date-times without an offset are local
   * time. Other ISO 8601 forms that pass validation (week dates, ordinal dates, basic format) are rejected with a 400
   * here; Node produces an Invalid Date that the database layer then fails on.
   */
  private static Instant jsDate(String field, String value) {
    if (value == null || value.isEmpty()) return null;
    Instant parsed = jsDateOrNull(value);
    if (parsed == null) {
      throw com.pif.api.web.ApiException.validation(List.of(field + " must be a valid ISO 8601 date string"));
    }
    return parsed;
  }

  /** new Date(value) for the ISO forms above; null where this port does not reproduce V8's fallback parser. */
  public static Instant jsDateOrNull(String value) {
    Matcher d = ES_DATE.matcher(value);
    if (d.matches()) {
      int month = d.group(2) == null ? 1 : Integer.parseInt(d.group(2));
      int day = d.group(3) == null ? 1 : Integer.parseInt(d.group(3));
      return LocalDate.of(Integer.parseInt(d.group(1)), month, day).atStartOfDay(ZoneOffset.UTC).toInstant();
    }
    Matcher t = ES_DATE_TIME.matcher(value);
    if (t.matches()) {
      LocalDate date = LocalDate.of(Integer.parseInt(t.group(1)), Integer.parseInt(t.group(2)),
          Integer.parseInt(t.group(3)));
      int hour = Integer.parseInt(t.group(4));
      int minute = Integer.parseInt(t.group(5));
      int second = t.group(6) == null ? 0 : Integer.parseInt(t.group(6));
      int millis = t.group(7) == null ? 0 : Integer.parseInt((t.group(7) + "00").substring(0, 3));
      LocalDateTime local;
      if (hour == 24 && minute == 0 && second == 0 && millis == 0) {
        local = date.plusDays(1).atStartOfDay();
      } else {
        local = LocalDateTime.of(date, LocalTime.of(hour, minute, second, millis * 1_000_000));
      }
      String zone = t.group(8);
      if (zone == null) return local.atZone(ZoneId.systemDefault()).toInstant();
      ZoneOffset offset = "Z".equalsIgnoreCase(zone) ? ZoneOffset.UTC : ZoneOffset.of(zone);
      return OffsetDateTime.of(local, offset).toInstant();
    }
    return null;
  }
}
