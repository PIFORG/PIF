package com.pif.api.backtest;

import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
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

  @GetMapping("/strategies")
  @Operation(summary = "Catalogue des strategies de backtest")
  public Map<String, Object> strategies(HttpServletRequest req) {
    AuthUser.from(req);
    return Map.of(
        "strategies", List.of(
            strategy(BuyAndHoldStrategy.ID, "Acheter et conserver",
                "Poids egaux sur les symboles selectionnes apres chaque cloture (execution NEXT_CLOSE)."),
            strategy(MovingAverageCrossoverStrategy.ID, "Croisement de moyennes mobiles",
                "Position longue sur le premier symbole quand SMA courte > SMA longue ; sinon cash."),
            strategy(PeriodicRebalancingStrategy.ID, "Reequilibrage periodique",
                "Portefeuille equipondere recalcule toutes les N barres (defaut 21).")),
        "engine", "BacktestEngine",
        "executionConvention", "NEXT_CLOSE",
        "persistence", "NONE",
        "note",
        "Strategies deterministes rejouables sur cours fictifs. Pas de sauvegarde PostgreSQL des definitions.");
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

  private static Map<String, Object> strategy(String id, String title, String description) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", id);
    m.put("title", title);
    m.put("description", description);
    m.put("runPath", "/backtests/run");
    return m;
  }
}
