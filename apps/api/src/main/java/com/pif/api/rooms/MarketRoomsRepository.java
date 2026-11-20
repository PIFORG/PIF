package com.pif.api.rooms;

import com.pif.api.data.Db;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class MarketRoomsRepository {

  private final JdbcClient jdbc;

  public MarketRoomsRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public boolean tablesPresent() {
    Integer n = jdbc.sql(
            "SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name='market_rooms'")
        .query(Integer.class).single();
    return n != null && n > 0;
  }

  public record RoomRow(
      UUID id, String code, String title, String description, String visibility, String mode, String status,
      UUID hostUserId, String rulesJson, String marketScope, String crisisEpisodeId,
      LocalDate simClockDate, Instant simStartedAt, Instant simEndedAt, Instant pausedAt,
      long eventSeq, int maxParticipants, Instant inviteExpiresAt, Instant createdAt) {}

  public record MemberRow(
      UUID id, UUID roomId, UUID userId, String role, String displayName, UUID portfolioId,
      int learningPoints, long creditDebtMillimes, long creditDrawnMillimes, long convertedCapitalMillimes,
      boolean tradingLocked, String lockReason, String pedagogicalLevel, Instant lastConversionAt,
      Instant joinedAt, Instant leftAt) {}

  public RoomRow insertRoom(UUID id, String code, String title, String description, String visibility, String mode,
      UUID hostId, String rulesJson, String marketScope, String crisisId, LocalDate simClock, int maxParticipants,
      Instant inviteExpires, Instant now) {
    jdbc.sql("""
        INSERT INTO market_rooms (id, code, title, description, visibility, mode, status, host_user_id, rules_json,
          market_scope, crisis_episode_id, sim_clock_date, max_participants, invite_expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'LOBBY', ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?)
        """)
        .params(id, code, title, description, visibility, mode, hostId, rulesJson, marketScope, crisisId,
            simClock == null ? null : Date.valueOf(simClock), maxParticipants,
            inviteExpires == null ? null : Timestamp.from(inviteExpires), Timestamp.from(now), Timestamp.from(now))
        .update();
    return room(id).orElseThrow();
  }

  public Optional<RoomRow> room(UUID id) {
    return jdbc.sql("SELECT * FROM market_rooms WHERE id = ?").param(id).query(this::roomMapper).optional();
  }

  public Optional<RoomRow> roomByCode(String code) {
    return jdbc.sql("SELECT * FROM market_rooms WHERE UPPER(code) = UPPER(?)").param(code).query(this::roomMapper)
        .optional();
  }

  public List<RoomRow> listVisible(UUID userId) {
    return jdbc.sql("""
        SELECT DISTINCT r.* FROM market_rooms r
        LEFT JOIN market_room_members m ON m.room_id = r.id AND m.user_id = ? AND m.left_at IS NULL
        WHERE r.status <> 'ENDED'
          AND (r.visibility = 'PUBLIC' OR m.user_id IS NOT NULL OR r.host_user_id = ?)
        ORDER BY r.created_at DESC
        LIMIT 80
        """)
        .params(userId, userId)
        .query(this::roomMapper)
        .list();
  }

  public void updateStatus(UUID roomId, String status, Instant now) {
    jdbc.sql("UPDATE market_rooms SET status = ?, updated_at = ? WHERE id = ?")
        .params(status, Timestamp.from(now), roomId).update();
  }

  public void setPaused(UUID roomId, Instant pausedAt, Instant now) {
    jdbc.sql("UPDATE market_rooms SET status = 'PAUSED', paused_at = ?, updated_at = ? WHERE id = ?")
        .params(Timestamp.from(pausedAt), Timestamp.from(now), roomId).update();
  }

  public void setActive(UUID roomId, Instant startedAt, Instant now) {
    jdbc.sql("""
        UPDATE market_rooms SET status = 'ACTIVE', sim_started_at = COALESCE(sim_started_at, ?),
          paused_at = NULL, updated_at = ? WHERE id = ?
        """)
        .params(Timestamp.from(startedAt), Timestamp.from(now), roomId).update();
  }

  public void endRoom(UUID roomId, Instant endedAt) {
    jdbc.sql("UPDATE market_rooms SET status = 'ENDED', sim_ended_at = ?, updated_at = ? WHERE id = ?")
        .params(Timestamp.from(endedAt), Timestamp.from(endedAt), roomId).update();
  }

  public void advanceClock(UUID roomId, LocalDate date, Instant now) {
    jdbc.sql("UPDATE market_rooms SET sim_clock_date = ?, updated_at = ? WHERE id = ?")
        .params(Date.valueOf(date), Timestamp.from(now), roomId).update();
  }

  public long nextEventSeq(UUID roomId) {
    return jdbc.sql("UPDATE market_rooms SET event_seq = event_seq + 1, updated_at = NOW() WHERE id = ? RETURNING event_seq")
        .param(roomId).query(Long.class).single();
  }

  public void insertEvent(UUID roomId, long seq, String type, UUID actorId, String payloadJson, Instant now) {
    jdbc.sql("""
        INSERT INTO market_room_events (id, room_id, seq, type, actor_user_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)
        """)
        .params(Db.newId(), roomId, seq, type, actorId, payloadJson, Timestamp.from(now))
        .update();
  }

  public List<Map<String, Object>> eventsSince(UUID roomId, long sinceSeq) {
    return jdbc.sql("""
        SELECT seq, type, actor_user_id::text AS actor_user_id, payload_json::text AS payload, created_at
        FROM market_room_events WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT 200
        """)
        .params(roomId, sinceSeq)
        .query((rs, n) -> {
          Map<String, Object> m = new java.util.LinkedHashMap<>();
          m.put("seq", rs.getLong("seq"));
          m.put("type", rs.getString("type"));
          m.put("actorUserId", rs.getString("actor_user_id"));
          m.put("payload", rs.getString("payload"));
          m.put("at", rs.getTimestamp("created_at").toInstant().toString());
          return m;
        }).list();
  }

  public MemberRow insertMember(UUID id, UUID roomId, UUID userId, String role, String displayName, UUID portfolioId,
      Instant now) {
    jdbc.sql("""
        INSERT INTO market_room_members (id, room_id, user_id, role, display_name, portfolio_id, joined_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """)
        .params(id, roomId, userId, role, displayName, portfolioId, Timestamp.from(now))
        .update();
    return member(id).orElseThrow();
  }

  public Optional<MemberRow> member(UUID id) {
    return jdbc.sql("SELECT * FROM market_room_members WHERE id = ?").param(id).query(this::memberMapper).optional();
  }

  public Optional<MemberRow> activeMember(UUID roomId, UUID userId) {
    return jdbc.sql("SELECT * FROM market_room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL")
        .params(roomId, userId).query(this::memberMapper).optional();
  }

  public List<MemberRow> activeMembers(UUID roomId) {
    return jdbc.sql("SELECT * FROM market_room_members WHERE room_id = ? AND left_at IS NULL ORDER BY joined_at")
        .param(roomId).query(this::memberMapper).list();
  }

  public int activeMemberCount(UUID roomId) {
    return jdbc.sql("SELECT COUNT(*)::int FROM market_room_members WHERE room_id = ? AND left_at IS NULL")
        .param(roomId).query(Integer.class).single();
  }

  public void leaveMember(UUID memberId, Instant now) {
    jdbc.sql("UPDATE market_room_members SET left_at = ? WHERE id = ? AND left_at IS NULL")
        .params(Timestamp.from(now), memberId).update();
  }

  public MemberRow updateEconomy(UUID memberId, int points, long debt, long drawn, long converted, boolean locked,
      String lockReason, String level, Instant lastConversion) {
    jdbc.sql("""
        UPDATE market_room_members SET learning_points = ?, credit_debt_millimes = ?, credit_drawn_millimes = ?,
          converted_capital_millimes = ?, trading_locked = ?, lock_reason = ?, pedagogical_level = ?,
          last_conversion_at = ? WHERE id = ?
        """)
        .params(points, debt, drawn, converted, locked, lockReason, level,
            lastConversion == null ? null : Timestamp.from(lastConversion), memberId)
        .update();
    return member(memberId).orElseThrow();
  }

  public boolean insertReward(UUID roomId, UUID memberId, String sourceKind, String sourceRef, int points) {
    try {
      jdbc.sql("""
          INSERT INTO market_room_rewards (id, room_id, member_id, source_kind, source_ref, points_awarded)
          VALUES (?, ?, ?, ?, ?, ?)
          """)
          .params(Db.newId(), roomId, memberId, sourceKind, sourceRef, points)
          .update();
      return true;
    } catch (org.springframework.dao.DuplicateKeyException e) {
      return false;
    }
  }

  /** Missions claimed in this room (source_kind = MISSION) — used by pedagogical score. */
  public int countMissionRewards(UUID memberId) {
    Integer n = jdbc.sql("""
        SELECT COUNT(*)::int FROM market_room_rewards
        WHERE member_id = ? AND source_kind = 'MISSION'
        """)
        .param(memberId)
        .query(Integer.class)
        .optional()
        .orElse(0);
    return n == null ? 0 : n;
  }

  public void insertLedger(UUID roomId, UUID memberId, String kind, long amount, int pointsDelta,
      Long cashAfter, Long debtAfter, Integer pointsAfter, String idempotencyKey, String note, Instant now) {
    jdbc.sql("""
        INSERT INTO market_room_ledger (id, room_id, member_id, kind, amount_millimes, points_delta,
          balance_cash_after, balance_debt_after, balance_points_after, idempotency_key, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """)
        .params(Db.newId(), roomId, memberId, kind, amount, pointsDelta, cashAfter, debtAfter, pointsAfter,
            idempotencyKey, note, Timestamp.from(now))
        .update();
  }

  public Optional<Map<String, Object>> ledgerByIdempotency(UUID roomId, String key) {
    return jdbc.sql("""
        SELECT kind, amount_millimes, points_delta, note, created_at
        FROM market_room_ledger WHERE room_id = ? AND idempotency_key = ?
        """)
        .params(roomId, key)
        .query((rs, n) -> {
          Map<String, Object> m = new java.util.LinkedHashMap<>();
          m.put("kind", rs.getString("kind"));
          m.put("amountMillimes", rs.getLong("amount_millimes"));
          m.put("pointsDelta", rs.getInt("points_delta"));
          m.put("note", rs.getString("note"));
          m.put("at", rs.getTimestamp("created_at").toInstant().toString());
          return m;
        }).optional();
  }

  public void insertMessage(UUID id, UUID roomId, UUID senderId, String body, Instant now) {
    jdbc.sql("""
        INSERT INTO market_room_messages (id, room_id, sender_user_id, body, created_at)
        VALUES (?, ?, ?, ?, ?)
        """)
        .params(id, roomId, senderId, body, Timestamp.from(now)).update();
  }

  public List<Map<String, Object>> recentMessages(UUID roomId, int limit) {
    return jdbc.sql("""
        SELECT m.id::text AS id, m.sender_user_id::text AS sender_user_id, m.body, m.created_at,
               COALESCE(mb.display_name, u.first_name || ' ' || u.last_name) AS sender_name
        FROM market_room_messages m
        JOIN users u ON u.id = m.sender_user_id
        LEFT JOIN market_room_members mb ON mb.room_id = m.room_id AND mb.user_id = m.sender_user_id AND mb.left_at IS NULL
        WHERE m.room_id = ? AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC
        LIMIT ?
        """)
        .params(roomId, limit)
        .query((rs, n) -> {
          Map<String, Object> row = new java.util.LinkedHashMap<>();
          row.put("id", rs.getString("id"));
          row.put("senderUserId", rs.getString("sender_user_id"));
          row.put("senderName", rs.getString("sender_name"));
          row.put("body", rs.getString("body"));
          row.put("at", rs.getTimestamp("created_at").toInstant().toString());
          row.put("status", "SENT");
          return row;
        }).list();
  }

  public int messagesLastMinute(UUID roomId, UUID userId, Instant since) {
    return jdbc.sql("""
        SELECT COUNT(*)::int FROM market_room_messages
        WHERE room_id = ? AND sender_user_id = ? AND created_at >= ?
        """)
        .params(roomId, userId, Timestamp.from(since)).query(Integer.class).single();
  }

  private RoomRow roomMapper(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
    Date clock = rs.getDate("sim_clock_date");
    Timestamp started = rs.getTimestamp("sim_started_at");
    Timestamp ended = rs.getTimestamp("sim_ended_at");
    Timestamp paused = rs.getTimestamp("paused_at");
    Timestamp invite = rs.getTimestamp("invite_expires_at");
    return new RoomRow(
        (UUID) rs.getObject("id"),
        rs.getString("code"),
        rs.getString("title"),
        rs.getString("description"),
        rs.getString("visibility"),
        rs.getString("mode"),
        rs.getString("status"),
        (UUID) rs.getObject("host_user_id"),
        rs.getString("rules_json"),
        rs.getString("market_scope"),
        rs.getString("crisis_episode_id"),
        clock == null ? null : clock.toLocalDate(),
        started == null ? null : started.toInstant(),
        ended == null ? null : ended.toInstant(),
        paused == null ? null : paused.toInstant(),
        rs.getLong("event_seq"),
        rs.getInt("max_participants"),
        invite == null ? null : invite.toInstant(),
        rs.getTimestamp("created_at").toInstant());
  }

  private MemberRow memberMapper(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
    Timestamp left = rs.getTimestamp("left_at");
    Timestamp conv = rs.getTimestamp("last_conversion_at");
    return new MemberRow(
        (UUID) rs.getObject("id"),
        (UUID) rs.getObject("room_id"),
        (UUID) rs.getObject("user_id"),
        rs.getString("role"),
        rs.getString("display_name"),
        (UUID) rs.getObject("portfolio_id"),
        rs.getInt("learning_points"),
        rs.getLong("credit_debt_millimes"),
        rs.getLong("credit_drawn_millimes"),
        rs.getLong("converted_capital_millimes"),
        rs.getBoolean("trading_locked"),
        rs.getString("lock_reason"),
        rs.getString("pedagogical_level"),
        conv == null ? null : conv.toInstant(),
        rs.getTimestamp("joined_at").toInstant(),
        left == null ? null : left.toInstant());
  }
}
