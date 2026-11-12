package com.pif.api.mail;

import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Mail configuration with the variable names, defaults and validation rules of
 * apps/api/src/config/configuration.ts and env.validation.ts. Invalid values fail at startup.
 * The SMTP password is never exposed through toString.
 */
@Component
public class MailSettings {

  public enum Mode { PREVIEW, SMTP }

  private static final Pattern LOOPBACK_HOST =
      Pattern.compile("^(localhost|127\\.\\d+\\.\\d+\\.\\d+|::1|0\\.0\\.0\\.0)$", Pattern.CASE_INSENSITIVE);
  private static final Pattern NON_DELIVERABLE_DOMAIN = Pattern.compile(
      "(^|\\.)(localhost|local|test|invalid|example|example\\.(com|net|org))$", Pattern.CASE_INSENSITIVE);
  private static final Pattern SIMPLE_EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

  private final Mode mode;
  private final String previewDir;
  private final String replyTo;
  private final String host;
  private final int port;
  private final boolean secure;
  private final boolean requireTls;
  private final String user;
  private final String pass;
  private final String from;
  private final String supportUrl;
  private final String appName;
  private final String frontendUrl;
  private final String linkBaseUrl;
  private final boolean production;
  private final boolean testEnv;

  public MailSettings(Environment env) {
    String nodeEnv = env.getProperty("NODE_ENV", "development");
    production = "production".equals(nodeEnv);
    testEnv = "test".equals(nodeEnv);

    String transport = env.getProperty("MAIL_TRANSPORT");
    if (transport != null && !transport.isEmpty() && !transport.equals("preview") && !transport.equals("smtp")) {
      throw new IllegalStateException("Environment validation failed: MAIL_TRANSPORT must be one of the following "
          + "values: preview, smtp");
    }
    String effective = transport == null || transport.isEmpty() ? "smtp" : transport.toLowerCase(Locale.ROOT);
    mode = effective.equals("preview") ? Mode.PREVIEW : Mode.SMTP;
    previewDir = orDefault(env.getProperty("MAIL_PREVIEW_DIR"), ".mail-preview");
    replyTo = emptyToNull(env.getProperty("MAIL_REPLY_TO"));
    if (replyTo != null && !SIMPLE_EMAIL.matcher(replyTo).matches()) {
      throw new IllegalStateException("Environment validation failed: MAIL_REPLY_TO must be an email");
    }

    host = env.getProperty("SMTP_HOST", "localhost");
    if (host.isBlank()) throw new IllegalStateException("Environment validation failed: SMTP_HOST should not be empty");
    port = parsePort(env.getProperty("SMTP_PORT", "1025"));
    secure = strictBoolean(env.getProperty("SMTP_SECURE"), "SMTP_SECURE", false);
    requireTls = strictBoolean(env.getProperty("SMTP_REQUIRE_TLS"), "SMTP_REQUIRE_TLS", production);
    user = emptyToNull(env.getProperty("SMTP_USER"));
    pass = emptyToNull(env.getProperty("SMTP_PASS"));
    from = env.getProperty("EMAIL_FROM", "noreply@localhost");
    if (from.isBlank()) throw new IllegalStateException("Environment validation failed: EMAIL_FROM should not be empty");
    supportUrl = emptyToNull(env.getProperty("EMAIL_SUPPORT_URL"));
    appName = env.getProperty("APP_NAME", "Market Trading Room");
    frontendUrl = env.getProperty("APP_FRONTEND_URL", "http://localhost:4200");
    linkBaseUrl = migrationLinkBase(emptyToNull(env.getProperty("MIGRATION_FRONTEND_URL")),
        env.getProperty("CORS_ORIGINS", "http://localhost:4200"));

    if (production) assertProductionMail();
  }

