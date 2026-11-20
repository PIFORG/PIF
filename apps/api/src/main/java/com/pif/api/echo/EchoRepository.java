package com.pif.api.echo;

import com.pif.api.data.Db;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/**
 * Persistence for ÉCHO. Every query is scoped by {@code user_id}: a row that belongs to someone else is
 * indistinguishable from a missing row (no IDOR oracle).
 */
@Repository
public class EchoRepository {

  private final JdbcClient jdbc;
  private final ObjectMapper mapper;

  public EchoRepository(JdbcClient jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  public boolean tablesPresent() {
    Integer n = jdbc.sql("SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' "
        + "AND table_name IN ('echo_preferences','echo_conversations','echo_messages','echo_decisions','echo_alerts')")
        .query(Integer.class).single();
    return n != null && n == 5;
  }

  String json(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (RuntimeException e) {
      throw new IllegalStateException("ÉCHO: sérialisation impossible", e);
    }
  }

  @SuppressWarnings("unchecked")
  Map<String, Object> parse(String raw) {
    if (raw == null || raw.isBlank()) return new LinkedHashMap<>();
    return mapper.readValue(raw, LinkedHashMap.class);
  }

  // ------------------------------------------------------------------ preferences

  public record Preferences(boolean memoryEnabled, boolean voiceEnabled, boolean proactiveVoice, boolean alertsEnabled,
      String helpLevel) {
    static final Preferences DEFAULTS = new Preferences(false, false, false, true, "INTERMEDIAIRE");

    Map<String, Object> toJson() {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("memoryEnabled", memoryEnabled);
      m.put("voiceEnabled", voiceEnabled);
      m.put("proactiveVoice", proactiveVoice);
      m.put("alertsEnabled", alertsEnabled);
      m.put("helpLevel", helpLevel);
      return m;
    }
  }

  public Preferences preferences(UUID user) {
    return jdbc.sql("SELECT memory_enabled, voice_enabled, proactive_voice, alerts_enabled, help_level "
            + "FROM echo_preferences WHERE user_id=?")
        .param(user)
        .query((rs, i) -> new Preferences(rs.getBoolean(1), rs.getBoolean(2), rs.getBoolean(3), rs.getBoolean(4),
            rs.getString(5)))
        .optional().orElse(Preferences.DEFAULTS);
  }

  public void savePreferences(UUID user, Preferences p) {
    jdbc.sql("""
        INSERT INTO echo_preferences (user_id, memory_enabled, voice_enabled, proactive_voice, alerts_enabled,
          help_level, updated_at) VALUES (?, ?, ?, ?, ?, ?, (NOW() AT TIME ZONE 'UTC'))
        ON CONFLICT (user_id) DO UPDATE SET memory_enabled=EXCLUDED.memory_enabled,
          voice_enabled=EXCLUDED.voice_enabled, proactive_voice=EXCLUDED.proactive_voice,
          alerts_enabled=EXCLUDED.alerts_enabled, help_level=EXCLUDED.help_level, updated_at=(NOW() AT TIME ZONE 'UTC')
        """)
        .params(user, p.memoryEnabled(), p.voiceEnabled(), p.proactiveVoice(), p.alertsEnabled(), p.helpLevel())
        .update();
  }

  // ------------------------------------------------------------------ conversations

  public record Conversation(UUID id, String title, Map<String, Object> state, Instant createdAt, Instant updatedAt) {}

  public Optional<Conversation> conversation(UUID user, UUID id) {
    return jdbc.sql("SELECT id, title, state::text, created_at, updated_at FROM echo_conversations "
            + "WHERE id=? AND user_id=?")
        .params(id, user)
        .query((rs, i) -> conversationRow(rs)).optional();
  }

  private Conversation conversationRow(ResultSet rs) throws SQLException {
    return new Conversation(Db.uuid(rs, "id"), rs.getString("title"), parse(rs.getString(3)),
        Db.instant(rs, "created_at"), Db.instant(rs, "updated_at"));
  }

  public Conversation createConversation(UUID user, String title) {
    UUID id = Db.newId();
    jdbc.sql("INSERT INTO echo_conversations (id, user_id, title) VALUES (?, ?, ?)")
        .params(id, user, title).update();
    // Keep at most 30 conversations per user; oldest are pruned (messages cascade).
    jdbc.sql("""
        DELETE FROM echo_conversations WHERE user_id=? AND id IN (
          SELECT id FROM echo_conversations WHERE user_id=? ORDER BY updated_at DESC, id DESC OFFSET 30)
        """).params(user, user).update();
    return conversation(user, id).orElseThrow();
  }

  public void updateState(UUID user, UUID id, Map<String, Object> state) {
    jdbc.sql("UPDATE echo_conversations SET state=?::jsonb, updated_at=(NOW() AT TIME ZONE 'UTC') WHERE id=? AND user_id=?")
        .params(json(state), id, user).update();
  }

  public List<Map<String, Object>> conversations(UUID user) {
    return jdbc.sql("""
        SELECT c.id, c.title, c.created_at, c.updated_at,
          (SELECT COUNT(*) FROM echo_messages m WHERE m.conversation_id=c.id)::int AS messages
        FROM echo_conversations c WHERE c.user_id=? ORDER BY c.updated_at DESC, c.id DESC LIMIT 30
        """)
        .param(user)
        .query((rs, i) -> {
          Map<String, Object> m = new LinkedHashMap<>();
          m.put("id", rs.getObject("id").toString());
          m.put("title", rs.getString("title"));
          m.put("createdAt", Db.iso(Db.instant(rs, "created_at")));
          m.put("updatedAt", Db.iso(Db.instant(rs, "updated_at")));
          m.put("messages", rs.getInt("messages"));
          return m;
        }).list();
  }

  public boolean deleteConversation(UUID user, UUID id) {
    return jdbc.sql("DELETE FROM echo_conversations WHERE id=? AND user_id=?").params(id, user).update() > 0;
  }

  public int deleteAllConversations(UUID user) {
    return jdbc.sql("DELETE FROM echo_conversations WHERE user_id=?").param(user).update();
  }

  public void addMessage(UUID user, UUID conversation, String role, String content, String intent,
      Map<String, Object> payload) {
    String text = content.length() > 8000 ? content.substring(0, 8000) : content;
    jdbc.sql("INSERT INTO echo_messages (id, conversation_id, user_id, role, content, intent, payload) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)")
        .params(Db.newId(), conversation, user, role, text, intent, payload == null ? null : json(payload))
        .update();
  }

  public List<Map<String, Object>> messages(UUID user, UUID conversation, int limit) {
    List<Map<String, Object>> rows = jdbc.sql("""
        SELECT role, content, intent, payload::text, created_at FROM echo_messages
        WHERE conversation_id=? AND user_id=? ORDER BY created_at DESC, id DESC LIMIT ?
        """)
        .params(conversation, user, limit)
        .query((rs, i) -> {
          Map<String, Object> m = new LinkedHashMap<>();
          m.put("role", rs.getString(1));
          m.put("content", rs.getString(2));
          m.put("intent", rs.getString(3));
          m.put("payload", rs.getString(4) == null ? null : parse(rs.getString(4)));
          m.put("createdAt", Db.iso(Db.instant(rs, "created_at")));
          return m;
        }).list();
    java.util.Collections.reverse(rows);
    return rows;
  }

  // ------------------------------------------------------------------ decisions

  public record NewDecision(UUID portfolioId, String symbol, String side, Double quantity, String intent,
      String intentNote, String hypothesis, Map<String, Object> snapshot) {}

  public UUID insertDecision(UUID user, NewDecision d) {
    UUID id = Db.newId();
    jdbc.sql("""
        INSERT INTO echo_decisions (id, user_id, portfolio_id, symbol, side, quantity, intent, intent_note,
          hypothesis, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
        """)
        .params(id, user, d.portfolioId(), d.symbol(), d.side(), d.quantity(), d.intent(), d.intentNote(),
            d.hypothesis(), json(d.snapshot()))
        .update();
    // Bounded retention: keep the 200 most recent decisions.
    jdbc.sql("""
        DELETE FROM echo_decisions WHERE user_id=? AND id IN (
          SELECT id FROM echo_decisions WHERE user_id=? ORDER BY created_at DESC, id DESC OFFSET 200)
        """).params(user, user).update();
    return id;
  }

  private Map<String, Object> decisionRow(ResultSet rs) throws SQLException {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", rs.getObject("id").toString());
    Object pid = rs.getObject("portfolio_id");
    m.put("portfolioId", pid == null ? null : pid.toString());
    m.put("symbol", rs.getString("symbol"));
    m.put("side", rs.getString("side"));
    java.math.BigDecimal q = rs.getBigDecimal("quantity");
    m.put("quantity", q == null ? null : q.doubleValue());
    m.put("intent", rs.getString("intent"));
    m.put("intentNote", rs.getString("intent_note"));
    m.put("hypothesis", rs.getString("hypothesis"));
    m.put("snapshot", parse(rs.getString("snapshot")));
    m.put("status", rs.getString("status"));
    m.put("observation", rs.getString("observation"));
    String review = rs.getString("review");
    m.put("review", review == null ? null : parse(review));
    m.put("createdAt", Db.iso(Db.instant(rs, "created_at")));
    m.put("updatedAt", Db.iso(Db.instant(rs, "updated_at")));
    return m;
  }

  private static final String DECISION_COLUMNS = "id, portfolio_id, symbol, side, quantity, intent, intent_note, "
      + "hypothesis, snapshot::text AS snapshot, status, observation, review::text AS review, created_at, updated_at";

  public List<Map<String, Object>> decisions(UUID user, int limit) {
    return jdbc.sql("SELECT " + DECISION_COLUMNS + " FROM echo_decisions WHERE user_id=? "
            + "ORDER BY created_at DESC, id DESC LIMIT ?")
        .params(user, limit).query((rs, i) -> decisionRow(rs)).list();
  }

  public Optional<Map<String, Object>> decision(UUID user, UUID id) {
    return jdbc.sql("SELECT " + DECISION_COLUMNS + " FROM echo_decisions WHERE id=? AND user_id=?")
        .params(id, user).query((rs, i) -> decisionRow(rs)).optional();
  }

  public boolean updateDecision(UUID user, UUID id, String intent, String intentNote, String hypothesis,
      String observation) {
    return jdbc.sql("""
        UPDATE echo_decisions SET intent=COALESCE(?, intent), intent_note=COALESCE(?, intent_note),
          hypothesis=COALESCE(?, hypothesis), observation=COALESCE(?, observation), updated_at=(NOW() AT TIME ZONE 'UTC')
        WHERE id=? AND user_id=?
        """).params(intent, intentNote, hypothesis, observation, id, user).update() > 0;
  }

  public void saveReview(UUID user, UUID id, Map<String, Object> review) {
    jdbc.sql("UPDATE echo_decisions SET review=?::jsonb, status='REVIEWED', updated_at=(NOW() AT TIME ZONE 'UTC') WHERE id=? AND user_id=?")
        .params(json(review), id, user).update();
  }

  public boolean deleteDecision(UUID user, UUID id) {
    return jdbc.sql("DELETE FROM echo_decisions WHERE id=? AND user_id=?").params(id, user).update() > 0;
  }

  public int deleteAllDecisions(UUID user) {
    return jdbc.sql("DELETE FROM echo_decisions WHERE user_id=?").param(user).update();
  }

  // ------------------------------------------------------------------ alerts

  public record AlertCandidate(String fingerprint, String code, String severity, String title, String message,
      Map<String, Object> evidence, Map<String, Object> action) {}

  /** Fingerprints the user dismissed or that resolved within the cooldown window: not re-raised. */
  public List<String> recentlyClosedFingerprints(UUID user, Instant since) {
    return jdbc.sql("SELECT DISTINCT fingerprint FROM echo_alerts WHERE user_id=? AND status IN ('DISMISSED','RESOLVED') "
            + "AND COALESCE(resolved_at, last_seen_at) >= ?")
        .params(user, Db.ts(since)).query(String.class).list();
  }

  public List<String> activeFingerprints(UUID user) {
    return jdbc.sql("SELECT fingerprint FROM echo_alerts WHERE user_id=? AND status='ACTIVE'")
        .param(user).query(String.class).list();
  }

  /** Inserts or refreshes: the partial unique index guarantees one ACTIVE alert per fingerprint. */
  public boolean upsertActive(UUID user, AlertCandidate a) {
    int touched = jdbc.sql("UPDATE echo_alerts SET last_seen_at=(NOW() AT TIME ZONE 'UTC'), evidence=?::jsonb "
            + "WHERE user_id=? AND fingerprint=? AND status='ACTIVE'")
        .params(json(a.evidence()), user, a.fingerprint()).update();
    if (touched > 0) return false;
    return jdbc.sql("""
        INSERT INTO echo_alerts (id, user_id, fingerprint, code, severity, title, message, evidence, action)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb) ON CONFLICT DO NOTHING
        """)
        .params(Db.newId(), user, a.fingerprint(), a.code(), a.severity(), a.title(), a.message(),
            json(a.evidence()), a.action() == null ? null : json(a.action()))
        .update() > 0;
  }

  /** Resolves every ACTIVE alert whose condition no longer holds (hysteresis is applied by the caller). */
  public int resolveMissing(UUID user, List<String> stillActive) {
    java.util.Set<String> keep = new java.util.HashSet<>(stillActive);
    int resolved = 0;
    for (String fp : activeFingerprints(user)) {
      if (keep.contains(fp)) continue;
      resolved += jdbc.sql("UPDATE echo_alerts SET status='RESOLVED', resolved_at=(NOW() AT TIME ZONE 'UTC') "
              + "WHERE user_id=? AND status='ACTIVE' AND fingerprint=?")
          .params(user, fp).update();
    }
    return resolved;
  }

  public List<Map<String, Object>> alerts(UUID user, boolean activeOnly, int limit) {
    return jdbc.sql("SELECT id, code, severity, title, message, evidence::text, action::text, status, read_at, "
            + "created_at, last_seen_at FROM echo_alerts WHERE user_id=? "
            + (activeOnly ? "AND status='ACTIVE' " : "")
            + "ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, created_at DESC LIMIT ?")
        .params(user, limit)
        .query((rs, i) -> {
          Map<String, Object> m = new LinkedHashMap<>();
          m.put("id", rs.getObject("id").toString());
          m.put("code", rs.getString("code"));
          m.put("severity", rs.getString("severity"));
          m.put("title", rs.getString("title"));
          m.put("message", rs.getString("message"));
          m.put("evidence", parse(rs.getString(6)));
          m.put("action", rs.getString(7) == null ? null : parse(rs.getString(7)));
          m.put("status", rs.getString("status"));
          m.put("read", rs.getTimestamp("read_at") != null);
          m.put("createdAt", Db.iso(Db.instant(rs, "created_at")));
          m.put("lastSeenAt", Db.iso(Db.instant(rs, "last_seen_at")));
          return m;
        }).list();
  }

  public boolean markRead(UUID user, UUID id) {
    return jdbc.sql("UPDATE echo_alerts SET read_at=COALESCE(read_at, (NOW() AT TIME ZONE 'UTC')) WHERE id=? AND user_id=?")
        .params(id, user).update() > 0;
  }

  public boolean dismiss(UUID user, UUID id) {
    return jdbc.sql("UPDATE echo_alerts SET status='DISMISSED', resolved_at=(NOW() AT TIME ZONE 'UTC'), read_at=COALESCE(read_at, (NOW() AT TIME ZONE 'UTC')) "
            + "WHERE id=? AND user_id=? AND status='ACTIVE'")
        .params(id, user).update() > 0;
  }
}
