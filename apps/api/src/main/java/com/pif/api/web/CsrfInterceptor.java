package com.pif.api.web;

import com.pif.api.config.PifProperties;
import com.pif.api.web.RouteAnnotations.CsrfProtected;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * CsrfGuard of apps/api/src/auth/guards/csrf.guard.ts, for controllers marked @CsrfProtected:
 * Origin allowlist → Sec-Fetch-Site → Referer → no signal (allowed outside production only).
 */
@Component
public class CsrfInterceptor implements HandlerInterceptor {

  private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");

  private final PifProperties props;

  public CsrfInterceptor(PifProperties props) {
    this.props = props;
  }

  @Override
  public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
    if (!(handler instanceof HandlerMethod method)) return true;
    if (!method.getBeanType().isAnnotationPresent(CsrfProtected.class)) return true;
    if (SAFE_METHODS.contains(req.getMethod().toUpperCase())) return true;

    String path = req.getRequestURI();
    boolean hasRefreshCookie = req.getCookies() != null && Arrays.stream(req.getCookies())
        .anyMatch(c -> props.cookieName().equals(c.getName()) && !c.getValue().isEmpty());
    boolean cookieRoute = path.contains("/auth/refresh") || path.contains("/auth/logout");
    String authorization = req.getHeader("Authorization");
    if (!hasRefreshCookie && !cookieRoute && authorization != null && authorization.startsWith("Bearer ")) {
      return true;
    }

    List<String> allowed = props.csrfAllowedOrigins();
    String origin = req.getHeader("Origin");
    if (origin != null) {
      if (allowed.contains(origin)) return true;
      throw rejected(Messages.get("csrf.origin_unverified"));
    }

    String fetchSite = req.getHeader("Sec-Fetch-Site");
    if ("same-origin".equals(fetchSite) || "none".equals(fetchSite)) return true;
    if ("cross-site".equals(fetchSite)) throw rejected(Messages.get("csrf.cross_site"));

    String referer = req.getHeader("Referer");
    if (referer != null && !referer.isEmpty()) {
      String refOrigin = PifProperties.originOf(referer);
      if (refOrigin != null && allowed.contains(refOrigin)) return true;
      throw rejected(Messages.get("csrf.origin_unverified"));
    }

    if (fetchSite == null && !props.isProduction()) return true;
    throw rejected(Messages.get("csrf.origin_unverified"));
  }

  private static ApiException rejected(String message) {
    return new ApiException(HttpStatus.FORBIDDEN, "CSRF_REJECTED", message);
  }

  static String cookieValue(HttpServletRequest req, String name) {
    if (req.getCookies() == null) return null;
    for (Cookie c : req.getCookies()) {
      if (name.equals(c.getName())) return c.getValue();
    }
    return null;
  }
}
