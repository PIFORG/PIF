package com.pif.api.security;

import com.pif.api.data.AuthRepository;
import com.pif.api.data.Db;
import com.pif.api.data.UserRow;
import com.pif.api.web.ApiException;
import com.pif.api.web.Messages;
import com.pif.api.web.RouteAnnotations.Public;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Global access-token guard (JwtAuthGuard + JwtStrategy.validate), applied to every route not
 * marked @Public. Signature/expiry failures are a plain 401 UNAUTHENTICATED, as with passport-jwt.
 */
@Component
public class JwtAuthInterceptor implements HandlerInterceptor {

  private static final Duration ACTIVITY_WRITE_INTERVAL = Duration.ofMinutes(5);

  private final JwtService jwt;
  private final AuthRepository repo;

  public JwtAuthInterceptor(JwtService jwt, AuthRepository repo) {
    this.jwt = jwt;
    this.repo = repo;
  }

  @Override
  public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
    if (!(handler instanceof HandlerMethod method)) return true;
    if (method.hasMethodAnnotation(Public.class) || method.getBeanType().isAnnotationPresent(Public.class)) {
      return true;
    }
    String header = req.getHeader("Authorization");
    if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) throw unauthenticated();
    Instant now = Db.now();
    JwtService.AccessClaims claims = jwt.verify(header.substring(7).strip(), now);
    if (claims == null) throw unauthenticated();
    req.setAttribute(AuthUser.ATTRIBUTE, validate(claims, now));
    return true;
  }

  private AuthUser validate(JwtService.AccessClaims claims, Instant now) {
    UUID userId = parseUuid(claims.sub());
    UUID sessionId = parseUuid(claims.sid());
    if (claims.sub() == null || claims.sid() == null) throw invalidToken();
    // Prisma rejects malformed UUIDs with an error; treat them as invalid tokens.
    if (userId == null || sessionId == null) throw invalidToken();

    UserRow user = repo.findUserById(userId).orElse(null);
    if (user == null || user.deletedAt() != null) throw invalidToken();
    if (!"ACTIVE".equals(user.status()) || !user.emailVerified()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "ACCOUNT_NOT_ELIGIBLE", Messages.get("auth.account_not_eligible"));
    }
    if (claims.sv() == null || claims.sv() != user.securityVersion()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "CREDENTIALS_ROTATED", Messages.get("auth.credentials_rotated"));
    }
    AuthRepository.SessionRow session = repo.findActiveSession(sessionId, user.id(), now)
        .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_REVOKED",
            Messages.get("auth.session_revoked")));

    Instant threshold = now.minus(ACTIVITY_WRITE_INTERVAL);
    if (user.lastActiveAt() == null || user.lastActiveAt().isBefore(threshold)) {
      repo.touchUserActive(user.id(), now);
    }
    if (session.lastSeenAt().isBefore(threshold)) {
      repo.touchSession(session.id(), now);
    }
    return new AuthUser(user, session.id());
  }

  private static UUID parseUuid(String value) {
    if (value == null) return null;
    try {
      return UUID.fromString(value);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  private static ApiException unauthenticated() {
    return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", Messages.get("auth.unauthorized"));
  }

  private static ApiException invalidToken() {
    return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TOKEN", Messages.get("auth.invalid_access_token"));
  }
}
