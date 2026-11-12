package com.pif.api.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.pif.api.config.PifProperties;
import com.pif.api.data.UserRow;
import com.pif.api.security.AuthUser;
import com.pif.api.web.RouteAnnotations.Roles;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

/** Port of apps/api/src/auth/guards/roles.guard.spec.ts, plus the cases that guard leaves to its callers. */
class RolesInterceptorTest {

  @Roles("ADMIN")
  static class AdminOnly {
    public void overview() {}
  }

  static class Open {
    public void health() {}
  }

  private static RolesInterceptor interceptor(String adminMfaRequired, String nodeEnv) {
    MockEnvironment env = new MockEnvironment()
        .withProperty("JWT_ACCESS_SECRET", "s".repeat(40))
        .withProperty("AUTH_TOKEN_PEPPER", "p")
        .withProperty("AUTH_IP_HASH_PEPPER", "q")
        .withProperty("MFA_ENCRYPTION_KEY", "00".repeat(32));
    if (adminMfaRequired != null) env.withProperty("AUTH_ADMIN_MFA_REQUIRED", adminMfaRequired);
    if (nodeEnv != null) env.withProperty("NODE_ENV", nodeEnv);
    return new RolesInterceptor(new PifProperties(env));
  }

  private static MockHttpServletRequest as(String role, boolean mfaEnabled) {
    Instant now = Instant.now();
    UserRow user = new UserRow(UUID.randomUUID(), "a@example.test", "A", "B", "hash", role, "BEGINNER", true, now,
        "ACTIVE", 0, null, mfaEnabled, mfaEnabled ? now : null, null, null, 0, null, now, now, null, null);
    MockHttpServletRequest req = new MockHttpServletRequest();
    req.setAttribute(AuthUser.ATTRIBUTE, new AuthUser(user, UUID.randomUUID()));
    return req;
  }

  private static boolean handle(RolesInterceptor interceptor, MockHttpServletRequest req, Object bean, String method)
      throws Exception {
    return interceptor.preHandle(req, new MockHttpServletResponse(), new HandlerMethod(bean, method));
  }

  @Test
  void deniesInvestorsOnAdminRoutes() {
    assertThatThrownBy(() -> handle(interceptor("false", null), as("INVESTOR", true), new AdminOnly(), "overview"))
        .isInstanceOfSatisfying(ApiException.class, e -> {
          assertThat(e.status()).isEqualTo(HttpStatus.FORBIDDEN);
          assertThat(e.errorCode()).isEqualTo("FORBIDDEN");
          assertThat(e.getMessage()).isEqualTo(Messages.get("forbidden.resource"));
        });
  }

  @Test
  void requiresAdminMfaEnrollmentWhenThePolicyIsOn() throws Exception {
    RolesInterceptor strict = interceptor("true", null);
    assertThatThrownBy(() -> handle(strict, as("ADMIN", false), new AdminOnly(), "overview"))
        .isInstanceOfSatisfying(ApiException.class, e -> {
          assertThat(e.status()).isEqualTo(HttpStatus.FORBIDDEN);
          assertThat(e.errorCode()).isEqualTo("ADMIN_MFA_REQUIRED");
        });
    assertThat(handle(strict, as("ADMIN", true), new AdminOnly(), "overview")).isTrue();
  }

  @Test
  void allowsAdminsWithoutMfaWhenThePolicyIsOffDevelopmentDefault() throws Exception {
    assertThat(handle(interceptor(null, "development"), as("ADMIN", false), new AdminOnly(), "overview")).isTrue();
  }

  @Test
  void policyDefaultsToOnInProduction() {
    assertThatThrownBy(() -> handle(interceptor(null, "production"), as("ADMIN", false), new AdminOnly(), "overview"))
        .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.errorCode()).isEqualTo("ADMIN_MFA_REQUIRED"));
  }

  @Test
  void deniesAdminRoutesWithoutAPrincipalAndIgnoresUnannotatedRoutes() throws Exception {
    RolesInterceptor interceptor = interceptor("false", null);
    assertThatThrownBy(() -> handle(interceptor, new MockHttpServletRequest(), new AdminOnly(), "overview"))
        .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.errorCode()).isEqualTo("FORBIDDEN"));
    assertThat(handle(interceptor, new MockHttpServletRequest(), new Open(), "health")).isTrue();
  }
}
