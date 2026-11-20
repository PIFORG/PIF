package com.pif.api.admin;

import com.pif.api.security.AuthUser;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.RouteAnnotations.Roles;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/admin/platform")
@Roles("ADMIN")
@Tag(name = "Administration plateforme")
public class AdminPlatformController {

  private final AdminPlatformService platform;
  private final ObjectMapper mapper;

  public AdminPlatformController(AdminPlatformService platform, ObjectMapper mapper) {
    this.platform = platform;
    this.mapper = mapper;
  }

  @GetMapping("/supervision")
  @Operation(summary = "Supervision globale")
  public Map<String, Object> supervision(HttpServletRequest req) {
    return platform.supervision(AuthUser.from(req));
  }

  @GetMapping("/markets")
  @Operation(summary = "Catalogue instruments et provenance")
  public Map<String, Object> markets(HttpServletRequest req) {
    return platform.markets(AuthUser.from(req));
  }

  @PatchMapping("/markets/{symbol}/status")
  @Operation(summary = "Suspendre ou reactiver un instrument")
  public Map<String, Object> setInstrumentStatus(HttpServletRequest req, @PathVariable("symbol") String symbol) {
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    String status = body.get("status") == null ? null : String.valueOf(body.get("status"));
    return platform.setInstrumentStatus(AuthUser.from(req), symbol, status);
  }

  @GetMapping("/learning")
  @Operation(summary = "Catalogue des missions pedagogiques")
  public Map<String, Object> learning(HttpServletRequest req) {
    return platform.learning(AuthUser.from(req));
  }

  @PatchMapping("/learning/{slug}")
  @Operation(summary = "Activer ou desactiver une mission pour les investisseurs")
  public Map<String, Object> setMission(HttpServletRequest req, @PathVariable("slug") String slug) {
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    boolean disabled = Boolean.TRUE.equals(body.get("disabled"));
    return platform.setMissionDisabled(AuthUser.from(req), slug, disabled);
  }

  @GetMapping("/ai")
  @Operation(summary = "Catalogue des modeles IA")
  public Map<String, Object> ai(HttpServletRequest req) {
    return platform.aiModels(AuthUser.from(req));
  }

  @PatchMapping("/ai/{modelId}")
  @Operation(summary = "Activer ou desactiver un modele IA")
  public Map<String, Object> setAi(HttpServletRequest req, @PathVariable("modelId") String modelId) {
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    boolean disabled = Boolean.TRUE.equals(body.get("disabled"));
    return platform.setAiModelDisabled(AuthUser.from(req), modelId, disabled);
  }

  @GetMapping("/stress")
  @Operation(summary = "Scenarios de stress bancaire")
  public Map<String, Object> stress(HttpServletRequest req) {
    return platform.stressCatalog(AuthUser.from(req));
  }

  @PatchMapping("/stress/{presetId}")
  @Operation(summary = "Activer ou desactiver un scenario de stress")
  public Map<String, Object> setStress(HttpServletRequest req, @PathVariable("presetId") String presetId) {
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    boolean disabled = Boolean.TRUE.equals(body.get("disabled"));
    return platform.setStressPresetDisabled(AuthUser.from(req), presetId, disabled);
  }

  @GetMapping("/challenges")
  @Operation(summary = "Defis virtuels")
  public Map<String, Object> challenges(HttpServletRequest req) {
    return platform.challengeStats(AuthUser.from(req));
  }

  @PostMapping("/challenges")
  @Operation(summary = "Creer un defi virtuel")
  public Map<String, Object> createChallenge(HttpServletRequest req) {
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    String title = body.get("title") == null ? null : String.valueOf(body.get("title"));
    String description = body.get("description") == null ? null : String.valueOf(body.get("description"));
    Double capital = body.get("startingCapital") instanceof Number n ? n.doubleValue() : null;
    return platform.createChallenge(AuthUser.from(req), title, description, capital);
  }

  @GetMapping("/news")
  @Operation(summary = "Fil d'actualites pedagogiques")
  public Map<String, Object> news(HttpServletRequest req) {
    return platform.news(AuthUser.from(req));
  }

  @PostMapping("/news")
  @Operation(summary = "Publier une actualite pedagogique")
  public Map<String, Object> publishNews(HttpServletRequest req) {
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    return platform.publishNews(AuthUser.from(req),
        body.get("title") == null ? null : String.valueOf(body.get("title")),
        body.get("summary") == null ? null : String.valueOf(body.get("summary")),
        body.get("symbol") == null ? null : String.valueOf(body.get("symbol")),
        body.get("sector") == null ? null : String.valueOf(body.get("sector")));
  }

  @DeleteMapping("/news/{id}")
  @Operation(summary = "Retirer une actualite publiee par l'administration")
  public Map<String, Object> deleteNews(HttpServletRequest req, @PathVariable("id") String id) {
    return platform.deleteNews(AuthUser.from(req), id);
  }

  @GetMapping("/simulation")
  @Operation(summary = "Parametres de simulation")
  public Map<String, Object> simulation(HttpServletRequest req) {
    return platform.simulationParams(AuthUser.from(req));
  }

  @PatchMapping("/simulation")
  @Operation(summary = "Mettre a jour les parametres de simulation")
  public Map<String, Object> updateSimulation(HttpServletRequest req) {
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    Boolean newsPaused = body.get("newsPaused") instanceof Boolean b ? b : null;
    Integer depth = body.get("depthScalePct") instanceof Number n ? n.intValue() : null;
    return platform.updateSimulationParams(AuthUser.from(req), newsPaused, depth);
  }

  @GetMapping("/actuarial")
  @Operation(summary = "Supervision actuarielle")
  public Map<String, Object> actuarial(HttpServletRequest req) {
    return platform.actuarial(AuthUser.from(req));
  }
}