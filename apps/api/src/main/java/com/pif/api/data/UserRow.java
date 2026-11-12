package com.pif.api.data;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;

/** A row of "users" (Prisma model User). */
public record UserRow(
    UUID id,
    String email,
    String firstName,
    String lastName,
    String passwordHash,
    String role,
    String experienceLevel,
    boolean emailVerified,
    Instant emailVerifiedAt,
    String status,
    int failedLoginCount,
    Instant lockedUntil,
    boolean mfaEnabled,
    Instant mfaVerifiedAt,
    String mfaSecretEncrypted,
    Long mfaLastAcceptedStep,
    int securityVersion,
    Instant deletedAt,
    Instant createdAt,
    Instant updatedAt,
    Instant lastLoginAt,
    Instant lastActiveAt) {

  public static final String COLUMNS = "id, email, first_name, last_name, password_hash, role::text AS role, "
      + "experience_level::text AS experience_level, email_verified, email_verified_at, status::text AS status, "
      + "failed_login_count, locked_until, mfa_enabled, mfa_verified_at, mfa_secret_encrypted, "
      + "mfa_last_accepted_step, security_version, deleted_at, created_at, updated_at, last_login_at, last_active_at";

  public static UserRow map(ResultSet rs, int rowNum) throws SQLException {
    long step = rs.getLong("mfa_last_accepted_step");
    Long lastStep = rs.wasNull() ? null : step;
    return new UserRow(
        Db.uuid(rs, "id"),
        rs.getString("email"),
        rs.getString("first_name"),
        rs.getString("last_name"),
        rs.getString("password_hash"),
        rs.getString("role"),
        rs.getString("experience_level"),
        rs.getBoolean("email_verified"),
        Db.instant(rs, "email_verified_at"),
        rs.getString("status"),
        rs.getInt("failed_login_count"),
        Db.instant(rs, "locked_until"),
        rs.getBoolean("mfa_enabled"),
        Db.instant(rs, "mfa_verified_at"),
        rs.getString("mfa_secret_encrypted"),
        lastStep,
        rs.getInt("security_version"),
        Db.instant(rs, "deleted_at"),
        Db.instant(rs, "created_at"),
        Db.instant(rs, "updated_at"),
        Db.instant(rs, "last_login_at"),
        Db.instant(rs, "last_active_at"));
  }

  public boolean isLocked(Instant now) {
    return lockedUntil != null && lockedUntil.isAfter(now);
  }
}
