package com.pif.api.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.admin.AdminDtos;
import com.pif.api.admin.AdminService;
import com.pif.api.auth.AuthService.ClientMeta;
import com.pif.api.auth.AuthService.IssuedSession;
import com.pif.api.auth.AuthService.MfaChallenge;
import com.pif.api.auth.AuthService.SignedIn;
import com.pif.api.config.PifProperties;
import com.pif.api.crypto.PasswordHasher;
import com.pif.api.crypto.Totp;
import com.pif.api.data.AuthRepository;
import com.pif.api.data.Db;
import com.pif.api.data.UserRow;
import com.pif.api.mail.MailService;
import com.pif.api.mail.MailTransport;
import com.pif.api.mail.MailTransport.OutgoingMail;
import com.pif.api.mail.RecordingMailTransport;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Account, MFA, session and admin workflows against the isolated *_test PostgreSQL database, with every email
 * captured in memory (never sent). Disposable accounts only, removed after each test.
 */
@Tag("database")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class IdentityDatabaseTest {

  private static final String DOMAIN = "@spring-db-test.test";
  private static final String PASSWORD = "Db-Test-Pass-1!";
  private static final ClientMeta META = new ClientMeta("junit", null, "junit-identity");

  @TestConfiguration
  static class CaptureMail {
    @Bean
    @Primary
    RecordingMailTransport recordingMailTransport() {
      return new RecordingMailTransport();
    }
  }

  @Autowired JdbcClient jdbc;
  @Autowired AuthRepository repo;
  @Autowired AuthService auth;
  @Autowired AccountService accounts;
  @Autowired SecurityService security;
  @Autowired AdminService admin;
  @Autowired PasswordHasher hasher;
  @Autowired PifProperties props;
  @Autowired MailService mail;
  @Autowired MailTransport transport;
  @Autowired RecordingMailTransport sink;
  @Autowired PlatformTransactionManager txManager;

  @BeforeEach
  void resetSink() {
    assertThat(transport).isSameAs(sink);
    sink.clear();
  }

  @AfterEach
  void removeDisposableUsers() {
    mail.awaitPending(Duration.ofSeconds(10));
    String ids = "SELECT id FROM users WHERE email LIKE ?";
    jdbc.sql("DELETE FROM audit_events WHERE subject_user_id IN (" + ids + ") OR actor_user_id IN (" + ids + ")")
        .param("%" + DOMAIN).param("%" + DOMAIN).update();
    jdbc.sql("DELETE FROM users WHERE email LIKE ?").param("%" + DOMAIN).update();
  }

  // ---------- helpers ----------

  private String newAddress(String local) {
    return local + "-" + UUID.randomUUID().toString().substring(0, 8) + DOMAIN;
  }

  private UUID createUser(String email, String role) {
    UUID id = UUID.randomUUID();
    Instant now = Db.now();
    jdbc.sql("INSERT INTO users (id, email, first_name, last_name, password_hash, email_verified, email_verified_at, "
            + "status, role, created_at, updated_at) VALUES (?, ?, 'Db', 'Test', ?, true, ?, 'ACTIVE', "
            + "?::\"UserRole\", ?, ?)")
        .params(id, email, hasher.hash(PASSWORD), Db.ts(now), role, Db.ts(now), Db.ts(now))
        .update();
    return id;
  }

  private AuthUser signIn(String email) {
    SignedIn signedIn = (SignedIn) auth.login(email, PASSWORD, META);
    UserRow user = repo.findUserByEmail(email).orElseThrow();
    return new AuthUser(user, signedIn.session().sessionId());
  }

  private AuthUser reload(AuthUser principal) {
    return new AuthUser(repo.findUserById(principal.id()).orElseThrow(), principal.sessionId());
  }

  private List<OutgoingMail> mails(String to, String template) {
    mail.awaitPending(Duration.ofSeconds(10));
    return sink.to(to, template);
  }

  private int auditCount(UUID subject, String eventType) {
    return jdbc.sql("SELECT count(*) FROM audit_events WHERE subject_user_id = ? AND event_type = ?")
        .param(subject).param(eventType).query(Integer.class).single();
  }

  private int activeSessions(UUID userId) {
    return jdbc.sql("SELECT count(*) FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL")
        .param(userId).query(Integer.class).single();
  }

  private static String errorCode(Runnable call) {
    try {
      call.run();
    } catch (ApiException e) {
      return e.errorCode();
    }
    throw new AssertionError("Expected an ApiException");
  }

  private static String totp(String base32Secret, int stepOffset) {
    long step = Totp.currentStep(System.currentTimeMillis()) + stepOffset;
    return Totp.generate(Totp.Base32.decode(base32Secret), step);
  }

  // ---------- lockout ----------

  @Test
  void lockoutSendsExactlyOneNoticeAndAuditsOnce() {
    String email = newAddress("lock");
    UUID id = createUser(email, "INVESTOR");
    int max = props.loginMaxFailures();
    for (int i = 0; i < max + 3; i++) {
      assertThat(errorCode(() -> auth.login(email, "Wrong-Pass-1!", META))).isEqualTo("INVALID_CREDENTIALS");
    }
    assertThat(errorCode(() -> auth.login(email, PASSWORD, META))).isEqualTo("INVALID_CREDENTIALS");

    List<OutgoingMail> notices = mails(email, "account-locked");
    assertThat(notices).hasSize(1);
    assertThat(notices.getFirst().text()).contains(props.loginLockoutMinutes() + " minutes");
    assertThat(RecordingMailTransport.containsTokenLink(notices.getFirst())).isFalse();
    assertThat(auditCount(id, "ACCOUNT_LOCKED")).isEqualTo(1);
    assertThat(repo.findUserById(id).orElseThrow().isLocked(Db.now())).isTrue();
  }

  @Test
  void aFailedLockoutNoticeNeverUndoesTheLock() {
    sink.failDeliveries(true);
    String email = newAddress("lockfail");
    UUID id = createUser(email, "INVESTOR");
    for (int i = 0; i < props.loginMaxFailures(); i++) {
      assertThat(errorCode(() -> auth.login(email, "Wrong-Pass-1!", META))).isEqualTo("INVALID_CREDENTIALS");
    }
    assertThat(mails(email, "account-locked")).hasSize(1);
    assertThat(repo.findUserById(id).orElseThrow().isLocked(Db.now())).isTrue();
    assertThat(auditCount(id, "ACCOUNT_LOCKED")).isEqualTo(1);
  }

  @Test
  void concurrentFailuresCrossingTheThresholdLockAndNotifyOnce() throws Exception {
    String email = newAddress("lockrace");
    UUID id = createUser(email, "INVESTOR");
    int max = props.loginMaxFailures();
    for (int i = 0; i < max - 1; i++) auth.registerFailedLogin(repo.findUserById(id).orElseThrow(), META);
    ExecutorService pool = Executors.newFixedThreadPool(8);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<?>> futures = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      futures.add(pool.submit(() -> {
        start.await();
        auth.registerFailedLogin(repo.findUserById(id).orElseThrow(), META);
        return null;
      }));
    }
    start.countDown();
    for (Future<?> f : futures) f.get();
    pool.shutdown();

    assertThat(mails(email, "account-locked")).hasSize(1);
    assertThat(auditCount(id, "ACCOUNT_LOCKED")).isEqualTo(1);
    assertThat(repo.findUserById(id).orElseThrow().isLocked(Db.now())).isTrue();
  }

  // ---------- registration and recovery ----------

  @Test
  void registrationVerificationIsSingleUseAndDuplicatesGetTheSameAnswer() {
    String email = newAddress("register");
    Map<String, Object> first = accounts.register(
        new AuthDtos.Register("Reg", "User", email, PASSWORD, PASSWORD), META);
    List<OutgoingMail> verify = mails(email, "verify-email");
    assertThat(verify).hasSize(1);
    String token = RecordingMailTransport.tokenOf(verify.getFirst());
    assertThat(token).matches("[0-9a-f]{64}");
    UUID id = repo.findUserByEmail(email).orElseThrow().id();
    String stored = jdbc.sql("SELECT token_hash FROM auth_tokens WHERE user_id = ? AND type = 'EMAIL_VERIFICATION'")
        .param(id).query(String.class).single();
    assertThat(stored).isNotEqualTo(token).isEqualTo(auth.hashToken(token));
    assertThat(errorCode(() -> auth.login(email, PASSWORD, META))).isEqualTo("EMAIL_NOT_VERIFIED");

    accounts.verifyEmail(token, META);
    assertThat(repo.findUserById(id).orElseThrow().status()).isEqualTo("ACTIVE");
    assertThat(mails(email, "welcome")).hasSize(1);
    assertThat(errorCode(() -> accounts.verifyEmail(token, META))).isEqualTo("TOKEN_INVALID");
    assertThat(auth.login(email, PASSWORD, META)).isInstanceOf(SignedIn.class);

    Map<String, Object> duplicate = accounts.register(
        new AuthDtos.Register("Reg", "User", email.toUpperCase(), PASSWORD, PASSWORD), META);
    accounts.register(new AuthDtos.Register("Reg", "User", email, PASSWORD, PASSWORD), META);
    assertThat(duplicate).isEqualTo(first);
    List<OutgoingMail> exists = mails(email, "account-exists");
    assertThat(exists).hasSize(1);
    assertThat(RecordingMailTransport.containsTokenLink(exists.getFirst())).isFalse();
    assertThat(mails(email, "verify-email")).hasSize(1);
  }

  @Test
  void passwordResetIsSingleUseRevokesSessionsAndUnknownAddressesLookTheSame() {
    String email = newAddress("reset");
    UUID id = createUser(email, "INVESTOR");
    signIn(email);
    signIn(email);
    assertThat(activeSessions(id)).isEqualTo(2);

    Map<String, Object> known = accounts.forgotPassword(email, META);
    Map<String, Object> unknown = accounts.forgotPassword(newAddress("nobody"), META);
    assertThat(unknown).isEqualTo(known);
    accounts.forgotPassword(email, META);
    List<OutgoingMail> resets = mails(email, "reset-password");
    assertThat(resets).as("cooldown allows one link").hasSize(1);
    String token = RecordingMailTransport.tokenOf(resets.getFirst());

    String newPassword = "Reset-Pass-2@x";
    accounts.resetPassword(new AuthDtos.ResetPassword(token, newPassword, newPassword), META);
    assertThat(activeSessions(id)).isZero();
    assertThat(mails(email, "password-changed")).hasSize(1);
    assertThat(errorCode(() -> accounts.resetPassword(
        new AuthDtos.ResetPassword(token, "Other-Pass-3#y", "Other-Pass-3#y"), META)))
        .isEqualTo("TOKEN_INVALID");
    assertThat(errorCode(() -> auth.login(email, PASSWORD, META))).isEqualTo("INVALID_CREDENTIALS");
    assertThat(auth.login(email, newPassword, META)).isInstanceOf(SignedIn.class);
  }

  @Test
  void changePasswordRequiresTheCurrentPasswordAndKeepsOnlyTheNewSession() {
    String email = newAddress("change");
    UUID id = createUser(email, "INVESTOR");
    AuthUser me = signIn(email);
    signIn(email);
    assertThat(errorCode(() -> accounts.changePassword(me,
        new AuthDtos.ChangePassword("Not-It-1!", "Fresh-Pass-4$z", "Fresh-Pass-4$z", null), META)))
        .isEqualTo("INVALID_CREDENTIALS");

    IssuedSession session = accounts.changePassword(me,
        new AuthDtos.ChangePassword(PASSWORD, "Fresh-Pass-4$z", "Fresh-Pass-4$z", null), META);
    assertThat(activeSessions(id)).isEqualTo(1);
    assertThat(repo.findSession(session.sessionId()).orElseThrow().revokedAt()).isNull();
    assertThat(mails(email, "password-changed")).hasSize(1);
  }

  @Test
  void emailChangeMovesOwnershipOnlyThroughTheConfirmationLink() {
    String email = newAddress("move");
    String target = newAddress("moved");
    UUID id = createUser(email, "INVESTOR");
    AuthUser me = signIn(email);
    accounts.requestEmailChange(me, new AuthDtos.ChangeEmailRequest(PASSWORD, target, null), META);
    assertThat(errorCode(() -> accounts.requestEmailChange(me,
        new AuthDtos.ChangeEmailRequest(PASSWORD, target, null), META))).isEqualTo("EMAIL_CHANGE_COOLDOWN");
    assertThat(mails(email, "email-change-requested")).hasSize(1);
    String token = RecordingMailTransport.tokenOf(mails(target, "email-change-confirm").getFirst());
    assertThat(repo.findUserById(id).orElseThrow().email()).isEqualTo(email);

    accounts.confirmEmailChange(token, META);
    assertThat(repo.findUserById(id).orElseThrow().email()).isEqualTo(target);
    assertThat(activeSessions(id)).isZero();
    assertThat(mails(email, "email-changed-old")).hasSize(1);
    assertThat(mails(target, "email-changed-new")).hasSize(1);
    assertThat(errorCode(() -> accounts.confirmEmailChange(token, META))).isEqualTo("TOKEN_INVALID");
  }

  // ---------- MFA ----------

  @Test
  void mfaLifecycleStoresOnlyEncryptedSecretsAndHashedRecoveryCodes() {
    String email = newAddress("mfa");
    UUID id = createUser(email, "INVESTOR");
    AuthUser me = signIn(email);
    AuthUser otherDevice = signIn(email);

    Map<String, Object> setup = security.mfaSetup(me, new AuthDtos.StepUp(PASSWORD, null, null), META);
    String secret = (String) setup.get("secret");
    assertThat(secret).matches("[A-Z2-7]{16}");
    assertThat((String) setup.get("otpauth")).startsWith("otpauth://totp/").contains("secret=" + secret)
        .contains("period=30&digits=6&algorithm=SHA1&issuer=");
    String pending = jdbc.sql("SELECT mfa_pending_secret_encrypted FROM users WHERE id = ?").param(id)
        .query(String.class).single();
    assertThat(pending).startsWith("v1:").doesNotContain(secret);
    assertThat(errorCode(() -> security.mfaEnable(me, "000000".equals(totp(secret, 0)) ? "111111" : "000000",
        META))).isEqualTo("MFA_INVALID");

    @SuppressWarnings("unchecked")
    List<String> codes = (List<String>) security.mfaEnable(me, totp(secret, 0), META).get("recoveryCodes");
    assertThat(codes).hasSize(10).allMatch(c -> c.matches("[0-9A-F]{10}"));
    List<String> hashes = jdbc.sql("SELECT code_hash FROM mfa_recovery_codes WHERE user_id = ?").param(id)
        .query(String.class).list();
    assertThat(hashes).hasSize(10).allMatch(h -> h.startsWith("$argon2id$")).noneMatch(codes::contains);
    assertThat(mails(email, "mfa-enabled")).hasSize(1);
    assertThat(security.mfaStatus(reload(me))).containsEntry("mfaEnabled", true)
        .containsEntry("remainingRecoveryCodes", 10);

    MfaChallenge challenge = (MfaChallenge) auth.login(email, PASSWORD, META);
    IssuedSession viaRecovery = auth.verifyMfaLogin(challenge.mfaChallengeToken(), null, codes.getFirst(), META);
    assertThat(viaRecovery.sessionId()).isNotNull();
    MfaChallenge again = (MfaChallenge) auth.login(email, PASSWORD, META);
    assertThat(errorCode(() -> auth.verifyMfaLogin(again.mfaChallengeToken(), null, codes.getFirst(), META)))
        .isEqualTo("MFA_INVALID");
    assertThat(security.mfaStatus(reload(me))).containsEntry("remainingRecoveryCodes", 9);

    AuthUser current = reload(me);
    @SuppressWarnings("unchecked")
    List<String> regenerated = (List<String>) security.mfaRegenerateRecovery(current,
        new AuthDtos.StepUp(PASSWORD, totp(secret, 1), null), META).get("recoveryCodes");
    assertThat(regenerated).hasSize(10).doesNotContainAnyElementsOf(codes);
    assertThat(mails(email, "mfa-recovery-codes-regenerated")).hasSize(1);

    security.mfaDisable(reload(me), new AuthDtos.StepUp(PASSWORD, null, regenerated.getFirst()), META);
    UserRow after = repo.findUserById(id).orElseThrow();
    assertThat(after.mfaEnabled()).isFalse();
    assertThat(after.mfaSecretEncrypted()).isNull();
    assertThat(repo.findSession(me.sessionId()).orElseThrow().revokedAt()).isNull();
    assertThat(repo.findSession(otherDevice.sessionId()).orElseThrow().revokedAt()).isNotNull();
    assertThat(mails(email, "mfa-disabled")).hasSize(1);
    String via = jdbc.sql("SELECT context->>'via' FROM audit_events WHERE subject_user_id = ? "
        + "AND event_type = 'MFA_DISABLED'").param(id).query(String.class).single();
    assertThat(via).isEqualTo("RECOVERY_CODE");
  }

  // ---------- sessions ----------

  @Test
  void sessionRevocationIsScopedToTheOwner() {
    String email = newAddress("sess");
    String otherEmail = newAddress("sessother");
    UUID id = createUser(email, "INVESTOR");
    createUser(otherEmail, "INVESTOR");
    AuthUser me = signIn(email);
    AuthUser second = signIn(email);
    AuthUser third = signIn(email);
    AuthUser stranger = signIn(otherEmail);

    List<Map<String, Object>> listed = security.listSessions(me);
    assertThat(listed).hasSize(3);
    assertThat(listed.stream().filter(s -> Boolean.TRUE.equals(s.get("current")))).hasSize(1);
    assertThat(errorCode(() -> security.revokeSessionOwned(stranger, second.sessionId(), META)))
        .isEqualTo("RESOURCE_NOT_FOUND");

    security.revokeSessionOwned(me, second.sessionId(), META);
    assertThat(repo.findSession(second.sessionId()).orElseThrow().revokedAt()).isNotNull();
    security.revokeOtherSessions(me, new AuthDtos.StepUp(PASSWORD, null, null), META);
    assertThat(repo.findSession(third.sessionId()).orElseThrow().revokedAt()).isNotNull();
    assertThat(repo.findSession(me.sessionId()).orElseThrow().revokedAt()).isNull();
    assertThat(mails(email, "sessions-revoked")).hasSize(1);

    security.logoutAll(me, META);
    assertThat(activeSessions(id)).isZero();
    Integer liveRefresh = jdbc.sql("SELECT count(*) FROM auth_tokens WHERE user_id = ? AND type = 'REFRESH_TOKEN' "
        + "AND revoked_at IS NULL AND used_at IS NULL").param(id).query(Integer.class).single();
    assertThat(liveRefresh).isZero();
  }

  // ---------- admin ----------

  @Test
  void adminStatusChangesRevokeAccessNotifyAndAudit() {
    String adminEmail = newAddress("admin");
    String userEmail = newAddress("member");
    UUID adminId = createUser(adminEmail, "ADMIN");
    UUID userId = createUser(userEmail, "INVESTOR");
    AuthUser actor = signIn(adminEmail);
    signIn(userEmail);
    int versionBefore = repo.findUserById(userId).orElseThrow().securityVersion();

    assertThat(errorCode(() -> admin.updateStatus(actor, adminId, new AdminDtos.StatusChange("SUSPENDED", "self"),
        META))).isEqualTo("SELF_STATUS_CHANGE_FORBIDDEN");
    admin.updateStatus(actor, userId, new AdminDtos.StatusChange("SUSPENDED", "Policy review"), META);
    UserRow suspended = repo.findUserById(userId).orElseThrow();
    assertThat(suspended.status()).isEqualTo("SUSPENDED");
    assertThat(suspended.securityVersion()).isEqualTo(versionBefore + 1);
    assertThat(activeSessions(userId)).isZero();
    assertThat(mails(userEmail, "account-suspended")).hasSize(1);
    assertThat(auditCount(userId, "ADMIN_STATUS_CHANGE")).isEqualTo(1);
    assertThat(errorCode(() -> auth.login(userEmail, PASSWORD, META))).isNotNull();
    assertThat(errorCode(() -> admin.updateStatus(actor, userId,
        new AdminDtos.StatusChange("SUSPENDED", "again"), META))).isEqualTo("STATUS_UNCHANGED");

    admin.updateStatus(actor, userId, new AdminDtos.StatusChange("ACTIVE", "Review done"), META);
    assertThat(repo.findUserById(userId).orElseThrow().status()).isEqualTo("ACTIVE");
    assertThat(mails(userEmail, "account-reactivated")).hasSize(1);
  }

  @Test
  void adminRoleChangesRequireReauthenticationAndNeverTargetSelf() {
    String adminEmail = newAddress("roleadmin");
    String userEmail = newAddress("rolemember");
    UUID adminId = createUser(adminEmail, "ADMIN");
    UUID userId = createUser(userEmail, "INVESTOR");
    AuthUser actor = signIn(adminEmail);

    assertThat(errorCode(() -> admin.updateRole(actor, adminId, new AdminDtos.RoleChange("INVESTOR", PASSWORD, null),
        META))).isEqualTo("SELF_DEMOTION_FORBIDDEN");
    assertThat(errorCode(() -> admin.updateRole(actor, userId,
        new AdminDtos.RoleChange("ADMIN", "Not-The-Pass-1!", null), META))).isEqualTo("INVALID_CREDENTIALS");
    assertThat(repo.findUserById(userId).orElseThrow().role()).isEqualTo("INVESTOR");

    admin.updateRole(actor, userId, new AdminDtos.RoleChange("ADMIN", PASSWORD, null), META);
    assertThat(repo.findUserById(userId).orElseThrow().role()).isEqualTo("ADMIN");
    assertThat(errorCode(() -> admin.updateRole(actor, userId, new AdminDtos.RoleChange("ADMIN", PASSWORD, null),
        META))).isEqualTo("ROLE_UNCHANGED");
    admin.updateRole(actor, userId, new AdminDtos.RoleChange("INVESTOR", PASSWORD, null), META);
    assertThat(auditCount(userId, "ADMIN_ROLE_CHANGE")).isEqualTo(2);
  }

  @Test
  void theLastActiveAdministratorCannotBeRestricted() {
    // Everything runs in one transaction that is always rolled back: the other administrators of the shared test
    // database are suspended only as seen from inside it, so no row outside this test is ever changed.
    new TransactionTemplate(txManager).executeWithoutResult(status -> {
      status.setRollbackOnly();
      String actorEmail = newAddress("lasta");
      String targetEmail = newAddress("lastb");
      UUID actorId = createUser(actorEmail, "ADMIN");
      UUID target = createUser(targetEmail, "ADMIN");
      AuthUser actor = signIn(actorEmail);
      jdbc.sql("UPDATE users SET status = 'SUSPENDED' WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> ?")
          .param(target).update();
      Integer activeAdmins = jdbc.sql("SELECT count(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' "
          + "AND deleted_at IS NULL").query(Integer.class).single();
      assertThat(activeAdmins).isEqualTo(1);

      // The actor's token was issued while active; a concurrent change then suspended the actor, leaving the
      // target as the only active administrator.
      assertThat(repo.findUserById(actorId).orElseThrow().status()).isEqualTo("SUSPENDED");
      assertThat(errorCode(() -> admin.updateStatus(actor, target,
          new AdminDtos.StatusChange("SUSPENDED", "Rotation"), META))).isEqualTo("LAST_ADMIN_PROTECTION");
      assertThat(errorCode(() -> admin.updateRole(actor, target,
          new AdminDtos.RoleChange("INVESTOR", PASSWORD, null), META))).isEqualTo("LAST_ADMIN_PROTECTION");
      UserRow unchanged = repo.findUserById(target).orElseThrow();
      assertThat(unchanged.status()).isEqualTo("ACTIVE");
      assertThat(unchanged.role()).isEqualTo("ADMIN");
    });
  }
}
