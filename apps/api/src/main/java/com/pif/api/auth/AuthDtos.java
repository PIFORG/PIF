package com.pif.api.auth;

import static com.pif.api.web.Validation.isEmail;
import static com.pif.api.web.Validation.isIn;
import static com.pif.api.web.Validation.isString;
import static com.pif.api.web.Validation.jsTrim;
import static com.pif.api.web.Validation.normalizeEmail;
import static com.pif.api.web.Validation.longerThan;
import static com.pif.api.web.Validation.matches;
import static com.pif.api.web.Validation.maxLength;
import static com.pif.api.web.Validation.minLength;
import static com.pif.api.web.Validation.mustBeBoolean;
import static com.pif.api.web.Validation.mustBeEmail;
import static com.pif.api.web.Validation.mustBeString;
import static com.pif.api.web.Validation.mustMatch;
import static com.pif.api.web.Validation.oneOf;
import static com.pif.api.web.Validation.shorterThan;
import com.pif.api.web.Messages;
import static com.pif.api.web.ApiDocs.describe;
import static com.pif.api.web.ApiDocs.email;
import static com.pif.api.web.ApiDocs.object;
import static com.pif.api.web.ApiDocs.pattern;
import static com.pif.api.web.ApiDocs.prop;
import static com.pif.api.web.ApiDocs.text;

import com.pif.api.data.AuthRepository.PreferencesPatch;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.Validation.Checker;
import io.swagger.v3.oas.models.media.BooleanSchema;
import io.swagger.v3.oas.models.media.Schema;
import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Request DTOs of apps/api/src/auth/dto/auth.dto.ts. Each check list follows the order in which
 * class-validator reports violations (the decorator closest to the property first).
 */
public final class AuthDtos {

  private AuthDtos() {}

  public record Login(String email, String password) {}

  public record MfaVerifyLogin(String mfaChallengeToken, String totpCode, String recoveryCode) {}

  public record UpdateProfile(String firstName, String lastName, String experienceLevel) {}

  private static final Pattern SIX_DIGITS = Pattern.compile("^\\d{6}$");
  static final List<String> EXPERIENCE_LEVELS = List.of("BEGINNER", "INTERMEDIATE", "ADVANCED");
  static final List<String> CHART_THEMES = List.of("trading_desk", "light", "dark");
  static final List<String> TRAINING_DIFFICULTIES = List.of("adaptive", "beginner", "intermediate", "advanced");
  private static final List<String> CURRENCY_LIST;
  private static final List<String> TIME_ZONE_LIST;
  static final Set<String> SUPPORTED_CURRENCIES;
  static final Set<String> SUPPORTED_TIME_ZONES;

  static {
    try (InputStream in = AuthDtos.class.getResourceAsStream("/reference/intl-supported-values.json")) {
      JsonNode root = JsonMapper.builder().build().readTree(in);
      CURRENCY_LIST = root.get("currencies").valueStream().map(JsonNode::asString).toList();
      TIME_ZONE_LIST = root.get("timeZones").valueStream().map(JsonNode::asString).toList();
      SUPPORTED_CURRENCIES = Set.copyOf(CURRENCY_LIST);
      SUPPORTED_TIME_ZONES = Set.copyOf(TIME_ZONE_LIST);
    } catch (IOException | RuntimeException e) {
      throw new IllegalStateException("Cannot load reference/intl-supported-values.json", e);
    }
  }

  private static final String PASSWORD_RULE = "8–128 characters with at least one letter, one number and one symbol";

