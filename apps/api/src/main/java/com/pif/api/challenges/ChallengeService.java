package com.pif.api.challenges;

import com.pif.api.data.Db;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import jakarta.annotation.PostConstruct;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

/**
 * Virtual trading challenges with fair starting capital and ranking.
 * Persisted to platform_challenges when the admin-content migration is present.
 */
@Service
public class ChallengeService {

  private static final Logger log = LoggerFactory.getLogger(ChallengeService.class);

  public record Challenge(String id, String title, String description, double startingCapital, String createdBy,
      Instant createdAt, boolean open) {}

  public record Entry(String userId, String displayName, Double score, Double finalEquity, Instant joinedAt,
      Instant submittedAt) {}

  private final ConcurrentHashMap<String, Challenge> challenges = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, ConcurrentHashMap<String, Entry>> entries = new ConcurrentHashMap<>();
  private final JdbcClient jdbc;
  private volatile Boolean schemaReady;

  @Autowired
  public ChallengeService(@Autowired(required = false) JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  /** Unit-test constructor. */
  public ChallengeService() {
    this.jdbc = null;
    seedDemoIfEmpty();
  }

  @PostConstruct
  public void init() {
    reload();
    seedDemoIfEmpty();
  }

  @EventListener(ApplicationReadyEvent.class)
  public void onApplicationReady() {
    resetSchemaProbe();
    reload();
    seedDemoIfEmpty();
  }

  public synchronized void reload() {
    challenges.clear();
    entries.clear();
    if (!schemaReady()) {
      log.info("Challenges: in-memory only (platform_challenges missing).");
      return;
    }
    jdbc.sql("SELECT id, title, description, starting_capital, created_by, created_at, open FROM platform_challenges")
        .query((rs, i) -> {
          Challenge c = new Challenge(
              rs.getString("id"),
              rs.getString("title"),
              rs.getString("description"),
              rs.getDouble("starting_capital"),
              rs.getString("created_by"),
              rs.getTimestamp("created_at").toInstant(),
              rs.getBoolean("open"));
          challenges.put(c.id(), c);
          entries.put(c.id(), new ConcurrentHashMap<>());
          return null;
        }).list();
    jdbc.sql("SELECT challenge_id, user_id, display_name, score, final_equity, joined_at, submitted_at "
            + "FROM platform_challenge_entries")
        .query((rs, i) -> {
          String cid = rs.getString("challenge_id");
          ConcurrentHashMap<String, Entry> map = entries.computeIfAbsent(cid, k -> new ConcurrentHashMap<>());
          Double score = (Double) rs.getObject("score");
          Double equity = (Double) rs.getObject("final_equity");
          Timestamp submitted = rs.getTimestamp("submitted_at");
          map.put(rs.getString("user_id"), new Entry(
              rs.getString("user_id"),
              rs.getString("display_name"),
              score,
              equity,
              rs.getTimestamp("joined_at").toInstant(),
              submitted == null ? null : submitted.toInstant()));
          return null;
        }).list();
    log.info("Challenges reloaded: {} challenges.", challenges.size());
  }

  public boolean durable() {
    return schemaReady();
  }

  private boolean schemaReady() {
    if (jdbc == null) return false;
    Boolean cached = schemaReady;
    if (Boolean.TRUE.equals(cached)) return true;
    try {
      Integer n = jdbc.sql(
          "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' "
              + "AND table_name = 'platform_challenges'")
          .query(Integer.class).single();
      boolean ok = n != null && n == 1;
      schemaReady = ok ? true : false;
      return ok;
    } catch (DataAccessException e) {
      log.debug("platform_challenges schema probe deferred: {}", e.getMessage());
      schemaReady = null;
      return false;
    }
  }

  public void resetSchemaProbe() {
    schemaReady = null;
  }

  private void seedDemoIfEmpty() {
    if (!challenges.isEmpty()) return;
    Challenge seed = new Challenge("challenge-demo-diversify", "Defi diversification",
        "Partir de 100 000 DT virtuels et terminer avec au moins quatre positions sans concentration extreme. "
            + "Environnement simule pedagogique.",
        100_000, "system", Instant.parse("2026-11-15T12:00:00Z"), true);
    challenges.put(seed.id(), seed);
    entries.put(seed.id(), new ConcurrentHashMap<>());
    if (schemaReady()) persistChallenge(seed);
  }

  public Map<String, Object> list() {
    List<Map<String, Object>> items = challenges.values().stream()
        .sorted(Comparator.comparing(Challenge::createdAt).reversed())
        .map(this::challengeView)
        .toList();
    return Map.of("challenges", items, "note",
        "Defis virtuels a capital initial equitable — classement pedagogique, pas une competition reelle.");
  }

  public Map<String, Object> create(AuthUser user, String title, String description, Double capital) {
    if (!"ADMIN".equals(user.user().role())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Seul un administrateur peut creer un defi.");
    }
    String t = title == null ? "" : title.trim();
    if (t.length() < 3 || t.length() > 80) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Titre invalide (3 a 80 caracteres).");
    }
    double start = capital == null ? 100_000 : capital;
    if (start < 10_000 || start > 1_000_000) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Capital initial hors plage autorisee.");
    }
    String id = "challenge-" + UUID.randomUUID().toString().substring(0, 8);
    Challenge c = new Challenge(id, t, description == null || description.isBlank()
        ? "Defi de trading virtuel a conditions equitables."
        : description.trim(), start, user.user().id().toString(), Instant.now(), true);
    if (schemaReady()) persistChallenge(c);
    challenges.put(id, c);
    entries.put(id, new ConcurrentHashMap<>());
    return challengeView(c);
  }

  public Map<String, Object> join(AuthUser user, String challengeId) {
    Challenge c = require(challengeId);
    if (!c.open()) throw new ApiException(HttpStatus.CONFLICT, "CLOSED", "Ce defi est ferme.");
    String uid = user.user().id().toString();
    Entry entry = new Entry(uid, user.user().firstName() + " " + user.user().lastName(), null, null, Instant.now(), null);
    entries.get(c.id()).computeIfAbsent(uid, id -> {
      if (schemaReady()) persistEntry(c.id(), entry);
      return entry;
    });
    return detail(challengeId);
  }

  public Map<String, Object> submit(AuthUser user, String challengeId, double finalEquity) {
    Challenge c = require(challengeId);
    if (finalEquity < 0 || finalEquity > c.startingCapital() * 20) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Fonds propres finaux invalides.");
    }
    String uid = user.user().id().toString();
    ConcurrentHashMap<String, Entry> map = entries.get(c.id());
    Entry existing = map.get(uid);
    if (existing == null) {
      throw new ApiException(HttpStatus.CONFLICT, "NOT_JOINED", "Rejoignez le defi avant de soumettre un score.");
    }
    double score = Math.round((finalEquity / c.startingCapital() - 1.0) * 10_000.0) / 100.0;
    Entry updated = new Entry(uid, existing.displayName(), score, finalEquity, existing.joinedAt(), Instant.now());
    if (schemaReady()) persistEntry(c.id(), updated);
    map.put(uid, updated);
    return detail(challengeId);
  }

  public Map<String, Object> detail(String challengeId) {
    Challenge c = require(challengeId);
    List<Map<String, Object>> ranking = entries.getOrDefault(c.id(), new ConcurrentHashMap<>()).values().stream()
        .filter(e -> e.score() != null)
        .sorted(Comparator.comparing(Entry::score).reversed())
        .map(e -> {
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("displayName", e.displayName());
          row.put("scorePct", e.score());
          row.put("finalEquity", e.finalEquity());
          row.put("submittedAt", e.submittedAt() == null ? null : e.submittedAt().toString());
          return row;
        })
        .toList();
    Map<String, Object> body = new LinkedHashMap<>(challengeView(c));
    body.put("ranking", ranking);
    body.put("participants", entries.getOrDefault(c.id(), new ConcurrentHashMap<>()).size());
    return body;
  }

  private void persistChallenge(Challenge c) {
    jdbc.sql("INSERT INTO platform_challenges (id, title, description, starting_capital, created_by, created_at, open) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?) "
            + "ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, "
            + "starting_capital = EXCLUDED.starting_capital, open = EXCLUDED.open")
        .params(c.id(), c.title(), c.description(), c.startingCapital(), c.createdBy(),
            Timestamp.from(c.createdAt()), c.open())
        .update();
  }

  private void persistEntry(String challengeId, Entry e) {
    jdbc.sql("INSERT INTO platform_challenge_entries "
            + "(challenge_id, user_id, display_name, score, final_equity, joined_at, submitted_at) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?) "
            + "ON CONFLICT (challenge_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name, "
            + "score = EXCLUDED.score, final_equity = EXCLUDED.final_equity, submitted_at = EXCLUDED.submitted_at")
        .params(challengeId, e.userId(), e.displayName(), e.score(), e.finalEquity(),
            Timestamp.from(e.joinedAt()),
            e.submittedAt() == null ? null : Timestamp.from(e.submittedAt()))
        .update();
  }

  private Challenge require(String id) {
    Challenge c = challenges.get(id);
    if (c == null) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Defi introuvable.");
    return c;
  }

  private Map<String, Object> challengeView(Challenge c) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", c.id());
    m.put("title", c.title());
    m.put("description", c.description());
    m.put("startingCapital", c.startingCapital());
    m.put("open", c.open());
    m.put("createdAt", c.createdAt().toString());
    m.put("currency", "TND");
    return m;
  }
}