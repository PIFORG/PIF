package com.pif.api.admin;

import com.pif.api.auth.AuthService.ClientMeta;
import com.pif.api.config.PifProperties;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.PathParams;
import com.pif.api.web.RouteAnnotations.Roles;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/**
 * apps/api/src/admin/admin.controller.ts. The role check runs server-side in RolesInterceptor and again in the
 * service (an active administrator). Like the original controller, there is no CSRF guard: these routes only accept
 * the bearer access token, never the refresh cookie. When both the body and the route UUID are invalid, NestJS
 * reports the body validation error, so the body is validated before the id.
 */
@RestController
@RequestMapping("/admin")
@Roles("ADMIN")
@Tag(name = "Administration")
public class AdminController {

  private final AdminService admin;
  private final PifProperties props;
  private final ObjectMapper mapper;

  public AdminController(AdminService admin, PifProperties props, ObjectMapper mapper) {
    this.admin = admin;
    this.props = props;
    this.mapper = mapper;
  }

  @GetMapping("/overview")
  @Operation(summary = "Get platform overview",
      description = "User counts by status, verification and MFA, with recent security activity.")
  public Map<String, Object> overview(HttpServletRequest req) {
    return admin.overview(AuthUser.from(req));
  }

  @GetMapping("/users")
  @Operation(summary = "Search users",
      description = "Paginated, filterable by text, status, role and email verification.")
  @ApiDocs.Query("ListUsersQueryDto")
  public Map<String, Object> listUsers(HttpServletRequest req) {
    return admin.listUsers(AuthUser.from(req), AdminDtos.listUsers(AdminDtos.query(req.getParameterMap())));
  }

  @GetMapping("/users/{id}")
  @Operation(summary = "Get user details")
  public Map<String, Object> getUser(HttpServletRequest req, @PathVariable("id") String id) {
    return admin.getUser(AuthUser.from(req), PathParams.uuid(id));
  }

  @PatchMapping("/users/{id}/status")
  @Operation(summary = "Change account status", description = "Suspend, reactivate or deactivate an account. A reason "
      + "is required and recorded in the audit log.")
  @ApiDocs.Body("UpdateStatusDto")
  public Map<String, Object> updateStatus(HttpServletRequest req, @PathVariable("id") String id) {
    var dto = AdminDtos.updateStatus(JsonBodyCache.get(req, mapper));
    return admin.updateStatus(AuthUser.from(req), PathParams.uuid(id), dto, ClientMeta.of(req, props));
  }

  @PatchMapping("/users/{id}/role")
  @Operation(summary = "Change user role", description = "Requires the administrator to reauthenticate. At least one "
      + "active administrator must remain.")
  @ApiDocs.Body("UpdateRoleDto")
  public Map<String, Object> updateRole(HttpServletRequest req, @PathVariable("id") String id) {
    var dto = AdminDtos.updateRole(JsonBodyCache.get(req, mapper));
    return admin.updateRole(AuthUser.from(req), PathParams.uuid(id), dto, ClientMeta.of(req, props));
  }

  @GetMapping("/audit-events")
  @Tag(name = "Audit Logs")
  @Operation(summary = "Search audit events",
      description = "Paginated, filterable by event type, outcome, actor, subject and date range.")
  @ApiDocs.Query("AuditQueryDto")
  public Map<String, Object> auditEvents(HttpServletRequest req) {
    return admin.listAuditEvents(AuthUser.from(req), AdminDtos.auditEvents(AdminDtos.query(req.getParameterMap())));
  }
}
