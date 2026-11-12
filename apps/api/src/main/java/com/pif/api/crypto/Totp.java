package com.pif.api.crypto;

import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * RFC 6238 TOTP with the otplib {@code authenticator} defaults used by the NestJS API:
 * base32 secret, HMAC-SHA1, 6 digits, 30-second step, window of one step either side.
 */
public final class Totp {

  public static final int STEP_SECONDS = 30;
  private static final int WINDOW = 1;

  private Totp() {}

  /**
   * Same contract as otplib {@code authenticator.checkDelta}: the matching step offset
   * (current step first, then past, then future), or null when the code is not accepted.
   */
  public static Integer checkDelta(String code, String base32Secret, long epochMillis) {
    if (code == null || !code.matches("^\\d{6}$")) return null;
    byte[] key = Base32.decode(base32Secret);
    long counter = Math.floorDiv(epochMillis / 1000, STEP_SECONDS);
    if (matches(code, key, counter)) return 0;
    for (int i = 1; i <= WINDOW; i++) {
      if (matches(code, key, counter - i)) return -i;
    }
    for (int i = 1; i <= WINDOW; i++) {
      if (matches(code, key, counter + i)) return i;
    }
    return null;
  }

  public static long currentStep(long epochMillis) {
    return Math.floorDiv(epochMillis / 1000, STEP_SECONDS);
  }

  public static String generate(byte[] key, long counter) {
    try {
      Mac mac = Mac.getInstance("HmacSHA1");
      mac.init(new SecretKeySpec(key, "HmacSHA1"));
      byte[] hash = mac.doFinal(ByteBuffer.allocate(8).putLong(counter).array());
      int offset = hash[hash.length - 1] & 0x0f;
      int binary = ((hash[offset] & 0x7f) << 24)
          | ((hash[offset + 1] & 0xff) << 16)
          | ((hash[offset + 2] & 0xff) << 8)
          | (hash[offset + 3] & 0xff);
      return String.format("%06d", binary % 1_000_000);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("HMAC-SHA1 unavailable", e);
    }
  }

  private static boolean matches(String code, byte[] key, long counter) {
    return MessageDigest.isEqual(
        generate(key, counter).getBytes(StandardCharsets.US_ASCII), code.getBytes(StandardCharsets.US_ASCII));
  }

  /** RFC 4648 base32 (case-insensitive, padding optional), as used for authenticator secrets. */
  public static final class Base32 {
    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    private Base32() {}

    public static byte[] decode(String input) {
      String clean = input.replace("=", "").replace(" ", "").toUpperCase();
      ByteBuffer out = ByteBuffer.allocate(clean.length() * 5 / 8);
      int buffer = 0;
      int bits = 0;
      for (char c : clean.toCharArray()) {
        int value = ALPHABET.indexOf(c);
        if (value < 0) throw new IllegalArgumentException("Invalid base32 secret");
        buffer = (buffer << 5) | value;
        bits += 5;
        if (bits >= 8) {
          out.put((byte) ((buffer >> (bits - 8)) & 0xff));
          bits -= 8;
        }
      }
      return java.util.Arrays.copyOf(out.array(), out.position());
    }

    public static String encode(byte[] data) {
      StringBuilder sb = new StringBuilder();
      int buffer = 0;
      int bits = 0;
      for (byte b : data) {
        buffer = (buffer << 8) | (b & 0xff);
        bits += 8;
        while (bits >= 5) {
          sb.append(ALPHABET.charAt((buffer >> (bits - 5)) & 31));
          bits -= 5;
        }
      }
      if (bits > 0) sb.append(ALPHABET.charAt((buffer << (5 - bits)) & 31));
      return sb.toString();
    }
  }
}
