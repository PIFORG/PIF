package com.pif.api.challenges;

import com.pif.api.security.AuthUser;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/challenges")
@Throttle(limit = 60, ttlSeconds = 60)
@Tag(name = "Defis")
public class ChallengeController {

  private final ChallengeService service;
  private final ObjectMapper mapper;

  public ChallengeController(ChallengeService service, ObjectMapper mapper) {
    this.service = service;
    this.mapper = mapper;
  }

  @GetMapping
  @Operation(summary = "Liste des defis virtuels")
  public Map<String, Object> list(HttpServletRequest req) {
    AuthUser.from(req);
    return service.list();
  }

  @GetMapping("/{id}")
  @Operation(summary = "Detail et classement d'un defi")
  public Map<String, Object> detail(HttpServletRequest req, @PathVariable("id") String id) {
    AuthUser.from(req);
    return service.detail(id);
  }

  @PostMapping
  @Operation(summary = "Creer un defi (ADMIN)")
  public Map<String, Object> create(HttpServletRequest req) {
    AuthUser user = AuthUser.from(req);
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    String title = body.get("title") == null ? null : String.valueOf(body.get("title"));
    String description = body.get("description") == null ? null : String.valueOf(body.get("description"));
    Double capital = body.get("startingCapital") instanceof Number n ? n.doubleValue() : null;
    return service.create(user, title, description, capital);
  }

  @PostMapping("/{id}/join")
  @Operation(summary = "Rejoindre un defi")
  public Map<String, Object> join(HttpServletRequest req, @PathVariable("id") String id) {
    return service.join(AuthUser.from(req), id);
  }

  @PostMapping("/{id}/submit")
  @Operation(summary = "Soumettre le resultat simule")
  public Map<String, Object> submit(HttpServletRequest req, @PathVariable("id") String id) {
    AuthUser user = AuthUser.from(req);
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    if (!(body.get("finalEquity") instanceof Number n)) {
      throw new com.pif.api.web.ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
          "finalEquity requis.");
    }
    return service.submit(user, id, n.doubleValue());
  }
}