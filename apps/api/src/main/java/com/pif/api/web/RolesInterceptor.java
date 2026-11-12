package com.pif.api.web;

import com.pif.api.config.PifProperties;
import com.pif.api.security.AuthUser;
import com.pif.api.web.RouteAnnotations.Roles;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * RolesGuard of apps/api/src/auth/guards/roles.guard.ts. This is the server-side boundary for administrator routes;
 * the Angular route guard only decides what to render.
 */
@Component
public class RolesInterceptor implements HandlerInterceptor {

  private final PifProperties props;

  public RolesInterceptor(PifProperties props) {
    this.props = props;
  }

  @Override
  public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
    if (!(handler instanceof HandlerMethod method)) return true;
    Roles roles = method.getMethodAnnotation(Roles.class);
    if (roles == null) roles = method.getBeanType().getAnnotation(Roles.class);
    if (roles == null || roles.value().length == 0) return true;

    Object attribute = req.getAttribute(AuthUser.ATTRIBUTE);
    if (!(attribute instanceof AuthUser principal)
        || !Arrays.asList(roles.value()).contains(principal.user().role())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", Messages.get("forbidden.resource"));
    }
    if ("ADMIN".equals(principal.user().role()) && !principal.user().mfaEnabled() && props.adminMfaRequired()) {
      throw new ApiException(HttpStatus.FORBIDDEN, "ADMIN_MFA_REQUIRED", Messages.get("forbidden.admin_mfa"));
    }
    return true;
  }
}
