package com.pif.api.data;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

/**
 * Timestamp conventions shared with Prisma: columns are TIMESTAMP(3) WITHOUT TIME ZONE holding UTC.
 * Values are always bound explicitly as UTC LocalDateTime truncated to milliseconds; database
 * defaults such as CURRENT_TIMESTAMP are never relied on because the server time zone is not UTC.
 */
public final class Db {

  private static final DateTimeFormatter ISO_MILLIS =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

  private Db() {}

  public static Instant now() {
    return Instant.now().truncatedTo(ChronoUnit.MILLIS);
  }

  public static LocalDateTime ts(Instant instant) {
    return instant == null ? null : LocalDateTime.ofInstant(instant.truncatedTo(ChronoUnit.MILLIS), ZoneOffset.UTC);
  }

  public static Instant instant(ResultSet rs, String column) throws SQLException {
    LocalDateTime value = rs.getObject(column, LocalDateTime.class);
    return value == null ? null : value.toInstant(ZoneOffset.UTC);
  }

  /** JavaScript Date#toISOString format, as serialized by the NestJS API. */
  public static String iso(Instant instant) {
    return instant == null ? null : ISO_MILLIS.format(instant);
  }

  public static UUID uuid(ResultSet rs, String column) throws SQLException {
    return rs.getObject(column, UUID.class);
  }

  /** Prisma generates UUID v4 identifiers in the application; no database default exists. */
  public static UUID newId() {
    return UUID.randomUUID();
  }
}
