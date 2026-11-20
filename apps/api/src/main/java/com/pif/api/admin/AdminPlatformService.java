package com.pif.api.admin;

import com.pif.api.ai.AiService;
import com.pif.api.audit.AuditService;
import com.pif.api.challenges.ChallengeService;
import com.pif.api.data.Db;
import com.pif.api.learning.engine.MissionCatalog;
import com.pif.api.market.FictionalUniverse;
import com.pif.api.market.MarketDataWarehouseRepository;
import com.pif.api.market.NewsService;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.security.AuthUser;
import com.pif.api.stress.StressService;
import com.pif.api.trading.TradingRepository;
import com.pif.api.trading.TradingRepository.InstrumentRow;
import com.pif.api.web.ApiException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Platform administration: catalogues plus real write operations (instrument halt, pedagogical news,
 * mission/AI/stress flags, simulation parameters, challenge creation). Writes are audited.
 */
@Service
public class AdminPlatformService {

  private final AiService ai;
  private final StressService stress;
  private final ChallengeService challenges;
  private final PlatformAdminStore store;
  private final AuditService audit;
  private final NewsService news;
  private final TradingRepository trading;
  private final JdbcClient jdbc;
  private final MarketDataWarehouseRepository warehouse;

  @Autowired
  public AdminPlatformService(AiService ai, StressService stress, ChallengeService challenges,
      PlatformAdminStore store, AuditService audit, NewsService news,
      @Autowired(required = false) TradingRepository trading,
      @Autowired(required = false) JdbcClient jdbc,
      @Autowired(required = false) MarketDataWarehouseRepository warehouse) {
    this.ai = ai;
    this.stress = stress;
    this.challenges = challenges;
    this.store = store;
    this.audit = audit;
    this.news = news;
    this.trading = trading;
    this.jdbc = jdbc;
    this.warehouse = warehouse;
  }

  /** Unit-test constructor without JDBC/trading. */
  AdminPlatformService(AiService ai, StressService stress, ChallengeService challenges, PlatformAdminStore store,
      AuditService audit, NewsService news) {
    this(ai, stress, challenges, store, audit, news, null, null, null);
  }

