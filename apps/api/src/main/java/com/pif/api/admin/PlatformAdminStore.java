package com.pif.api.admin;

import jakarta.annotation.PostConstruct;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Administrator-managed pedagogical content and feature flags.
 * When {@link PlatformAdminRepository#schemaReady()} is true, PostgreSQL is the source of truth:
 * every mutation is written to the database before the in-memory cache is updated, and startup
 * reloads the durable state. Without the tables, mutations stay in-memory only (unit tests).
 */
@Component
public class PlatformAdminStore {

  private static final Logger log = LoggerFactory.getLogger(PlatformAdminStore.class);

  public static final String FLAG_MISSION_PREFIX = "mission:";
  public static final String FLAG_AI_PREFIX = "ai:";
  public static final String FLAG_STRESS_PREFIX = "stress:";
  public static final String FLAG_SIM = "sim:params";
  public static final String DISABLED = "DISABLED";
  public static final String ENABLED = "ENABLED";

  private final ConcurrentHashMap<String, String> flags = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Map<String, Object>> newsById = new ConcurrentHashMap<>();
  private final PlatformAdminRepository repository;

  @Autowired
  public PlatformAdminStore(@Autowired(required = false) PlatformAdminRepository repository) {
    this.repository = repository;
  }

  @PostConstruct
  public void loadFromDatabase() {
    reload();
  }

  /** Pool may not be ready during @PostConstruct; reload once the context is up. */
  @EventListener(ApplicationReadyEvent.class)
  public void onApplicationReady() {
    if (repository != null) repository.resetSchemaProbe();
    reload();
  }

  /** Clears memory and reloads from PostgreSQL when the schema is ready. */
  public synchronized void reload() {
    flags.clear();
    newsById.clear();
    if (repository == null || !repository.schemaReady()) {
      log.info("Platform admin store: in-memory only (tables not ready).");
      return;
    }
    flags.putAll(repository.loadFlags());
    for (Map<String, Object> item : repository.loadNews()) {
      newsById.put(String.valueOf(item.get("id")), new LinkedHashMap<>(item));
    }
    log.info("Platform admin store reloaded: {} flags, {} news items.", flags.size(), newsById.size());
  }

  public boolean durable() {
    return repository != null && repository.schemaReady();
  }

  public Map<String, String> flagsSnapshot() {
    return Map.copyOf(flags);
  }

  public Optional<String> flag(String key) {
    return Optional.ofNullable(flags.get(key));
  }

  public boolean isDisabled(String key) {
    return DISABLED.equals(flags.get(key));
  }

  public void setFlag(String key, String value) {
    requireDurableIfBound();
    if (value == null || value.isBlank()) {
      if (durable()) repository.deleteFlag(key);
      flags.remove(key);
      return;
    }
    if (durable()) repository.upsertFlag(key, value);
    flags.put(key, value);
  }

  public void putNews(Map<String, Object> item) {
    requireDurableIfBound();
    Map<String, Object> copy = new LinkedHashMap<>(item);
    if (durable()) repository.upsertNews(copy);
    newsById.put(String.valueOf(copy.get("id")), copy);
  }

  public boolean removeNews(String id) {
    requireDurableIfBound();
    if (durable()) {
      boolean deleted = repository.deleteNews(id);
      newsById.remove(id);
      return deleted;
    }
    return newsById.remove(id) != null;
  }

  /** When a repository is wired, durable tables are mandatory for mutations. */
  private void requireDurableIfBound() {
    if (repository != null && !repository.schemaReady()) {
      throw new IllegalStateException(
          "platform_admin tables missing; apply migration 20261119220000_platform_admin_content on the isolated database.");
    }
  }

  public Optional<Map<String, Object>> news(String id) {
    Map<String, Object> item = newsById.get(id);
    return item == null ? Optional.empty() : Optional.of(new LinkedHashMap<>(item));
  }

  public List<Map<String, Object>> newsItems() {
    List<Map<String, Object>> items = new ArrayList<>();
    for (Map<String, Object> item : newsById.values()) {
      items.add(new LinkedHashMap<>(item));
    }
    items.sort(Comparator.comparing((Map<String, Object> m) -> String.valueOf(m.get("publishedAt"))).reversed());
    return items;
  }

  public Map<String, Object> simulationParams() {
    String raw = flags.get(FLAG_SIM);
    if (raw == null || raw.isBlank()) {
      return defaultSimParams();
    }
    try {
      Map<String, Object> out = defaultSimParams();
      for (String part : raw.split(";")) {
        int eq = part.indexOf('=');
        if (eq <= 0) continue;
        String k = part.substring(0, eq).trim();
        String v = part.substring(eq + 1).trim();
        if ("newsPaused".equals(k)) out.put(k, Boolean.parseBoolean(v));
        else if ("depthScalePct".equals(k)) out.put(k, Integer.parseInt(v));
        else out.put(k, v);
      }
      return out;
    } catch (RuntimeException e) {
      return defaultSimParams();
    }
  }

  public void setSimulationParams(boolean newsPaused, int depthScalePct) {
    int clamped = Math.max(25, Math.min(200, depthScalePct));
    setFlag(FLAG_SIM, "newsPaused=" + newsPaused + ";depthScalePct=" + clamped);
  }

  public static Map<String, Object> defaultSimParams() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("newsPaused", false);
    m.put("depthScalePct", 100);
    m.put("updatedAt", null);
    return m;
  }

  public static Map<String, Object> newsItem(String id, String title, String summary, String symbol, String sector,
      Instant publishedAt) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", id);
    m.put("title", title);
    m.put("summary", summary);
    m.put("symbol", symbol);
    m.put("sector", sector == null || sector.isBlank() ? "Macro" : sector);
    m.put("publishedAt", publishedAt.toString());
    m.put("provenance", "SYNTHETIC_PEDAGOGICAL");
    m.put("originalUrl", null);
    m.put("fetchedAt", Instant.now().toString());
    m.put("availability", "AVAILABLE");
    m.put("adminManaged", true);
    m.put("language", "fr");
    return m;
  }
}