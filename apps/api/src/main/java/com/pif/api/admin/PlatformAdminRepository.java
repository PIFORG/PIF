package com.pif.api.admin;

import com.pif.api.data.Db;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/**
 * JDBC persistence for administrator flags and pedagogical news. Tables are optional until the
 * isolated migration is applied; callers must treat {@link #schemaReady()} as the gate for durable writes.
 */
@Repository
public class PlatformAdminRepository {

  private static final Logger log = LoggerFactory.getLogger(PlatformAdminRepository.class);

  private final JdbcClient jdbc;
  private final ObjectMapper mapper;
  private volatile Boolean ready;

  public PlatformAdminRepository(JdbcClient jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  public boolean schemaReady() {
    Boolean cached = ready;
    // Only cache positive readiness. A transient failure before the pool is up must not
    // permanently disable durable admin writes for the lifetime of the JVM.
    if (Boolean.TRUE.equals(cached)) return true;
    try {
      Integer n = jdbc.sql(
          "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' "
              + "AND table_name IN ('platform_admin_flags','platform_news_items')")
          .query(Integer.class).single();
      boolean ok = n != null && n >= 2;
      if (ok) ready = true;
      else ready = false;
      return ok;
    } catch (DataAccessException e) {
      log.debug("platform_admin schema probe deferred: {}", e.getMessage());
      ready = null;
      return false;
    }
  }

  /** Force re-probe after a migration applied in the same JVM (tests). */
  public void resetSchemaProbe() {
    ready = null;
  }

  public Map<String, String> loadFlags() {
    Map<String, String> out = new LinkedHashMap<>();
    if (!schemaReady()) return out;
    jdbc.sql("SELECT key, value FROM platform_admin_flags").query((rs, i) -> {
      out.put(rs.getString("key"), rs.getString("value"));
      return null;
    }).list();
    return out;
  }

  public void upsertFlag(String key, String value) {
    requireReady();
    Instant now = Db.now();
    jdbc.sql("INSERT INTO platform_admin_flags (key, value, updated_at) VALUES (?, ?, ?) "
            + "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at")
        .params(key, value, Timestamp.from(now)).update();
  }

  public void deleteFlag(String key) {
    requireReady();
    jdbc.sql("DELETE FROM platform_admin_flags WHERE key = ?").param(key).update();
  }

  public List<Map<String, Object>> loadNews() {
    List<Map<String, Object>> out = new ArrayList<>();
    if (!schemaReady()) return out;
    jdbc.sql("SELECT payload FROM platform_news_items ORDER BY published_at DESC").query((rs, i) -> {
      try {
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = mapper.readValue(rs.getString("payload"), Map.class);
        out.add(payload);
      } catch (Exception e) {
        log.warn("Skipping corrupt platform_news_items row", e);
      }
      return null;
    }).list();
    return out;
  }

  public void upsertNews(Map<String, Object> item) {
    requireReady();
    try {
      String json = mapper.writeValueAsString(item);
      Instant published = Instant.parse(String.valueOf(item.get("publishedAt")));
      jdbc.sql("INSERT INTO platform_news_items (id, title, summary, symbol, sector, published_at, payload, created_at) "
              + "VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?) "
              + "ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, "
              + "symbol = EXCLUDED.symbol, sector = EXCLUDED.sector, published_at = EXCLUDED.published_at, "
              + "payload = EXCLUDED.payload")
          .params(
              String.valueOf(item.get("id")),
              String.valueOf(item.get("title")),
              String.valueOf(item.get("summary")),
              item.get("symbol") == null ? null : String.valueOf(item.get("symbol")),
              item.get("sector") == null ? null : String.valueOf(item.get("sector")),
              Timestamp.from(published),
              json,
              Timestamp.from(Db.now()))
          .update();
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new IllegalStateException("Failed to persist admin news", e);
    }
  }

  public boolean deleteNews(String id) {
    requireReady();
    return jdbc.sql("DELETE FROM platform_news_items WHERE id = ?").param(id).update() > 0;
  }

  public Optional<Map<String, Object>> findNews(String id) {
    if (!schemaReady()) return Optional.empty();
    return jdbc.sql("SELECT payload FROM platform_news_items WHERE id = ?").param(id)
        .query((rs, i) -> {
          try {
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = mapper.readValue(rs.getString("payload"), Map.class);
            return payload;
          } catch (Exception e) {
            throw new IllegalStateException(e);
          }
        }).optional();
  }

  private void requireReady() {
    if (!schemaReady()) {
      throw new IllegalStateException("platform_admin tables are missing; apply migration 20261119220000_platform_admin_content on the isolated database.");
    }
  }
}