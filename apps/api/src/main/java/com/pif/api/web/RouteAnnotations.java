package com.pif.api.web;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Route metadata equivalent to the NestJS decorators of the same names. */
public final class RouteAnnotations {

  private RouteAnnotations() {}

  /** @Public(): no access token required. */
  @Retention(RetentionPolicy.RUNTIME)
  @Target({ElementType.METHOD, ElementType.TYPE})
  public @interface Public {}

  /** @Throttle({ default: { limit, ttl } }) for the per-IP default throttler. */
  @Retention(RetentionPolicy.RUNTIME)
  @Target({ElementType.METHOD, ElementType.TYPE})
  public @interface Throttle {
    int limit();
    int ttlSeconds();
  }

  /** @AccountThrottle(limit, ttl): per-account limit keyed on the normalized email in the body. */
  @Retention(RetentionPolicy.RUNTIME)
  @Target(ElementType.METHOD)
  public @interface AccountThrottle {
    int limit();
    int ttlSeconds();
  }

  /** @UseGuards(CsrfGuard): origin verification for cookie-bearing auth routes. */
  @Retention(RetentionPolicy.RUNTIME)
  @Target(ElementType.TYPE)
  public @interface CsrfProtected {}

  /** @UseGuards(RolesGuard) + @Roles(...): the caller's role must be listed. */
  @Retention(RetentionPolicy.RUNTIME)
  @Target({ElementType.METHOD, ElementType.TYPE})
  public @interface Roles {
    String[] value();
  }
}
