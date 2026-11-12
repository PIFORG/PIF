package com.pif.api.trading;

import com.pif.api.admin.AdminDtos;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.PathParams;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/**
 * PortfoliosController of apps/api/src/trading/trading.controller.ts. When both the body (or query) and a route UUID
 * are invalid, NestJS reports the DTO validation error: its ValidationPipe rejects before the ParseUUIDPipe that runs
 * after it on the id parameter. Handlers therefore validate the DTO first, then the UUIDs (id before orderId).
 */
@RestController
@RequestMapping("/portfolios")
@Throttle(limit = 240, ttlSeconds = 60)
@Tag(name = "Portfolios")
public class PortfoliosController {

  private final PortfoliosService portfolios;
  private final ObjectMapper mapper;

  public PortfoliosController(PortfoliosService portfolios, ObjectMapper mapper) {
    this.portfolios = portfolios;
    this.mapper = mapper;
  }

  @GetMapping
  @Operation(summary = "List your portfolios", description = "Each portfolio with its server-computed valuation.")
  public Map<String, Object> list(HttpServletRequest req) {
    return portfolios.list(AuthUser.from(req));
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "Create a portfolio",
      description = "Funds a new virtual portfolio with the initial capital. No real money is involved.")
  @ApiDocs.Body("CreatePortfolioDto")
  public Map<String, Object> create(HttpServletRequest req) {
    return portfolios.create(AuthUser.from(req), TradingDtos.createPortfolio(JsonBodyCache.get(req, mapper)));
  }

  @GetMapping("/{id}")
  @Operation(summary = "Get a portfolio",
      description = "Cash, reserved cash, positions marked at mid, P&L and the version to send with orders.")
  public Map<String, Object> get(HttpServletRequest req, @PathVariable("id") String id) {
    return portfolios.get(AuthUser.from(req), PathParams.uuid(id));
  }