  /** OpenAPI request schemas, named and shaped like the legacy-NestJS-DTO-parity output of auth.dto.ts. */
  public static Map<String, Schema<?>> openApiSchemas() {
    Map<String, Schema<?>> s = new LinkedHashMap<>();
    s.put("RegisterDto", object(List.of("firstName", "lastName", "email", "password"),
        prop("firstName", text(1, 80)), prop("lastName", text(1, 80)), prop("email", email(254)),
        prop("password", describe(text(8, 128), PASSWORD_RULE)), prop("passwordConfirmation", text(8, 128))));
    s.put("VerifyEmailDto", object(List.of("token"), prop("token", text(32, 128))));
    s.put("ResendVerificationDto", object(List.of("email"), prop("email", email(null))));
    s.put("LoginDto", object(List.of("email", "password"), prop("email", email(null)), prop("password", text(1, 128))));
    s.put("MfaVerifyLoginDto", object(List.of("mfaChallengeToken"), prop("mfaChallengeToken", text(32, null)),
        prop("totpCode", pattern("^\\d{6}$")), prop("recoveryCode", text(8, 32))));
    s.put("ForgotPasswordDto", object(List.of("email"), prop("email", email(null))));
    s.put("ResetPasswordDto", object(List.of("token", "password", "passwordConfirmation"),
        prop("token", text(32, null)), prop("password", describe(text(8, 128), PASSWORD_RULE)),
        prop("passwordConfirmation", text(8, 128))));
    s.put("ChangePasswordDto", object(List.of("currentPassword", "newPassword", "newPasswordConfirmation"),
        prop("currentPassword", text(1, 128)), prop("newPassword", describe(text(8, 128), PASSWORD_RULE)),
        prop("newPasswordConfirmation", text(8, 128)),
        prop("totpCode", describe(pattern("^\\d{6}$"), "Required when MFA is enabled"))));
    s.put("UpdateProfileDto", object(List.of(), prop("firstName", text(1, 80)), prop("lastName", text(1, 80)),
        prop("experienceLevel", ApiDocs.oneOf(EXPERIENCE_LEVELS))));
    s.put("UpdatePreferencesDto", object(List.of(),
        prop("preferredCurrency",
            describe(ApiDocs.oneOf(CURRENCY_LIST), "ISO 4217 code known to the runtime, e.g. USD, EUR, TND")),
        prop("timezone", describe(ApiDocs.oneOf(TIME_ZONE_LIST), "IANA time zone, e.g. UTC or Africa/Tunis")),
        prop("chartTheme", ApiDocs.oneOf(CHART_THEMES)), prop("notifyEmailSecurity", new BooleanSchema()),
        prop("notifyMarketDigest", new BooleanSchema()),
        prop("trainingDifficulty", ApiDocs.oneOf(TRAINING_DIFFICULTIES)),
        prop("reduceMotion", new BooleanSchema()), prop("highContrast", new BooleanSchema())));
    s.put("ChangeEmailRequestDto", object(List.of("password", "newEmail"), prop("password", text(1, 128)),
        prop("newEmail", email(null)), prop("totpCode", pattern("^\\d{6}$"))));
    s.put("ChangeEmailConfirmDto", object(List.of("token"), prop("token", text(32, null))));
    s.put("StepUpPasswordDto", object(List.of("password"), prop("password", text(1, 128)),
        prop("totpCode", pattern("^\\d{6}$"))));
    s.put("MfaEnableDto", object(List.of("totpCode"), prop("totpCode", pattern("^\\d{6}$"))));
    s.put("MfaDisableDto", object(List.of("password"), prop("password", text(1, 128)),
        prop("totpCode", pattern("^\\d{6}$")), prop("recoveryCode", text(8, 32))));
    s.put("DeactivateAccountDto", object(List.of("password", "confirmation"), prop("password", text(1, 128)),
        prop("totpCode", pattern("^\\d{6}$")), prop("confirmation", pattern("^DEACTIVATE$"))));
    s.put("DeleteAccountDto", object(List.of("password", "confirmation"), prop("password", text(1, 128)),
        prop("totpCode", pattern("^\\d{6}$")), prop("confirmation", pattern("^DELETE$"))));
    return s;
  }

