package com.pif.api.security;

import com.pif.api.data.UserRow;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;

/** The authenticated principal (AuthRequestUser): the user row plus the session of the access token. */
public record AuthUser(UserRow user, UUID sessionId) {

  public static final String ATTRIBUTE = "pif.authUser";

  public UUID id() {
    return user.id();
  }

  public static AuthUser from(HttpServletRequest req) {
    Object value = req.getAttribute(ATTRIBUTE);
    if (value instanceof AuthUser user) return user;
    throw new IllegalStateException("Route requires authentication but no principal was resolved");
  }
}
