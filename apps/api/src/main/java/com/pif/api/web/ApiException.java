package com.pif.api.web;

import java.util.List;
import org.springframework.http.HttpStatus;

/** An HTTP error rendered as {statusCode, message, errorCode, details?, correlationId}. */
public class ApiException extends RuntimeException {

  private final HttpStatus status;
  private final String errorCode;
  private final Object details;

  public ApiException(HttpStatus status, String errorCode, String message) {
    this(status, errorCode, message, (Object) null);
  }

  public ApiException(HttpStatus status, String errorCode, String message, List<String> details) {
    this(status, errorCode, message, (Object) details);
  }

  /** {@code details} is any JSON value (a map such as {@code {currentVersion: 3}}, or a list of messages). */
  public ApiException(HttpStatus status, String errorCode, String message, Object details) {
    super(message, null, false, false);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }

  public static ApiException validation(List<String> messages) {
    return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", Messages.get("validation.failed"), messages);
  }

  public HttpStatus status() { return status; }
  public String errorCode() { return errorCode; }

  /** Validation messages, or null when the details are not a list. */
  @SuppressWarnings("unchecked")
  public List<String> details() { return details instanceof List<?> list ? (List<String>) list : null; }

  public Object detailsValue() { return details; }
}
