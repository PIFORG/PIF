package com.pif.api.data;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * SQL for the identity tables, written to match the Prisma queries of apps/api/src/auth.
 * Every UPDATE on users or user_preferences also sets updated_at, as Prisma's @updatedAt does.
 */
@Repository
public class AuthRepository {

  public record TokenRow(UUID id, UUID userId, UUID sessionId, String type, Instant expiresAt, Instant usedAt,
      Instant revokedAt, UUID replacedById) {

    static TokenRow map(ResultSet rs, int rowNum) throws SQLException {
      return new TokenRow(Db.uuid(rs, "id"), Db.uuid(rs, "user_id"), Db.uuid(rs, "session_id"), rs.getString("type"),
          Db.instant(rs, "expires_at"), Db.instant(rs, "used_at"), Db.instant(rs, "revoked_at"),
          Db.uuid(rs, "replaced_by_id"));
    }
  }

  public record SessionRow(UUID id, UUID userId, Instant lastSeenAt, Instant expiresAt, Instant revokedAt) {
    static SessionRow map(ResultSet rs, int rowNum) throws SQLException {
      return new SessionRow(Db.uuid(rs, "id"), Db.uuid(rs, "user_id"), Db.instant(rs, "last_seen_at"),
          Db.instant(rs, "expires_at"), Db.instant(rs, "revoked_at"));
    }
  }

  public record RecoveryCodeRow(UUID id, String codeHash) {}

  private static final String TOKEN_COLUMNS =
      "id, user_id, session_id, type::text AS type, expires_at, used_at, revoked_at, replaced_by_id";

  private final JdbcClient jdbc;

  public AuthRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  // ---------- users ----------

  public Optional<UserRow> findUserByEmail(String email) {
    return jdbc.sql("SELECT " + UserRow.COLUMNS + " FROM users WHERE email = ?::citext")
        .param(email).query(UserRow::map).optional();
  }

  public Optional<UserRow> findUserById(UUID id) {
    return jdbc.sql("SELECT " + UserRow.COLUMNS + " FROM users WHERE id = ?").param(id).query(UserRow::map).optional();
  }

  public Optional<PreferencesRow> findPreferences(UUID userId) {
    return jdbc.sql("SELECT " + PreferencesRow.COLUMNS + " FROM user_preferences WHERE user_id = ?")
        .param(userId).query(PreferencesRow::map).optional();
  }

  public int incrementFailedLogin(UUID userId, Instant now) {
    return jdbc.sql("UPDATE users SET failed_login_count = failed_login_count + 1, updated_at = ? WHERE id = ? "
            + "RETURNING failed_login_count")
        .param(Db.ts(now)).param(userId).query(Integer.class).single();
  }

  public int applyLock(UUID userId, Instant lockedUntil, int maxFailures, Instant now) {
    return jdbc.sql("UPDATE users SET locked_until = ?, failed_login_count = 0, updated_at = ? "
            + "WHERE id = ? AND failed_login_count >= ?")
        .param(Db.ts(lockedUntil)).param(Db.ts(now)).param(userId).param(maxFailures).update();
  }

  public void markLoginSuccess(UUID userId, Instant now) {
    jdbc.sql("UPDATE users SET last_login_at = ?, last_active_at = ?, failed_login_count = 0, locked_until = NULL, "
            + "updated_at = ? WHERE id = ?")
        .param(Db.ts(now)).param(Db.ts(now)).param(Db.ts(now)).param(userId).update();
  }

  public void touchUserActive(UUID userId, Instant now) {
    jdbc.sql("UPDATE users SET last_active_at = ?, updated_at = ? WHERE id = ?")
        .param(Db.ts(now)).param(Db.ts(now)).param(userId).update();
  }

  public boolean claimTotpStep(UUID userId, long step, Instant now) {
    return jdbc.sql("UPDATE users SET mfa_last_accepted_step = ?, updated_at = ? "
            + "WHERE id = ? AND (mfa_last_accepted_step IS NULL OR mfa_last_accepted_step < ?)")
        .param(step).param(Db.ts(now)).param(userId).param(step).update() == 1;
  }

