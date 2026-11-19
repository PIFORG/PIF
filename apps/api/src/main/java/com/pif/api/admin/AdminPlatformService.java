package com.pif.api.admin;

import com.pif.api.ai.AiService;
import com.pif.api.challenges.ChallengeService;
import com.pif.api.learning.engine.MissionCatalog;
import com.pif.api.market.FictionalUniverse;
import com.pif.api.market.NewsCatalog;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.security.AuthUser;
import com.pif.api.stress.StressService;
import com.pif.api.web.ApiException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Catalogues administratifs en lecture seule : marchés, apprentissage, IA, stress, défis, actuariat. */
@Service
public class AdminPlatformService {

  private final AiService ai;
  private final StressService stress;
  private final ChallengeService challenges;

  public AdminPlatformService(AiService ai, StressService stress, ChallengeService challenges) {
    this.ai = ai;
    this.stress = stress;
    this.challenges = challenges;
  }

  private static void assertAdmin(AuthUser actor) {
    if (!"ADMIN".equals(actor.user().role()) || !"ACTIVE".equals(actor.user().status())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN",
          com.pif.api.web.Messages.get("forbidden.admin_required"));
    }
  }

  public Map<String, Object> supervision(AuthUser actor) {
    assertAdmin(actor);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("title", "Supervision de la plateforme");
    body.put("modules", List.of(
        Map.of("id", "users", "label", "Utilisateurs et audit", "status", "LIVE"),
        Map.of("id", "markets", "label", "Instruments et provenance", "status", "LIVE"),
        Map.of("id", "learning", "label", "Missions pedagogiques", "status", "LIVE"),
        Map.of("id", "ai", "label", "Modeles IA", "status", "LIVE"),
        Map.of("id", "stress", "label", "Scenarios bancaires", "status", "LIVE"),
        Map.of("id", "challenges", "label", "Defis virtuels", "status", "LIVE"),
        Map.of("id", "news", "label", "Fil d'actualités pédagogiques", "status", "LIVE"),
        Map.of("id", "actuarial", "label", "Actuariat (paramètres autorisés)", "status", "LIVE")));
    body.put("note",
        "Vues de supervision en lecture seule. Les écritures utilisateurs restent sur /admin/users.");
    return body;
  }

  public Map<String, Object> markets(AuthUser actor) {
    assertAdmin(actor);
    List<Map<String, Object>> instruments = new ArrayList<>();
    FictionalUniverse.INSTRUMENTS.forEach((symbol, inst) -> {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("symbol", symbol);
      row.put("name", inst.name());
      row.put("sector", inst.sector());
      row.put("initialPrice", inst.initialPrice());
      row.put("spreadBps", inst.spreadBps());
      row.put("depth", inst.depth());
      row.put("provenance", SimulatedMarketProvider.SIMULATED_PROVENANCE.kind());
      instruments.add(row);
    });
    return Map.of(
        "instruments", instruments,
        "provider", SimulatedMarketProvider.SIMULATED_PROVENANCE.providerId(),
        "description", SimulatedMarketProvider.SIMULATED_PROVENANCE.description(),
        "newsAvailable", true);
  }

  public Map<String, Object> learning(AuthUser actor) {
    assertAdmin(actor);
    List<Map<String, Object>> missions = MissionCatalog.MISSIONS.stream().map(m -> {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("slug", m.slug());
      row.put("title", m.title());
      row.put("level", m.level());
      row.put("availability", m.availability());
      row.put("order", m.order());
      return row;
    }).toList();
    long implemented = missions.stream().filter(m -> "IMPLEMENTED".equals(m.get("availability"))).count();
    long configured = missions.stream().filter(m -> "CONFIGURED".equals(m.get("availability"))).count();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("missions", missions);
    body.put("stats", Map.of("total", missions.size(), "implemented", implemented, "configured", configured));
    return body;
  }

  public Map<String, Object> aiModels(AuthUser actor) {
    assertAdmin(actor);
    return ai.overview();
  }

  public Map<String, Object> stressCatalog(AuthUser actor) {
    assertAdmin(actor);
    return stress.catalog();
  }

  public Map<String, Object> challengeStats(AuthUser actor) {
    assertAdmin(actor);
    return challenges.list();
  }

  public Map<String, Object> news(AuthUser actor) {
    assertAdmin(actor);
    return NewsCatalog.feed();
  }

  public Map<String, Object> actuarial(AuthUser actor) {
    assertAdmin(actor);
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("title", "Supervision actuarielle");
    body.put("modules", List.of(
        Map.of("id", "pricing", "label", "Tarification fréquence / sévérité", "status", "LIVE"),
        Map.of("id", "aggregate", "label", "Pertes agrégées Panjer / Monte-Carlo", "status", "LIVE"),
        Map.of("id", "reserving", "label", "Provisionnement Chain-Ladder / BF / IBNR", "status", "LIVE"),
        Map.of("id", "capital-alm", "label", "Capital économique / ALM", "status", "LIVE")));
    body.put("note",
        "Tarification, provisionnement, capital économique et ALM sont opérationnels sur ce serveur "
            + "(périmètre pédagogique, non réglementaire).");
    return body;
  }
}