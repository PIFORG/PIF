package com.pif.api.ai;

import com.pif.api.security.AuthUser;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Financial AI lab: real trained models on synthetic chronological data, with explanations. */
@RestController
@RequestMapping("/ai")
@Throttle(limit = 60, ttlSeconds = 60)
@Tag(name = "Intelligence artificielle")
public class AiController {

  private final AiService service;

  public AiController(AiService service) {
    this.service = service;
  }

  @GetMapping
  @Operation(summary = "Vue d'ensemble des modèles IA")
  public Map<String, Object> overview(HttpServletRequest req) {
    AuthUser.from(req);
    return service.overview();
  }

  @GetMapping("/insights")
  @Operation(summary = "Insights, agent et sentiment synthétique")
  public Map<String, Object> insights(HttpServletRequest req) {
    return service.insights(AuthUser.from(req));
  }

  @GetMapping("/insights/{id}/explanation")
  @Operation(summary = "Attribution locale Shapley pour un insight")
  public Map<String, Object> explanation(HttpServletRequest req, @PathVariable("id") String id) {
    AuthUser.from(req);
    return service.explanation(id);
  }

  @GetMapping("/models/{id}")
  @Operation(summary = "Fiche modèle avec métriques hors échantillon")
  public Map<String, Object> model(HttpServletRequest req, @PathVariable("id") String id) {
    AuthUser.from(req);
    return service.model(id);
  }

  @GetMapping("/models/{id}/importance")
  @Operation(summary = "Importance globale des variables")
  public Map<String, Object> importance(HttpServletRequest req, @PathVariable("id") String id) {
    AuthUser.from(req);
    return service.importance(id);
  }

  @GetMapping("/predictions/latest")
  @Operation(summary = "Dernière prédiction de test chronologique")
  public Map<String, Object> predict(HttpServletRequest req) {
    AuthUser.from(req);
    return service.predictLatest();
  }
}
