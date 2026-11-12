package com.pif.api.config;

import java.net.URI;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Same variable names and defaults as apps/api/src/config/configuration.ts.
 * Secrets are required at startup and never exposed through toString or logs.
 */
@Component
public class PifProperties {

  private static final Pattern DURATION = Pattern.compile("^([1-9]\\d{0,5})([smhd])$");

  private final String nodeEnv;
  private final boolean swaggerEnabled;
  private final String apiUrl;
  private final List<String> corsOrigins;
  private final boolean trustProxy;

  private final byte[] jwtAccessSecret;
  private final Duration jwtAccessExpiresIn;
  private final String jwtIssuer;
  private final String jwtAudience;
  private final Duration refreshExpiresIn;

  private final String tokenPepper;
  private final String ipHashPepper;
  private final int mfaChallengeExpiresMinutes;
  private final int maxSessions;
  private final int rateLimitTtlSeconds;
  private final int rateLimitLimit;
  private final int loginMaxFailures;
  private final int loginLockoutMinutes;
  private final String mfaEncryptionKey;
  private final int emailCooldownSeconds;
  private final int emailVerificationExpiresMinutes;
  private final int passwordResetExpiresMinutes;
  private final int emailChangeExpiresMinutes;
  private final boolean adminMfaRequired;
  private final String appName;

  private final String cookieName;
  private final boolean cookieSecure;
  private final String cookieSameSite;
  private final String cookiePath;
  private final String cookieDomain;

  public PifProperties(Environment env) {
    nodeEnv = env.getProperty("NODE_ENV", "development");
    swaggerEnabled = DotEnvEnvironmentPostProcessor.apiDocsEnabled(env.getProperty("SWAGGER_ENABLED"), nodeEnv);
    apiUrl = env.getProperty("APP_API_URL", "http://localhost:3002");
    corsOrigins = Arrays.stream(env.getProperty("CORS_ORIGINS", "http://localhost:4200").split(","))
        .map(String::strip)
        .filter(s -> !s.isEmpty())
        .toList();
    trustProxy = env.getProperty("TRUST_PROXY", "false").equalsIgnoreCase("true");

    jwtAccessSecret = required(env, "JWT_ACCESS_SECRET").getBytes(java.nio.charset.StandardCharsets.UTF_8);
    jwtAccessExpiresIn = parseDuration(env.getProperty("JWT_ACCESS_EXPIRES_IN", "15m"), "JWT_ACCESS_EXPIRES_IN");
    jwtIssuer = env.getProperty("JWT_ISSUER", "mtrs-api");
    jwtAudience = env.getProperty("JWT_AUDIENCE", "mtrs-web");
    refreshExpiresIn = parseDuration(env.getProperty("JWT_REFRESH_EXPIRES_IN", "7d"), "JWT_REFRESH_EXPIRES_IN");

    tokenPepper = required(env, "AUTH_TOKEN_PEPPER");
    ipHashPepper = required(env, "AUTH_IP_HASH_PEPPER");
    mfaChallengeExpiresMinutes = intProp(env, "MFA_LOGIN_CHALLENGE_EXPIRES_IN_MINUTES", 5);
    maxSessions = intProp(env, "AUTH_MAX_SESSIONS", 8);
    rateLimitTtlSeconds = intProp(env, "AUTH_RATE_LIMIT_TTL_SECONDS", 60);
    rateLimitLimit = intProp(env, "AUTH_RATE_LIMIT_LIMIT", 20);
    loginMaxFailures = intProp(env, "AUTH_LOGIN_MAX_FAILURES", 8);
    loginLockoutMinutes = intProp(env, "AUTH_LOGIN_LOCKOUT_MINUTES", 15);
    mfaEncryptionKey = required(env, "MFA_ENCRYPTION_KEY");
    emailCooldownSeconds = intProp(env, "AUTH_EMAIL_COOLDOWN_SECONDS", 60);
    emailVerificationExpiresMinutes = intProp(env, "EMAIL_VERIFICATION_TOKEN_EXPIRES_IN_MINUTES", 60);
    passwordResetExpiresMinutes = intProp(env, "PASSWORD_RESET_TOKEN_EXPIRES_IN_MINUTES", 30);
    emailChangeExpiresMinutes = intProp(env, "EMAIL_CHANGE_TOKEN_EXPIRES_IN_MINUTES", 60);
    adminMfaRequired = strictBoolean(env.getProperty("AUTH_ADMIN_MFA_REQUIRED"), "AUTH_ADMIN_MFA_REQUIRED",
        "production".equals(nodeEnv));
    appName = env.getProperty("APP_NAME", "Market Trading Room Simulator");

    cookieName = env.getProperty("AUTH_REFRESH_COOKIE_NAME", "mtrs_refresh");
    cookieSecure = env.getProperty("AUTH_COOKIE_SECURE", "false").equalsIgnoreCase("true");
    cookieSameSite = env.getProperty("AUTH_COOKIE_SAME_SITE", "lax");
    cookiePath = env.getProperty("AUTH_COOKIE_PATH", "/api/auth");
    String domain = env.getProperty("AUTH_COOKIE_DOMAIN", "");
    cookieDomain = domain.isBlank() ? null : domain;
  }

