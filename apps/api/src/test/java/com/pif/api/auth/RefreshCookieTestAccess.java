package com.pif.api.auth;

import com.pif.api.config.PifProperties;
import java.time.Instant;
import org.springframework.mock.env.MockEnvironment;

/** Exposes RefreshCookie serialization with default cookie settings to tests in other packages. */
public final class RefreshCookieTestAccess {

  private RefreshCookieTestAccess() {}

  private static RefreshCookie cookie() {
    return new RefreshCookie(new PifProperties(new MockEnvironment()
        .withProperty("JWT_ACCESS_SECRET", "s".repeat(40))
        .withProperty("AUTH_TOKEN_PEPPER", "p")
        .withProperty("AUTH_IP_HASH_PEPPER", "q")
        .withProperty("MFA_ENCRYPTION_KEY", "00".repeat(32))));
  }

  public static String set(String value, Instant expires) {
    return cookie().serialize(value, expires);
  }

  public static String clear() {
    return cookie().serialize("", Instant.EPOCH);
  }
}
