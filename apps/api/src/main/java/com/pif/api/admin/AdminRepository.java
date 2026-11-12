package com.pif.api.admin;

import com.pif.api.data.Db;
import com.pif.api.data.UserRow;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Queries of apps/api/src/admin/admin.service.ts. */
@Repository
public class AdminRepository {

  public record UserCounts(long total, long active, long pending, long suspended, long deactivated, long verified,
      long mfaEnabled) {}

  public record EventSummary(UUID id, String eventType, String outcome, Instant createdAt, UUID actorUserId) {}

  public record EventTotal(String eventType, String outcome, long count) {}

  public record UserListRow(UUID id, String email, String firstName, String lastName, String role, String status,
      boolean emailVerified, boolean mfaEnabled, String experienceLevel, Instant createdAt, Instant lastLoginAt) {}

  public record AuditRow(UUID id, String eventType, String outcome, UUID actorUserId, UUID subjectUserId,
      String correlationId, Instant createdAt, String contextJson) {}

  private final JdbcClient jdbc;

  public AdminRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public UserCounts userCounts() {
    return jdbc.sql("SELECT count(*) AS total, "
            + "count(*) FILTER (WHERE status = 'ACTIVE') AS active, "
            + "count(*) FILTER (WHERE status = 'PENDING_VERIFICATION') AS pending, "
            + "count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended, "
            + "count(*) FILTER (WHERE status = 'DEACTIVATED') AS deactivated, "
            + "count(*) FILTER (WHERE email_verified) AS verified, "
            + "count(*) FILTER (WHERE mfa_enabled) AS mfa_enabled "
            + "FROM users WHERE deleted_at IS NULL")
        .query((rs, n) -> new UserCounts(rs.getLong("total"), rs.getLong("active"), rs.getLong("pending"),
            rs.getLong("suspended"), rs.getLong("deactivated"), rs.getLong("verified"), rs.getLong("mfa_enabled")))
        .single();
  }

  public List<EventSummary> recentEvents(int limit) {
    return jdbc.sql("SELECT id, event_type, outcome::text AS outcome, created_at, actor_user_id FROM audit_events "
            + "ORDER BY created_at DESC, id DESC LIMIT ?")
        .param(limit).query(AdminRepository::summary).list();
  }

