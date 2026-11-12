package com.pif.api.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

/**
 * express.json(): JSON bodies are parsed once, before routing and guards, with the default
 * 100 KB limit. Invalid JSON is rejected here, so guards never see a half-parsed request.
 */
@Configuration
public class JsonBodyCache {

  static final String PARSED = "pif.jsonBody";
  private static final int LIMIT_BYTES = 100 * 1024;

  public static Map<String, Object> get(HttpServletRequest req, ObjectMapper mapper) {
    Object parsed = req.getAttribute(PARSED);
    if (parsed instanceof Map<?, ?>) {
      @SuppressWarnings("unchecked")
      Map<String, Object> body = (Map<String, Object>) parsed;
      return new LinkedHashMap<>(body);
    }
    return new LinkedHashMap<>();
  }

  @Bean
  FilterRegistrationBean<OncePerRequestFilter> jsonBodyFilter(ObjectMapper mapper) {
    OncePerRequestFilter filter = new OncePerRequestFilter() {
      @Override
      protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
          throws ServletException, IOException {
        String contentType = req.getContentType();
        if (contentType != null && contentType.toLowerCase().contains("json")) {
          byte[] raw;
          try (InputStream in = req.getInputStream()) {
            raw = in.readNBytes(LIMIT_BYTES + 1);
          }
          if (raw.length > LIMIT_BYTES) {
            write(res, req, mapper, HttpStatus.PAYLOAD_TOO_LARGE, "request entity too large", "REQUEST_FAILED");
            return;
          }
          try {
            req.setAttribute(PARSED, Validation.parseBody(mapper, new String(raw, StandardCharsets.UTF_8), contentType));
          } catch (ApiException e) {
            write(res, req, mapper, e.status(), e.getMessage(), e.errorCode());
            return;
          }
        }
        chain.doFilter(req, res);
      }
    };
    FilterRegistrationBean<OncePerRequestFilter> bean = new FilterRegistrationBean<>(filter);
    bean.setOrder(-140);
    bean.addUrlPatterns("/*");
    return bean;
  }

  private static void write(HttpServletResponse res, HttpServletRequest req, ObjectMapper mapper, HttpStatus status,
      String message, String errorCode) throws IOException {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("statusCode", status.value());
    body.put("message", message);
    body.put("errorCode", errorCode);
    Object correlationId = req.getAttribute(RequestFilters.CORRELATION_ATTRIBUTE);
    if (correlationId != null) body.put("correlationId", correlationId);
    res.setStatus(status.value());
    res.setHeader("Cache-Control", "no-store");
    res.setContentType("application/json; charset=utf-8");
    res.getOutputStream().write(mapper.writeValueAsBytes(body));
  }
}
