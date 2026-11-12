package com.pif.api.web;

import com.pif.api.config.PifProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Servlet filters reproducing the Express middleware order of apps/api/src/main.ts:
 * helmet → cors → correlation id → no-store.
 */
@Configuration
public class RequestFilters {

  public static final String CORRELATION_ATTRIBUTE = "pif.correlationId";

  /** Accepted inbound correlation IDs; anything else is replaced so logs cannot be forged. */
  static final Pattern CORRELATION_ID_PATTERN = Pattern.compile("^[A-Za-z0-9._:-]{1,64}$");

  static final String CSP = "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';"
      + "frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';"
      + "style-src 'self' https: 'unsafe-inline'";

  @Bean
  FilterRegistrationBean<OncePerRequestFilter> securityHeadersFilter(PifProperties props) {
    String csp = props.isProduction() ? CSP + ";upgrade-insecure-requests" : CSP;
    OncePerRequestFilter filter = new OncePerRequestFilter() {
      @Override
      protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
          throws ServletException, IOException {
        res.setHeader("Content-Security-Policy", csp);
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Origin-Agent-Cluster", "?1");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-DNS-Prefetch-Control", "off");
        res.setHeader("X-Download-Options", "noopen");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
        res.setHeader("X-XSS-Protection", "0");
        chain.doFilter(req, res);
      }
    };
    return register(filter, -300);
  }

  /** Behaviour of the `cors` package with an origin allowlist and credentials (Nest enableCors). */
  @Bean
  FilterRegistrationBean<OncePerRequestFilter> corsFilter(PifProperties props) {
    OncePerRequestFilter filter = new OncePerRequestFilter() {
      @Override
      protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
          throws ServletException, IOException {
        String origin = req.getHeader("Origin");
        boolean allowed = origin != null && props.corsOrigins().contains(origin);
        if (allowed) res.setHeader("Access-Control-Allow-Origin", origin);
        res.addHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
        if ("OPTIONS".equalsIgnoreCase(req.getMethod())) {
          res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE");
          String requested = req.getHeader("Access-Control-Request-Headers");
          if (requested != null) {
            res.setHeader("Access-Control-Allow-Headers", requested);
            res.addHeader("Vary", "Access-Control-Request-Headers");
          }
          res.setStatus(204);
          res.setContentLength(0);
          return;
        }
        chain.doFilter(req, res);
      }
    };
    return register(filter, -200);
  }

  @Bean
  FilterRegistrationBean<OncePerRequestFilter> correlationFilter() {
    OncePerRequestFilter filter = new OncePerRequestFilter() {
      @Override
      protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
          throws ServletException, IOException {
        String inbound = req.getHeader("x-correlation-id");
        if (inbound == null) inbound = req.getHeader("x-request-id");
        String id = inbound != null && CORRELATION_ID_PATTERN.matcher(inbound).matches()
            ? inbound
            : UUID.randomUUID().toString();
        req.setAttribute(CORRELATION_ATTRIBUTE, id);
        res.setHeader("x-correlation-id", id);
        // Every API response carries per-user identity data; browsers and proxies must not store it.
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");
        MDC.put("correlationId", id);
        try {
          chain.doFilter(req, res);
        } finally {
          MDC.remove("correlationId");
        }
      }
    };
    return register(filter, -150);
  }

  private static FilterRegistrationBean<OncePerRequestFilter> register(OncePerRequestFilter filter, int order) {
    FilterRegistrationBean<OncePerRequestFilter> bean = new FilterRegistrationBean<>(filter);
    bean.setOrder(order);
    bean.addUrlPatterns("/*");
    return bean;
  }
}
