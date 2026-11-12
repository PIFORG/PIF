package com.pif.api.web;

import com.pif.api.security.JwtAuthInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Global prefix "api" and the NestJS guard order: JwtAuthGuard → ThrottlerGuard → controller guards. */
@Configuration
public class WebConfig implements WebMvcConfigurer {

  private static final String APP_PACKAGE = "com.pif.api.";

  private final JwtAuthInterceptor jwt;
  private final ThrottleInterceptor throttle;
  private final CsrfInterceptor csrf;
  private final RolesInterceptor roles;

  public WebConfig(JwtAuthInterceptor jwt, ThrottleInterceptor throttle, CsrfInterceptor csrf,
      RolesInterceptor roles) {
    this.jwt = jwt;
    this.throttle = throttle;
    this.csrf = csrf;
    this.roles = roles;
  }

  @Override
  public void configurePathMatch(PathMatchConfigurer configurer) {
    configurer.addPathPrefix("/api", type -> type.getPackageName().startsWith(APP_PACKAGE)
        && type.isAnnotationPresent(org.springframework.web.bind.annotation.RestController.class));
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(appOnly(jwt)).order(1);
    registry.addInterceptor(appOnly(throttle)).order(2);
    registry.addInterceptor(appOnly(csrf)).order(3);
    registry.addInterceptor(appOnly(roles)).order(4);
  }

  /**
   * Guards cover this application's controllers only. In NestJS, Swagger is Express middleware outside
   * the guard chain, so the API docs (springdoc controllers here) must not require a token either.
   */
  static HandlerInterceptor appOnly(HandlerInterceptor delegate) {
    return new HandlerInterceptor() {
      @Override
      public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) throws Exception {
        return !isAppHandler(handler) || delegate.preHandle(req, res, handler);
      }
    };
  }

  static boolean isAppHandler(Object handler) {
    return handler instanceof HandlerMethod method && method.getBeanType().getPackageName().startsWith(APP_PACKAGE);
  }
}
