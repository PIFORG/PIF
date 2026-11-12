package com.pif.api.data;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.audit.AuditService;
import com.pif.api.auth.AuthService;
import com.pif.api.auth.AuthService.ClientMeta;
import com.pif.api.auth.AuthService.SignedIn;
import com.pif.api.config.PifProperties;
import com.pif.api.crypto.PasswordHasher;
import com.pif.api.data.AuthRepository.PreferencesPatch;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Runs the real SQL against an isolated PostgreSQL database that already carries the Prisma migrations.
 * The application refuses to start unless the database name ends with _test, so these tests can never touch PIF.
 * Run with: mvnw -P database-tests test (DATABASE_URL pointing at the *_test database).
 */
@Tag("database")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class AuthDatabaseTest {

  private static final String DOMAIN = "@spring-db-test.test";
  private static final String PASSWORD = "Db-Test-Pass-1!";

  @Autowired JdbcClient jdbc;
  @Autowired AuthRepository repo;
  @Autowired AuthService auth;
  @Autowired AuditService audit;
  @Autowired PasswordHasher hasher;
  @Autowired PifProperties props;
  @Autowired Environment env;

  @BeforeAll
  static void useServerTimeZone() {
    TimeZone.setDefault(TimeZone.getTimeZone("Africa/Lagos"));
  }

  @AfterEach
  void removeDisposableUsers() {
    jdbc.sql("DELETE FROM audit_events WHERE subject_user_id IN (SELECT id FROM users WHERE email LIKE ?)")
        .param("%" + DOMAIN).update();
    jdbc.sql("DELETE FROM users WHERE email LIKE ?").param("%" + DOMAIN).update();
  }

  private UUID createUser(String local) {
    UUID id = UUID.randomUUID();
    Instant now = Db.now();
    jdbc.sql("INSERT INTO users (id, email, first_name, last_name, password_hash, email_verified, email_verified_at, "
            + "status, created_at, updated_at) VALUES (?, ?, 'Db', 'Test', ?, true, ?, 'ACTIVE', ?, ?)")
        .params(id, local + "-" + id.toString().substring(0, 8) + DOMAIN, hasher.hash(PASSWORD), Db.ts(now),
            Db.ts(now), Db.ts(now))
        .update();
    return id;
  }

  private String emailOf(UUID id) {
    return jdbc.sql("SELECT email FROM users WHERE id = ?").param(id).query(String.class).single();
  }

  @Test
  void runsOnlyAgainstATestDatabaseWithEveryPrismaMigrationApplied() {
    String url = env.getProperty("spring.datasource.url", "");
    assertThat(url).containsPattern("/[^/?]+_test(\\?|$)");
    Integer finished = jdbc.sql("SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL "
        + "AND rolled_back_at IS NULL").query(Integer.class).single();
    assertThat(finished).isGreaterThanOrEqualTo(9);
  }

  @Test
  void timestampsAreWrittenAsUtcRegardlessOfTheJvmTimeZone() {
    UUID userId = createUser("utc");
    UUID sessionId = UUID.randomUUID();
    Instant now = Db.now();
    repo.insertSession(sessionId, userId, now, now.plus(Duration.ofDays(1)), "junit", null, "junit");

    Double skewSeconds = jdbc.sql("SELECT abs(extract(epoch FROM (created_at - (now() AT TIME ZONE 'UTC')))) "
        + "FROM auth_sessions WHERE id = ?").param(sessionId).query(Double.class).single();
    assertThat(skewSeconds).isLessThan(5.0);
    assertThat(repo.findSession(sessionId).orElseThrow().lastSeenAt()).isEqualTo(now);
  }

  @Test
  void sessionLimitRevokesTheOldestSessionAndItsRefreshToken() throws InterruptedException {
    UUID userId = createUser("limit");
    String email = emailOf(userId);
    int max = props.maxSessions();
    List<UUID> sessions = new ArrayList<>();
    for (int i = 0; i <= max; i++) {
      SignedIn signedIn = (SignedIn) auth.login(email, PASSWORD, new ClientMeta("junit", null, null));
      sessions.add(signedIn.session().sessionId());
      Thread.sleep(5);
    }

    UUID oldest = sessions.getFirst();
    Map<String, Object> revoked = jdbc.sql("SELECT revoked_reason, revoked_at FROM auth_sessions WHERE id = ?")
        .param(oldest).query().singleRow();
    assertThat(revoked.get("revoked_reason")).isEqualTo("SESSION_LIMIT");
    assertThat(revoked.get("revoked_at")).isNotNull();
    Integer liveTokens = jdbc.sql("SELECT count(*) FROM auth_tokens WHERE session_id = ? AND revoked_at IS NULL")
        .param(oldest).query(Integer.class).single();
    assertThat(liveTokens).isZero();
    assertThat(repo.activeSessionIdsOldestFirst(userId, Db.now())).hasSize(max).doesNotContain(oldest);

    String context = jdbc.sql("SELECT context::text FROM audit_events WHERE subject_user_id = ? "
        + "AND event_type = 'SESSION_LIMIT_REVOKED'").param(userId).query(String.class).single();
    assertThat(context).contains(oldest.toString()).contains("\"maxSessions\": " + max);
  }

  @Test
  void revokeSessionsForLimitBindsAUuidArray() {
    UUID userId = createUser("array");
    Instant now = Db.now();
    UUID a = UUID.randomUUID();
    UUID b = UUID.randomUUID();
    UUID kept = UUID.randomUUID();
    for (UUID id : List.of(a, b, kept)) {
      repo.insertSession(id, userId, now, now.plus(Duration.ofDays(1)), null, null, null);
      repo.insertToken(UUID.randomUUID(), userId, id, "REFRESH_TOKEN", UUID.randomUUID().toString(),
          now.plus(Duration.ofDays(1)), now);
    }
    repo.revokeSessionsForLimit(List.of(a, b), now);

    assertThat(repo.activeSessionIdsOldestFirst(userId, now)).containsExactly(kept);
    Integer revokedTokens = jdbc.sql("SELECT count(*) FROM auth_tokens WHERE user_id = ? AND revoked_at IS NOT NULL")
        .param(userId).query(Integer.class).single();
    assertThat(revokedTokens).isEqualTo(2);
  }

  @Test
  void singleUseTokensAreConsumedExactlyOnceAndNeverAfterExpiry() {
    UUID userId = createUser("token");
    Instant now = Db.now();
    repo.insertToken(UUID.randomUUID(), userId, null, "MFA_LOGIN_CHALLENGE", "hash-live-" + userId,
        now.plus(Duration.ofMinutes(5)), now);
    repo.insertToken(UUID.randomUUID(), userId, null, "PASSWORD_RESET", "hash-expired-" + userId,
        now.minus(Duration.ofSeconds(1)), now.minus(Duration.ofMinutes(5)));

    assertThat(repo.consumeToken("hash-live-" + userId, "MFA_LOGIN_CHALLENGE", Db.now())).contains(userId);
    assertThat(repo.consumeToken("hash-live-" + userId, "MFA_LOGIN_CHALLENGE", Db.now())).isEmpty();
    assertThat(repo.consumeToken("hash-expired-" + userId, "PASSWORD_RESET", Db.now())).isEmpty();
    assertThat(repo.consumeToken("hash-live-" + userId, "PASSWORD_RESET", Db.now())).isEmpty();
  }

  @Test
  void issuingAChallengeRevokesThePreviousUnusedOne() {
    UUID userId = createUser("challenge");
    jdbc.sql("UPDATE users SET mfa_enabled = true WHERE id = ?").param(userId).update();
    String email = emailOf(userId);
    var first = (AuthService.MfaChallenge) auth.login(email, PASSWORD, new ClientMeta("junit", null, null));
    var second = (AuthService.MfaChallenge) auth.login(email, PASSWORD, new ClientMeta("junit", null, null));

    assertThat(first.mfaChallengeToken()).isNotEqualTo(second.mfaChallengeToken());
    Integer live = jdbc.sql("SELECT count(*) FROM auth_tokens WHERE user_id = ? AND type = 'MFA_LOGIN_CHALLENGE' "
        + "AND revoked_at IS NULL AND used_at IS NULL").param(userId).query(Integer.class).single();
    assertThat(live).isEqualTo(1);
  }

  @Test
  void totpStepClaimsAreStrictlyMonotonic() {
    UUID userId = createUser("totp");
    assertThat(repo.claimTotpStep(userId, 100, Db.now())).isTrue();
    assertThat(repo.claimTotpStep(userId, 100, Db.now())).isFalse();
    assertThat(repo.claimTotpStep(userId, 99, Db.now())).isFalse();
    assertThat(repo.claimTotpStep(userId, 101, Db.now())).isTrue();
  }

  @Test
  void failedLoginsLockTheAccountOnlyAtTheThreshold() {
    UUID userId = createUser("lock");
    Instant now = Db.now();
    assertThat(repo.incrementFailedLogin(userId, now)).isEqualTo(1);
    assertThat(repo.applyLock(userId, now.plus(Duration.ofMinutes(15)), 2, now)).isZero();
    assertThat(repo.incrementFailedLogin(userId, now)).isEqualTo(2);
    assertThat(repo.applyLock(userId, now.plus(Duration.ofMinutes(15)), 2, now)).isEqualTo(1);

    UserRow user = repo.findUserById(userId).orElseThrow();
    assertThat(user.failedLoginCount()).isZero();
    assertThat(user.isLocked(Db.now())).isTrue();
  }

  @Test
  void preferencesUpsertKeepsUntouchedFieldsAndBumpsUpdatedAt() throws InterruptedException {
    UUID userId = createUser("prefs");
    String stamps = "SELECT created_at::text || '|' || updated_at::text FROM user_preferences WHERE user_id = ?";
    repo.upsertPreferences(userId, new PreferencesPatch().set("timezone", "Africa/Tunis"), Db.now());
    String[] created = jdbc.sql(stamps).param(userId).query(String.class).single().split("\\|");
    Thread.sleep(5);
    PreferencesRow updated = repo.upsertPreferences(userId,
        new PreferencesPatch().set("preferred_currency", "EUR"), Db.now());
    String[] after = jdbc.sql(stamps).param(userId).query(String.class).single().split("\\|");

    assertThat(updated.toJson()).containsEntry("timezone", "Africa/Tunis").containsEntry("preferredCurrency", "EUR");
    assertThat(after[0]).isEqualTo(created[0]);
    assertThat(after[1]).isNotEqualTo(created[1]);
  }

  @Test
  void auditStoresJsonNullForAMissingContextAndDropsSensitiveKeys() {
    UUID userId = createUser("audit");
    audit.record(new AuditService.Event("JUNIT_NULL", "SUCCESS", null, userId, "junit-1", null));
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("password", "x");
    context.put("refreshTokenHash", "y");
    context.put("nested", Map.of("mfaSecret", "z", "kept", 1));
    context.put("sessionId", userId);
    audit.record(new AuditService.Event("JUNIT_CONTEXT", "FAILURE", userId, userId, null, context));

    String nullType = jdbc.sql("SELECT jsonb_typeof(context) FROM audit_events WHERE subject_user_id = ? "
        + "AND event_type = 'JUNIT_NULL'").param(userId).query(String.class).single();
    assertThat(nullType).isEqualTo("null");
    String stored = jdbc.sql("SELECT context::text FROM audit_events WHERE subject_user_id = ? "
        + "AND event_type = 'JUNIT_CONTEXT'").param(userId).query(String.class).single();
    assertThat(stored).doesNotContain("password").doesNotContain("refreshTokenHash").doesNotContain("mfaSecret")
        .contains("\"kept\": 1").contains(userId.toString());
  }
}
