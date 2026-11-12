package com.pif.api.crypto;

import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Same algorithms as apps/api/src/common/crypto/token.util.ts. */
public final class TokenCrypto {

  private static final SecureRandom RANDOM = new SecureRandom();
  private static final HexFormat HEX = HexFormat.of();

  private TokenCrypto() {}

  /** 32 cryptographically random bytes as 64 hex characters. */
  public static String generateOpaqueToken() {
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    return HEX.formatHex(bytes);
  }

  /** HMAC-SHA-256(pepper, token) hex digest; raw tokens are never stored. */
  public static String hashOpaqueToken(String token, String pepper) {
    return hmacHex(pepper, token);
  }

  public static String digestIp(String ip, String pepper) {
    if (ip == null || ip.isEmpty()) return null;
    String normalized = ip.strip();
    if (normalized.length() > 64) normalized = normalized.substring(0, 64);
    if (normalized.isEmpty()) return null;
    return hmacHex(pepper, normalized);
  }

  public static String sanitizeUserAgent(String ua) {
    if (ua == null || ua.isEmpty()) return null;
    String cleaned = ua.replaceAll("[\\r\\n\\x00]", "").strip();
    if (cleaned.length() > 512) cleaned = cleaned.substring(0, 512);
    return cleaned.isEmpty() ? null : cleaned;
  }

  /**
   * Formats a socket address the way Node reports it on a dual-stack listener
   * ("::ffff:127.0.0.1", "::1"), so IP digests and per-IP rate-limit keys match the NestJS API.
   */
  public static String nodeStyleAddress(String remoteAddr) {
    if (remoteAddr == null || remoteAddr.isBlank()) return null;
    try {
      InetAddress address = InetAddress.ofLiteral(remoteAddr.strip());
      if (address instanceof java.net.Inet4Address) return "::ffff:" + address.getHostAddress();
      return compressIpv6(address.getAddress());
    } catch (IllegalArgumentException e) {
      return remoteAddr.strip();
    }
  }

  private static String compressIpv6(byte[] bytes) {
    int[] groups = new int[8];
    for (int i = 0; i < 8; i++) groups[i] = ((bytes[2 * i] & 0xff) << 8) | (bytes[2 * i + 1] & 0xff);
    int bestStart = -1;
    int bestLen = 0;
    for (int i = 0; i < 8; ) {
      if (groups[i] != 0) {
        i++;
        continue;
      }
      int j = i;
      while (j < 8 && groups[j] == 0) j++;
      if (j - i > bestLen && j - i >= 2) {
        bestStart = i;
        bestLen = j - i;
      }
      i = j;
    }
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 8; i++) {
      if (i == bestStart) {
        sb.append("::");
        i += bestLen - 1;
        continue;
      }
      if (sb.length() > 0 && sb.charAt(sb.length() - 1) != ':') sb.append(':');
      sb.append(Integer.toHexString(groups[i]));
    }
    return sb.toString();
  }

  static String hmacHex(String key, String message) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return HEX.formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("HMAC-SHA-256 unavailable", e);
    }
  }
}