  public void updateProfile(UUID userId, String firstName, String lastName, String experienceLevel, Instant now) {
    List<String> sets = new ArrayList<>();
    List<Object> params = new ArrayList<>();
    if (firstName != null) {
      sets.add("first_name = ?");
      params.add(firstName);
    }
    if (lastName != null) {
      sets.add("last_name = ?");
      params.add(lastName);
    }
    if (experienceLevel != null) {
      sets.add("experience_level = ?::\"ExperienceLevel\"");
      params.add(experienceLevel);
    }
    sets.add("updated_at = ?");
    params.add(Db.ts(now));
    params.add(userId);
    int updated = jdbc.sql("UPDATE users SET " + String.join(", ", sets) + " WHERE id = ?").params(params).update();
    if (updated != 1) throw new IllegalStateException("User row not found for profile update");
  }

  // ---------- preferences ----------

  /** Prisma upsert with an explicit field list; null fields are left unchanged (or default on insert). */
  public PreferencesRow upsertPreferences(UUID userId, PreferencesPatch patch, Instant now) {
    List<String> columns = new ArrayList<>(List.of("id", "user_id", "created_at", "updated_at"));
    List<Object> values = new ArrayList<>(List.of(Db.newId(), userId, Db.ts(now), Db.ts(now)));
    List<String> updates = new ArrayList<>();
    patch.forEach((column, value) -> {
      columns.add(column);
      values.add(value);
      updates.add(column + " = EXCLUDED." + column);
    });
    String conflict = updates.isEmpty()
        ? "ON CONFLICT (user_id) DO NOTHING"
        : "ON CONFLICT (user_id) DO UPDATE SET " + String.join(", ", updates) + ", updated_at = EXCLUDED.updated_at";
    String placeholders = String.join(", ", java.util.Collections.nCopies(columns.size(), "?"));
    jdbc.sql("INSERT INTO user_preferences (" + String.join(", ", columns) + ") VALUES (" + placeholders + ") "
        + conflict).params(values).update();
    return findPreferences(userId).orElseThrow();
  }

  /** Column → value pairs in a stable order. */
  public static final class PreferencesPatch {
    private final java.util.LinkedHashMap<String, Object> values = new java.util.LinkedHashMap<>();

    public PreferencesPatch set(String column, Object value) {
      if (value != null) values.put(column, value);
      return this;
    }

    void forEach(java.util.function.BiConsumer<String, Object> consumer) {
      values.forEach(consumer);
    }
  }

  // ---------- sessions ----------

  public List<UUID> activeSessionIdsOldestFirst(UUID userId, Instant now) {
    return jdbc.sql("SELECT id FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? "
            + "ORDER BY created_at ASC, id ASC")
        .param(userId).param(Db.ts(now)).query(UUID.class).list();
  }

  public void revokeSessionsForLimit(List<UUID> sessionIds, Instant now) {
    if (sessionIds.isEmpty()) return;
    UUID[] ids = sessionIds.toArray(UUID[]::new);
    jdbc.sql("UPDATE auth_sessions SET revoked_at = ?, revoked_reason = 'SESSION_LIMIT' WHERE id = ANY(?)")
        .param(Db.ts(now)).param(ids).update();
    jdbc.sql("UPDATE auth_tokens SET revoked_at = ? WHERE session_id = ANY(?) AND type = 'REFRESH_TOKEN' "
            + "AND revoked_at IS NULL AND used_at IS NULL")
        .param(Db.ts(now)).param(ids).update();
  }

