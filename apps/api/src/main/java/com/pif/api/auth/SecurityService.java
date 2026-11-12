package com.pif.api.auth;

import com.pif.api.audit.AuditService;
import com.pif.api.auth.AuthService.ClientMeta;
import com.pif.api.config.PifProperties;
import com.pif.api.crypto.MfaCrypto;
import com.pif.api.crypto.PasswordHasher;
import com.pif.api.crypto.TokenCrypto;
import com.pif.api.crypto.Totp;
import com.pif.api.data.AuthRepository;
import com.pif.api.data.AuthRepository.PendingMfa;
import com.pif.api.data.Db;
import com.pif.api.data.UserRow;
import com.pif.api.mail.MailService;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Sessions, two-step verification and the dashboard context, ported from apps/api/src/auth/auth.service.ts. MFA
 * secrets use the shared AES-GCM envelope and are only ever decrypted in memory; recovery codes are stored as
 * Argon2id hashes and returned exactly once.
 */
@Service
public class SecurityService {

  /** An unconfirmed authenticator enrollment is discarded after 10 minutes. */
  static final int MFA_PENDING_SETUP_TTL_MINUTES = 10;
  private static final int RECOVERY_CODE_COUNT = 10;
  private static final SecureRandom RANDOM = new SecureRandom();

  private final AuthService auth;
  private final AuthRepository repo;
  private final PasswordHasher passwords;
  private final AuditService audit;
  private final MailService mail;
  private final PifProperties props;
  private final TransactionTemplate tx;

  public SecurityService(AuthService auth, AuthRepository repo, PasswordHasher passwords, AuditService audit,
      MailService mail, PifProperties props, TransactionTemplate tx) {
    this.auth = auth;
    this.repo = repo;
    this.passwords = passwords;
    this.audit = audit;
    this.mail = mail;
    this.props = props;
    this.tx = tx;
  }

  // ---------- sessions ----------

