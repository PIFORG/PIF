package com.pif.api.web;

import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/** Route parameter pipes. */
public final class PathParams {

  /** ParseUUIDPipe's default "all" pattern: any hex UUID layout, version not checked. */
  private static final Pattern UUID_ANY =
      Pattern.compile("^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$", Pattern.CASE_INSENSITIVE);

  private PathParams() {}

  /** ParseUUIDPipe: runs after the guards, like a NestJS pipe, because it is called from the handler. */
  public static UUID uuid(String value) {
    if (value == null || !UUID_ANY.matcher(value).matches()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", Messages.get("validation.uuid_expected"));
    }
    return UUID.fromString(value);
  }
}
