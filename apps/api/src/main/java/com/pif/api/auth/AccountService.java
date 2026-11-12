package com.pif.api.auth;

import com.pif.api.audit.AuditService;
import com.pif.api.auth.AuthService.ClientMeta;
import com.pif.api.auth.AuthService.IssuedSession;
import com.pif.api.config.PifProperties;
import com.pif.api.crypto.PasswordHasher;
import com.pif.api.crypto.PasswordPolicy;
import com.pif.api.data.AuthRepository;
import com.pif.api.data.AuthRepository.ConsumedToken;
import com.pif.api.data.Db;
import com.pif.api.data.UserRow;
import com.pif.api.mail.EmailTemplates;
import com.pif.api.mail.MailService;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import com.pif.api.web.Validation;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Registration, email verification, password recovery and change, email change, deactivation and deletion, ported
 * from apps/api/src/auth/auth.service.ts with the same token rules, audit events, emails and messages. Responses
 * never depend on whether an email could be delivered or whether an address is registered.
 */
@Service
public class AccountService {

  /** At most one "account already exists" notice per address per 15 minutes. */
  private static final Duration ACCOUNT_EXISTS_NOTICE_COOLDOWN = Duration.ofMinutes(15);

  private final AuthService auth;
  private final AuthRepository repo;
  private final PasswordHasher passwords;
  private final AuditService audit;
  private final MailService mail;
  private final PifProperties props;
  private final TransactionTemplate tx;

  public AccountService(AuthService auth, AuthRepository repo, PasswordHasher passwords, AuditService audit,
      MailService mail, PifProperties props, TransactionTemplate tx) {
    this.auth = auth;
    this.repo = repo;
    this.passwords = passwords;
    this.audit = audit;
    this.mail = mail;
    this.props = props;
    this.tx = tx;
  }

