package com.pif.api.admin;

import com.pif.api.audit.AuditService;
import com.pif.api.auth.AuthService;
import com.pif.api.auth.AuthService.ClientMeta;
import com.pif.api.auth.UserJson;
import com.pif.api.data.Db;
import com.pif.api.data.UserRow;
import com.pif.api.mail.MailService;
import com.pif.api.mail.MailTransport.DeliveryResult;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** apps/api/src/admin/admin.service.ts. */
@Service
public class AdminService {

  private static final Logger log = LoggerFactory.getLogger(AdminService.class);

  /** Audit context keys an administrator may see; masked addresses, IP digests and internal ids stay in the database. */
  static final List<String> ADMIN_VISIBLE_AUDIT_CONTEXT_KEYS = List.of("status", "from", "to", "role", "reason",
      "scope", "via", "lockMinutes", "maxSessions", "targetInUse", "sessions", "credentialRecords", "recoveryCodes",
      "auditEvents");
  private static final Set<String> ADMIN_MANAGEABLE_STATUSES = Set.of("ACTIVE", "SUSPENDED", "DEACTIVATED");
  private static final int OVERVIEW_WINDOW_DAYS = 7;
  private static final Duration NOTIFICATION_WAIT = Duration.ofSeconds(60);

  private final AdminRepository repo;
  private final AuditService audit;
  private final MailService mail;
  private final AuthService auth;
  private final ObjectMapper mapper;
  private final TransactionTemplate serializable;

  public AdminService(AdminRepository repo, AuditService audit, MailService mail, AuthService auth,
      ObjectMapper mapper, PlatformTransactionManager txManager) {
    this.repo = repo;
    this.audit = audit;
    this.mail = mail;
    this.auth = auth;
    this.mapper = mapper;
    this.serializable = new TransactionTemplate(txManager);
    this.serializable.setIsolationLevel(TransactionDefinition.ISOLATION_SERIALIZABLE);
  }

