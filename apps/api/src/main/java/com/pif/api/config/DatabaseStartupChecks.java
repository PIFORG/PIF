package com.pif.api.config;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Two startup checks, both read-only:
 *
 * <ol>
 *   <li>Target guard: the service only starts against a database whose name ends with
 *       {@code _test}, unless {@code PIF_SPRING_ALLOWED_DATABASE} names the database explicitly.
 *       This keeps the parallel implementation away from the shared development database until
 *       someone deliberately opts in.
 *   <li>Schema compatibility: the Prisma migration history and the columns this service uses
 *       must be present. Nothing is created, altered or baselined.
 * </ol>
 */
@Component
public class DatabaseStartupChecks implements InitializingBean {

  private static final Logger log = LoggerFactory.getLogger(DatabaseStartupChecks.class);

  /** Prisma migrations the Spring service was written against (apps/api/prisma/migrations). */
  static final List<String> REQUIRED_MIGRATIONS = List.of(
      "20261015190000_init_identity",
      "20261016090000_mfa_pending_created_at",
      "20261105120000_marketlab_learning",
      "20261109120000_story_progress_versions",
      "20261110090000_virtual_trading",
      "20261111090000_actuarial_scenarios",
      "20261112090000_actuarial_simulation_runs",
      "20261113090000_trading_event_sequence",
      "20261114090000_actuarial_reserving_runs");

  static final Map<String, Set<String>> REQUIRED_COLUMNS = Map.of(
      "users", Set.of("id", "email", "first_name", "last_name", "password_hash", "role", "experience_level",
          "email_verified", "email_verified_at", "status", "failed_login_count", "locked_until", "mfa_enabled",
          "mfa_verified_at", "mfa_secret_encrypted", "mfa_last_accepted_step", "security_version", "deleted_at",
          "created_at", "updated_at", "last_login_at", "last_active_at"),
      "user_preferences", Set.of("id", "user_id", "preferred_currency", "timezone", "chart_theme",
          "notify_email_security", "notify_market_digest", "training_difficulty", "reduce_motion", "high_contrast",
          "created_at", "updated_at"),
      "auth_sessions", Set.of("id", "user_id", "created_at", "last_seen_at", "expires_at", "revoked_at",
          "revoked_reason", "user_agent", "ip_digest", "device_label"),
      "auth_tokens", Set.of("id", "user_id", "session_id", "type", "token_hash", "expires_at", "used_at",
          "revoked_at", "replaced_by_id", "created_at"),
      "mfa_recovery_codes", Set.of("id", "user_id", "code_hash", "used_at", "created_at"),
      "audit_events", Set.of("id", "actor_user_id", "subject_user_id", "event_type", "outcome", "correlation_id",
          "context", "created_at"));

  private final JdbcClient jdbc;
  private final Environment env;

  public DatabaseStartupChecks(JdbcClient jdbc, Environment env) {
    this.jdbc = jdbc;
    this.env = env;
  }

  @Override
  public void afterPropertiesSet() {
    String database = databaseName(env.getProperty("spring.datasource.url", ""));
    String allowed = env.getProperty("PIF_SPRING_ALLOWED_DATABASE", "");
    if (!isAllowedTarget(database, allowed)) {
      throw new IllegalStateException("Refusing to start: database '" + database
          + "' does not end with _test. Set PIF_SPRING_ALLOWED_DATABASE to that exact name to opt in.");
    }
    try {
      verifySchema();
    } catch (org.springframework.dao.DataAccessResourceFailureException e) {
      if ("production".equals(env.getProperty("NODE_ENV"))) throw e;
      log.warn("Database unavailable at startup; database-backed requests will return 503 until it is reachable.");
    }
  }

  static boolean isAllowedTarget(String database, String allowed) {
    if (database == null || database.isBlank()) return false;
    return database.endsWith("_test") || (!allowed.isBlank() && allowed.equals(database));
  }

  static String databaseName(String jdbcUrl) {
    String rest = jdbcUrl.replaceFirst("^jdbc:postgresql://", "");
    int slash = rest.indexOf('/');
    if (slash < 0) return "";
    String path = rest.substring(slash + 1);
    int q = path.indexOf('?');
    return q >= 0 ? path.substring(0, q) : path;
  }

  private void verifySchema() {
    List<String> applied = jdbc.sql(
            "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
        .query(String.class)
        .list();
    Set<String> missingMigrations = new HashSet<>(REQUIRED_MIGRATIONS);
    applied.forEach(missingMigrations::remove);
    if (!missingMigrations.isEmpty()) {
      throw new IllegalStateException("Prisma migrations missing on the target database: " + missingMigrations);
    }

    Map<String, Set<String>> actual = new HashMap<>();
    jdbc.sql("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()")
        .query((rs, i) -> Map.entry(rs.getString(1), rs.getString(2)))
        .list()
        .forEach(e -> actual.computeIfAbsent(e.getKey(), k -> new HashSet<>()).add(e.getValue()));
    for (Map.Entry<String, Set<String>> table : REQUIRED_COLUMNS.entrySet()) {
      Set<String> columns = actual.getOrDefault(table.getKey(), Set.of());
      Set<String> missing = new HashSet<>(table.getValue());
      missing.removeAll(columns);
      if (!missing.isEmpty()) {
        throw new IllegalStateException("Schema mismatch on " + table.getKey() + ": missing columns " + missing);
      }
    }
    log.info("Schema check passed: {} Prisma migrations present, {} tables verified (read-only).",
        REQUIRED_MIGRATIONS.size(), REQUIRED_COLUMNS.size());
  }
}
