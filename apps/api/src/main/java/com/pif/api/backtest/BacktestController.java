package com.pif.api.backtest;

import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** Synchronous historical backtests on fictional simulated prices. Auth required. No DB writes. */
@RestController
@RequestMapping("/backtests")
@Throttle(limit = 60, ttlSeconds = 60)
@Tag(name = "Backtesting")
public class BacktestController {

  private final BacktestService backtests;
  private final ObjectMapper mapper;

  public BacktestController(BacktestService backtests, ObjectMapper mapper) {
    this.backtests = backtests;
    this.mapper = mapper;
  }

  @PostMapping("/run")
  @Operation(summary = "Run a historical backtest",
      description = "Replays a rule-based strategy on fictional daily closes. Synchronous v1 result (no job queue). "
          + "Provenance is always FICTIONAL. Does not write to the trading database.")
  @ApiDocs.Body("RunBacktestDto")
  public Map<String, Object> run(HttpServletRequest req) {
    AuthUser.from(req); // require authenticated principal
    return backtests.run(BacktestDtos.run(JsonBodyCache.get(req, mapper)));
  }
}