  public List<Map<String, Object>> listSessions(AuthUser principal) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (AuthRepository.SessionView s : repo.activeSessions(principal.id(), Db.now())) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", s.id().toString());
      m.put("createdAt", Db.iso(s.createdAt()));
      m.put("lastSeenAt", Db.iso(s.lastSeenAt()));
      m.put("expiresAt", Db.iso(s.expiresAt()));
      m.put("deviceLabel", s.deviceLabel());
      m.put("userAgent", s.userAgent());
      m.put("current", s.id().equals(principal.sessionId()));
      out.add(m);
    }
    return out;
  }

  public Map<String, Object> revokeSessionOwned(AuthUser principal, UUID sessionId, ClientMeta meta) {
    if (!repo.sessionOwnedBy(sessionId, principal.id())) {
      throw new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", com.pif.api.web.Messages.get("auth.resource_not_found"));
    }
    Instant now = Db.now();
    tx.executeWithoutResult(status -> repo.revokeSession(sessionId, "USER_REVOKE", principal.id(), now));
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("sessionId", sessionId.toString());
    context.put("current", sessionId.equals(principal.sessionId()));
    audit.record(new AuditService.Event("SESSION_REVOKED", "SUCCESS", principal.id(), principal.id(),
        meta.correlationId(), context));
    return AccountService.generic("Session revoquee");
  }

  /** Signs out every device, including the caller's. */
  public Map<String, Object> logoutAll(AuthUser principal, ClientMeta meta) {
    UserRow user = principal.user();
    Instant now = Db.now();
    tx.executeWithoutResult(status -> {
      repo.revokeUserSessions(user.id(), "LOGOUT_ALL", null, now);
      repo.revokeOutstandingTokens(user.id(), List.of("REFRESH_TOKEN", "MFA_LOGIN_CHALLENGE"), now);
    });
    mail.sendSessionsRevoked(user.email(), user.firstName(), "all");
    audit.record(new AuditService.Event("SESSIONS_REVOKE_ALL", "SUCCESS", user.id(), user.id(), meta.correlationId(),
        null));
    return AccountService.generic("Deconnecte sur tous les appareils");
  }

  public Map<String, Object> revokeOtherSessions(AuthUser principal, AuthDtos.StepUp dto, ClientMeta meta) {
    UserRow user = principal.user();
    auth.assertStepUp(user, dto.password(), dto.totpCode(), null, null, meta);
    Instant now = Db.now();
    tx.executeWithoutResult(status -> {
      repo.revokeUserSessions(user.id(), "REVOKE_OTHERS", principal.sessionId(), now);
      repo.revokeRefreshTokensOutsideSession(user.id(), principal.sessionId(), now);
    });
    mail.sendSessionsRevoked(user.email(), user.firstName(), "others");
    audit.record(new AuditService.Event("SESSIONS_REVOKE_OTHERS", "SUCCESS", user.id(), null, meta.correlationId(),
        null));
    return AccountService.generic("Les autres sessions ont ete deconnectees");
  }

  // ---------- two-step verification ----------

  public Map<String, Object> mfaSetup(AuthUser principal, AuthDtos.StepUp dto, ClientMeta meta) {
    UserRow user = principal.user();
    auth.assertStepUp(user, dto.password(), dto.totpCode(), null, null, meta);
    byte[] random = new byte[10];
    RANDOM.nextBytes(random);
    String secret = Totp.Base32.encode(random);
    repo.setPendingMfa(user.id(), MfaCrypto.encrypt(secret, props.mfaEncryptionKey()), MfaCrypto.keyVersion(),
        Db.now());
    String issuer = props.appName();
    String otpauth = "otpauth://totp/" + encode(issuer) + ":" + encode(user.email()) + "?secret=" + secret
        + "&period=30&digits=6&algorithm=SHA1&issuer=" + encode(issuer);
    audit.record(new AuditService.Event("MFA_SETUP_STARTED", "SUCCESS", user.id(), user.id(), meta.correlationId(),
        null));
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("secret", secret);
    body.put("otpauth", otpauth);
    body.put("expiresInMinutes", MFA_PENDING_SETUP_TTL_MINUTES);
    return body;
  }

  public Map<String, Object> mfaEnable(AuthUser principal, String totpCode, ClientMeta meta) {
    UUID userId = principal.id();
    UserRow fresh = repo.findUserById(userId).orElseThrow();
    PendingMfa pending = repo.pendingMfa(userId).orElseThrow();
    if (pending.secretEncrypted() == null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "MFA_SETUP_REQUIRED", com.pif.api.web.Messages.get("auth.mfa_setup_required"));
    }
    long startedAt = pending.createdAt() == null ? 0 : pending.createdAt().toEpochMilli();
    if (System.currentTimeMillis() - startedAt > MFA_PENDING_SETUP_TTL_MINUTES * 60_000L) {
      repo.clearPendingMfa(userId, Db.now());
      throw new ApiException(HttpStatus.BAD_REQUEST, "MFA_SETUP_EXPIRED",
          com.pif.api.web.Messages.get("auth.mfa_setup_expired"));
    }
    String secret = MfaCrypto.decrypt(pending.secretEncrypted(), props.mfaEncryptionKey());
    if (!auth.consumeTotp(userId, secret, totpCode)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "MFA_INVALID", com.pif.api.web.Messages.get("auth.invalid_authenticator_code"));
    }
    List<String> codes = newRecoveryCodes();
    List<String> hashes = codes.stream().map(passwords::hash).toList();
    Instant now = Db.now();
    tx.executeWithoutResult(status -> {
      repo.enableMfa(userId, pending.secretEncrypted(), now);
      repo.deleteRecoveryCodes(userId);
      repo.insertRecoveryCodes(userId, hashes, now);
    });
    mail.sendMfaEnabled(fresh.email(), fresh.firstName());
    audit.record(new AuditService.Event("MFA_ENABLED", "SUCCESS", userId, null, meta.correlationId(), null));
    return Map.of("recoveryCodes", codes);
  }

  public Map<String, Object> mfaDisable(AuthUser principal, AuthDtos.StepUp dto, ClientMeta meta) {
    UserRow user = principal.user();
    if (!user.mfaEnabled()) throw mfaNotEnabled();
    auth.assertStepUp(user, dto.password(), dto.totpCode(), dto.recoveryCode(), null, meta);
    Instant now = Db.now();
    tx.executeWithoutResult(status -> {
      repo.disableMfa(user.id(), now);
      repo.deleteRecoveryCodes(user.id());
      // The caller's session survives (it refreshes onto the new security version); other devices sign in again.
      repo.revokeUserSessions(user.id(), "MFA_DISABLED", principal.sessionId(), now);
      repo.revokeOutstandingTokens(user.id(), List.of("MFA_LOGIN_CHALLENGE"), now);
    });
    mail.sendMfaDisabled(user.email(), user.firstName());
    audit.record(new AuditService.Event("MFA_DISABLED", "SUCCESS", user.id(), user.id(), meta.correlationId(),
        Map.of("via", AuthService.isEmpty(dto.totpCode()) ? "RECOVERY_CODE" : "TOTP")));
    return AccountService.generic(com.pif.api.web.Messages.get("auth.mfa_disabled_ok"));
  }

  public Map<String, Object> mfaRegenerateRecovery(AuthUser principal, AuthDtos.StepUp dto, ClientMeta meta) {
    UserRow user = principal.user();
    if (!user.mfaEnabled()) throw mfaNotEnabled();
    auth.assertStepUp(user, dto.password(), dto.totpCode(), null, null, meta);
    List<String> codes = newRecoveryCodes();
    List<String> hashes = codes.stream().map(passwords::hash).toList();
    Instant now = Db.now();
    tx.executeWithoutResult(status -> {
      repo.deleteRecoveryCodes(user.id());
      repo.insertRecoveryCodes(user.id(), hashes, now);
    });
    mail.sendMfaRecoveryCodesRegenerated(user.email(), user.firstName());
    audit.record(new AuditService.Event("MFA_RECOVERY_REGENERATED", "SUCCESS", user.id(), null, meta.correlationId(),
        null));
    return Map.of("recoveryCodes", codes);
  }

  public Map<String, Object> mfaStatus(AuthUser principal) {
    UserRow user = principal.user();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("mfaEnabled", user.mfaEnabled());
    body.put("mfaVerifiedAt", Db.iso(user.mfaVerifiedAt()));
    body.put("remainingRecoveryCodes", repo.countUnusedRecoveryCodes(user.id()));
    return body;
  }

  private static ApiException mfaNotEnabled() {
    return new ApiException(HttpStatus.BAD_REQUEST, "MFA_NOT_ENABLED", com.pif.api.web.Messages.get("auth.mfa_not_enabled_security"));
  }

  /** generateOpaqueToken().slice(0, 10).toUpperCase(): 10 upper-case hex characters each. */
  private static List<String> newRecoveryCodes() {
    List<String> codes = new ArrayList<>();
    for (int i = 0; i < RECOVERY_CODE_COUNT; i++) {
      codes.add(TokenCrypto.generateOpaqueToken().substring(0, 10).toUpperCase(Locale.ROOT));
    }
    return codes;
  }

  /** encodeURIComponent, as used by otplib's keyuri. */
  private static String encode(String value) {
    StringBuilder out = new StringBuilder();
    for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
      int c = b & 0xff;
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || "-_.!~*'()".indexOf(c) >= 0) {
        out.append((char) c);
      } else {
        out.append('%').append(String.format("%02X", c));
      }
    }
    return out.toString();
  }

  // ---------- dashboard ----------

  /**
   * Identity context only, with no invented portfolio or performance figures. {@code permitted}: the role may use the
   * module; {@code available}: the module exists in this deployment. A capability is true only when both hold.
   */
  public Map<String, Object> dashboardContext(AuthUser principal) {
    UserRow user = principal.user();
    boolean isAdmin = "ADMIN".equals(user.role());
    boolean adminMfaEnrollmentRequired = isAdmin && !user.mfaEnabled() && props.adminMfaRequired();
    List<Map<String, Object>> modules = List.of(
        module("portfolio", "Portefeuille virtuel", true, true),
        module("orders", "Salle des ordres", true, true),
        module("learning", "Parcours pédagogique", true, true),
        module("ai", "Analyse IA", true, false),
        module("stress", "Tests de résistance bancaire", true, false),
        module("actuarial", "Outils actuariels", true, true),
        module("admin", "Administration des comptes", isAdmin && !adminMfaEnrollmentRequired, true));
    Map<String, Object> capabilities = new LinkedHashMap<>();
    capabilities.put("trading", usable(modules, "orders"));
    capabilities.put("portfolio", usable(modules, "portfolio"));
    capabilities.put("learning", usable(modules, "learning"));
    capabilities.put("aiAnalysis", usable(modules, "ai"));
    capabilities.put("stressTesting", usable(modules, "stress"));
    capabilities.put("actuarial", usable(modules, "actuarial"));
    capabilities.put("admin", usable(modules, "admin"));

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("user", UserJson.serializeWithoutPreferences(user));
    body.put("role", user.role());
    body.put("experienceLevel", user.experienceLevel());
    body.put("experienceLevelNotice", "Le niveau d'expérience sert uniquement à adapter le contenu pédagogique. "
        + "Ce n'est ni une évaluation d'adéquation à l'investissement ni une certification de trading.");
    body.put("capabilities", capabilities);
    body.put("requiredActions", adminMfaEnrollmentRequired ? List.of("ENROLL_MFA_FOR_ADMIN") : List.of());
    body.put("modules", modules);
    return body;
  }

  private static Map<String, Object> module(String id, String label, boolean permitted, boolean available) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", id);
    m.put("label", label);
    m.put("permitted", permitted);
    m.put("available", available);
    return m;
  }

  private static boolean usable(List<Map<String, Object>> modules, String id) {
    return modules.stream().anyMatch(m -> id.equals(m.get("id")) && Boolean.TRUE.equals(m.get("permitted"))
        && Boolean.TRUE.equals(m.get("available")));
  }
}
