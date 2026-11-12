package com.pif.api.web;

import java.text.MessageFormat;
import java.util.Locale;
import java.util.MissingResourceException;
import java.util.ResourceBundle;

/** User-facing API strings (French default). Keys remain ASCII; values live in messages*.properties. */
public final class Messages {

  private static final ResourceBundle BUNDLE = ResourceBundle.getBundle("messages", Locale.FRENCH);

  private Messages() {}

  public static String get(String key) {
    try {
      return BUNDLE.getString(key);
    } catch (MissingResourceException e) {
      return key;
    }
  }

  public static String format(String key, Object... args) {
    return MessageFormat.format(get(key), args);
  }
}
