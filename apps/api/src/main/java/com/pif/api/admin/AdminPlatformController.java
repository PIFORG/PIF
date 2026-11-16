package com.pif.api.admin;

import com.pif.api.security.AuthUser;
import com.pif.api.web.RouteAnnotations.Roles;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/platform")
@Roles("ADMIN")
@Tag(name = "Administration plateforme")
public class AdminPlatformController {

  private final AdminPlatformService platform;

  public AdminPlatformController(AdminPlatformService platform) {
    this.platform = platform;
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

  @GetMapping("/learning")
  @Operation(summary = "Catalogue des missions pedagogiques")
  public Map<String, Object> learning(HttpServletRequest req) {
    return platform.learning(AuthUser.from(req));
  }

  @GetMapping("/ai")
  @Operation(summary = "Catalogue des modeles IA")
  public Map<String, Object> ai(HttpServletRequest req) {
    return platform.aiModels(AuthUser.from(req));
  }

  @GetMapping("/stress")
  @Operation(summary = "Scenarios de stress bancaire")
  public Map<String, Object> stress(HttpServletRequest req) {
    return platform.stressCatalog(AuthUser.from(req));
  }

  @GetMapping("/challenges")
  @Operation(summary = "Defis virtuels")
  public Map<String, Object> challenges(HttpServletRequest req) {
    return platform.challengeStats(AuthUser.from(req));
  }

  @GetMapping("/news")
  @Operation(summary = "Fil d'actualites pedagogiques")
  public Map<String, Object> news(HttpServletRequest req) {
    return platform.news(AuthUser.from(req));
  }

  @GetMapping("/actuarial")
  @Operation(summary = "Supervision actuarielle")
  public Map<String, Object> actuarial(HttpServletRequest req) {
    return platform.actuarial(AuthUser.from(req));
  }
}