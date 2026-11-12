package com.pif.api.web;

import com.pif.api.config.PifProperties;
import com.pif.api.web.RouteAnnotations.AccountThrottle;
import com.pif.api.web.RouteAnnotations.Throttle;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import tools.jackson.databind.ObjectMapper;

/**
 * ThrottlerGuard with two named throttlers, as in apps/api/src/app.module.ts:
 * "default" (per client IP; AUTH_RATE_LIMIT_LIMIT per AUTH_RATE_LIMIT_TTL_SECONDS unless the route
 * overrides it) and "account" (opt-in per route, keyed on the normalized email in the body).
 */
@Component
public class ThrottleInterceptor implements HandlerInterceptor {

  private final PifProperties props;
  private final ObjectMapper mapper;
  private final ThrottleStore store = new ThrottleStore(System::currentTimeMillis);

  public ThrottleInterceptor(PifProperties props, ObjectMapper mapper) {
    this.props = props;
    this.mapper = mapper;
  }

  @Override
  public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
    // CompletableFuture / async MVC re-enters the interceptor on ASYNC dispatch; NestJS counts once.
    if (req.getDispatcherType() == DispatcherType.ASYNC) return true;
    if (!(handler instanceof HandlerMethod method)) return true;
    String prefix = method.getBeanType().getSimpleName() + "-" + method.getMethod().getName();

    Throttle throttle = method.getMethodAnnotation(Throttle.class);
    if (throttle == null) throttle = method.getBeanType().getAnnotation(Throttle.class);
    int limit = throttle != null ? throttle.limit() : props.rateLimitLimit();
    long ttlMs = (throttle != null ? throttle.ttlSeconds() : props.rateLimitTtlSeconds()) * 1000L;
    apply(res, prefix, "default", ClientIp.of(req, props), limit, ttlMs);

    AccountThrottle account = method.getMethodAnnotation(AccountThrottle.class);
    if (account != null) {
      String tracker = accountTracker(req);
      if (tracker != null) apply(res, prefix, "account", tracker, account.limit(), account.ttlSeconds() * 1000L);
    }
    return true;
  }

  private void apply(HttpServletResponse res, String prefix, String name, String tracker, int limit, long ttlMs) {
    String key = sha256(prefix + "-" + name + "-" + tracker);
    ThrottleStore.Result r = store.increment(key, ttlMs, limit, ttlMs, name);
    String suffix = "default".equals(name) ? "" : "-" + name;
    if (r.blocked()) {
      res.setHeader("Retry-After" + suffix, String.valueOf(r.timeToBlockExpire()));
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", Messages.get("rate_limited"));
    }
    res.setHeader("X-RateLimit-Limit" + suffix, String.valueOf(limit));
    res.setHeader("X-RateLimit-Remaining" + suffix, String.valueOf(Math.max(0, limit - r.totalHits())));
    res.setHeader("X-RateLimit-Reset" + suffix, String.valueOf(r.timeToExpire()));
  }

  /** accountTrackerFromBody of apps/api/src/common/throttling/account-throttle.ts. */
  private String accountTracker(HttpServletRequest req) {
    Map<String, Object> body = JsonBodyCache.get(req, mapper);
    if (!(body.get("email") instanceof String email)) return null;
    String normalized = Validation.normalizeEmail(email);
    return !normalized.isEmpty() && normalized.length() <= 254 ? "acct:" + normalized : null;
  }

  private static String sha256(String value) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
