package com.pif.api.crypto;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** validatePasswordPolicy of apps/api/src/common/crypto/password.util.ts. */
public final class PasswordPolicy {

  public static final int MIN_LENGTH = 8;
  public static final int MAX_LENGTH = 128;

  private static final Pattern LETTER = Pattern.compile("\\p{L}");
  private static final Pattern NUMBER = Pattern.compile("\\p{N}");
  /** JavaScript's \s inside the Unicode-mode class [^\p{L}\p{N}\s]. */
  private static final Pattern SYMBOL = Pattern.compile(
      "[^\\p{L}\\p{N}\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]");

  private PasswordPolicy() {}

  /** 8–128 characters (Unicode code points) with at least one letter, one number and one symbol. */
  public static List<String> errors(String password) {
    List<String> errors = new ArrayList<>();
    int length = password.codePointCount(0, password.length());
    if (length < MIN_LENGTH) errors.add("Le mot de passe doit contenir au moins " + MIN_LENGTH + " caracteres");
    if (length > MAX_LENGTH) errors.add("Le mot de passe doit contenir au plus " + MAX_LENGTH + " caracteres");
    if (!LETTER.matcher(password).find()) errors.add("Le mot de passe doit contenir une lettre");
    if (!NUMBER.matcher(password).find()) errors.add("Le mot de passe doit contenir un chiffre");
    if (!SYMBOL.matcher(password).find()) errors.add("Le mot de passe doit contenir un symbole");
    return errors;
  }
}
