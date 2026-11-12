package com.pif.api.data;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** A row of "user_preferences" (Prisma model UserPreferences). */
public record PreferencesRow(
    UUID userId,
    String preferredCurrency,
    String timezone,
    String chartTheme,
    boolean notifyEmailSecurity,
    boolean notifyMarketDigest,
    String trainingDifficulty,
    boolean reduceMotion,
    boolean highContrast) {

  public static final String COLUMNS = "user_id, preferred_currency, timezone, chart_theme, notify_email_security, "
      + "notify_market_digest, training_difficulty, reduce_motion, high_contrast";

  public static PreferencesRow map(ResultSet rs, int rowNum) throws SQLException {
    return new PreferencesRow(
        Db.uuid(rs, "user_id"),
        rs.getString("preferred_currency"),
        rs.getString("timezone"),
        rs.getString("chart_theme"),
        rs.getBoolean("notify_email_security"),
        rs.getBoolean("notify_market_digest"),
        rs.getString("training_difficulty"),
        rs.getBoolean("reduce_motion"),
        rs.getBoolean("high_contrast"));
  }

  /** serializePreferences of apps/api/src/common/serializers/user.serializer.ts. */
  public Map<String, Object> toJson() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("preferredCurrency", preferredCurrency);
    m.put("timezone", timezone);
    m.put("chartTheme", chartTheme);
    m.put("notifyEmailSecurity", notifyEmailSecurity);
    m.put("notifyMarketDigest", notifyMarketDigest);
    m.put("trainingDifficulty", trainingDifficulty);
    m.put("reduceMotion", reduceMotion);
    m.put("highContrast", highContrast);
    return m;
  }
}