  private static ApiException notFound() {
    return new ApiException(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", com.pif.api.web.Messages.get("auth.resource_not_found"));
  }

  /** canManageUsers: an active administrator. */
  private static void assertAdmin(AuthUser actor) {
    if (!"ADMIN".equals(actor.user().role()) || !"ACTIVE".equals(actor.user().status())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", com.pif.api.web.Messages.get("forbidden.admin_required"));
    }
  }

  /**
   * SERIALIZABLE so "count active admins, then demote/suspend one" cannot interleave with a concurrent request and
   * leave zero admins. A serialization failure or deadlock (Prisma P2034) becomes 409 CONCURRENT_UPDATE.
   */
  private <T> T inSerializable(Supplier<T> work) {
    try {
      return serializable.execute(status -> work.get());
    } catch (DataAccessException | TransactionException e) {
      if (isSerializationFailure(e)) {
        throw new ApiException(HttpStatus.CONFLICT, "CONCURRENT_UPDATE",
            com.pif.api.web.Messages.get("admin.concurrent_update"));
      }
      throw e;
    }
  }

  private static boolean isSerializationFailure(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof SQLException sql && ("40001".equals(sql.getSQLState()) || "40P01".equals(sql.getSQLState()))) {
        return true;
      }
    }
    return false;
  }

  private void assertAnotherActiveAdminRemains(UserRow target) {
    if (!"ADMIN".equals(target.role()) || !"ACTIVE".equals(target.status())) return;
    if (repo.countOtherActiveAdmins(target.id()) < 1) {
      throw new ApiException(HttpStatus.FORBIDDEN, "LAST_ADMIN_PROTECTION",
          com.pif.api.web.Messages.get("admin.last_admin"));
    }
  }

  public Map<String, Object> overview(AuthUser actor) {
    assertAdmin(actor);
    Instant since = Instant.now().minus(Duration.ofDays(OVERVIEW_WINDOW_DAYS));
    AdminRepository.UserCounts counts = repo.userCounts();
    Map<String, Object> users = new LinkedHashMap<>();
    users.put("total", counts.total());
    users.put("active", counts.active());
    users.put("pending", counts.pending());
    users.put("suspended", counts.suspended());
    users.put("deactivated", counts.deactivated());
    users.put("verified", counts.verified());
    users.put("mfaEnabled", counts.mfaEnabled());

    List<Map<String, Object>> items = new ArrayList<>();
    repo.eventTotalsSince(since).stream()
        .sorted(Comparator.comparingLong(AdminRepository.EventTotal::count).reversed()
            .thenComparing(AdminRepository.EventTotal::eventType, AdminService::localeCompare))
        .forEach(t -> {
          Map<String, Object> m = new LinkedHashMap<>();
          m.put("eventType", t.eventType());
          m.put("outcome", t.outcome());
          m.put("count", t.count());
          items.add(m);
        });
    Map<String, Object> eventTotals = new LinkedHashMap<>();
    eventTotals.put("windowDays", OVERVIEW_WINDOW_DAYS);
    eventTotals.put("items", items);

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("users", users);
    body.put("recentEvents", repo.recentEvents(10).stream().map(AdminRepository::eventJson).toList());
    body.put("eventTotals", eventTotals);
    return body;
  }

  public Map<String, Object> listUsers(AuthUser actor, AdminDtos.UserQuery query) {
    assertAdmin(actor);
    int page = query.page();
    int pageSize = query.pageSize();
    String q = query.q() == null ? null : com.pif.api.web.Validation.jsTrim(query.q());
    long total = repo.countUsers(query, q);
    List<Map<String, Object>> items = new ArrayList<>();
    for (AdminRepository.UserListRow u : repo.listUsers(query, q, (long) (page - 1) * pageSize, pageSize)) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", u.id().toString());
      m.put("email", u.email());
      m.put("firstName", u.firstName());
      m.put("lastName", u.lastName());
      m.put("role", u.role());
      m.put("status", u.status());
      m.put("emailVerified", u.emailVerified());
      m.put("mfaEnabled", u.mfaEnabled());
      m.put("experienceLevel", u.experienceLevel());
      m.put("createdAt", Db.iso(u.createdAt()));
      m.put("lastLoginAt", Db.iso(u.lastLoginAt()));
      items.add(m);
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("page", page);
    body.put("pageSize", pageSize);
    body.put("total", total);
    body.put("items", items);
    return body;
  }

  /** Limited account view: no preferences, no secrets, audit summary without context. */
  public Map<String, Object> getUser(AuthUser actor, UUID id) {
    assertAdmin(actor);
    UserRow user = repo.findLiveUser(id).orElseThrow(AdminService::notFound);
    Instant now = Instant.now();
    Map<String, Object> security = new LinkedHashMap<>();
    security.put("locked", user.lockedUntil() != null && user.lockedUntil().isAfter(now));
    security.put("activeSessions", repo.countActiveSessions(id, now));
    List<Map<String, Object>> summary = new ArrayList<>();
    for (AdminRepository.EventSummary e : repo.eventsAbout(id, 20)) {
      Map<String, Object> m = AdminRepository.eventJson(e);
      m.put("byAdministrator", e.actorUserId() != null && !e.actorUserId().equals(id));
      summary.add(m);
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("user", UserJson.serializeWithoutPreferences(user));
    body.put("security", security);
    body.put("auditSummary", summary);
    return body;
  }

  private record StatusTransition(UserRow user, String from, String to) {}

  public Map<String, Object> updateStatus(AuthUser actor, UUID id, AdminDtos.StatusChange body, ClientMeta meta) {
    assertAdmin(actor);
    if (!ADMIN_MANAGEABLE_STATUSES.contains(body.status())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", com.pif.api.web.Messages.get("admin.status_unsupported"));
    }
    if (actor.id().equals(id)) {
      throw new ApiException(HttpStatus.FORBIDDEN, "SELF_STATUS_CHANGE_FORBIDDEN",
          com.pif.api.web.Messages.get("admin.self_status"));
    }
    String reason = com.pif.api.web.Validation.jsTrim(body.reason());
    boolean restricting = !"ACTIVE".equals(body.status());

    StatusTransition change = inSerializable(() -> {
      UserRow user = repo.findLiveUser(id).orElseThrow(AdminService::notFound);
      // Reactivating an unverified account must not skip email verification.
      String next = "ACTIVE".equals(body.status()) && !user.emailVerified() ? "PENDING_VERIFICATION" : body.status();
      if (user.status().equals(next)) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "STATUS_UNCHANGED", com.pif.api.web.Messages.get("admin.status_unchanged"));
      }
      if (restricting) assertAnotherActiveAdminRemains(user);
      Instant now = Db.now();
      repo.setStatus(id, next, restricting, now);
      if (restricting) {
        repo.revokeAllSessions(id, "SUSPENDED".equals(next) ? "ADMIN_SUSPEND" : "ADMIN_DEACTIVATE", now);
        repo.revokeUnusedTokens(id, now);
      }
      return new StatusTransition(user, user.status(), next);
    });

    Map<String, Object> context = new LinkedHashMap<>();
    context.put("from", change.from());
    context.put("to", change.to());
    context.put("reason", reason);
    audit.record(new AuditService.Event("ADMIN_STATUS_CHANGE", "SUCCESS", actor.id(), id, meta.correlationId(),
        context));
    notifyStatusChange(change.user(), change.from(), change.to());
    return getUser(actor, id);
  }

  /** Awaited like the original, but a failed notification never undoes the status change. */
  private void notifyStatusChange(UserRow user, String from, String to) {
    CompletableFuture<DeliveryResult> pending = null;
    if ("SUSPENDED".equals(to)) {
      pending = mail.sendAccountSuspended(user.email(), user.firstName());
    } else if ("DEACTIVATED".equals(to)) {
      pending = mail.sendAccountDeactivated(user.email(), user.firstName(), true);
    } else if ("SUSPENDED".equals(from) || "DEACTIVATED".equals(from)) {
      pending = mail.sendAccountReactivated(user.email(), user.firstName(), "PENDING_VERIFICATION".equals(to));
    }
    if (pending == null) return;
    try {
      pending.get(NOTIFICATION_WAIT.toSeconds(), TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      log.warn("Status-change notification failed: interrupted");
    } catch (Exception e) {
      log.warn("Status-change notification failed: {}", e.getClass().getSimpleName());
    }
  }

  private record RoleTransition(String from, String to) {}

  public Map<String, Object> updateRole(AuthUser actor, UUID id, AdminDtos.RoleChange body, ClientMeta meta) {
    assertAdmin(actor);
    if (actor.id().equals(id)) {
      throw new ApiException(HttpStatus.FORBIDDEN, "SELF_DEMOTION_FORBIDDEN",
          com.pif.api.web.Messages.get("admin.self_role"));
    }
    auth.assertStepUp(actor.user(), body.password(), body.totpCode(), null, null, meta);

    RoleTransition change = inSerializable(() -> {
      UserRow user = repo.findLiveUser(id).orElseThrow(AdminService::notFound);
      if (user.role().equals(body.role())) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "ROLE_UNCHANGED", com.pif.api.web.Messages.get("admin.role_unchanged"));
      }
      if (!"ADMIN".equals(body.role())) assertAnotherActiveAdminRemains(user);
      repo.setRole(id, body.role(), Db.now());
      return new RoleTransition(user.role(), body.role());
    });

    Map<String, Object> context = new LinkedHashMap<>();
    context.put("from", change.from());
    context.put("to", change.to());
    audit.record(new AuditService.Event("ADMIN_ROLE_CHANGE", "SUCCESS", actor.id(), id, meta.correlationId(),
        context));
    return getUser(actor, id);
  }

  public Map<String, Object> listAuditEvents(AuthUser actor, AdminDtos.AuditQuery query) {
    assertAdmin(actor);
    if (query.from() != null && query.to() != null && query.from().isAfter(query.to())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", com.pif.api.web.Messages.get("validation.from_before_to"));
    }
    int page = query.page();
    int pageSize = query.pageSize();
    long total = repo.countAuditEvents(query);
    List<Map<String, Object>> items = new ArrayList<>();
    for (AdminRepository.AuditRow e : repo.listAuditEvents(query, (long) (page - 1) * pageSize, pageSize)) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", e.id().toString());
      m.put("eventType", e.eventType());
      m.put("outcome", e.outcome());
      m.put("actorUserId", e.actorUserId() == null ? null : e.actorUserId().toString());
      m.put("subjectUserId", e.subjectUserId() == null ? null : e.subjectUserId().toString());
      m.put("correlationId", e.correlationId());
      m.put("createdAt", Db.iso(e.createdAt()));
      m.put("context", filterAuditContext(e.contextJson()));
      items.add(m);
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("page", page);
    body.put("pageSize", pageSize);
    body.put("total", total);
    body.put("items", items);
    return body;
  }

  Map<String, Object> filterAuditContext(String json) {
    if (json == null) return null;
    Object parsed = mapper.readValue(json, Object.class);
    if (!(parsed instanceof Map<?, ?> context)) return null;
    Map<String, Object> out = new LinkedHashMap<>();
    for (String key : ADMIN_VISIBLE_AUDIT_CONTEXT_KEYS) {
      if (context.containsKey(key)) out.put(key, context.get(key));
    }
    return out.isEmpty() ? null : out;
  }

  /**
   * String.prototype.localeCompare (ICU root collation) for audit event types, which are restricted to
   * [A-Z0-9_]: "_" sorts before digits, digits before letters, and a prefix before its extensions.
   */
  static int localeCompare(String a, String b) {
    int n = Math.min(a.length(), b.length());
    for (int i = 0; i < n; i++) {
      int diff = rank(a.charAt(i)) - rank(b.charAt(i));
      if (diff != 0) return diff;
    }
    return Integer.compare(a.length(), b.length());
  }

  private static int rank(char c) {
    if (c == '_') return 0;
    if (c >= '0' && c <= '9') return 1 + (c - '0');
    if (c >= 'A' && c <= 'Z') return 11 + (c - 'A');
    if (c >= 'a' && c <= 'z') return 11 + (c - 'a');
    return 100 + c;
  }
}
