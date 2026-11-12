package com.pif.api.users;

import com.pif.api.auth.AuthDtos;
import com.pif.api.auth.AuthService;
import com.pif.api.auth.SecurityService;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** Routes of apps/api/src/users/users.controller.ts. */
@RestController
@RequestMapping("/users/me")
@Tag(name = "User Management")
public class UsersController {

  private final AuthService auth;
  private final SecurityService security;
  private final ObjectMapper mapper;

  public UsersController(AuthService auth, SecurityService security, ObjectMapper mapper) {
    this.auth = auth;
    this.security = security;
    this.mapper = mapper;
  }

  @GetMapping("/dashboard-context")
  @Operation(summary = "Get dashboard context", description = "Role, capabilities, module availability and required "
      + "actions used to build the dashboard.")
  public Map<String, Object> dashboardContext(HttpServletRequest req) {
    return security.dashboardContext(AuthUser.from(req));
  }

  @GetMapping("/preferences")
  @Operation(summary = "Get preferences")
  public Map<String, Object> preferences(HttpServletRequest req) {
    return auth.getPreferences(AuthUser.from(req)).toJson();
  }

  @PatchMapping("/preferences")
  @Operation(summary = "Update preferences")
  @ApiDocs.Body("UpdatePreferencesDto")
  public Map<String, Object> updatePreferences(HttpServletRequest req) {
    return auth.updatePreferences(AuthUser.from(req), AuthDtos.updatePreferences(JsonBodyCache.get(req, mapper)))
        .toJson();
  }
}
