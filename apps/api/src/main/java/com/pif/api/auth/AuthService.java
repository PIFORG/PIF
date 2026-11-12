package com.pif.api.auth;

import com.pif.api.audit.AuditService;
import com.pif.api.config.PifProperties;
import com.pif.api.crypto.MfaCrypto;
import com.pif.api.crypto.PasswordHasher;
import com.pif.api.crypto.TokenCrypto;
import com.pif.api.crypto.Totp;
import com.pif.api.data.AuthRepository;
import com.pif.api.data.AuthRepository.PreferencesPatch;
import com.pif.api.data.AuthRepository.TokenRow;
import com.pif.api.data.Db;
import com.pif.api.data.PreferencesRow;
import com.pif.api.data.UserRow;
import com.pif.api.mail.MailService;
import com.pif.api.security.AuthUser;
import com.pif.api.security.JwtService;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import com.pif.api.web.ApiException;
import com.pif.api.web.Messages;
import com.pif.api.web.Validation;

/**
 * Sign-in, two-step verification, refresh rotation, sign-out and profile reads/updates, ported
 * from apps/api/src/auth/auth.service.ts with the same queries, audit events and error codes.
 */
@Service
public class AuthService {

  private static final Duration REFRESH_REUSE_GRACE = Duration.ofSeconds(15);

  /** Client metadata recorded on sessions: sanitized user agent and peppered IP digest. */
  public record ClientMeta(String userAgent, String ipDigest, String correlationId) {

    public static ClientMeta of(jakarta.servlet.http.HttpServletRequest req, PifProperties props) {
      return new ClientMeta(
          TokenCrypto.sanitizeUserAgent(req.getHeader("User-Agent")),
          TokenCrypto.digestIp(com.pif.api.web.ClientIp.of(req, props), props.ipHashPepper()),
          (String) req.getAttribute(com.pif.api.web.RequestFilters.CORRELATION_ATTRIBUTE));
    }
  }

  /** Session issued to the browser: the refresh token goes into the HttpOnly cookie only. */
  public record IssuedSession(String accessToken, String refreshToken, Instant refreshExpiresAt,
      Map<String, Object> user, UUID sessionId) {}

  public sealed interface LoginResult permits MfaChallenge, SignedIn {}

  public record MfaChallenge(String mfaChallengeToken) implements LoginResult {}

  public record SignedIn(IssuedSession session) implements LoginResult {}

  /**
   * Tokens that grant account access or ownership changes. All are revoked whenever the password changes or is
   * reset, so a recovered account cannot be re-taken via a pending email-change link, MFA challenge or refresh token.
   */
  static final List<String> CREDENTIAL_SENSITIVE_TOKEN_TYPES =
      List.of("PASSWORD_RESET", "EMAIL_CHANGE", "MFA_LOGIN_CHALLENGE", "REFRESH_TOKEN");

  private final AuthRepository repo;
  private final PasswordHasher passwords;
  private final JwtService jwt;
  private final AuditService audit;
  private final PifProperties props;
  private final TransactionTemplate tx;
  private final MailService mail;

  public AuthService(AuthRepository repo, PasswordHasher passwords, JwtService jwt, AuditService audit,
      PifProperties props, TransactionTemplate tx, MailService mail) {
    this.repo = repo;
    this.passwords = passwords;
    this.jwt = jwt;
    this.audit = audit;
    this.props = props;
    this.tx = tx;
    this.mail = mail;
  }

  // ---------- sign-in ----------

  public LoginResult login(String rawEmail, String password, ClientMeta meta) {
    String email = Validation.normalizeEmail(rawEmail);
    UserRow user = repo.findUserByEmail(email).orElse(null);

    // While locked, the password is never evaluated (dummy hash keeps timing comparable).
    boolean locked = user != null && user.isLocked(Db.now());
    String hash = locked || user == null ? null : user.passwordHash();
    boolean passwordOk = hash != null
        ? passwords.verify(hash, password)
        : dummyVerify(password);

    if (user == null || locked || !passwordOk) {
      if (user != null && !locked) registerFailedLogin(user, meta);
      audit.record(new AuditService.Event("LOGIN_FAILURE", locked ? "DENIED" : "FAILURE", null,
          user == null ? null : user.id(), meta.correlationId(),
          Map.of("reason", user == null ? "UNKNOWN_ACCOUNT" : locked ? "LOCKED" : "BAD_PASSWORD")));
      throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", Messages.get("auth.invalid_credentials"));
    }

    if (!user.emailVerified() || "PENDING_VERIFICATION".equals(user.status())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "EMAIL_NOT_VERIFIED", Messages.get("auth.email_not_verified"));
    }
    if ("SUSPENDED".equals(user.status())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_SUSPENDED", Messages.get("auth.account_suspended"));
    }
    if ("DEACTIVATED".equals(user.status()) || "PENDING_DELETION".equals(user.status()) || user.deletedAt() != null) {
      throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_UNAVAILABLE", Messages.get("auth.account_unavailable"));
    }