  static Map<String, Object> generic(String message) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("message", message);
    body.put("errorCode", null);
    return body;
  }

  private static ApiException validationError(String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message);
  }

  private static void assertPolicy(String password) {
    List<String> errors = PasswordPolicy.errors(password);
    if (!errors.isEmpty()) throw validationError(String.join("; ", errors));
  }

  // ---------- registration and verification ----------

  public Map<String, Object> register(AuthDtos.Register dto, ClientMeta meta) {
    if (dto.passwordConfirmation() != null && !dto.passwordConfirmation().equals(dto.password())) {
      throw validationError(com.pif.api.web.Messages.get("auth.password_mismatch"));
    }
    String email = Validation.normalizeEmail(dto.email());
    assertPolicy(dto.password());

    // Hash before the lookup so new and already-registered addresses cost the same Argon2 work.
    String passwordHash = passwords.hash(dto.password());
    UserRow existing = repo.findUserByEmail(email).orElse(null);
    Map<String, Object> generic =
        generic(com.pif.api.web.Messages.get("auth.register_generic"));

    if (existing != null) {
      if (existing.emailVerified() && "ACTIVE".equals(existing.status()) && existing.deletedAt() == null) {
        maybeSendAccountExistsNotice(existing, meta);
      } else if ("PENDING_VERIFICATION".equals(existing.status())) {
        maybeSendVerification(existing);
      }
      audit.record(new AuditService.Event("REGISTER_DUPLICATE", "SUCCESS", null, existing.id(), meta.correlationId(),
          null));
      return generic;
    }

    int expiresMinutes = props.emailVerificationExpiresMinutes();
    UUID userId = Db.newId();
    try {
      Instant now = Db.now();
      tx.executeWithoutResult(status -> {
        repo.insertPendingUser(userId, email, Validation.jsTrim(dto.firstName()), Validation.jsTrim(dto.lastName()),
            passwordHash, now);
        repo.upsertPreferences(userId, new AuthRepository.PreferencesPatch(), now);
      });
    } catch (DuplicateKeyException e) {
      // A concurrent registration claimed the address first.
      return generic;
    }
    UserRow user = repo.findUserById(userId).orElseThrow();
    Instant now = Db.now();
    String raw = auth.issueSingleUseToken(user.id(), "EMAIL_VERIFICATION",
        now.plus(Duration.ofMinutes(expiresMinutes)), null, now);
    mail.sendVerification(user.email(), user.firstName(), raw, expiresMinutes);
    audit.record(new AuditService.Event("REGISTER", "SUCCESS", null, user.id(), meta.correlationId(), null));
    return generic;
  }

  private void maybeSendAccountExistsNotice(UserRow user, ClientMeta meta) {
    Instant since = Instant.now().minus(ACCOUNT_EXISTS_NOTICE_COOLDOWN);
    if (repo.auditEventSince("ACCOUNT_EXISTS_NOTICE", "subject_user_id", user.id(), since)) return;
    audit.record(new AuditService.Event("ACCOUNT_EXISTS_NOTICE", "SUCCESS", null, user.id(), meta.correlationId(),
        null));
    mail.sendAccountExists(user.email(), user.firstName());
  }

  /** Verification links are only ever issued to accounts still awaiting verification. */
  private void maybeSendVerification(UserRow user) {
    if (!"PENDING_VERIFICATION".equals(user.status()) || user.emailVerified() || user.deletedAt() != null) return;
    Instant since = Instant.now().minus(Duration.ofSeconds(props.emailCooldownSeconds()));
    if (repo.tokenCreatedSince(user.id(), "EMAIL_VERIFICATION", since)) return;
    int expiresMinutes = props.emailVerificationExpiresMinutes();
    Instant now = Db.now();
    String raw = auth.issueSingleUseToken(user.id(), "EMAIL_VERIFICATION",
        now.plus(Duration.ofMinutes(expiresMinutes)), null, now);
    mail.sendVerification(user.email(), user.firstName(), raw, expiresMinutes);
  }

  private record Verified(UUID userId, String email, String firstName, boolean activated) {}

  public Map<String, Object> verifyEmail(String token, ClientMeta meta) {
    Instant now = Db.now();
    Verified verified = tx.execute(status -> {
      ConsumedToken consumed = repo.claimToken(auth.hashToken(token), "EMAIL_VERIFICATION", now)
          .orElseThrow(AuthService::invalidTokenError);
      UserRow user = repo.findUserById(consumed.userId()).orElseThrow();
      // Thrown inside the transaction, so the token claim rolls back too.
      if (user.deletedAt() != null || "PENDING_DELETION".equals(user.status())) throw AuthService.invalidTokenError();
      repo.markEmailVerified(user.id(), now);
      repo.revokeOutstandingTokens(user.id(), List.of("EMAIL_VERIFICATION"), now);
      return new Verified(user.id(), user.email(), user.firstName(), "PENDING_VERIFICATION".equals(user.status()));
    });
    if (verified.activated()) mail.sendWelcome(verified.email(), verified.firstName());
    audit.record(new AuditService.Event("EMAIL_VERIFIED", "SUCCESS", null, verified.userId(), meta.correlationId(),
        null));
    return generic("Adresse e-mail verifiee. Vous pouvez vous connecter.");
  }

  public Map<String, Object> resendVerification(String rawEmail, ClientMeta meta) {
    UserRow user = repo.findUserByEmail(Validation.normalizeEmail(rawEmail)).orElse(null);
    if (user != null && !user.emailVerified() && "PENDING_VERIFICATION".equals(user.status())) {
      maybeSendVerification(user);
    }
    audit.record(new AuditService.Event("RESEND_VERIFICATION", "SUCCESS", null, user == null ? null : user.id(),
        meta.correlationId(), null));
    return generic(
        "Si un compte non verifie existe pour cette adresse, un nouveau message de verification a ete envoye le cas echeant.");
  }

  // ---------- password recovery and change ----------

  public Map<String, Object> forgotPassword(String rawEmail, ClientMeta meta) {
    UserRow user = repo.findUserByEmail(Validation.normalizeEmail(rawEmail)).orElse(null);
    if (user != null && user.emailVerified() && "ACTIVE".equals(user.status()) && user.deletedAt() == null) {
      Instant since = Instant.now().minus(Duration.ofSeconds(props.emailCooldownSeconds()));
      if (!repo.tokenCreatedSince(user.id(), "PASSWORD_RESET", since)) {
        int minutes = props.passwordResetExpiresMinutes();
        Instant now = Db.now();
        String raw = auth.issueSingleUseToken(user.id(), "PASSWORD_RESET", now.plus(Duration.ofMinutes(minutes)),
            null, now);
        mail.sendPasswordReset(user.email(), user.firstName(), raw, minutes);
      }
    }
    audit.record(new AuditService.Event("FORGOT_PASSWORD", "SUCCESS", null, user == null ? null : user.id(),
        meta.correlationId(), null));
    return generic(
        "Si un compte existe pour cette adresse, les instructions de reinitialisation ont ete envoyees le cas echeant.");
  }

  public Map<String, Object> resetPassword(AuthDtos.ResetPassword dto, ClientMeta meta) {
    if (!dto.password().equals(dto.passwordConfirmation())) {
      throw validationError("La confirmation du mot de passe ne correspond pas");
    }
    String tokenHash = auth.hashToken(dto.token());
    // Cheap read-only check first so bogus tokens never trigger Argon2 work.
    repo.peekToken(tokenHash, "PASSWORD_RESET", Db.now()).orElseThrow(AuthService::invalidTokenError);
    assertPolicy(dto.password());
    String passwordHash = passwords.hash(dto.password());
    Instant now = Db.now();
    UUID userId = tx.execute(status -> {
      ConsumedToken consumed = repo.claimToken(tokenHash, "PASSWORD_RESET", now)
          .orElseThrow(AuthService::invalidTokenError);
      repo.setPassword(consumed.userId(), passwordHash, true, now);
      repo.revokeUserSessions(consumed.userId(), "PASSWORD_RESET", null, now);
      repo.revokeOutstandingTokens(consumed.userId(), AuthService.CREDENTIAL_SENSITIVE_TOKEN_TYPES, now);
      return consumed.userId();
    });
    repo.findUserById(userId).ifPresent(u -> mail.sendPasswordChanged(u.email(), u.firstName(), "reset"));
    audit.record(new AuditService.Event("PASSWORD_RESET", "SUCCESS", null, userId, meta.correlationId(), null));
    return generic("Mot de passe mis a jour. Connectez-vous avec votre nouveau mot de passe.");
  }

  /** Every existing session is revoked; the caller continues on a new session (new refresh cookie). */
  public IssuedSession changePassword(AuthUser principal, AuthDtos.ChangePassword dto, ClientMeta meta) {
    if (!dto.newPassword().equals(dto.newPasswordConfirmation())) {
      throw validationError("La confirmation du mot de passe ne correspond pas");
    }
    if (dto.newPassword().equals(dto.currentPassword())) {
      throw validationError("Le nouveau mot de passe doit etre different de l'actuel");
    }
    assertPolicy(dto.newPassword());
    auth.assertStepUp(principal.user(), dto.currentPassword(), dto.totpCode(), null, "Le mot de passe actuel est incorrect",
        meta);
    String passwordHash = passwords.hash(dto.newPassword());
    UUID userId = principal.id();
    Instant now = Db.now();
    tx.executeWithoutResult(status -> {
      repo.setPassword(userId, passwordHash, false, now);
      repo.revokeUserSessions(userId, "PASSWORD_CHANGE", null, now);
      repo.revokeOutstandingTokens(userId, AuthService.CREDENTIAL_SENSITIVE_TOKEN_TYPES, now);
    });
    UserRow fresh = repo.findUserById(userId).orElseThrow();
    IssuedSession session = auth.createSessionWithRefresh(fresh, meta);
    mail.sendPasswordChanged(fresh.email(), fresh.firstName(), "change");
    audit.record(new AuditService.Event("PASSWORD_CHANGE", "SUCCESS", userId, userId, meta.correlationId(), null));
    return session;
  }

  // ---------- email change ----------

  public Map<String, Object> requestEmailChange(AuthUser principal, AuthDtos.ChangeEmailRequest dto, ClientMeta meta) {
    UserRow user = principal.user();
    auth.assertStepUp(user, dto.password(), dto.totpCode(), null, null, meta);
    String newEmail = Validation.normalizeEmail(dto.newEmail());
    if (newEmail.equals(user.email())) throw validationError(com.pif.api.web.Messages.get("auth.email_change_same"));

    // Keyed on the request audit trail, not on issued tokens, so it behaves the same whether or not the
    // target address is registered (no enumeration oracle).
    int cooldownSeconds = props.emailCooldownSeconds();
    if (repo.auditEventSince("EMAIL_CHANGE_REQUESTED", "actor_user_id", user.id(),
        Instant.now().minus(Duration.ofSeconds(cooldownSeconds)))) {
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "EMAIL_CHANGE_COOLDOWN",
          com.pif.api.web.Messages.format("auth.email_change_cooldown", cooldownSeconds));
    }

    boolean targetInUse = repo.emailInUse(newEmail);
    int minutes = props.emailChangeExpiresMinutes();
    if (targetInUse) {
      // No link to an address owned by someone else; any earlier pending change is cancelled either way.
      repo.revokeOutstandingTokens(user.id(), "EMAIL_CHANGE", Db.now());
    } else {
      Instant now = Db.now();
      String raw = auth.issueSingleUseToken(user.id(), "EMAIL_CHANGE", now.plus(Duration.ofMinutes(minutes)),
          newEmail, now);
      mail.sendEmailChangeConfirm(newEmail, user.firstName(), raw, minutes);
    }
    mail.sendEmailChangeRequested(user.email(), user.firstName(), newEmail);
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("target", EmailTemplates.maskEmail(newEmail));
    context.put("targetInUse", targetInUse);
    audit.record(new AuditService.Event("EMAIL_CHANGE_REQUESTED", "SUCCESS", user.id(), user.id(),
        meta.correlationId(), context));
    return generic(com.pif.api.web.Messages.get("auth.email_change_generic"));
  }

  private record EmailChanged(UUID userId, String firstName, String oldEmail, String newEmail) {}

  public Map<String, Object> confirmEmailChange(String token, ClientMeta meta) {
    Instant now = Db.now();
    EmailChanged outcome;
    try {
      outcome = tx.execute(status -> {
        ConsumedToken consumed = repo.claimToken(auth.hashToken(token), "EMAIL_CHANGE", now)
            .orElseThrow(AuthService::invalidTokenError);
        if (consumed.pendingEmail() == null) throw AuthService.invalidTokenError();
        UserRow user = repo.findUserById(consumed.userId()).orElseThrow();
        if (user.deletedAt() != null || !"ACTIVE".equals(user.status())) throw AuthService.invalidTokenError();
        // Thrown inside the transaction: the claim rolls back and ownership never moves.
        if (repo.emailInUse(consumed.pendingEmail())) throw emailChangeFailed();
        repo.changeEmail(user.id(), consumed.pendingEmail(), now);
        repo.revokeUserSessions(user.id(), "EMAIL_CHANGE", null, now);
        List<String> types = new ArrayList<>(AuthService.CREDENTIAL_SENSITIVE_TOKEN_TYPES);
        types.add("EMAIL_VERIFICATION");
        repo.revokeOutstandingTokens(user.id(), types, now);
        return new EmailChanged(user.id(), user.firstName(), user.email(), consumed.pendingEmail());
      });
    } catch (DuplicateKeyException e) {
      // Unique-constraint race with a concurrent registration: the whole transaction rolled back.
      throw emailChangeFailed();
    }
    mail.sendEmailChangedToOld(outcome.oldEmail(), outcome.firstName(), outcome.newEmail());
    mail.sendEmailChangedToNew(outcome.newEmail(), outcome.firstName());
    Map<String, Object> context = new LinkedHashMap<>();
    context.put("previousAddress", EmailTemplates.maskEmail(outcome.oldEmail()));
    context.put("newAddress", EmailTemplates.maskEmail(outcome.newEmail()));
    audit.record(new AuditService.Event("EMAIL_CHANGED", "SUCCESS", null, outcome.userId(), meta.correlationId(),
        context));
    return generic(com.pif.api.web.Messages.get("auth.email_change_done"));
  }

  private static ApiException emailChangeFailed() {
    return new ApiException(HttpStatus.BAD_REQUEST, "EMAIL_CHANGE_FAILED",
        com.pif.api.web.Messages.get("auth.email_change_failed"));
  }

  // ---------- deactivation and deletion ----------

  public Map<String, Object> deactivate(AuthUser principal, AuthDtos.StepUp dto, ClientMeta meta) {
    UserRow user = principal.user();
    auth.assertStepUp(user, dto.password(), dto.totpCode(), null, null, meta);
    Instant now = Db.now();
    tx.executeWithoutResult(status -> {
      repo.deactivate(user.id(), now);
      repo.revokeUserSessions(user.id(), "DEACTIVATED", null, now);
      repo.revokeAllTokens(user.id(), now);
    });
    mail.sendAccountDeactivated(user.email(), user.firstName(), false);
    audit.record(new AuditService.Event("ACCOUNT_DEACTIVATED", "SUCCESS", user.id(), null, meta.correlationId(), null));
    return generic("Compte desactive");
  }

  public Map<String, Object> deleteAccount(AuthUser principal, AuthDtos.StepUp dto, ClientMeta meta) {
    UserRow user = principal.user();
    auth.assertStepUp(user, dto.password(), dto.totpCode(), null, null, meta);
    Instant now = Db.now();
    tx.executeWithoutResult(status -> {
      repo.markPendingDeletion(user.id(), now);
      repo.revokeUserSessions(user.id(), "PENDING_DELETION", null, now);
      repo.revokeAllTokens(user.id(), now);
      repo.deleteRecoveryCodes(user.id());
    });
    // `user` still holds the pre-anonymisation address loaded for this request.
    mail.sendAccountDeletionScheduled(user.email(), user.firstName());
    audit.record(new AuditService.Event("ACCOUNT_PENDING_DELETION", "SUCCESS", user.id(), null, meta.correlationId(),
        null));
    return generic("Compte programme pour suppression. La connexion est desactivee. La conservation des donnees de "
        + "simulation requiert une validation produit et juridique.");
  }
}