  public static Duration parseDuration(String value, String name) {
    Matcher m = DURATION.matcher(value == null ? "" : value.strip());
    if (!m.matches()) {
      throw new IllegalStateException(name + " must look like 15m, 7d, 3600s or 12h");
    }
    long n = Long.parseLong(m.group(1));
    return switch (m.group(2)) {
      case "s" -> Duration.ofSeconds(n);
      case "m" -> Duration.ofMinutes(n);
      case "h" -> Duration.ofHours(n);
      default -> Duration.ofDays(n);
    };
  }

  private static String required(Environment env, String name) {
    String value = env.getProperty(name);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(name + " is required (same variable as apps/api/.env)");
    }
    return value;
  }

  /** Security flags accept only "true" or "false" (env.validation.ts coerceBooleans). */
  private static boolean strictBoolean(String raw, String name, boolean fallback) {
    if (raw == null) return fallback;
    String value = raw.strip().toLowerCase(java.util.Locale.ROOT);
    if (!value.equals("true") && !value.equals("false")) {
      throw new IllegalStateException("Environment validation failed: " + name + " must be \"true\" or \"false\"");
    }
    return value.equals("true");
  }

  private static int intProp(Environment env, String name, int fallback) {
    String value = env.getProperty(name);
    if (value == null || value.isBlank()) return fallback;
    return Integer.parseInt(value.strip());
  }

  public boolean isProduction() {
    return "production".equals(nodeEnv);
  }

  public boolean swaggerEnabled() { return swaggerEnabled; }
  public String apiUrl() { return apiUrl; }
  public List<String> corsOrigins() { return corsOrigins; }
  public boolean trustProxy() { return trustProxy; }

  /** CORS_ORIGINS plus the API's own origin, as in the NestJS CSRF guard. */
  public List<String> csrfAllowedOrigins() {
    java.util.LinkedHashSet<String> origins = new java.util.LinkedHashSet<>(corsOrigins);
    String own = originOf(apiUrl);
    if (own != null) origins.add(own);
    return List.copyOf(origins);
  }

  public static String originOf(String url) {
    try {
      URI uri = URI.create(url);
      if (uri.getScheme() == null || uri.getHost() == null) return null;
      return uri.getScheme() + "://" + uri.getHost() + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  public byte[] jwtAccessSecret() { return jwtAccessSecret.clone(); }
  public Duration jwtAccessExpiresIn() { return jwtAccessExpiresIn; }
  public String jwtIssuer() { return jwtIssuer; }
  public String jwtAudience() { return jwtAudience; }
  public Duration refreshExpiresIn() { return refreshExpiresIn; }
  public String tokenPepper() { return tokenPepper; }
  public String ipHashPepper() { return ipHashPepper; }
  public int mfaChallengeExpiresMinutes() { return mfaChallengeExpiresMinutes; }
  public int maxSessions() { return maxSessions; }
  public int rateLimitTtlSeconds() { return rateLimitTtlSeconds; }
  public int rateLimitLimit() { return rateLimitLimit; }
  public int loginMaxFailures() { return loginMaxFailures; }
  public int loginLockoutMinutes() { return loginLockoutMinutes; }
  public String mfaEncryptionKey() { return mfaEncryptionKey; }
  public int emailCooldownSeconds() { return emailCooldownSeconds; }
  public int emailVerificationExpiresMinutes() { return emailVerificationExpiresMinutes; }
  public int passwordResetExpiresMinutes() { return passwordResetExpiresMinutes; }
  public int emailChangeExpiresMinutes() { return emailChangeExpiresMinutes; }
  public boolean adminMfaRequired() { return adminMfaRequired; }
  public String appName() { return appName; }
  public String cookieName() { return cookieName; }
  public boolean cookieSecure() { return cookieSecure; }
  public String cookieSameSite() { return cookieSameSite; }
  public String cookiePath() { return cookiePath; }
  public String cookieDomain() { return cookieDomain; }

  @Override
  public String toString() {
    return "PifProperties[secrets redacted]";
  }
}
