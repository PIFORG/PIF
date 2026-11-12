package com.pif.api.crypto;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * AES-256-GCM MFA secret envelope of apps/api/src/common/crypto/mfa-crypto.util.ts:
 * {@code v1:} + base64(iv(12) || tag(16) || ciphertext). Java's GCM output is
 * ciphertext || tag, so the tag is moved to keep the stored format identical.
 */
public final class MfaCrypto {

  private static final int KEY_VERSION = 1;
  private static final SecureRandom RANDOM = new SecureRandom();

  private MfaCrypto() {}

  /** Stored in users.mfa_secret_key_version alongside each new envelope. */
  public static int keyVersion() {
    return KEY_VERSION;
  }

  public static String encrypt(String plaintext, String keyHex) {
    byte[] iv = new byte[12];
    RANDOM.nextBytes(iv);
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key(keyHex), new GCMParameterSpec(128, iv));
      byte[] out = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
      byte[] ct = Arrays.copyOfRange(out, 0, out.length - 16);
      byte[] tag = Arrays.copyOfRange(out, out.length - 16, out.length);
      byte[] packed = new byte[12 + 16 + ct.length];
      System.arraycopy(iv, 0, packed, 0, 12);
      System.arraycopy(tag, 0, packed, 12, 16);
      System.arraycopy(ct, 0, packed, 28, ct.length);
      return "v" + KEY_VERSION + ":" + Base64.getEncoder().encodeToString(packed);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("MFA secret encryption failed", e);
    }
  }

  public static String decrypt(String payload, String keyHex) {
    int colon = payload == null ? -1 : payload.indexOf(':');
    if (colon <= 0 || !payload.startsWith("v") || colon == payload.length() - 1) {
      throw new IllegalArgumentException("Invalid MFA ciphertext format");
    }
    byte[] buf = Base64.getDecoder().decode(payload.substring(colon + 1));
    if (buf.length < 28) throw new IllegalArgumentException("Invalid MFA ciphertext format");
    byte[] iv = Arrays.copyOfRange(buf, 0, 12);
    byte[] tag = Arrays.copyOfRange(buf, 12, 28);
    byte[] ct = Arrays.copyOfRange(buf, 28, buf.length);
    byte[] joined = new byte[ct.length + 16];
    System.arraycopy(ct, 0, joined, 0, ct.length);
    System.arraycopy(tag, 0, joined, ct.length, 16);
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key(keyHex), new GCMParameterSpec(128, iv));
      return new String(cipher.doFinal(joined), StandardCharsets.UTF_8);
    } catch (GeneralSecurityException e) {
      throw new IllegalArgumentException("MFA secret could not be decrypted", e);
    }
  }

  private static SecretKeySpec key(String keyHex) {
    if (keyHex == null || !keyHex.matches("^[0-9a-fA-F]{64}$")) {
      throw new IllegalStateException("MFA encryption key must be 64 hex characters");
    }
    return new SecretKeySpec(HexFormat.of().parseHex(keyHex), "AES");
  }
}