  @PostMapping("/{id}/cash-flows")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "Deposit or withdraw virtual cash",
      description = "External cash flow. Recorded in the cash ledger and excluded from performance.")
  @ApiDocs.Body("CashFlowDto")
  public Map<String, Object> cashFlow(HttpServletRequest req, @PathVariable("id") String id) {
    TradingDtos.CashFlow dto = TradingDtos.cashFlow(JsonBodyCache.get(req, mapper));
    return portfolios.cashFlow(AuthUser.from(req), PathParams.uuid(id), dto);
  }

  @GetMapping("/{id}/cash-entries")
  @Operation(summary = "Cash ledger", description = "Deposits, withdrawals and trade settlements, newest first, with "
      + "the balance after each entry.")
  @ApiDocs.Query("LimitQueryDto")
  public Map<String, Object> cashEntries(HttpServletRequest req, @PathVariable("id") String id) {
    TradingDtos.LimitQuery query = TradingDtos.limit(AdminDtos.query(req.getParameterMap()));
    return portfolios.cashEntries(AuthUser.from(req), PathParams.uuid(id), query);
  }

  @PostMapping("/{id}/orders/preview")
  @Tag(name = "Trading")
  @Operation(summary = "Preview an order", description = "Runs the same checks and cost estimate as submitting, on the "
      + "current quote. Nothing is recorded. Returns the version and quote time to submit with.")
  @ApiDocs.Body("PreviewOrderDto")
  public Map<String, Object> preview(HttpServletRequest req, @PathVariable("id") String id) {
    TradingDtos.OrderTerms dto = TradingDtos.previewOrder(JsonBodyCache.get(req, mapper));
    return portfolios.preview(AuthUser.from(req), PathParams.uuid(id), dto);
  }

  @PostMapping("/{id}/orders")
  @ResponseStatus(HttpStatus.CREATED)
  @Tag(name = "Trading")
  @Operation(summary = "Submit an order", description = "Idempotent by clientOrderId. Refused with 409 when the "
      + "portfolio version or the quote changed since the preview. Orders that fail pre-trade checks are recorded as "
      + "REJECTED with a reason.")
  @ApiDocs.Body("SubmitOrderDto")
  public Map<String, Object> submit(HttpServletRequest req, @PathVariable("id") String id) {
    TradingDtos.SubmitOrder dto = TradingDtos.submitOrder(JsonBodyCache.get(req, mapper));
    return portfolios.submit(AuthUser.from(req), PathParams.uuid(id), dto);
  }

  @GetMapping("/{id}/orders")
  @Tag(name = "Trading")
  @Operation(summary = "List orders", description = "Newest first. Filter open (working) or closed orders.")
  @ApiDocs.Query("OrderListQueryDto")
  public Map<String, Object> orders(HttpServletRequest req, @PathVariable("id") String id) {
    TradingDtos.OrderListQuery query = TradingDtos.orders(AdminDtos.query(req.getParameterMap()));
    return portfolios.orders(AuthUser.from(req), PathParams.uuid(id), query);
  }

  @GetMapping("/{id}/orders/{orderId}")
  @Tag(name = "Trading")
  @Operation(summary = "Get an order", description = "Order status and its executions.")
  public Map<String, Object> order(HttpServletRequest req, @PathVariable("id") String id,
      @PathVariable("orderId") String orderId) {
    UUID portfolioId = PathParams.uuid(id);
    return portfolios.order(AuthUser.from(req), portfolioId, PathParams.uuid(orderId));
  }

  @PostMapping("/{id}/orders/{orderId}/cancel")
  @Tag(name = "Trading")
  @Operation(summary = "Cancel an open order")
  public Map<String, Object> cancel(HttpServletRequest req, @PathVariable("id") String id,
      @PathVariable("orderId") String orderId) {
    UUID portfolioId = PathParams.uuid(id);
    return portfolios.cancel(AuthUser.from(req), portfolioId, PathParams.uuid(orderId), orderId);
  }

  @GetMapping("/{id}/executions")
  @Tag(name = "Trading")
  @Operation(summary = "Trade history", description = "Executions, newest first, with price, fee, spread cost, "
      + "realised P&L and the quote used.")
  @ApiDocs.Query("LimitQueryDto")
  public Map<String, Object> executions(HttpServletRequest req, @PathVariable("id") String id) {
    TradingDtos.LimitQuery query = TradingDtos.limit(AdminDtos.query(req.getParameterMap()));
    return portfolios.executions(AuthUser.from(req), PathParams.uuid(id), query);
  }

  @GetMapping("/{id}/analytics")
  @Operation(summary = "Portfolio analytics", description = "Valuation, reconciliation, allocation, concentration, "
      + "time- and money-weighted returns, VaR and expected shortfall, realised volatility, drawdown and stress tests, "
      + "methodology metadata, risk contributions and diversification. Metrics without enough data are null with a reason.")
  public Map<String, Object> analytics(HttpServletRequest req, @PathVariable("id") String id) {
    return portfolios.analytics(AuthUser.from(req), PathParams.uuid(id), id);
  }

  @PostMapping("/{id}/risk/pretrade")
  @Operation(summary = "Pre-trade risk impact", description = "Compares current vs proposed exposure, concentration, "
      + "cash and weights for a hypothetical fill. Does not place an order. Uses the same acceptance checks as "
      + "order preview; historical VaR is not recomputed.")
  @ApiDocs.Body("PreviewOrderDto")
  public Map<String, Object> preTradeRisk(HttpServletRequest req, @PathVariable("id") String id) {
    TradingDtos.OrderTerms dto = TradingDtos.previewOrder(JsonBodyCache.get(req, mapper));
    return portfolios.preTradeRisk(AuthUser.from(req), PathParams.uuid(id), dto);
  }

  @GetMapping("/{id}/history")
  @Operation(summary = "Equity history", description = "End-of-day equity since creation and the current valuation.")
  public Map<String, Object> history(HttpServletRequest req, @PathVariable("id") String id) {
    return portfolios.history(AuthUser.from(req), PathParams.uuid(id));
  }
}