  public List<EventSummary> eventsAbout(UUID subjectUserId, int limit) {
    return jdbc.sql("SELECT id, event_type, outcome::text AS outcome, created_at, actor_user_id FROM audit_events "
            + "WHERE subject_user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
        .param(subjectUserId).param(limit).query(AdminRepository::summary).list();
  }

  public List<EventTotal> eventTotalsSince(Instant since) {
    return jdbc.sql("SELECT event_type, outcome::text AS outcome, count(*) AS n FROM audit_events "
            + "WHERE created_at >= ? GROUP BY event_type, outcome")
        .param(Db.ts(since))
        .query((rs, n) -> new EventTotal(rs.getString("event_type"), rs.getString("outcome"), rs.getLong("n")))
        .list();
  }

  /** Prisma `contains` + mode "insensitive": ILIKE '%q%' with the value passed through unescaped. */
  public long countUsers(AdminDtos.UserQuery query, String q) {
    Where where = userWhere(query, q);
    return jdbc.sql("SELECT count(*) FROM users WHERE " + where.sql).params(where.params).query(Long.class).single();
  }

  public List<UserListRow> listUsers(AdminDtos.UserQuery query, String q, long offset, int limit) {
    Where where = userWhere(query, q);
    List<Object> params = new ArrayList<>(where.params);
    params.add(limit);
    params.add(offset);
    return jdbc.sql("SELECT id, email, first_name, last_name, role::text AS role, status::text AS status, "
            + "email_verified, mfa_enabled, experience_level::text AS experience_level, created_at, last_login_at "
            + "FROM users WHERE " + where.sql + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
        .params(params)
        .query((rs, n) -> new UserListRow(Db.uuid(rs, "id"), rs.getString("email"), rs.getString("first_name"),
            rs.getString("last_name"), rs.getString("role"), rs.getString("status"), rs.getBoolean("email_verified"),
            rs.getBoolean("mfa_enabled"), rs.getString("experience_level"), Db.instant(rs, "created_at"),
            Db.instant(rs, "last_login_at")))
        .list();
  }

  private record Where(String sql, List<Object> params) {}

  private static Where userWhere(AdminDtos.UserQuery query, String q) {
    StringBuilder sql = new StringBuilder("deleted_at IS NULL");
    List<Object> params = new ArrayList<>();
    if (query.status() != null && !query.status().isEmpty()) {
      sql.append(" AND status = ?::\"UserStatus\"");
      params.add(query.status());
    }
    if (query.role() != null && !query.role().isEmpty()) {
      sql.append(" AND role = ?::\"UserRole\"");
      params.add(query.role());
    }
    if (query.emailVerified() != null && !query.emailVerified().isEmpty()) {
      sql.append(" AND email_verified = ?");
      params.add("true".equals(query.emailVerified()));
    }
    if (q != null && !q.isEmpty()) {
      String pattern = "%" + q + "%";
      sql.append(" AND (email::text ILIKE ? OR first_name ILIKE ? OR last_name ILIKE ?)");
      params.add(pattern);
      params.add(pattern);
      params.add(pattern);
    }
    return new Where(sql.toString(), params);
  }

  public Optional<UserRow> findLiveUser(UUID id) {
    return jdbc.sql("SELECT " + UserRow.COLUMNS + " FROM users WHERE id = ? AND deleted_at IS NULL")
        .param(id).query(UserRow::map).optional();
  }

  public long countActiveSessions(UUID userId, Instant now) {
    return jdbc.sql("SELECT count(*) FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?")
        .param(userId).param(Db.ts(now)).query(Long.class).single();
  }

  public long countOtherActiveAdmins(UUID excludeUserId) {
    return jdbc.sql("SELECT count(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND deleted_at IS NULL "
            + "AND id <> ?")
        .param(excludeUserId).query(Long.class).single();
  }

  public void setStatus(UUID userId, String status, boolean bumpSecurityVersion, Instant now) {
    jdbc.sql("UPDATE users SET status = ?::\"UserStatus\", "
            + (bumpSecurityVersion ? "security_version = security_version + 1, " : "")
            + "updated_at = ? WHERE id = ?")
        .param(status).param(Db.ts(now)).param(userId).update();
  }

  public void setRole(UUID userId, String role, Instant now) {
    jdbc.sql("UPDATE users SET role = ?::\"UserRole\", security_version = security_version + 1, updated_at = ? "
            + "WHERE id = ?")
        .param(role).param(Db.ts(now)).param(userId).update();
  }

  /** Every unrevoked session, expired or not (authSession.updateMany where revokedAt null). */
  public void revokeAllSessions(UUID userId, String reason, Instant now) {
    jdbc.sql("UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL")
        .param(Db.ts(now)).param(reason).param(userId).update();
  }

  public void revokeUnusedTokens(UUID userId, Instant now) {
    jdbc.sql("UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL")
        .param(Db.ts(now)).param(userId).update();
  }

  public long countAuditEvents(AdminDtos.AuditQuery query) {
    Where where = auditWhere(query);
    return jdbc.sql("SELECT count(*) FROM audit_events WHERE " + where.sql).params(where.params)
        .query(Long.class).single();
  }

  public List<AuditRow> listAuditEvents(AdminDtos.AuditQuery query, long offset, int limit) {
    Where where = auditWhere(query);
    List<Object> params = new ArrayList<>(where.params);
    params.add(limit);
    params.add(offset);
    return jdbc.sql("SELECT id, event_type, outcome::text AS outcome, actor_user_id, subject_user_id, correlation_id, "
            + "created_at, context::text AS context FROM audit_events WHERE " + where.sql
            + " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
        .params(params)
        .query((rs, n) -> new AuditRow(Db.uuid(rs, "id"), rs.getString("event_type"), rs.getString("outcome"),
            Db.uuid(rs, "actor_user_id"), Db.uuid(rs, "subject_user_id"), rs.getString("correlation_id"),
            Db.instant(rs, "created_at"), rs.getString("context")))
        .list();
  }

  private static Where auditWhere(AdminDtos.AuditQuery query) {
    StringBuilder sql = new StringBuilder("TRUE");
    List<Object> params = new ArrayList<>();
    if (query.eventType() != null) {
      sql.append(" AND event_type = ?");
      params.add(query.eventType());
    }
    if (query.outcome() != null) {
      sql.append(" AND outcome = ?::\"AuditOutcome\"");
      params.add(query.outcome());
    }
    if (query.actorUserId() != null) {
      sql.append(" AND actor_user_id = ?");
      params.add(UUID.fromString(query.actorUserId()));
    }
    if (query.subjectUserId() != null) {
      sql.append(" AND subject_user_id = ?");
      params.add(UUID.fromString(query.subjectUserId()));
    }
    if (query.from() != null) {
      sql.append(" AND created_at >= ?");
      params.add(Db.ts(query.from()));
    }
    if (query.to() != null) {
      sql.append(" AND created_at <= ?");
      params.add(Db.ts(query.to()));
    }
    return new Where(sql.toString(), params);
  }

  private static EventSummary summary(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
    return new EventSummary(Db.uuid(rs, "id"), rs.getString("event_type"), rs.getString("outcome"),
        Db.instant(rs, "created_at"), Db.uuid(rs, "actor_user_id"));
  }

  static Map<String, Object> eventJson(EventSummary e) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", e.id().toString());
    m.put("eventType", e.eventType());
    m.put("outcome", e.outcome());
    m.put("createdAt", Db.iso(e.createdAt()));
    return m;
  }
}
