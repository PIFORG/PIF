package com.pif.api.crypto;

import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Argon2id with the parameters of apps/api/src/common/crypto/password.util.ts
 * (m=19456 KiB, t=2, p=1, 16-byte salt, 32-byte hash) in the PHC string format node-argon2 writes,
 * so existing password hashes verify unchanged and new hashes verify in NestJS.
 */
@Component
public class PasswordHasher {

  /** Verified against when the account is unknown or locked, to keep response timing uniform. */
  public static final String DUMMY_HASH =
      "$argon2id$v=19$m=19456,t=2,p=1$alUobNvgu1tuBMUZNRqvVg$jfNVQH4G1DIHiyJwQp7rk4KxYlNKCV3tUlEcEVQXuXk";

  private final Argon2PasswordEncoder encoder = new Argon2PasswordEncoder(16, 32, 1, 19456, 2);

  public String hash(String password) {
    return encoder.encode(password);
  }

  public boolean verify(String hash, String password) {
    if (hash == null || password == null) return false;
    try {
      return encoder.matches(password, hash);
    } catch (RuntimeException e) {
      return false;
    }
  }
}
