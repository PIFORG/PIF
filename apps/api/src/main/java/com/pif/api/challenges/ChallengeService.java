package com.pif.api.challenges;

import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Virtual trading challenges with fair starting capital and ranking. In-memory for this slice
 * (no production schema change). Scores are submitted after a simulated run; the engine does not
 * claim live market alpha.
 */
@Service
public class ChallengeService {

  public record Challenge(String id, String title, String description, double startingCapital, String createdBy,
      Instant createdAt, boolean open) {}

  public record Entry(String userId, String displayName, Double score, Double finalEquity, Instant joinedAt,
      Instant submittedAt) {}

  private final ConcurrentHashMap<String, Challenge> challenges = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, ConcurrentHashMap<String, Entry>> entries = new ConcurrentHashMap<>();

  public ChallengeService() {
    Challenge seed = new Challenge("challenge-demo-diversify", "Défi diversification",
        "Partir de 100 000 DT virtuels et terminer avec au moins quatre positions sans concentration extrême. "
            + "Environnement simulé pédagogique.",
        100_000, "system", Instant.parse("2026-11-15T12:00:00Z"), true);
    challenges.put(seed.id(), seed);
    entries.put(seed.id(), new ConcurrentHashMap<>());
  }

  public Map<String, Object> list() {
    List<Map<String, Object>> items = challenges.values().stream()
        .sorted(Comparator.comparing(Challenge::createdAt).reversed())
        .map(this::challengeView)
        .toList();
    return Map.of("challenges", items, "note",
        "Défis virtuels à capital initial équitable — classement pédagogique, pas une compétition réelle.");
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
    challenges.put(id, c);
    entries.put(id, new ConcurrentHashMap<>());
    return challengeView(c);
  }

  public Map<String, Object> join(AuthUser user, String challengeId) {
    Challenge c = require(challengeId);
    if (!c.open()) throw new ApiException(HttpStatus.CONFLICT, "CLOSED", "Ce defi est ferme.");
    String uid = user.user().id().toString();
    entries.get(c.id()).computeIfAbsent(uid,
        id -> new Entry(uid, user.user().firstName() + " " + user.user().lastName(), null, null, Instant.now(), null));
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
    map.put(uid, new Entry(uid, existing.displayName(), score, finalEquity, existing.joinedAt(), Instant.now()));
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