  public void insertSession(UUID id, UUID userId, Instant now, Instant expiresAt, String userAgent, String ipDigest,
      String deviceLabel) {
    jdbc.sql("INSERT INTO auth_sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip_digest, "
            + "device_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .params(id, userId, Db.ts(now), Db.ts(now), Db.ts(expiresAt), userAgent, ipDigest, deviceLabel)
        .update();
  }

  public Optional<SessionRow> findSession(UUID id) {
    return jdbc.sql("SELECT id, user_id, last_seen_at, expires_at, revoked_at FROM auth_sessions WHERE id = ?")
        .param(id).query(SessionRow::map).optional();
  }

  public Optional<SessionRow> findActiveSession(UUID id, UUID userId, Instant now) {
    return jdbc.sql("SELECT id, user_id, last_seen_at, expires_at, revoked_at FROM auth_sessions "
            + "WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1")
        .param(id).param(userId).param(Db.ts(now)).query(SessionRow::map).optional();
  }

  public void touchSession(UUID id, Instant now) {
    jdbc.sql("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").param(Db.ts(now)).param(id).update();
  }

  public void extendSession(UUID id, Instant now, Instant expiresAt) {
    jdbc.sql("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
        .param(Db.ts(now)).param(Db.ts(expiresAt)).param(id).update();
  }

  /** revokeSession of auth.service.ts: the session (optionally scoped to its owner) and all its refresh tokens. */
  public void revokeSession(UUID sessionId, String reason, UUID userId, Instant now) {
    if (userId != null) {
      jdbc.sql("UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL "
              + "AND user_id = ?")
          .param(Db.ts(now)).param(reason).param(sessionId).param(userId).update();
    } else {
      jdbc.sql("UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL")
          .param(Db.ts(now)).param(reason).param(sessionId).update();
    }
    jdbc.sql("UPDATE auth_tokens SET revoked_at = ? WHERE session_id = ? AND type = 'REFRESH_TOKEN' "
            + "AND revoked_at IS NULL")
        .param(Db.ts(now)).param(sessionId).update();
  }

  // ---------- tokens ----------

  public void insertToken(UUID id, UUID userId, UUID sessionId, String type, String tokenHash, Instant expiresAt,
      Instant now) {
    jdbc.sql("INSERT INTO auth_tokens (id, user_id, session_id, type, token_hash, expires_at, created_at) "
            + "VALUES (?, ?, ?, ?::\"AuthTokenType\", ?, ?, ?)")
        .params(id, userId, sessionId, type, tokenHash, Db.ts(expiresAt), Db.ts(now))
        .update();
  }

  public void revokeOutstandingTokens(UUID userId, String type, Instant now) {
    jdbc.sql("UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND type = ?::\"AuthTokenType\" "
            + "AND used_at IS NULL AND revoked_at IS NULL")
        .param(Db.ts(now)).param(userId).param(type).update();
  }

  /** Atomic single-use claim (conditional update + affected-row check). Returns the owner. */
  public Optional<UUID> consumeToken(String tokenHash, String type, Instant now) {
    return jdbc.sql("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND type = ?::\"AuthTokenType\" "
            + "AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? RETURNING user_id")
        .param(Db.ts(now)).param(tokenHash).param(type).param(Db.ts(now))
        .query(UUID.class).optional();
  }

  public Optional<TokenRow> findTokenByHash(String tokenHash) {
    return jdbc.sql("SELECT " + TOKEN_COLUMNS + " FROM auth_tokens WHERE token_hash = ?")
        .param(tokenHash).query(TokenRow::map).optional();
  }

  public Optional<TokenRow> findTokenById(UUID id) {
    return jdbc.sql("SELECT " + TOKEN_COLUMNS + " FROM auth_tokens WHERE id = ?").param(id).query(TokenRow::map).optional();
  }

  public boolean claimRefreshToken(UUID id, Instant now) {
    return jdbc.sql("UPDATE auth_tokens SET used_at = ?, revoked_at = ? WHERE id = ? AND used_at IS NULL "
            + "AND revoked_at IS NULL AND replaced_by_id IS NULL")
        .param(Db.ts(now)).param(Db.ts(now)).param(id).update() == 1;
  }

  public void setReplacedBy(UUID id, UUID replacementId) {
    jdbc.sql("UPDATE auth_tokens SET replaced_by_id = ? WHERE id = ?").param(replacementId).param(id).update();
  }

  public void revokeSessionForReuse(UUID sessionId, Instant now) {
    jdbc.sql("UPDATE auth_sessions SET revoked_at = ?, revoked_reason = 'REFRESH_REUSE_DETECTED' "
            + "WHERE id = ? AND revoked_at IS NULL")
        .param(Db.ts(now)).param(sessionId).update();
    jdbc.sql("UPDATE auth_tokens SET revoked_at = ? WHERE session_id = ? AND type = 'REFRESH_TOKEN' "
            + "AND revoked_at IS NULL")
        .param(Db.ts(now)).param(sessionId).update();
  }

  // ---------- account lifecycle ----------

  /** prisma.user.create with role INVESTOR and status PENDING_VERIFICATION; column defaults fill the rest. */
  public void insertPendingUser(UUID id, String email, String firstName, String lastName, String passwordHash,
      Instant now) {
    jdbc.sql("INSERT INTO users (id, email, first_name, last_name, password_hash, role, status, created_at, "
            + "updated_at) VALUES (?, ?, ?, ?, ?, 'INVESTOR'::\"UserRole\", "
            + "'PENDING_VERIFICATION'::\"UserStatus\", ?, ?)")
        .params(id, email, firstName, lastName, passwordHash, Db.ts(now), Db.ts(now))
        .update();
  }

  public boolean emailInUse(String email) {
    return jdbc.sql("SELECT 1 FROM users WHERE email = ?::citext").param(email).query(Integer.class).optional()
        .isPresent();
  }

  /** emailVerified, emailVerifiedAt kept when already set, and ACTIVE only when the account was pending. */
  public void markEmailVerified(UUID userId, Instant now) {
    jdbc.sql("UPDATE users SET email_verified = true, email_verified_at = COALESCE(email_verified_at, ?), "
            + "status = CASE WHEN status = 'PENDING_VERIFICATION' THEN 'ACTIVE'::\"UserStatus\" ELSE status END, "
            + "updated_at = ? WHERE id = ?")
        .param(Db.ts(now)).param(Db.ts(now)).param(userId).update();
  }

  /** New password hash with securityVersion + 1; a reset also clears the sign-in lockout. */
  public void setPassword(UUID userId, String passwordHash, boolean clearLockout, Instant now) {
    jdbc.sql("UPDATE users SET password_hash = ?, password_changed_at = ?, security_version = security_version + 1, "
            + (clearLockout ? "failed_login_count = 0, locked_until = NULL, " : "")
            + "updated_at = ? WHERE id = ?")
        .param(passwordHash).param(Db.ts(now)).param(Db.ts(now)).param(userId).update();
  }

  public void changeEmail(UUID userId, String newEmail, Instant now) {
    jdbc.sql("UPDATE users SET email = ?, email_verified = true, email_verified_at = ?, "
            + "security_version = security_version + 1, updated_at = ? WHERE id = ?")
        .param(newEmail).param(Db.ts(now)).param(Db.ts(now)).param(userId).update();
  }

  public void deactivate(UUID userId, Instant now) {
    jdbc.sql("UPDATE users SET status = 'DEACTIVATED'::\"UserStatus\", security_version = security_version + 1, "
            + "updated_at = ? WHERE id = ?")
        .param(Db.ts(now)).param(userId).update();
  }

  /** Soft pending deletion: anonymised identity, MFA off, sign-in disabled. */
  public void markPendingDeletion(UUID userId, Instant now) {
    jdbc.sql("UPDATE users SET status = 'PENDING_DELETION'::\"UserStatus\", deleted_at = ?, email = ?, "
            + "first_name = 'Deleted', last_name = 'User', security_version = security_version + 1, "
            + "mfa_enabled = false, mfa_secret_encrypted = NULL, mfa_pending_secret_encrypted = NULL, updated_at = ? "
            + "WHERE id = ?")
        .param(Db.ts(now)).param("deleted:" + userId + "@invalid.local").param(Db.ts(now)).param(userId).update();
  }

  /** Revokes the user's live sessions, optionally keeping one (the caller's). */
  public void revokeUserSessions(UUID userId, String reason, UUID keepSessionId, Instant now) {
    if (keepSessionId == null) {
      jdbc.sql("UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL")
          .param(Db.ts(now)).param(reason).param(userId).update();
    } else {
      jdbc.sql("UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL "
              + "AND id <> ?")
          .param(Db.ts(now)).param(reason).param(userId).param(keepSessionId).update();
    }
  }

  /** Prisma `NOT: { sessionId }` also excludes rows whose session_id is NULL (SQL three-valued logic). */
  public void revokeRefreshTokensOutsideSession(UUID userId, UUID keepSessionId, Instant now) {
    jdbc.sql("UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND type = 'REFRESH_TOKEN' "
            + "AND revoked_at IS NULL AND session_id <> ?")
        .param(Db.ts(now)).param(userId).param(keepSessionId).update();
  }

  /** Every unrevoked token of the user, used or not (deactivation and deletion). */
  public void revokeAllTokens(UUID userId, Instant now) {
    jdbc.sql("UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .param(Db.ts(now)).param(userId).update();
  }

  public void revokeOutstandingTokens(UUID userId, List<String> types, Instant now) {
    jdbc.sql("UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND type::text = ANY(?) "
            + "AND used_at IS NULL AND revoked_at IS NULL")
        .param(Db.ts(now)).param(userId).param(types.toArray(String[]::new)).update();
  }

  public void insertToken(UUID id, UUID userId, String type, String tokenHash, Instant expiresAt, String pendingEmail,
      Instant now) {
    jdbc.sql("INSERT INTO auth_tokens (id, user_id, type, token_hash, expires_at, pending_email, created_at) "
            + "VALUES (?, ?, ?::\"AuthTokenType\", ?, ?, ?::citext, ?)")
        .params(id, userId, type, tokenHash, Db.ts(expiresAt), pendingEmail, Db.ts(now))
        .update();
  }

  public boolean tokenCreatedSince(UUID userId, String type, Instant since) {
    return jdbc.sql("SELECT 1 FROM auth_tokens WHERE user_id = ? AND type = ?::\"AuthTokenType\" AND created_at > ? "
            + "LIMIT 1")
        .param(userId).param(type).param(Db.ts(since)).query(Integer.class).optional().isPresent();
  }

  public record ConsumedToken(UUID id, UUID userId, String pendingEmail, UUID sessionId) {}

  /** Read-only validity check (peekToken): unused, unrevoked, unexpired. */
  public Optional<UUID> peekToken(String tokenHash, String type, Instant now) {
    return jdbc.sql("SELECT user_id FROM auth_tokens WHERE token_hash = ? AND type = ?::\"AuthTokenType\" "
            + "AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? LIMIT 1")
        .param(tokenHash).param(type).param(Db.ts(now)).query(UUID.class).optional();
  }

  /** consumeToken of auth.service.ts: atomic single-use claim returning the token's owner and payload. */
  public Optional<ConsumedToken> claimToken(String tokenHash, String type, Instant now) {
    return jdbc.sql("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND type = ?::\"AuthTokenType\" "
            + "AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? "
            + "RETURNING id, user_id, pending_email::text AS pending_email, session_id")
        .param(Db.ts(now)).param(tokenHash).param(type).param(Db.ts(now))
        .query((rs, i) -> new ConsumedToken(Db.uuid(rs, "id"), Db.uuid(rs, "user_id"), rs.getString("pending_email"),
            Db.uuid(rs, "session_id")))
        .optional();
  }

  // ---------- sessions (owner views) ----------

  public record SessionView(UUID id, Instant createdAt, Instant lastSeenAt, Instant expiresAt, String deviceLabel,
      String userAgent) {}

  public List<SessionView> activeSessions(UUID userId, Instant now) {
    return jdbc.sql("SELECT id, created_at, last_seen_at, expires_at, device_label, user_agent FROM auth_sessions "
            + "WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC")
        .param(userId).param(Db.ts(now))
        .query((rs, i) -> new SessionView(Db.uuid(rs, "id"), Db.instant(rs, "created_at"),
            Db.instant(rs, "last_seen_at"), Db.instant(rs, "expires_at"), rs.getString("device_label"),
            rs.getString("user_agent")))
        .list();
  }

  public boolean sessionOwnedBy(UUID sessionId, UUID userId) {
    return jdbc.sql("SELECT 1 FROM auth_sessions WHERE id = ? AND user_id = ?").param(sessionId).param(userId)
        .query(Integer.class).optional().isPresent();
  }

  public int countActiveSessions(UUID userId, Instant now) {
    return jdbc.sql("SELECT count(*) FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?")
        .param(userId).param(Db.ts(now)).query(Integer.class).single();
  }

  // ---------- two-step verification ----------

  public record PendingMfa(String secretEncrypted, Instant createdAt) {}

  public Optional<PendingMfa> pendingMfa(UUID userId) {
    return jdbc.sql("SELECT mfa_pending_secret_encrypted, mfa_pending_created_at FROM users WHERE id = ?")
        .param(userId)
        .query((rs, i) -> new PendingMfa(rs.getString("mfa_pending_secret_encrypted"),
            Db.instant(rs, "mfa_pending_created_at")))
        .optional();
  }

  public void setPendingMfa(UUID userId, String secretEncrypted, int keyVersion, Instant now) {
    jdbc.sql("UPDATE users SET mfa_pending_secret_encrypted = ?, mfa_pending_created_at = ?, "
            + "mfa_secret_key_version = ?, updated_at = ? WHERE id = ?")
        .param(secretEncrypted).param(Db.ts(now)).param(keyVersion).param(Db.ts(now)).param(userId).update();
  }

  public void clearPendingMfa(UUID userId, Instant now) {
    jdbc.sql("UPDATE users SET mfa_pending_secret_encrypted = NULL, mfa_pending_created_at = NULL, updated_at = ? "
            + "WHERE id = ?")
        .param(Db.ts(now)).param(userId).update();
  }

  public void enableMfa(UUID userId, String secretEncrypted, Instant now) {
    jdbc.sql("UPDATE users SET mfa_enabled = true, mfa_verified_at = ?, mfa_secret_encrypted = ?, "
            + "mfa_pending_secret_encrypted = NULL, mfa_pending_created_at = NULL, updated_at = ? WHERE id = ?")
        .param(Db.ts(now)).param(secretEncrypted).param(Db.ts(now)).param(userId).update();
  }

  public void disableMfa(UUID userId, Instant now) {
    jdbc.sql("UPDATE users SET mfa_enabled = false, mfa_secret_encrypted = NULL, mfa_pending_secret_encrypted = NULL, "
            + "mfa_pending_created_at = NULL, mfa_verified_at = NULL, mfa_last_accepted_step = NULL, "
            + "security_version = security_version + 1, updated_at = ? WHERE id = ?")
        .param(Db.ts(now)).param(userId).update();
  }

  public void deleteRecoveryCodes(UUID userId) {
    jdbc.sql("DELETE FROM mfa_recovery_codes WHERE user_id = ?").param(userId).update();
  }

  public void insertRecoveryCodes(UUID userId, List<String> codeHashes, Instant now) {
    for (String hash : codeHashes) {
      jdbc.sql("INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)")
          .params(Db.newId(), userId, hash, Db.ts(now)).update();
    }
  }

  public int countUnusedRecoveryCodes(UUID userId) {
    return jdbc.sql("SELECT count(*) FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL")
        .param(userId).query(Integer.class).single();
  }

  // ---------- audit lookups ----------

  public boolean auditEventSince(String eventType, String userColumn, UUID userId, Instant since) {
    if (!"subject_user_id".equals(userColumn) && !"actor_user_id".equals(userColumn)) {
      throw new IllegalArgumentException("Unsupported audit column");
    }
    return jdbc.sql("SELECT 1 FROM audit_events WHERE event_type = ? AND " + userColumn + " = ? AND created_at > ? "
            + "LIMIT 1")
        .param(eventType).param(userId).param(Db.ts(since)).query(Integer.class).optional().isPresent();
  }

  // ---------- recovery codes ----------

  public List<RecoveryCodeRow> unusedRecoveryCodes(UUID userId) {
    return jdbc.sql("SELECT id, code_hash FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL")
        .param(userId).query((rs, i) -> new RecoveryCodeRow(Db.uuid(rs, "id"), rs.getString("code_hash"))).list();
  }

  public boolean markRecoveryCodeUsed(UUID id, Instant now) {
    return jdbc.sql("UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
        .param(Db.ts(now)).param(id).update() == 1;
  }
}
