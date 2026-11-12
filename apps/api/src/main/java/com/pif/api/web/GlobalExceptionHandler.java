package com.pif.api.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.web.HttpMediaTypeException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Error body of apps/api/src/common/filters/http-exception.filter.ts. */
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  /** Connection-level SQL states: connection exceptions, insufficient resources, admin shutdown. */
  private static final Set<String> UNAVAILABLE_STATE_PREFIXES = Set.of("08", "53", "57");
  /** undefined_table, undefined_column. */
  private static final Set<String> SCHEMA_OUTDATED_STATES = Set.of("42P01", "42703");

  @ExceptionHandler(ApiException.class)
  ResponseEntity<Map<String, Object>> api(ApiException e, HttpServletRequest req, HttpServletResponse res) {
    return body(e.status(), e.getMessage(), e.errorCode(), e.detailsValue(), req, res);
  }

  @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class,
      HttpRequestMethodNotSupportedException.class, HttpMediaTypeException.class})
  ResponseEntity<Map<String, Object>> notFound(Exception e, HttpServletRequest req, HttpServletResponse res) {
    return body(HttpStatus.NOT_FOUND,
        Messages.format("global.not_found", req.getMethod(), req.getRequestURI()),
        "RESOURCE_NOT_FOUND", null, req, res);
  }

  @ExceptionHandler(DataAccessException.class)
  ResponseEntity<Map<String, Object>> data(DataAccessException e, HttpServletRequest req, HttpServletResponse res) {
    String state = sqlState(e);
    if (e instanceof CannotGetJdbcConnectionException || e instanceof DataAccessResourceFailureException
        || (state != null && UNAVAILABLE_STATE_PREFIXES.contains(state.substring(0, 2)))) {
      log.warn("Database unavailable on {} {}", req.getMethod(), req.getRequestURI());
      return body(HttpStatus.SERVICE_UNAVAILABLE, Messages.get("global.database_unavailable"),
          "DATABASE_UNAVAILABLE", null, req, res);
    }
    if (state != null && SCHEMA_OUTDATED_STATES.contains(state)) {
      log.error("Database schema is behind the application on {} {}; run the pending Prisma migrations.",
          req.getMethod(), req.getRequestURI());
      return body(HttpStatus.SERVICE_UNAVAILABLE, Messages.get("global.schema_outdated"),
          "DATABASE_SCHEMA_OUTDATED", null, req, res);
    }
    return unexpected(e, req, res);
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, Object>> unexpected(Exception e, HttpServletRequest req, HttpServletResponse res) {
    log.error("Unhandled error on {} {}", req.getMethod(), req.getRequestURI(), e);
    return body(HttpStatus.INTERNAL_SERVER_ERROR, Messages.get("global.internal_error"), "INTERNAL_ERROR", null, req,
        res);
  }

  private static String sqlState(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof SQLException sql && sql.getSQLState() != null && sql.getSQLState().length() >= 2) {
        return sql.getSQLState();
      }
    }
    return null;
  }

  static ResponseEntity<Map<String, Object>> body(HttpStatus status, String message, String errorCode,
      Object details, HttpServletRequest req, HttpServletResponse res) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("statusCode", status.value());
    body.put("message", message);
    body.put("errorCode", errorCode);
    if (details != null) body.put("details", details);
    Object correlationId = req.getAttribute(RequestFilters.CORRELATION_ATTRIBUTE);
    if (correlationId != null) body.put("correlationId", correlationId);
    res.setHeader("Cache-Control", "no-store");
    return ResponseEntity.status(status).body(body);
  }
}
