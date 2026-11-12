package com.pif.api.audit;

import com.pif.api.data.Db;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Append-only audit trail (apps/api/src/audit/audit.service.ts). Secret-bearing keys are dropped
 * from the context recursively; a failed insert is logged and never breaks the request.
 */
@Service
public class AuditService {

  private static final Logger log = LoggerFactory.getLogger(AuditService.class);

  private static final Set<String> SENSITIVE_KEYS = Set.of("password", "passwordhash", "token", "refreshtoken",
      "accesstoken", "secret", "mfasecret", "code", "recoverycode", "authorization", "cookie", "pepper",
      "encryptionkey");
  private static final List<String> SENSITIVE_FRAGMENTS = List.of("password", "secret", "token", "hash");

  public record Event(String eventType, String outcome, UUID actorUserId, UUID subjectUserId, String correlationId,
      Map<String, Object> context) {}

  private final JdbcClient jdbc;
  private final ObjectMapper mapper;

  public AuditService(JdbcClient jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  public void record(Event event) {
    try {
      Object context = event.context() == null ? null : sanitize(event.context());
      String correlationId = event.correlationId() != null ? event.correlationId() : MDC.get("correlationId");
      // Prisma.JsonNull: an absent context is stored as the JSON literal null, not SQL NULL.
      String json = context == null ? "null" : mapper.writeValueAsString(context);
      jdbc.sql("INSERT INTO audit_events (id, actor_user_id, subject_user_id, event_type, outcome, correlation_id, "
              + "context, created_at) VALUES (?, ?, ?, ?, ?::\"AuditOutcome\", ?, ?::jsonb, ?)")
          .params(Db.newId(), event.actorUserId(), event.subjectUserId(), event.eventType(), event.outcome(),
              correlationId, json, Db.ts(Db.now()))
          .update();
    } catch (RuntimeException e) {
      log.error("Failed to record audit event {}", event.eventType(), e);
    }
  }

  static Object sanitize(Object value) {
    if (value instanceof Map<?, ?> map) {
      Map<String, Object> out = new LinkedHashMap<>();
      map.forEach((k, v) -> {
        String key = String.valueOf(k);
        if (!isSensitive(key)) out.put(key, sanitize(v));
      });
      return out;
    }
    if (value instanceof List<?> list) {
      List<Object> out = new ArrayList<>();
      list.forEach(v -> out.add(sanitize(v)));
      return out;
    }
    if (value instanceof UUID uuid) return uuid.toString();
    return value;
  }

  private static boolean isSensitive(String key) {
    String lower = key.toLowerCase(java.util.Locale.ROOT);
    if (SENSITIVE_KEYS.contains(lower)) return true;
    return SENSITIVE_FRAGMENTS.stream().anyMatch(lower::contains);
  }
}
