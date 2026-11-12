package com.pif.api.health;

import com.pif.api.web.RouteAnnotations.Public;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/health")
@Tag(name = "System Health")
public class HealthController {

  private final JdbcClient jdbc;

  public HealthController(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  @Public
  @GetMapping
  @Operation(summary = "Check service health")
  public ResponseEntity<Map<String, Object>> check() {
    boolean up;
    try {
      jdbc.sql("SELECT 1").query(Integer.class).single();
      up = true;
    } catch (RuntimeException e) {
      up = false;
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("status", up ? "ok" : "degraded");
    body.put("database", up ? "up" : "down");
    return ResponseEntity.status(up ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).body(body);
  }
}