  private static void assertAdmin(AuthUser actor) {
    if (!"ADMIN".equals(actor.user().role()) || !"ACTIVE".equals(actor.user().status())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN",
          com.pif.api.web.Messages.get("forbidden.admin_required"));
    }
  }

  private void audit(AuthUser actor, String type, Map<String, Object> context) {
    audit.record(new AuditService.Event(type, "SUCCESS", actor.user().id(), null, null, context));
  }

  private static void wrapPersist(Runnable action) {
    try {
      action.run();
    } catch (IllegalStateException e) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DATABASE_SCHEMA_OUTDATED",
          com.pif.api.web.Messages.get("global.schema_outdated"));
    }
  }

  private static boolean wrapPersistBool(java.util.function.BooleanSupplier action) {
    try {
      return action.getAsBoolean();
    } catch (IllegalStateException e) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DATABASE_SCHEMA_OUTDATED",
          com.pif.api.web.Messages.get("global.schema_outdated"));
    }
  }

  public Map<String, Object> supervision(AuthUser actor) {
    assertAdmin(actor);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("title", "Supervision de la plateforme");
    body.put("modules", List.of(
        Map.of("id", "users", "label", "Utilisateurs et audit", "status", "LIVE_WRITES"),
        Map.of("id", "markets", "label", "Instruments et provenance", "status", "LIVE_WRITES"),
        Map.of("id", "learning", "label", "Missions pedagogiques", "status", "LIVE_WRITES"),
        Map.of("id", "ai", "label", "Modeles IA", "status", "LIVE_WRITES"),
        Map.of("id", "stress", "label", "Scenarios bancaires", "status", "LIVE_WRITES"),
        Map.of("id", "challenges", "label", "Defis virtuels", "status", "LIVE_WRITES"),
        Map.of("id", "news", "label", "Fil d'actualites (RSS reel + pedagogique)", "status", "LIVE_WRITES"),
        Map.of("id", "warehouse", "label", "Warehouse donnees de marche", "status", "LIVE"),
        Map.of("id", "sim", "label", "Parametres de simulation", "status", "LIVE_WRITES"),
        Map.of("id", "actuarial", "label", "Actuariat (parametres autorises)", "status", "LIVE")));
    body.put("note",
        "Supervision avec ecritures admin sur instruments, actualites, drapeaux pedagogiques, "
            + "parametres de simulation et defis. Comptes utilisateurs: /admin/users.");
    body.put("stats", globalStats());
    body.put("simulation", store.simulationParams());
    if (warehouse != null && warehouse.tablesPresent()) {
      body.put("marketWarehouse", warehouse.coverageSummary());
    }
    return body;
  }

  private Map<String, Object> globalStats() {
    Map<String, Object> stats = new LinkedHashMap<>();
    stats.put("adminNews", store.newsItems().size());
    stats.put("disabledFlags", store.flagsSnapshot().values().stream().filter(PlatformAdminStore.DISABLED::equals).count());
    if (jdbc == null) {
      stats.put("persistence", "IN_MEMORY");
      return stats;
    }
    try {
      stats.put("users", jdbc.sql("SELECT COUNT(*) FROM users").query(Long.class).single());
      stats.put("learningSessions", jdbc.sql("SELECT COUNT(*) FROM learning_sessions").query(Long.class).single());
      stats.put("portfolios", jdbc.sql("SELECT COUNT(*) FROM trading_portfolios").query(Long.class).single());
      stats.put("realInstruments",
          jdbc.sql("SELECT COUNT(*) FROM instruments WHERE fictional = false").query(Long.class).single());
      stats.put("persistence", "POSTGRESQL");
    } catch (DataAccessException e) {
      stats.put("persistence", "PARTIAL");
      stats.put("persistenceNote", "Certaines tables de statistiques sont indisponibles.");
    }
    return stats;
  }

  public Map<String, Object> markets(AuthUser actor) {
    assertAdmin(actor);
    List<Map<String, Object>> instruments = new ArrayList<>();
    if (trading != null) {
      try {
        for (InstrumentRow i : trading.instruments()) {
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("symbol", i.symbol());
          row.put("name", i.name());
          row.put("sector", i.sector());
          row.put("assetClass", i.assetClass());
          row.put("status", i.status());
          row.put("lotSize", i.lotSize());
          row.put("currency", i.quoteCurrency());
          row.put("providerId", i.providerId());
          row.put("fictional", i.fictional());
          row.put("provenance", i.fictional() ? "FICTIONAL" : "HISTORICAL");
          instruments.add(row);
        }
      } catch (DataAccessException e) {
        // fall through to fictional catalog
      }
    }
    if (instruments.isEmpty()) {
      FictionalUniverse.INSTRUMENTS.forEach((symbol, inst) -> {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("symbol", symbol);
        row.put("name", inst.name());
        row.put("sector", inst.sector());
        row.put("initialPrice", inst.initialPrice());
        row.put("status", "ACTIVE");
        row.put("provenance", SimulatedMarketProvider.SIMULATED_PROVENANCE.kind());
        instruments.add(row);
      });
    }
    long historicalCount = instruments.stream().filter(r -> Boolean.FALSE.equals(r.get("fictional"))).count();
    long fictionalCount = instruments.size() - historicalCount;
    // Admin table: all fictional (halt/resume) + sample of historical; full catalog is /market/instruments.
    List<Map<String, Object>> listed = new ArrayList<>();
    int histSample = 0;
    for (Map<String, Object> row : instruments) {
      if (!Boolean.FALSE.equals(row.get("fictional"))) {
        listed.add(row);
      } else if (histSample < 40) {
        listed.add(row);
        histSample++;
      }
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("instruments", listed);
    body.put("instrumentCount", instruments.size());
    body.put("fictionalCount", fictionalCount);
    body.put("historicalCount", historicalCount);
    body.put("instrumentsListed", listed.size());
    body.put("writable", trading != null);
    body.put("actions", List.of("HALT", "RESUME"));
    body.put("description",
        "Instruments fictifs (simulateur) et historiques (warehouse CMF/Yahoo). "
            + "Les indices sont consultables mais non négociables. "
            + "Catalogue complet via le module Marchés.");
    if (warehouse != null && warehouse.tablesPresent()) {
      body.put("warehouse", warehouse.coverageSummary());
      if (jdbc != null) {
        try {
          body.put("importBatches", jdbc.sql("""
              SELECT id::text AS id, source_id, status, rows_read, rows_inserted, rows_updated, rows_rejected,
                     started_at, finished_at
              FROM market_import_batches ORDER BY started_at DESC LIMIT 20
              """).query((rs, n) -> {
                Map<String, Object> b = new LinkedHashMap<>();
                b.put("id", rs.getString("id"));
                b.put("sourceId", rs.getString("source_id"));
                b.put("status", rs.getString("status"));
                b.put("rowsRead", rs.getObject("rows_read"));
                b.put("rowsInserted", rs.getObject("rows_inserted"));
                b.put("rowsUpdated", rs.getObject("rows_updated"));
                b.put("rowsRejected", rs.getObject("rows_rejected"));
                b.put("startedAt", rs.getTimestamp("started_at") == null ? null
                    : rs.getTimestamp("started_at").toInstant().toString());
                b.put("finishedAt", rs.getTimestamp("finished_at") == null ? null
                    : rs.getTimestamp("finished_at").toInstant().toString());
                return b;
              }).list());
          body.put("sources", jdbc.sql("""
              SELECT id, name, kind, market, license_note, homepage_url FROM market_data_sources ORDER BY id
              """).query((rs, n) -> {
                Map<String, Object> s = new LinkedHashMap<>();
                s.put("id", rs.getString("id"));
                s.put("name", rs.getString("name"));
                s.put("kind", rs.getString("kind"));
                s.put("market", rs.getString("market"));
                s.put("licenseNotes", rs.getString("license_note"));
                s.put("homepageUrl", rs.getString("homepage_url"));
                return s;
              }).list());
        } catch (DataAccessException e) {
          body.put("importBatches", List.of());
        }
      }
    }
    return body;
  }

  public Map<String, Object> setInstrumentStatus(AuthUser actor, String symbol, String status) {
    assertAdmin(actor);
    if (symbol == null || symbol.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Symbole requis.");
    }
    if (!"ACTIVE".equals(status) && !"HALTED".equals(status)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Statut invalide (ACTIVE ou HALTED).");
    }
    if (trading == null) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TRADING_UNAVAILABLE",
          "Le referentiel d'instruments n'est pas disponible.");
    }
    int updated;
    try {
      updated = trading.updateInstrumentStatus(symbol.trim().toUpperCase(), status);
    } catch (DataAccessException e) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DATABASE_SCHEMA_OUTDATED",
          com.pif.api.web.Messages.get("global.schema_outdated"));
    }
    if (updated == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "INSTRUMENT_NOT_FOUND", "Instrument introuvable.");
    }
    audit(actor, "ADMIN_INSTRUMENT_STATUS", Map.of("symbol", symbol.trim().toUpperCase(), "status", status));
    return Map.of("symbol", symbol.trim().toUpperCase(), "status", status, "updated", true);
  }

  public Map<String, Object> learning(AuthUser actor) {
    assertAdmin(actor);
    List<Map<String, Object>> missions = MissionCatalog.MISSIONS.stream().map(m -> {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("slug", m.slug());
      row.put("title", m.title());
      row.put("level", m.level());
      String availability = m.availability();
      boolean disabled = store.isDisabled(PlatformAdminStore.FLAG_MISSION_PREFIX + m.slug());
      row.put("availability", availability);
      row.put("adminDisabled", disabled);
      row.put("effectiveAvailability", disabled ? "DISABLED_BY_ADMIN" : availability);
      row.put("order", m.order());
      return row;
    }).toList();
    long implemented = missions.stream().filter(m -> "IMPLEMENTED".equals(m.get("availability"))).count();
    long configured = missions.stream().filter(m -> "CONFIGURED".equals(m.get("availability"))).count();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("missions", missions);
    body.put("stats", Map.of("total", missions.size(), "implemented", implemented, "configured", configured,
        "adminDisabled", missions.stream().filter(m -> Boolean.TRUE.equals(m.get("adminDisabled"))).count()));
    body.put("progression", learningProgression());
    return body;
  }

  private Map<String, Object> learningProgression() {
    Map<String, Object> prog = new LinkedHashMap<>();
    if (jdbc == null) {
      prog.put("available", false);
      return prog;
    }
    try {
      prog.put("available", true);
      prog.put("sessions", jdbc.sql("SELECT COUNT(*) FROM learning_sessions").query(Long.class).single());
      prog.put("completed", jdbc.sql(
          "SELECT COUNT(*) FROM learning_sessions WHERE status::text = 'COMPLETED'")
          .query(Long.class).single());
    } catch (DataAccessException e) {
      prog.put("available", false);
      prog.put("note", "Tables learning_sessions indisponibles sur cette base.");
    }
    return prog;
  }

  public Map<String, Object> setMissionDisabled(AuthUser actor, String slug, boolean disabled) {
    assertAdmin(actor);
    if (slug == null || slug.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Slug de mission requis.");
    }
    boolean known = MissionCatalog.MISSIONS.stream().anyMatch(m -> m.slug().equals(slug));
    if (!known) {
      throw new ApiException(HttpStatus.NOT_FOUND, "MISSION_NOT_FOUND", "Mission introuvable.");
    }
    String key = PlatformAdminStore.FLAG_MISSION_PREFIX + slug;
    wrapPersist(() -> store.setFlag(key, disabled ? PlatformAdminStore.DISABLED : PlatformAdminStore.ENABLED));
    audit(actor, "ADMIN_MISSION_FLAG", Map.of("slug", slug, "disabled", disabled));
    return Map.of("slug", slug, "adminDisabled", disabled);
  }

  public Map<String, Object> aiModels(AuthUser actor) {
    assertAdmin(actor);
    Map<String, Object> body = new LinkedHashMap<>(ai.overview());
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> models = (List<Map<String, Object>>) body.get("models");
    List<Map<String, Object>> enriched = new ArrayList<>();
    if (models != null) {
      for (Map<String, Object> m : models) {
        Map<String, Object> row = new LinkedHashMap<>(m);
        String id = String.valueOf(m.get("id"));
        row.put("adminDisabled", store.isDisabled(PlatformAdminStore.FLAG_AI_PREFIX + id));
        enriched.add(row);
      }
    }
    body.put("models", enriched);
    return body;
  }

  public Map<String, Object> setAiModelDisabled(AuthUser actor, String modelId, boolean disabled) {
    assertAdmin(actor);
    if (modelId == null || modelId.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Identifiant de modele requis.");
    }
    wrapPersist(() -> store.setFlag(PlatformAdminStore.FLAG_AI_PREFIX + modelId,
        disabled ? PlatformAdminStore.DISABLED : PlatformAdminStore.ENABLED));
    audit(actor, "ADMIN_AI_MODEL_FLAG", Map.of("modelId", modelId, "disabled", disabled));
    return Map.of("modelId", modelId, "adminDisabled", disabled);
  }

  public Map<String, Object> stressCatalog(AuthUser actor) {
    assertAdmin(actor);
    Map<String, Object> body = new LinkedHashMap<>(stress.catalog());
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> presets = (List<Map<String, Object>>) body.get("presets");
    if (presets != null) {
      List<Map<String, Object>> enriched = new ArrayList<>();
      for (Map<String, Object> p : presets) {
        Map<String, Object> row = new LinkedHashMap<>(p);
        String id = String.valueOf(p.get("id"));
        row.put("adminDisabled", store.isDisabled(PlatformAdminStore.FLAG_STRESS_PREFIX + id));
        enriched.add(row);
      }
      body.put("presets", enriched);
    }
    return body;
  }

  public Map<String, Object> setStressPresetDisabled(AuthUser actor, String presetId, boolean disabled) {
    assertAdmin(actor);
    if (presetId == null || presetId.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Identifiant de scenario requis.");
    }
    wrapPersist(() -> store.setFlag(PlatformAdminStore.FLAG_STRESS_PREFIX + presetId,
        disabled ? PlatformAdminStore.DISABLED : PlatformAdminStore.ENABLED));
    audit(actor, "ADMIN_STRESS_PRESET_FLAG", Map.of("presetId", presetId, "disabled", disabled));
    return Map.of("presetId", presetId, "adminDisabled", disabled);
  }

  public Map<String, Object> challengeStats(AuthUser actor) {
    assertAdmin(actor);
    return challenges.list();
  }

  public Map<String, Object> createChallenge(AuthUser actor, String title, String description, Double capital) {
    assertAdmin(actor);
    Map<String, Object> created = challenges.create(actor, title, description, capital);
    audit(actor, "ADMIN_CHALLENGE_CREATE", Map.of("id", created.get("id"), "title", created.get("title")));
    return created;
  }

  public Map<String, Object> news(AuthUser actor) {
    assertAdmin(actor);
    return news.feed();
  }

  public Map<String, Object> publishNews(AuthUser actor, String title, String summary, String symbol, String sector) {
    assertAdmin(actor);
    if (title == null || title.trim().length() < 8 || title.trim().length() > 160) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Titre invalide (8 a 160 caracteres).");
    }
    String id = "admin-news-" + UUID.randomUUID().toString().substring(0, 8);
    Instant at = Db.now();
    Map<String, Object> item = PlatformAdminStore.newsItem(id, title.trim(),
        summary == null || summary.isBlank()
            ? "Actualite pedagogique publiee par l'administration."
            : summary.trim(),
        symbol == null || symbol.isBlank() ? null : symbol.trim().toUpperCase(),
        sector, at);
    wrapPersist(() -> store.putNews(item));
    audit(actor, "ADMIN_NEWS_PUBLISH", Map.of("id", id, "title", title.trim()));
    return item;
  }

  public Map<String, Object> deleteNews(AuthUser actor, String id) {
    assertAdmin(actor);
    if (id == null || !id.startsWith("admin-news-")) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
          "Seules les actualites publiees par l'administration peuvent etre retirees.");
    }
    boolean deleted = wrapPersistBool(() -> store.removeNews(id));
    if (!deleted) {
      throw new ApiException(HttpStatus.NOT_FOUND, "NEWS_NOT_FOUND", "Actualite introuvable.");
    }
    audit(actor, "ADMIN_NEWS_DELETE", Map.of("id", id));
    return Map.of("id", id, "deleted", true);
  }

  public Map<String, Object> simulationParams(AuthUser actor) {
    assertAdmin(actor);
    Map<String, Object> body = new LinkedHashMap<>(store.simulationParams());
    body.put("note",
        "Parametres pedagogiques du simulateur. depthScalePct ajuste la profondeur affichee ; "
            + "newsPaused coupe le fil d'actualites.");
    return body;
  }

  public Map<String, Object> updateSimulationParams(AuthUser actor, Boolean newsPaused, Integer depthScalePct) {
    assertAdmin(actor);
    Map<String, Object> current = store.simulationParams();
    boolean paused = newsPaused != null ? newsPaused : Boolean.TRUE.equals(current.get("newsPaused"));
    int depth = depthScalePct != null ? depthScalePct
        : ((Number) current.getOrDefault("depthScalePct", 100)).intValue();
    wrapPersist(() -> store.setSimulationParams(paused, depth));
    Map<String, Object> updated = store.simulationParams();
    updated.put("updatedAt", Db.now().toString());
    audit(actor, "ADMIN_SIM_PARAMS", Map.of("newsPaused", paused, "depthScalePct", depth));
    return updated;
  }

  public Map<String, Object> actuarial(AuthUser actor) {
    assertAdmin(actor);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("title", "Supervision actuarielle");
    body.put("modules", List.of(
        Map.of("id", "pricing", "label", "Tarification frequence / severite", "status", "LIVE"),
        Map.of("id", "aggregate", "label", "Pertes agregées Panjer / Monte-Carlo", "status", "LIVE"),
        Map.of("id", "reserving", "label", "Provisionnement Chain-Ladder / BF / IBNR", "status", "LIVE"),
        Map.of("id", "capital-alm", "label", "Capital economique / ALM", "status", "LIVE")));
    body.put("note",
        "Tarification, provisionnement, capital economique et ALM sont operationnels sur ce serveur "
            + "(perimetre pedagogique, non reglementaire).");
    return body;
  }

  /** Used by AI/stress consumers to honour admin disable flags. */
  public boolean isAiModelDisabled(String modelId) {
    return store.isDisabled(PlatformAdminStore.FLAG_AI_PREFIX + modelId);
  }

  public boolean isStressPresetDisabled(String presetId) {
    return store.isDisabled(PlatformAdminStore.FLAG_STRESS_PREFIX + presetId);
  }

  public boolean isMissionDisabled(String slug) {
    return store.isDisabled(PlatformAdminStore.FLAG_MISSION_PREFIX + slug);
  }
}