  /**
   * MIGRATION_FRONTEND_URL (Spring only): during isolated migration testing, account e-mail links may open the
   * Angular app instead of APP_FRONTEND_URL. Refused in production, so real users keep receiving links to the
   * approved frontend until cutover. It must be a bare origin listed in CORS_ORIGINS, so a link token can only
   * go to a frontend this API already trusts.
   */
  private String migrationLinkBase(String raw, String corsOrigins) {
    if (raw == null) return frontendUrl;
    if (production) fail("MIGRATION_FRONTEND_URL is for migration testing only and must not be set in production");
    URI uri;
    try {
      uri = URI.create(raw.strip());
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("Environment validation failed: MIGRATION_FRONTEND_URL must be a URL");
    }
    boolean bareOrigin = ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) && uri.getHost() != null
        && uri.getUserInfo() == null && uri.getQuery() == null && uri.getFragment() == null
        && (uri.getPath() == null || uri.getPath().isEmpty() || uri.getPath().equals("/"));
    if (!bareOrigin) {
      throw new IllegalStateException(
          "Environment validation failed: MIGRATION_FRONTEND_URL must be an http(s) origin without path, query or credentials");
    }
    String origin = uri.getScheme() + "://" + uri.getHost() + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
    boolean trusted = Arrays.stream(corsOrigins.split(",")).map(String::strip).anyMatch(origin::equals);
    if (!trusted) {
      throw new IllegalStateException("Environment validation failed: MIGRATION_FRONTEND_URL must be one of CORS_ORIGINS");
    }
    return origin;
  }

  /** assertProductionMail of env.validation.ts. */
  private void assertProductionMail() {
    if (mode != Mode.SMTP) {
      fail("MAIL_TRANSPORT must be \"smtp\" in production; the preview inbox is development-only");
    }
    if (LOOPBACK_HOST.matcher(host.strip()).matches()) {
      fail("SMTP_HOST points at a local catcher; configure the real SMTP relay for production");
    }
    if (!secure && !requireTls) {
      fail("SMTP_REQUIRE_TLS=false is not allowed in production without SMTP_SECURE=true");
    }
    if (user != null && pass == null) {
      fail("SMTP_PASS is required when SMTP_USER is set");
    }
    String address = senderAddress(from);
    int at = address.indexOf('@');
    String domain = at >= 0 ? address.substring(at + 1).split("@", -1)[0] : "";
    if (domain.isEmpty() || NON_DELIVERABLE_DOMAIN.matcher(domain).find()) {
      fail("EMAIL_FROM must use a verified sender on a real domain in production");
    }
  }

  public static String senderAddress(String from) {
    java.util.regex.Matcher angle = Pattern.compile("<([^>]+)>").matcher(from);
    return (angle.find() ? angle.group(1) : from).strip();
  }

  private static void fail(String message) {
    throw new IllegalStateException("Unsafe configuration: " + message);
  }

  private static int parsePort(String raw) {
    int value;
    try {
      value = Integer.parseInt(raw.strip());
    } catch (NumberFormatException e) {
      throw new IllegalStateException("Environment validation failed: SMTP_PORT must be an integer number");
    }
    if (value < 1 || value > 65535) {
      throw new IllegalStateException("Environment validation failed: SMTP_PORT must be between 1 and 65535");
    }
    return value;
  }

  /** Never silently treat a typo (e.g. "ture", "yes") as false for a security flag. */
  static boolean strictBoolean(String raw, String name, boolean fallback) {
    if (raw == null) return fallback;
    String value = raw.strip().toLowerCase(Locale.ROOT);
    if (!value.equals("true") && !value.equals("false")) {
      throw new IllegalStateException("Environment validation failed: " + name + " must be \"true\" or \"false\"");
    }
    return value.equals("true");
  }

  private static String emptyToNull(String value) {
    return value == null || value.isEmpty() ? null : value;
  }

  private static String orDefault(String value, String fallback) {
    return value == null || value.isEmpty() ? fallback : value;
  }

  public Mode mode() { return mode; }
  public String previewDir() { return previewDir; }
  public String replyTo() { return replyTo; }
  public String host() { return host; }
  public int port() { return port; }
  public boolean secure() { return secure; }
  public boolean requireTls() { return requireTls; }
  public String user() { return user; }
  String pass() { return pass; }
  public String from() { return from; }
  public String supportUrl() { return supportUrl; }
  public String appName() { return appName; }
  public String frontendUrl() { return frontendUrl; }
  /** Base of token links in account e-mails: APP_FRONTEND_URL unless MIGRATION_FRONTEND_URL is set. */
  public String linkBaseUrl() { return linkBaseUrl; }
  public boolean production() { return production; }
  public boolean testEnv() { return testEnv; }

  @Override
  public String toString() {
    return "MailSettings[mode=" + mode + ", host=" + host + ", port=" + port + ", secrets redacted]";
  }
}