    if (user.mfaEnabled()) {
      Instant now = Db.now();
      String raw = issueSingleUseToken(user.id(), "MFA_LOGIN_CHALLENGE",
          now.plus(Duration.ofMinutes(props.mfaChallengeExpiresMinutes())), now);
      audit.record(new AuditService.Event("LOGIN_MFA_CHALLENGE", "SUCCESS", null, user.id(), meta.correlationId(), null));
      return new MfaChallenge(raw);
    }

    IssuedSession session = createSessionWithRefresh(user, meta);
    audit.record(new AuditService.Event("LOGIN_SUCCESS", "SUCCESS", null, user.id(), meta.correlationId(),
        Map.of("sessionId", session.sessionId().toString())));
    return new SignedIn(session);
  }

  private boolean dummyVerify(String password) {
    passwords.verify(PasswordHasher.DUMMY_HASH, password);
    return false;
  }

  /**
   * Atomic failure counting; only the request that crosses the threshold applies the lock.
   * A lock pauses new sign-ins and never revokes existing sessions.
   */
  void registerFailedLogin(UserRow user, ClientMeta meta) {
    Instant now = Db.now();
    int failed = repo.incrementFailedLogin(user.id(), now);
    if (failed < props.loginMaxFailures()) return;
    int lockMinutes = props.loginLockoutMinutes();
    int applied = repo.applyLock(user.id(), now.plus(Duration.ofMinutes(lockMinutes)), props.loginMaxFailures(), now);
    if (applied != 1) return;
    audit.record(new AuditService.Event("ACCOUNT_LOCKED", "DENIED", null, user.id(), meta.correlationId(),
        Map.of("lockMinutes", lockMinutes)));
    mail.sendAccountLocked(user.email(), user.firstName(), lockMinutes);
  }

  public IssuedSession verifyMfaLogin(String challengeToken, String totpCode, String recoveryCode, ClientMeta meta) {
    if (isEmpty(totpCode) && isEmpty(recoveryCode)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", Messages.get("auth.mfa_code_required"));
    }
    Instant now = Db.now();
    UUID userId = repo.consumeToken(TokenCrypto.hashOpaqueToken(challengeToken, props.tokenPepper()),
            "MFA_LOGIN_CHALLENGE", now)
        .orElseThrow(AuthService::invalidTokenError);
    UserRow user = repo.findUserById(userId).orElseThrow();

    ApiException mfaInvalid = new ApiException(HttpStatus.UNAUTHORIZED, "MFA_INVALID", Messages.get("auth.mfa_invalid"));
    if (!"ACTIVE".equals(user.status()) || !user.emailVerified() || user.deletedAt() != null || user.isLocked(now)) {
      throw mfaInvalid;
    }
    if (!user.mfaEnabled()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "MFA_NOT_ENABLED", Messages.get("auth.mfa_not_enabled"));
    }

    boolean ok = false;
    if (!isEmpty(totpCode) && user.mfaSecretEncrypted() != null) {
      String secret = MfaCrypto.decrypt(user.mfaSecretEncrypted(), props.mfaEncryptionKey());
      ok = consumeTotp(user.id(), secret, totpCode);
    }
    if (!ok && !isEmpty(recoveryCode)) {
      ok = consumeRecoveryCode(user.id(), recoveryCode);
    }
    if (!ok) {
      registerFailedLogin(user, meta);
      audit.record(new AuditService.Event("MFA_LOGIN_FAILURE", "FAILURE", null, user.id(), meta.correlationId(), null));
      throw mfaInvalid;
    }

    IssuedSession session = createSessionWithRefresh(user, meta);
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("mfa", true);
    context.put("sessionId", session.sessionId().toString());
    audit.record(new AuditService.Event("LOGIN_SUCCESS", "SUCCESS", null, user.id(), meta.correlationId(), context));
    return session;
  }

  /** Replay protection: a TOTP step is accepted at most once per account. */
  boolean consumeTotp(UUID userId, String secret, String code) {
    long nowMs = System.currentTimeMillis();
    Integer delta = Totp.checkDelta(code, secret, nowMs);
    if (delta == null) return false;
    long step = Totp.currentStep(nowMs) + delta;
    return repo.claimTotpStep(userId, step, Db.now());
  }

  boolean consumeRecoveryCode(UUID userId, String code) {
    String normalized = code.replaceAll("\\s+", "").toUpperCase();
    for (AuthRepository.RecoveryCodeRow row : repo.unusedRecoveryCodes(userId)) {
      if (passwords.verify(row.codeHash(), normalized)) {
        return repo.markRecoveryCodeUsed(row.id(), Db.now());
      }
    }
    return false;
  }

  // ---------- sessions ----------

  IssuedSession createSessionWithRefresh(UserRow user, ClientMeta meta) {
    Instant now = Db.now();
    Instant refreshExpires = now.plus(props.refreshExpiresIn());
    String rawRefresh = TokenCrypto.generateOpaqueToken();
    String tokenHash = TokenCrypto.hashOpaqueToken(rawRefresh, props.tokenPepper());
    int maxSessions = props.maxSessions();
    UUID sessionId = Db.newId();

    List<UUID> evicted = tx.execute(status -> {
      List<UUID> active = repo.activeSessionIdsOldestFirst(user.id(), now);
      List<UUID> evictedIds = List.of();
      if (active.size() >= maxSessions) {
        evictedIds = List.copyOf(active.subList(0, active.size() - maxSessions + 1));
        repo.revokeSessionsForLimit(evictedIds, now);
      }
      String deviceLabel = meta.userAgent() == null ? null
          : meta.userAgent().substring(0, Math.min(80, meta.userAgent().length()));
      repo.insertSession(sessionId, user.id(), now, refreshExpires, meta.userAgent(), meta.ipDigest(), deviceLabel);
      repo.insertToken(Db.newId(), user.id(), sessionId, "REFRESH_TOKEN", tokenHash, refreshExpires, now);
      repo.markLoginSuccess(user.id(), now);
      return evictedIds;
    });

    if (evicted != null && !evicted.isEmpty()) {
      Map<String, Object> context = new LinkedHashMap<>();
      context.put("revokedSessionIds", evicted.stream().map(UUID::toString).toList());
      context.put("maxSessions", maxSessions);
      audit.record(new AuditService.Event("SESSION_LIMIT_REVOKED", "SUCCESS", null, user.id(), meta.correlationId(),
          context));
    }
    String accessToken = jwt.sign(user.id().toString(), sessionId.toString(), user.securityVersion(), Db.now());
    return new IssuedSession(accessToken, rawRefresh, refreshExpires, me(user.id()), sessionId);
  }

  private String issueSingleUseToken(UUID userId, String type, Instant expiresAt, Instant now) {
    return issueSingleUseToken(userId, type, expiresAt, null, now);
  }

  /** Replaces any outstanding token of the same type; only the raw value leaves this method. */
  String issueSingleUseToken(UUID userId, String type, Instant expiresAt, String pendingEmail, Instant now) {
    String raw = TokenCrypto.generateOpaqueToken();
    String hash = TokenCrypto.hashOpaqueToken(raw, props.tokenPepper());
    tx.executeWithoutResult(status -> {
      repo.revokeOutstandingTokens(userId, type, now);
      repo.insertToken(Db.newId(), userId, type, hash, expiresAt, pendingEmail, now);
    });
    return raw;
  }

  String hashToken(String raw) {
    return TokenCrypto.hashOpaqueToken(raw, props.tokenPepper());
  }

  // ---------- step-up reauthentication ----------

  /**
   * Password plus, when MFA is enabled, a fresh (non-replayed) TOTP code, or, only where the caller allows it, an
   * unused recovery code. Wrong passwords count toward the sign-in lockout. Failures are 403, not 401: the access
   * token is valid, only the reauthentication failed, and a 401 would make clients refresh and retry.
   */
  public void assertStepUp(UserRow user, String password, String totpCode, String recoveryCode, String passwordMessage,
      ClientMeta meta) {
    if (!passwords.verify(user.passwordHash(), password)) {
      registerFailedLogin(user, meta);
      throw stepUpFailed(passwordMessage != null ? passwordMessage : Messages.get("auth.reauthentication_failed"),
          "INVALID_CREDENTIALS");
    }
    if (!user.mfaEnabled()) return;
    if (!isEmpty(totpCode) && user.mfaSecretEncrypted() != null) {
      String secret = MfaCrypto.decrypt(user.mfaSecretEncrypted(), props.mfaEncryptionKey());
      if (consumeTotp(user.id(), secret, totpCode)) return;
      throw stepUpFailed(Messages.get("auth.invalid_authenticator_code"), "MFA_INVALID");
    }
    if (!isEmpty(recoveryCode)) {
      if (consumeRecoveryCode(user.id(), recoveryCode)) return;
      throw stepUpFailed(Messages.get("auth.invalid_recovery_code"), "MFA_INVALID");
    }
    throw stepUpFailed(Messages.get("auth.authenticator_required"), "MFA_REQUIRED");
  }

  private static ApiException stepUpFailed(String message, String errorCode) {
    return new ApiException(HttpStatus.FORBIDDEN, errorCode, message);
  }

  public IssuedSession refresh(String rawRefresh, ClientMeta meta) {
    if (isEmpty(rawRefresh)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_MISSING", Messages.get("auth.refresh_missing"));
    }
    TokenRow existing = repo.findTokenByHash(TokenCrypto.hashOpaqueToken(rawRefresh, props.tokenPepper())).orElse(null);
    if (existing == null || !"REFRESH_TOKEN".equals(existing.type())) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_INVALID", Messages.get("auth.refresh_invalid"));
    }
    // Revoked by logout or a password reset, never rotated: not a theft signal.
    if (existing.replacedById() == null && existing.revokedAt() != null) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_INVALID", Messages.get("auth.refresh_invalid"));
    }
    AuthRepository.SessionRow session = existing.sessionId() == null ? null
        : repo.findSession(existing.sessionId()).orElse(null);

    // Benign concurrent-tab race: rotated moments ago, session active, replacement still live.
    if (existing.replacedById() != null && existing.usedAt() != null) {
      Duration rotatedAgo = Duration.between(existing.usedAt(), Instant.now());
      if (rotatedAgo.compareTo(REFRESH_REUSE_GRACE) <= 0 && session != null && session.revokedAt() == null) {
        TokenRow replacement = repo.findTokenById(existing.replacedById()).orElse(null);
        if (replacement != null && replacement.usedAt() == null && replacement.revokedAt() == null) {
          throw superseded();
        }
      }
    }

    if (existing.usedAt() != null || existing.revokedAt() != null || existing.replacedById() != null) {
      if (existing.sessionId() != null) {
        UUID sessionId = existing.sessionId();
        Instant now = Db.now();
        tx.executeWithoutResult(status -> repo.revokeSessionForReuse(sessionId, now));
      }
      Map<String, Object> context = new LinkedHashMap<>();
      context.put("sessionId", existing.sessionId() == null ? null : existing.sessionId().toString());
      audit.record(new AuditService.Event("REFRESH_REUSE_DETECTED", "DENIED", null, existing.userId(),
          meta.correlationId(), context));
      throw new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_REUSE_DETECTED", Messages.get("auth.refresh_reuse"));
    }

    Instant nowCheck = Instant.now();
    if (!existing.expiresAt().isAfter(nowCheck)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_EXPIRED", Messages.get("auth.refresh_expired"));
    }
    if (session == null || session.revokedAt() != null || !session.expiresAt().isAfter(nowCheck)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_REVOKED", Messages.get("auth.session_revoked"));
    }
    UserRow user = repo.findUserById(existing.userId()).orElseThrow();
    if (!"ACTIVE".equals(user.status()) || !user.emailVerified() || user.deletedAt() != null) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "ACCOUNT_NOT_ELIGIBLE", Messages.get("auth.account_not_eligible"));
    }

    String newRaw = TokenCrypto.generateOpaqueToken();
    String newHash = TokenCrypto.hashOpaqueToken(newRaw, props.tokenPepper());
    Instant now = Db.now();
    Instant refreshExpires = now.plus(props.refreshExpiresIn());
    Boolean rotated = tx.execute(status -> {
      if (!repo.claimRefreshToken(existing.id(), now)) {
        status.setRollbackOnly();
        return false;
      }
      UUID newId = Db.newId();
      repo.insertToken(newId, user.id(), existing.sessionId(), "REFRESH_TOKEN", newHash, refreshExpires, now);
      repo.setReplacedBy(existing.id(), newId);
      repo.extendSession(existing.sessionId(), now, refreshExpires);
      return true;
    });
    // Another tab won the race; the loser gets no token.
    if (!Boolean.TRUE.equals(rotated)) throw superseded();

    String accessToken = jwt.sign(user.id().toString(), existing.sessionId().toString(), user.securityVersion(),
        Db.now());
    return new IssuedSession(accessToken, newRaw, refreshExpires, me(user.id()), existing.sessionId());
  }

  /** Idempotent: revokes the session named by the refresh cookie and/or a valid bearer token. */
  public Map<String, Object> logout(String rawRefresh, String bearer, ClientMeta meta) {
    Map<UUID, UUID> revoked = new LinkedHashMap<>();
    if (!isEmpty(rawRefresh)) {
      repo.findTokenByHash(TokenCrypto.hashOpaqueToken(rawRefresh, props.tokenPepper()))
          .filter(t -> t.sessionId() != null && "REFRESH_TOKEN".equals(t.type()))
          .ifPresent(t -> revoked.put(t.sessionId(), t.userId()));
    }
    if (!isEmpty(bearer)) {
      JwtService.AccessClaims claims = jwt.verify(bearer, Instant.now());
      if (claims != null && !isEmpty(claims.sid()) && !isEmpty(claims.sub())) {
        UUID sid = parseUuid(claims.sid());
        UUID sub = parseUuid(claims.sub());
        if (sid != null && sub != null) revoked.put(sid, sub);
      }
    }
    for (Map.Entry<UUID, UUID> entry : revoked.entrySet()) {
      Instant now = Db.now();
      tx.executeWithoutResult(status -> repo.revokeSession(entry.getKey(), "LOGOUT", entry.getValue(), now));
      audit.record(new AuditService.Event("LOGOUT", "SUCCESS", entry.getValue(), entry.getValue(),
          meta.correlationId(), Map.of("sessionId", entry.getKey().toString())));
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("message", Messages.get("auth.signed_out"));
    body.put("errorCode", null);
    return body;
  }

  // ---------- profile ----------

  public Map<String, Object> me(UUID userId) {
    UserRow user = repo.findUserById(userId).orElseThrow();
    PreferencesRow prefs = repo.findPreferences(userId).orElse(null);
    return UserJson.serialize(user, prefs);
  }

  public Map<String, Object> updateProfile(AuthUser principal, String firstName, String lastName,
      String experienceLevel) {
    repo.updateProfile(principal.id(), Validation.jsTrim(firstName), Validation.jsTrim(lastName), experienceLevel,
        Db.now());
    return me(principal.id());
  }

  public PreferencesRow getPreferences(AuthUser principal) {
    return repo.upsertPreferences(principal.id(), new PreferencesPatch(), Db.now());
  }

  public PreferencesRow updatePreferences(AuthUser principal, PreferencesPatch patch) {
    return repo.upsertPreferences(principal.id(), patch, Db.now());
  }

  // ---------- helpers ----------

  static ApiException invalidTokenError() {
    return new ApiException(HttpStatus.BAD_REQUEST, "TOKEN_INVALID", Messages.get("auth.token_invalid"));
  }

  private static ApiException superseded() {
    return new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_SUPERSEDED", Messages.get("auth.refresh_superseded"));
  }

  static boolean isEmpty(String value) {
    return value == null || value.isEmpty();
  }

  private static UUID parseUuid(String value) {
    try {
      return UUID.fromString(value);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }
}