  public static Login login(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("email", "password"));
    Object email = c.stringValue("email");
    if (email instanceof String s) email = normalizeEmail(s);
    if (!isEmail(email)) c.add(mustBeEmail("email"));
    Object password = c.stringValue("password");
    stringLength(c, "password", password, 1, 128);
    c.requireValid();
    return new Login((String) email, (String) password);
  }

  public static MfaVerifyLogin mfaVerifyLogin(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("mfaChallengeToken", "totpCode", "recoveryCode"));
    Object token = c.stringValue("mfaChallengeToken");
    if (!minLength(token, 32)) c.add(longerThan("mfaChallengeToken", 32));
    if (!isString(token)) c.add(mustBeString("mfaChallengeToken"));
    Object totp = c.stringValue("totpCode");
    if (totp != null) {
      if (!matches(totp, SIX_DIGITS)) c.add(mustMatch("totpCode", "^\\d{6}$"));
      if (!isString(totp)) c.add(mustBeString("totpCode"));
    }
    Object recovery = c.stringValue("recoveryCode");
    if (recovery != null) stringLength(c, "recoveryCode", recovery, 8, 32);
    c.requireValid();
    return new MfaVerifyLogin((String) token, (String) totp, (String) recovery);
  }

  public static UpdateProfile updateProfile(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("firstName", "lastName", "experienceLevel"));
    Object firstName = trimmed(c.stringValue("firstName"));
    if (firstName != null) stringLength(c, "firstName", firstName, 1, 80);
    Object lastName = trimmed(c.stringValue("lastName"));
    if (lastName != null) stringLength(c, "lastName", lastName, 1, 80);
    Object level = c.raw("experienceLevel");
    if (level != null && !isIn(level, EXPERIENCE_LEVELS)) c.add(oneOf("experienceLevel", EXPERIENCE_LEVELS));
    c.requireValid();
    return new UpdateProfile((String) firstName, (String) lastName, (String) level);
  }

  public static PreferencesPatch updatePreferences(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("preferredCurrency", "timezone", "chartTheme", "notifyEmailSecurity",
        "notifyMarketDigest", "trainingDifficulty", "reduceMotion", "highContrast"));
    Object currency = c.stringValue("preferredCurrency");
    if (currency instanceof String s) currency = jsTrim(s).toUpperCase(java.util.Locale.ROOT);
    if (currency != null) {
      if (!isIn(currency, SUPPORTED_CURRENCIES)) c.add(Messages.format("validation.currency_supported", "preferredCurrency"));
      if (!isString(currency)) c.add(mustBeString("preferredCurrency"));
    }
    Object timezone = trimmed(c.stringValue("timezone"));
    if (timezone != null) {
      if (!isIn(timezone, SUPPORTED_TIME_ZONES)) c.add(Messages.format("validation.timezone_iana", "timezone"));
      if (!isString(timezone)) c.add(mustBeString("timezone"));
    }
    Object chartTheme = c.stringValue("chartTheme");
    if (chartTheme != null && !isIn(chartTheme, CHART_THEMES)) c.add(oneOf("chartTheme", CHART_THEMES));
    Object notifySecurity = bool(c, "notifyEmailSecurity");
    Object notifyDigest = bool(c, "notifyMarketDigest");
    Object difficulty = c.stringValue("trainingDifficulty");
    if (difficulty != null && !isIn(difficulty, TRAINING_DIFFICULTIES)) {
      c.add(oneOf("trainingDifficulty", TRAINING_DIFFICULTIES));
    }
    Object reduceMotion = bool(c, "reduceMotion");
    Object highContrast = bool(c, "highContrast");
    c.requireValid();
    return new PreferencesPatch()
        .set("preferred_currency", currency)
        .set("timezone", timezone)
        .set("chart_theme", chartTheme)
        .set("notify_email_security", notifySecurity)
        .set("notify_market_digest", notifyDigest)
        .set("training_difficulty", difficulty)
        .set("reduce_motion", reduceMotion)
        .set("high_contrast", highContrast);
  }

  // ---------- account, recovery and security DTOs ----------

  public record Register(String firstName, String lastName, String email, String password,
      String passwordConfirmation) {}

  public record ResetPassword(String token, String password, String passwordConfirmation) {}

  public record ChangePassword(String currentPassword, String newPassword, String newPasswordConfirmation,
      String totpCode) {}

  public record ChangeEmailRequest(String password, String newEmail, String totpCode) {}

  /** StepUpPasswordDto and its subclasses (recoveryCode for MfaDisableDto, confirmation for deactivate/delete). */
  public record StepUp(String password, String totpCode, String recoveryCode) {}

  private static final int PASSWORD_MIN = com.pif.api.crypto.PasswordPolicy.MIN_LENGTH;

  public static Register register(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("firstName", "lastName", "email", "password", "passwordConfirmation"));
    Object firstName = trimmed(c.stringValue("firstName"));
    stringLength(c, "firstName", firstName, 1, 80);
    Object lastName = trimmed(c.stringValue("lastName"));
    stringLength(c, "lastName", lastName, 1, 80);
    Object email = lowerTrimmed(c.stringValue("email"));
    if (!maxLength(email, 254)) c.add(shorterThan("email", 254));
    if (!isEmail(email)) c.add(mustBeEmail("email"));
    Object password = c.stringValue("password");
    stringLength(c, "password", password, PASSWORD_MIN, 128);
    Object confirmation = c.stringValue("passwordConfirmation");
    if (confirmation != null) stringLength(c, "passwordConfirmation", confirmation, PASSWORD_MIN, 128);
    c.requireValid();
    return new Register((String) firstName, (String) lastName, (String) email, (String) password,
        (String) confirmation);
  }

  /** VerifyEmailDto: 32–128 characters. */
  public static String verifyEmailToken(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("token"));
    Object token = c.stringValue("token");
    stringLength(c, "token", token, 32, 128);
    c.requireValid();
    return (String) token;
  }

  /** ChangeEmailConfirmDto: at least 32 characters. */
  public static String changeEmailConfirmToken(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("token"));
    Object token = c.stringValue("token");
    if (!minLength(token, 32)) c.add(longerThan("token", 32));
    if (!isString(token)) c.add(mustBeString("token"));
    c.requireValid();
    return (String) token;
  }

  /** ResendVerificationDto and ForgotPasswordDto. */
  public static String emailOnly(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("email"));
    Object email = lowerTrimmed(c.stringValue("email"));
    if (!isEmail(email)) c.add(mustBeEmail("email"));
    c.requireValid();
    return (String) email;
  }

  public static ResetPassword resetPassword(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("token", "password", "passwordConfirmation"));
    Object token = c.stringValue("token");
    if (!minLength(token, 32)) c.add(longerThan("token", 32));
    if (!isString(token)) c.add(mustBeString("token"));
    Object password = c.stringValue("password");
    stringLength(c, "password", password, PASSWORD_MIN, 128);
    Object confirmation = c.stringValue("passwordConfirmation");
    stringLength(c, "passwordConfirmation", confirmation, PASSWORD_MIN, 128);
    c.requireValid();
    return new ResetPassword((String) token, (String) password, (String) confirmation);
  }

  public static ChangePassword changePassword(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("currentPassword", "newPassword", "newPasswordConfirmation", "totpCode"));
    Object current = c.stringValue("currentPassword");
    stringLength(c, "currentPassword", current, 1, 128);
    Object next = c.stringValue("newPassword");
    stringLength(c, "newPassword", next, PASSWORD_MIN, 128);
    Object confirmation = c.stringValue("newPasswordConfirmation");
    stringLength(c, "newPasswordConfirmation", confirmation, PASSWORD_MIN, 128);
    Object totp = optionalTotp(c);
    c.requireValid();
    return new ChangePassword((String) current, (String) next, (String) confirmation, (String) totp);
  }

  public static ChangeEmailRequest changeEmailRequest(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("password", "newEmail", "totpCode"));
    Object password = c.stringValue("password");
    stringLength(c, "password", password, 1, 128);
    Object newEmail = lowerTrimmed(c.stringValue("newEmail"));
    if (!isEmail(newEmail)) c.add(mustBeEmail("newEmail"));
    Object totp = optionalTotp(c);
    c.requireValid();
    return new ChangeEmailRequest((String) password, (String) newEmail, (String) totp);
  }

  public static StepUp stepUp(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("password", "totpCode"));
    StepUp dto = stepUpFields(c, false);
    c.requireValid();
    return dto;
  }

  public static StepUp mfaDisable(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("password", "totpCode", "recoveryCode"));
    StepUp dto = stepUpFields(c, true);
    c.requireValid();
    return dto;
  }

  /** DeactivateAccountDto (DEACTIVATE) and DeleteAccountDto (DELETE). */
  public static StepUp confirmedStepUp(Map<String, Object> body, String word) {
    Checker c = new Checker(body, Set.of("password", "totpCode", "confirmation"));
    StepUp dto = stepUpFields(c, false);
    Object confirmation = c.stringValue("confirmation");
    if (!matches(confirmation, Pattern.compile("^" + word + "$"))) {
      c.add(mustMatch("confirmation", "^" + word + "$"));
    }
    if (!isString(confirmation)) c.add(mustBeString("confirmation"));
    c.requireValid();
    return dto;
  }

  /** MfaEnableDto: a required 6-digit code. */
  public static String mfaEnableCode(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("totpCode"));
    Object totp = c.stringValue("totpCode");
    if (!matches(totp, SIX_DIGITS)) c.add(mustMatch("totpCode", "^\\d{6}$"));
    if (!isString(totp)) c.add(mustBeString("totpCode"));
    c.requireValid();
    return (String) totp;
  }

  private static StepUp stepUpFields(Checker c, boolean withRecoveryCode) {
    Object password = c.stringValue("password");
    stringLength(c, "password", password, 1, 128);
    Object totp = optionalTotp(c);
    Object recovery = null;
    if (withRecoveryCode) {
      recovery = c.stringValue("recoveryCode");
      if (recovery != null) stringLength(c, "recoveryCode", recovery, 8, 32);
    }
    return new StepUp((String) password, (String) totp, (String) recovery);
  }

  private static Object optionalTotp(Checker c) {
    Object totp = c.stringValue("totpCode");
    if (totp != null) {
      if (!matches(totp, SIX_DIGITS)) c.add(mustMatch("totpCode", "^\\d{6}$"));
      if (!isString(totp)) c.add(mustBeString("totpCode"));
    }
    return totp;
  }

  private static Object lowerTrimmed(Object value) {
    return value instanceof String s ? normalizeEmail(s) : value;
  }

  /** The raw JSON value must be a real boolean (no "false" → true coercion). */
  private static Object bool(Checker c, String field) {
    Object v = c.raw(field);
    if (v != null && !(v instanceof Boolean)) c.add(mustBeBoolean(field));
    return v;
  }

  private static void stringLength(Checker c, String field, Object value, int min, int max) {
    if (!maxLength(value, max)) c.add(shorterThan(field, max));
    if (!minLength(value, min)) c.add(longerThan(field, min));
    if (!isString(value)) c.add(mustBeString(field));
  }

  private static Object trimmed(Object value) {
    return value instanceof String s ? jsTrim(s) : value;
  }
}
