package com.pif.api.trading;

import com.pif.api.admin.AdminDtos;
import com.pif.api.backtest.BacktestDtos;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** MarketController of apps/api/src/trading/trading.controller.ts. */
@RestController
@RequestMapping("/market")
@Throttle(limit = 240, ttlSeconds = 60)
@Tag(name = "Markets")
public class MarketController {

  private final MarketService market;

  public MarketController(MarketService market) {
    this.market = market;
  }

  @GetMapping("/status")
  @Operation(summary = "Market status", description = "Price provider, data provenance (fictional, historical, delayed "
      + "or live), server time and the current quote period.")
  public Map<String, Object> status() {
    return market.status();
  }

  @GetMapping("/instruments")
  @Operation(summary = "List instruments", description = "Instrument master with trading terms, the current quote and "
      + "the change since the previous daily close. Filter by text or asset class.")
  @ApiDocs.Query("InstrumentQueryDto")
  public Map<String, Object> instruments(HttpServletRequest req) {
    return market.listInstruments(TradingDtos.instruments(AdminDtos.query(req.getParameterMap())));
  }

  @GetMapping("/instruments/{symbol}")
  @Operation(summary = "Get an instrument")
  public Map<String, Object> instrument(@PathVariable("symbol") String symbol) {
    return market.getInstrument(symbol);
  }

  @GetMapping("/instruments/{symbol}/history")
  @Operation(summary = "Price history", description = "1D: 5-minute mids; 5D: 30-minute mids; 1M, 3M, 6M and ALL: "
      + "daily closes plus the current mid.")
  @ApiDocs.Query("HistoryQueryDto")
  public Map<String, Object> history(HttpServletRequest req, @PathVariable("symbol") String symbol) {
    return market.history(symbol, TradingDtos.history(AdminDtos.query(req.getParameterMap())));
  }

  @GetMapping("/instruments/{symbol}/indicators")
  @Operation(summary = "Technical indicators", description = "SMA, EMA, RSI, MACD and Bollinger overlays on the same "
      + "mid series as history. Warm-up values are null. Provenance is FICTIONAL.")
  public Map<String, Object> indicators(HttpServletRequest req, @PathVariable("symbol") String symbol) {
    Map<String, String[]> query = req.getParameterMap();
    return market.indicators(symbol, BacktestDtos.historyRange(query), BacktestDtos.indicatorKinds(query));
  }

  @GetMapping("/watchlist")
  @Operation(summary = "Your watchlist")
  public Map<String, Object> watchlist(HttpServletRequest req) {
    return market.watchlist(AuthUser.from(req));
  }

  @PutMapping("/watchlist/{symbol}")
  @Operation(summary = "Add to your watchlist")
  public Map<String, Object> watch(HttpServletRequest req, @PathVariable("symbol") String symbol) {
    return market.addToWatchlist(AuthUser.from(req), symbol);
  }

  @DeleteMapping("/watchlist/{symbol}")
  @Operation(summary = "Remove from your watchlist")
  public Map<String, Object> unwatch(HttpServletRequest req, @PathVariable("symbol") String symbol) {
    return market.removeFromWatchlist(AuthUser.from(req), symbol);
  }
}
