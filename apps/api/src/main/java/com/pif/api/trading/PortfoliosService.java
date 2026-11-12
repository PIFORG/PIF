package com.pif.api.trading;

import static com.pif.api.trading.TradingViews.dt;
import static com.pif.api.trading.TradingViews.evaluationView;
import static com.pif.api.trading.TradingViews.executionView;
import static com.pif.api.trading.TradingViews.orderView;
import static com.pif.api.trading.TradingViews.quoteView;

import com.pif.api.admin.AdminDtos;
import com.pif.api.data.Db;
import com.pif.api.finance.Holding;
import com.pif.api.finance.Ledger;
import com.pif.api.finance.Money;
import com.pif.api.finance.OrderSide;
import com.pif.api.finance.OrderType;
import com.pif.api.finance.Valuation;
import com.pif.api.market.MarketQuote;
import com.pif.api.market.PricePoint;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.Analytics.AnalyticsInput;
import com.pif.api.trading.Analytics.CashEntryInput;
import com.pif.api.trading.Analytics.EquityPoint;
import com.pif.api.trading.Analytics.ExecutionInput;
import com.pif.api.trading.Analytics.FlowPoint;
import com.pif.api.trading.Analytics.HoldingInput;
import com.pif.api.trading.Engine.Book;
import com.pif.api.trading.Engine.Evaluation;
import com.pif.api.trading.Engine.Fill;
import com.pif.api.trading.Engine.InstrumentTerms;
import com.pif.api.trading.Engine.OrderRequest;
import com.pif.api.trading.Engine.Period;
import com.pif.api.trading.Engine.WorkingOrder;
import com.pif.api.trading.TradingRepository.CashEntryRow;
import com.pif.api.trading.TradingRepository.ExecutionRow;
import com.pif.api.trading.TradingRepository.InstrumentRow;
import com.pif.api.trading.TradingRepository.NewExecution;
import com.pif.api.trading.TradingRepository.NewOrder;
import com.pif.api.trading.TradingRepository.NewSnapshot;
import com.pif.api.trading.TradingRepository.OrderRow;
import com.pif.api.trading.TradingRepository.PortfolioRow;
import com.pif.api.trading.TradingRepository.Sequences;
import com.pif.api.web.ApiException;
import com.pif.api.web.JsNumbers;
import com.pif.api.web.Messages;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * apps/api/src/trading/portfolios.service.ts. Every operation runs in one database transaction that first takes the
 * portfolio's row lock (SELECT … FOR UPDATE), so concurrent requests on the same portfolio are serialized by
 * PostgreSQL rather than by an application lock; then it loads the book, matches working orders against every quote
 * period since the last match, persists the result and only then performs the operation.
 */
@Service
public class PortfoliosService {

  private static final int RISK_WINDOW_DAYS = 250;
  private static final Duration DAY = Duration.ofDays(1);
  private static final Duration QUOTE_PERIOD = Duration.ofMillis(SimulatedMarketProvider.BUCKET_MS);

  private final TradingRepository repo;
  private final SimulatedMarketProvider provider;
  private final Clock clock;
  private final TransactionTemplate tx;

  public PortfoliosService(TradingRepository repo, SimulatedMarketProvider provider, Clock clock,
      PlatformTransactionManager txManager) {
    this.repo = repo;
    this.provider = provider;
    this.clock = clock;
    this.tx = new TransactionTemplate(txManager);
    this.tx.setTimeout(20);
  }

  private record OrderMeta(String clientOrderId, String requestHash, UUID instrumentId, MarketQuote quote) {}

  /** One locked unit of work on a portfolio. */
  private static final class Ctx {
    final Instant now;
    PortfolioRow row;
    final Book book;
    final Map<String, InstrumentRow> bySymbol;
    final Map<String, MarketQuote> quotes = new HashMap<>();

    Ctx(Instant now, PortfolioRow row, Book book, Map<String, InstrumentRow> bySymbol) {
      this.now = now;
      this.row = row;
      this.book = book;
      this.bySymbol = bySymbol;
    }
  }

  private static ApiException notFound() {
    return new ApiException(HttpStatus.NOT_FOUND, "PORTFOLIO_NOT_FOUND", Messages.get("portfolio.not_found"));
  }

  private Instant now() {
    return clock.instant().truncatedTo(ChronoUnit.MILLIS);
  }

  // ------------------------------------------------------------------ portfolios

  public Map<String, Object> create(AuthUser user, TradingDtos.CreatePortfolio dto) {
    long capital = (long) Money.toAmount(dto.initialCapital());
    Instant now = now();
    UUID id;
    try {
      id = tx.execute(status -> {
        repo.lockUserPortfolios(user.id());
        if (repo.countPortfolios(user.id()) >= TradingRules.MAX_PORTFOLIOS_PER_USER) {
          throw new ApiException(HttpStatus.CONFLICT, "PORTFOLIO_LIMIT",
              Messages.format("portfolio.limit", TradingRules.MAX_PORTFOLIOS_PER_USER));
        }
        UUID portfolioId = Db.newId();
        int weight = dto.maxPositionWeightPct() != null ? dto.maxPositionWeightPct()
            : TradingRules.DEFAULT_MAX_POSITION_WEIGHT_PCT;
        repo.insertPortfolio(portfolioId, user.id(), dto.name(), capital, weight, now);
        repo.insertCashEntry(portfolioId, 1, "DEPOSIT", capital, capital, null,
            Messages.get("portfolio.cash.initial"), now);
        repo.insertSnapshot(new NewSnapshot(portfolioId, "OPENING", 0, 0, 0, capital, capital, now));
        return portfolioId;
      });
    } catch (DuplicateKeyException e) {
      throw new ApiException(HttpStatus.CONFLICT, "PORTFOLIO_NAME_TAKEN", Messages.get("portfolio.name_taken"));
    }
    return get(user, id);
  }

  public Map<String, Object> list(AuthUser user) {
    List<Object> portfolios = new ArrayList<>();
    for (UUID id : repo.portfolioIds(user.id())) portfolios.add(run(user, id, this::summary));
    return Map.of("portfolios", portfolios);
  }

  public Map<String, Object> get(AuthUser user, UUID id) {
    return run(user, id, this::summary);
  }

  // ------------------------------------------------------------------ orders

  public Map<String, Object> preview(AuthUser user, UUID id, TradingDtos.OrderTerms dto) {
    OrderRequest request = toRequest(dto);
    return run(user, id, ctx -> {
      InstrumentRow instrument = instrument(ctx, request.symbol());
      MarketQuote quote = quote(ctx, instrument.symbol());
      double depthUsed = depthUsed(ctx, instrument.id(), request.side(), quote);
      Function<String, InstrumentTerms> termsOf = termsOf(ctx);
      Evaluation evaluation = Engine.evaluateOrder(ctx.book, request, termsOf.apply(request.symbol()), quote, termsOf,
          s -> quote(ctx, s).mid(), depthUsed);
      Map<String, Object> quoteJson = new LinkedHashMap<>();
      quoteJson.put("symbol", instrument.symbol());
      quoteJson.putAll(quoteView(quote));
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("portfolioVersion", ctx.row.version());
      m.put("quote", quoteJson);
      m.put("provenance", provider.provenance().toJson());
      m.putAll(evaluationView(evaluation));
      return m;
    });
  }

  public Map<String, Object> submit(AuthUser user, UUID id, TradingDtos.SubmitOrder dto) {
    OrderRequest request = toRequest(dto.terms());
    String requestHash = requestHash(request);
    try {
      return run(user, id, ctx -> {
        OrderRow existing = repo.orderByClientId(ctx.row.id(), dto.clientOrderId()).orElse(null);
        if (existing != null) {
          if (!existing.requestHash().equals(requestHash)) {
            throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                Messages.get("portfolio.idempotency_reused"));
          }
          return submitted(true, existing, null, ctx);
        }
        if (ctx.row.version() != dto.expectedVersion()) {
          throw new ApiException(HttpStatus.CONFLICT, "PORTFOLIO_CHANGED", Messages.get("portfolio.changed_loaded"),
              Map.of("currentVersion", ctx.row.version()));
        }
        InstrumentRow instrument = instrument(ctx, request.symbol());
        MarketQuote quote = quote(ctx, instrument.symbol());
        Instant previewed = AdminDtos.jsDateOrNull(dto.quoteAsOf());
        if (previewed == null || !quote.asOf().equals(previewed)) {
          throw new ApiException(HttpStatus.CONFLICT, "QUOTE_CHANGED", Messages.get("portfolio.quote_changed"),
              Map.of("quote", quoteView(quote)));
        }
        double depthUsed = depthUsed(ctx, instrument.id(), request.side(), quote);
        Function<String, InstrumentTerms> termsOf = termsOf(ctx);
        InstrumentTerms terms = termsOf.apply(request.symbol());
        Evaluation evaluation = Engine.evaluateOrder(ctx.book, request, terms, quote, termsOf,
            s -> quote(ctx, s).mid(), depthUsed);
        OrderMeta meta = new OrderMeta(dto.clientOrderId(), requestHash, instrument.id(), quote);

        if (evaluation.rejection() != null) {
          WorkingOrder rejected = WorkingOrder.open(UUID.randomUUID().toString(), request, ctx.now);
          rejected.status = "REJECTED";
          rejected.statusReason = evaluation.rejection().message();
          rejected.closedAt = ctx.now;
          repo.insertOrder(orderData(ctx, rejected, meta, repo.nextSequences(ctx.row.id()).order(),
              evaluation.rejection().code()));
          OrderRow saved = repo.order(ctx.row.id(), UUID.fromString(rejected.id)).orElseThrow();
          return submitted(false, saved, evaluation, ctx);
        }

        WorkingOrder order = WorkingOrder.open(UUID.randomUUID().toString(), request, ctx.now);
        Map<String, Double> depth = new HashMap<>();
        depth.put(request.symbol() + ":" + request.side().name(), depthUsed);
        List<Fill> fills = Engine.placeOrder(ctx.book, order, terms, quote, depth, ctx.now);
        persist(ctx, fills, Map.of(order.id, meta), true);
        OrderRow saved = repo.order(ctx.row.id(), UUID.fromString(order.id)).orElseThrow();
        return submitted(false, saved, evaluation, ctx);
      });
    } catch (DuplicateKeyException e) {
      throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_SUBMISSION", Messages.get("portfolio.duplicate_submission"));
    }
  }

  private Map<String, Object> submitted(boolean replayed, OrderRow order, Evaluation evaluation, Ctx ctx) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("replayed", replayed);
    m.put("order", orderView(order));
    m.put("executions", repo.executionsOfOrder(order.id()).stream().map(TradingViews::executionView).toList());
    m.put("evaluation", evaluation == null ? null : evaluationView(evaluation));
    m.put("portfolio", summary(ctx));
    return m;
  }

  /** {@code rawOrderId} is compared as sent with the in-memory ids, as the original compares strings. */
  public Map<String, Object> cancel(AuthUser user, UUID id, UUID orderId, String rawOrderId) {
    return run(user, id, ctx -> {
      WorkingOrder order = ctx.book.orders().stream()
          .filter(o -> o.id.equals(rawOrderId) && Engine.isWorking(o.status)).findFirst().orElse(null);
      if (order == null) {
        OrderRow row = repo.order(ctx.row.id(), orderId).orElseThrow(() ->
            new ApiException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND", Messages.get("portfolio.order_not_found")));
        String statusLabel = row.status().toLowerCase(java.util.Locale.FRENCH).replace('_', ' ');
        throw new ApiException(HttpStatus.CONFLICT, "ORDER_NOT_OPEN",
            Messages.format("portfolio.order_not_open", statusLabel));
      }
      Engine.cancelWorkingOrder(order, ctx.now);
      persist(ctx, List.of(), Map.of(), true);
      OrderRow saved = repo.order(ctx.row.id(), orderId).orElseThrow();
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("order", orderView(saved));
      m.put("portfolio", summary(ctx));
      return m;
    });
  }

  public Map<String, Object> orders(AuthUser user, UUID id, TradingDtos.OrderListQuery query) {
    return run(user, id, ctx -> {
      String status = query.status() == null ? "all" : query.status();
      List<OrderRow> rows = repo.orders(ctx.row.id(), status, query.limit() == null ? 100 : query.limit());
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("portfolioVersion", ctx.row.version());
      m.put("orders", rows.stream().map(TradingViews::orderView).toList());
      return m;
    });
  }

  public Map<String, Object> order(AuthUser user, UUID id, UUID orderId) {
    return run(user, id, ctx -> {
      OrderRow row = repo.order(ctx.row.id(), orderId).orElseThrow(() ->
          new ApiException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND", Messages.get("portfolio.order_not_found")));
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("order", orderView(row));
      m.put("executions", repo.executionsOfOrder(row.id()).stream().map(TradingViews::executionView).toList());
      return m;
    });
  }

  public Map<String, Object> executions(AuthUser user, UUID id, TradingDtos.LimitQuery query) {
    return run(user, id, ctx -> Map.of("executions", repo.executionsNewestFirst(ctx.row.id(),
        query.limit() == null ? 100 : query.limit()).stream().map(TradingViews::executionView).toList()));
  }

  // ------------------------------------------------------------------ cash

  public Map<String, Object> cashFlow(AuthUser user, UUID id, TradingDtos.CashFlow dto) {
    double amount = Money.toAmount(dto.amount());
    if (amount <= 0 || amount > TradingRules.MAX_CASH_FLOW) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", Messages.get("portfolio.amount_range"));
    }
    return run(user, id, ctx -> {
      if (ctx.row.version() != dto.expectedVersion()) {
        throw new ApiException(HttpStatus.CONFLICT, "PORTFOLIO_CHANGED", Messages.get("portfolio.changed"),
            Map.of("currentVersion", ctx.row.version()));
      }
      double contributions = ctx.row.netContributions();
      boolean deposit = "DEPOSIT".equals(dto.type());
      if (deposit && contributions + amount > TradingRules.MAX_NET_CONTRIBUTIONS) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "CONTRIBUTION_LIMIT",
            Messages.format("portfolio.contribution_limit",
                JsNumbers.toLocaleEnUs(dt(TradingRules.MAX_NET_CONTRIBUTIONS))));
      }
      double free = Engine.availableCash(ctx.book, termsOf(ctx));
      if (!deposit && amount > free) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "INSUFFICIENT_CASH",
            Messages.format("portfolio.insufficient_cash", JsNumbers.toFixed(dt(free), 3)));
      }
      double signed = deposit ? amount : -amount;
      double equityBefore = Engine.bookEquity(ctx.book, s -> quote(ctx, s).mid());
      double positionsValue = equityBefore - ctx.book.ledger().cash();
      ctx.book.ledger().addCash(signed);
      repo.insertSnapshot(new NewSnapshot(ctx.row.id(), "CASH_FLOW", (long) equityBefore,
          (long) (ctx.book.ledger().cash() - signed), (long) positionsValue, (long) (contributions + signed),
          (long) signed, ctx.now));
      repo.insertCashEntry(ctx.row.id(), repo.nextSequences(ctx.row.id()).cash(), dto.type(), (long) signed,
          (long) ctx.book.ledger().cash(), null,
          deposit ? Messages.get("portfolio.cash.deposit") : Messages.get("portfolio.cash.withdrawal"), ctx.now);
      ctx.row = repo.updateAfterCashFlow(ctx.row.id(), (long) ctx.book.ledger().cash(), (long) signed);
      return summary(ctx);
    });
  }

  public Map<String, Object> cashEntries(AuthUser user, UUID id, TradingDtos.LimitQuery query) {
    return run(user, id, ctx -> {
      List<CashEntryRow> rows = repo.cashEntriesNewestFirst(ctx.row.id(), query.limit() == null ? 100 : query.limit());
      return Map.of("entries", rows.stream().map(e -> {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.id().toString());
        m.put("type", e.type());
        m.put("amount", dt(e.amount()));
        m.put("balanceAfter", dt(e.balanceAfter()));
        m.put("executionId", e.executionId() == null ? null : e.executionId().toString());
        m.put("description", e.description());
        m.put("occurredAt", Db.iso(e.occurredAt()));
        m.put("sequence", e.sequence());
        return m;
      }).toList());
    });
  }

  // ------------------------------------------------------------------ analytics

  public Map<String, Object> analytics(AuthUser user, UUID id, String rawId) {
    return run(user, id, ctx -> {
      List<FlowPoint> flowPoints = repo.flowSnapshots(ctx.row.id()).stream()
          .map(s -> new FlowPoint(s.equity(), s.externalFlow(), s.asOf())).toList();
      List<CashEntryRow> cashEntries = repo.cashEntriesOldestFirst(ctx.row.id());
      List<ExecutionRow> executions = repo.executionsOldestFirst(ctx.row.id());
      long ledgerSum = repo.cashLedgerSum(ctx.row.id());
      List<HoldingInput> holdings = new ArrayList<>();
      for (Holding p : ctx.book.ledger().positions().values()) {
        InstrumentRow instrument = instrument(ctx, p.symbol());
        MarketQuote quote = quote(ctx, p.symbol());
        holdings.add(new HoldingInput(p.symbol(), instrument.name(), instrument.assetClass(), instrument.sector(),
            p.quantity(), p.costBasis(), quote.mid(), quote.bid(),
            TradingRules.FEE_SCHEDULES.get(instrument.assetClass())));
      }
      List<EquityPoint> dailyEquity = dailyEquity(ctx, cashEntries, executions);
      Map<String, double[]> instrumentReturns = new LinkedHashMap<>();
      for (HoldingInput h : holdings) {
        String providerSymbol = instrument(ctx, h.symbol()).providerSymbol();
        double[] closes = provider.dailyCloses(providerSymbol, ctx.now.minus(DAY.multipliedBy(RISK_WINDOW_DAYS + 1)),
            ctx.now).stream().mapToDouble(PricePoint::mid).toArray();
        double[] returns = new double[Math.max(0, closes.length - 1)];
        for (int i = 0; i < returns.length; i++) returns[i] = closes[i + 1] / closes[i] - 1;
        instrumentReturns.put(h.symbol(), returns);
      }
      Ledger ledger = ctx.book.ledger();
      Map<String, Object> result = Analytics.portfolioAnalytics(new AnalyticsInput(ctx.now, ctx.row.createdAt(),
          ledger.cash(), ledger.cash() - Engine.availableCash(ctx.book, termsOf(ctx)), ctx.row.netContributions(),
          ledger.realizedPnl(), ledger.feesPaid(), ledger.spreadCostPaid(), holdings, flowPoints, dailyEquity,
          instrumentReturns, ledgerSum, TradingRules.STRESS_SCENARIOS, TradingViews::dt));
      Map<String, Double> values = new LinkedHashMap<>();
      for (HoldingInput h : holdings) values.put(h.symbol(), Money.notional(h.mid(), h.quantity()));
      int observations = 0;
      Object risk = result.get("risk");
      if (risk instanceof Map<?, ?> riskMap && riskMap.get("observations") instanceof Number n) {
        observations = n.intValue();
      }
      List<String> symbols = new ArrayList<>(values.keySet());
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("portfolioId", rawId);
      m.put("asOf", Db.iso(ctx.now));
      m.put("currency", ctx.row.baseCurrency());
      m.put("provenance", provider.provenance().toJson());
      m.putAll(result);
      m.put("methodology", RiskStudio.methodology(ctx.row.baseCurrency(), observations, symbols.size()));
      m.put("riskContributions", RiskStudio.riskContributions(values, instrumentReturns, ledger.cash()
          + Valuation.totalValue(values), TradingViews::dt));
      m.put("diversification", RiskStudio.diversification(instrumentReturns, symbols));
      return m;
    });
  }

  /**
   * Hypothetical fill impact for the Risk Studio: current vs proposed exposure, concentration, cash and weights.
   * Does not place an order. Uses mid for valuation weights and ask/bid for cash movement (same as the desk).
   */
  public Map<String, Object> preTradeRisk(AuthUser user, UUID id, TradingDtos.OrderTerms dto) {
    OrderRequest request = toRequest(dto);
    return run(user, id, ctx -> {
      InstrumentRow instrument = instrument(ctx, request.symbol());
      MarketQuote quote = quote(ctx, instrument.symbol());
      double depthUsed = depthUsed(ctx, instrument.id(), request.side(), quote);
      Function<String, InstrumentTerms> termsOf = termsOf(ctx);
      Evaluation evaluation = Engine.evaluateOrder(ctx.book, request, termsOf.apply(request.symbol()), quote, termsOf,
          s -> quote(ctx, s).mid(), depthUsed);

      Map<String, Double> currentValues = new LinkedHashMap<>();
      for (Holding p : ctx.book.ledger().positions().values()) {
        currentValues.put(p.symbol(), Money.notional(quote(ctx, p.symbol()).mid(), p.quantity()));
      }
      double currentCash = ctx.book.ledger().cash();
      Double weightCap = (double) ctx.row.maxPositionWeightPct();
      Map<String, Object> current = RiskStudio.snapshot(currentCash, currentValues, weightCap);

      Map<String, Object> proposed = null;
      Map<String, Object> delta = null;
      if (evaluation.rejection() == null) {
        Map<String, Double> proposedValues = new LinkedHashMap<>(currentValues);
        double qty = request.quantity();
        double fillPrice = request.side() == OrderSide.BUY ? quote.ask() : quote.bid();
        double notional = Money.notional(fillPrice, qty);
        var fees = TradingRules.FEE_SCHEDULES.get(instrument.assetClass());
        double fee = Money.commission(notional, fees.feeBps(), fees.minFee());
        double proposedCash = request.side() == OrderSide.BUY ? currentCash - notional - fee : currentCash + notional - fee;
        Holding existing = ctx.book.ledger().positions().get(request.symbol());
        double held = existing == null ? 0 : existing.quantity();
        double newQty = request.side() == OrderSide.BUY ? held + qty : held - qty;
        if (newQty <= 1e-12) proposedValues.remove(request.symbol());
        else proposedValues.put(request.symbol(), Money.notional(quote.mid(), newQty));
        proposed = RiskStudio.snapshot(proposedCash, proposedValues, weightCap);
        delta = new LinkedHashMap<>();
        for (String key : List.of("cash", "positionsValue", "equity", "exposure", "largestWeight")) {
          delta.put(key, ((Number) proposed.get(key)).doubleValue() - ((Number) current.get(key)).doubleValue());
        }
      }

      Map<String, Object> quoteJson = new LinkedHashMap<>();
      quoteJson.put("symbol", instrument.symbol());
      quoteJson.putAll(quoteView(quote));
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("portfolioId", id.toString());
      m.put("asOf", Db.iso(ctx.now));
      m.put("currency", ctx.row.baseCurrency());
      m.put("provenance", provider.provenance().toJson());
      m.put("hypothetical", true);
      m.put("note", "Simulated immediate fill for risk comparison only. Authoritative acceptance still uses "
          + "POST /portfolios/{id}/orders/preview. Historical VaR is not recomputed here.");
      m.put("quote", quoteJson);
      m.put("evaluation", evaluationView(evaluation));
      m.put("current", moneySnapshot(current));
      m.put("proposed", proposed == null ? null : moneySnapshot(proposed));
      m.put("delta", delta == null ? null : moneyDelta(delta));
      return m;
    });
  }

  private static Map<String, Object> moneySnapshot(Map<String, Object> raw) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("cash", dt(((Number) raw.get("cash")).doubleValue()));
    m.put("positionsValue", dt(((Number) raw.get("positionsValue")).doubleValue()));
    m.put("equity", dt(((Number) raw.get("equity")).doubleValue()));
    m.put("exposure", raw.get("exposure"));
    m.put("largestWeight", raw.get("largestWeight"));
    m.put("hhi", raw.get("hhi"));
    m.put("effectiveHoldings", raw.get("effectiveHoldings"));
    m.put("maxPositionWeightPct", raw.get("maxPositionWeightPct"));
    m.put("withinPositionLimit", raw.get("withinPositionLimit"));
    return m;
  }

  private static Map<String, Object> moneyDelta(Map<String, Object> raw) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("cash", dt(((Number) raw.get("cash")).doubleValue()));
    m.put("positionsValue", dt(((Number) raw.get("positionsValue")).doubleValue()));
    m.put("equity", dt(((Number) raw.get("equity")).doubleValue()));
    m.put("exposure", raw.get("exposure"));
    m.put("largestWeight", raw.get("largestWeight"));
    return m;
  }

  public Map<String, Object> history(AuthUser user, UUID id) {
    return run(user, id, ctx -> {
      List<EquityPoint> points = dailyEquity(ctx, repo.cashEntriesOldestFirst(ctx.row.id()),
          repo.executionsOldestFirst(ctx.row.id()));
      double equity = Engine.bookEquity(ctx.book, s -> quote(ctx, s).mid());
      List<Object> out = new ArrayList<>();
      for (EquityPoint p : points) out.add(historyPoint(p.at(), p.equity(), p.netContributions(), false));
      out.add(historyPoint(ctx.now, equity, ctx.row.netContributions(), true));
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("convention", "End-of-day equity rebuilt from the cash ledger and executions, holdings marked at each daily "
          + "close; the last point is the current valuation.");
      m.put("points", out);
      return m;
    });
  }

  private static Map<String, Object> historyPoint(Instant at, double equity, double netContributions,
      boolean current) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("at", Db.iso(at));
    m.put("equity", dt(equity));
    m.put("netContributions", dt(netContributions));
    m.put("current", current);
    return m;
  }

  // ------------------------------------------------------------------ internals

  private <T> T run(AuthUser user, UUID id, Function<Ctx, T> fn) {
    return tx.execute(status -> {
      if (!repo.lockPortfolio(id, user.id())) throw notFound();
      Ctx ctx = load(id, now());
      sync(ctx);
      return fn.apply(ctx);
    });
  }

  private Ctx load(UUID id, Instant now) {
    PortfolioRow row = repo.portfolio(id);
    Map<String, InstrumentRow> bySymbol = new HashMap<>();
    Map<UUID, InstrumentRow> byId = new HashMap<>();
    for (InstrumentRow i : repo.instruments()) {
      bySymbol.put(i.symbol(), i);
      byId.put(i.id(), i);
    }
    Map<String, Holding> holdings = new LinkedHashMap<>();
    for (TradingRepository.PositionRow p : repo.positions(id)) {
      String symbol = byId.get(p.instrumentId()).symbol();
      holdings.put(symbol, new Holding(symbol, p.quantity(), p.costBasis()));
    }
    List<OrderRow> orders = repo.workingOrders(id);
    Map<UUID, Long> filledValue = repo.filledValues(orders.stream().map(OrderRow::id).toList());
    List<WorkingOrder> working = new ArrayList<>();
    for (OrderRow o : orders) {
      working.add(new WorkingOrder(o.id().toString(), o.symbol(), OrderSide.valueOf(o.side()),
          OrderType.valueOf(o.type()), o.quantity(), o.filledQuantity(), filledValue.getOrDefault(o.id(), 0L),
          o.limitPrice() == null ? null : o.limitPrice().doubleValue(),
          o.stopPrice() == null ? null : o.stopPrice().doubleValue(), o.triggered(), o.status(), o.statusReason(),
          o.submittedAt(), o.expiresAt(), o.closedAt(), false));
    }
    Ledger ledger = new Ledger(row.cash(), holdings, row.realizedPnl(), row.feesPaid(), row.spreadCost());
    return new Ctx(now, row, new Book(ledger, working, row.maxPositionWeightPct()), bySymbol);
  }

  /** Matches working orders against every quote period since the last match. Deterministic, so safe to repeat. */
  private void sync(Ctx ctx) {
    List<WorkingOrder> working = ctx.book.orders().stream().filter(o -> Engine.isWorking(o.status)).toList();
    if (working.isEmpty()) return;
    TreeMap<Instant, Map<String, MarketQuote>> periods = new TreeMap<>();
    Set<String> symbols = new LinkedHashSet<>();
    for (WorkingOrder o : working) symbols.add(o.symbol);
    for (String symbol : symbols) {
      InstrumentRow instrument = instrument(ctx, symbol);
      for (MarketQuote q : provider.quotesBetween(instrument.providerSymbol(), ctx.row.matchedThrough(), ctx.now)) {
        periods.computeIfAbsent(q.asOf(), k -> new HashMap<>()).put(symbol, q.withSymbol(symbol));
      }
    }
    List<Period> ordered = periods.entrySet().stream().map(e -> new Period(e.getKey(), e.getValue())).toList();
    List<Fill> fills = Engine.matchWorkingOrders(ctx.book, ordered, termsOf(ctx));
    persist(ctx, fills, Map.of(), !fills.isEmpty() || ctx.book.orders().stream().anyMatch(o -> o.changed));
  }

  /** Writes changed orders, fills, positions and balances; bumps the version when anything a decision depends on changed. */
  private void persist(Ctx ctx, List<Fill> fills, Map<String, OrderMeta> newOrders, boolean bump) {
    Book book = ctx.book;
    UUID portfolioId = ctx.row.id();
    Sequences next = !fills.isEmpty() || !newOrders.isEmpty() ? repo.nextSequences(portfolioId)
        : new Sequences(0, 0, 0);
    int nextOrder = next.order();
    int nextExecution = next.execution();
    int nextCash = next.cash();
    for (WorkingOrder order : book.orders()) {
      if (!order.changed) continue;
      OrderMeta meta = newOrders.get(order.id);
      if (meta != null) {
        repo.insertOrder(orderData(ctx, order, meta, nextOrder++, null));
      } else {
        repo.updateOrder(UUID.fromString(order.id), order.status, (int) order.filledQuantity,
            toLong(Engine.averagePrice(order)), order.triggered, order.statusReason, order.closedAt);
      }
      order.changed = false;
    }

    Map<String, WorkingOrder> byId = new HashMap<>();
    for (WorkingOrder o : book.orders()) byId.put(o.id, o);
    Instant lastAt = null;
    for (Fill fill : fills) {
      WorkingOrder order = byId.get(fill.orderId());
      Instant at = Engine.executedAt(fill, order);
      InstrumentRow instrument = instrument(ctx, fill.symbol());
      boolean buy = fill.side() == OrderSide.BUY;
      UUID executionId = repo.insertExecution(new NewExecution(UUID.fromString(fill.orderId()), portfolioId,
          nextExecution++, instrument.id(), fill.side().name(), (int) fill.quantity(), (long) fill.price(),
          (long) fill.notional(), (long) fill.fee(), (long) fill.spreadCost(), (long) fill.realizedPnl(),
          (long) fill.quote().mid(), (long) fill.quote().bid(), (long) fill.quote().ask(),
          provider.provenance().providerId(), at));
      repo.insertCashEntry(portfolioId, nextCash++, fill.side().name(),
          (long) (buy ? -(fill.notional() + fill.fee()) : fill.notional() - fill.fee()), (long) fill.cashAfter(),
          executionId, (buy ? "Bought" : "Sold") + " " + JsNumbers.toJsString(fill.quantity()) + " " + fill.symbol()
              + " at " + JsNumbers.toFixed(dt(fill.price()), 3) + " DT", at);
      lastAt = at;
    }

    Set<String> traded = new LinkedHashSet<>();
    for (Fill fill : fills) traded.add(fill.symbol());
    for (String symbol : traded) {
      UUID instrumentId = instrument(ctx, symbol).id();
      Holding position = book.ledger().positions().get(symbol);
      if (position == null || position.quantity() == 0) {
        repo.deletePosition(portfolioId, instrumentId);
      } else {
        repo.upsertPosition(portfolioId, instrumentId, (int) position.quantity(), (long) position.costBasis(),
            lastAt != null ? lastAt : ctx.now);
      }
    }

    Ledger ledger = book.ledger();
    ctx.row = repo.updateAfterTrading(portfolioId, (long) ledger.cash(), (long) ledger.realizedPnl(),
        (long) ledger.feesPaid(), (long) ledger.spreadCostPaid(), ctx.now, bump);

    if (lastAt != null) {
      double positionsValue = 0;
      for (Holding p : ledger.positions().values()) {
        MarketQuote q = provider.quote(instrument(ctx, p.symbol()).providerSymbol(), lastAt);
        if (q != null) positionsValue += Money.notional(q.mid(), p.quantity());
      }
      repo.insertSnapshot(new NewSnapshot(portfolioId, "POST_TRADE", (long) (ledger.cash() + positionsValue),
          (long) ledger.cash(), (long) positionsValue, ctx.row.netContributions(), 0, lastAt));
    }
  }

  private Map<String, Object> summary(Ctx ctx) {
    record Line(Holding p, InstrumentRow instrument, MarketQuote quote, double value) {}
    double cash = ctx.book.ledger().cash();
    double free = Engine.availableCash(ctx.book, termsOf(ctx));
    List<Line> lines = new ArrayList<>();
    for (Holding p : ctx.book.ledger().positions().values()) {
      if (!(p.quantity() > 0)) continue;
      MarketQuote quote = quote(ctx, p.symbol());
      lines.add(new Line(p, instrument(ctx, p.symbol()), quote, Money.notional(quote.mid(), p.quantity())));
    }
    double positionsValue = 0;
    for (Line l : lines) positionsValue += l.value();
    double equity = cash + positionsValue;
    double costBasis = 0;
    for (Line l : lines) costBasis += l.p().costBasis();
    double contributions = ctx.row.netContributions();
    long openOrders = ctx.book.orders().stream().filter(o -> Engine.isWorking(o.status)).count();
    List<Line> sorted = new ArrayList<>(lines);
    sorted.sort((a, b) -> {
      double d = b.value() - a.value();
      return d > 0 ? 1 : d < 0 ? -1 : 0;
    });
    final double totalEquity = equity;
    List<Object> positions = sorted.stream().map(l -> {
      Holding p = l.p();
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("symbol", p.symbol());
      m.put("name", l.instrument().name());
      m.put("assetClass", l.instrument().assetClass());
      m.put("sector", l.instrument().sector());
      m.put("quantity", p.quantity());
      m.put("averageCost", dt(Money.divRound(p.costBasis(), p.quantity())));
      m.put("costBasis", dt(p.costBasis()));
      m.put("price", dt(l.quote().mid()));
      m.put("bid", dt(l.quote().bid()));
      m.put("ask", dt(l.quote().ask()));
      m.put("marketValue", dt(l.value()));
      m.put("unrealizedPnl", dt(l.value() - p.costBasis()));
      m.put("unrealizedPct", p.costBasis() > 0 ? (l.value() - p.costBasis()) / p.costBasis() : null);
      m.put("weight", totalEquity > 0 ? l.value() / totalEquity : null);
      m.put("quoteAsOf", Db.iso(l.quote().asOf()));
      return (Object) m;
    }).toList();

    PortfolioRow row = ctx.row;
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", row.id().toString());
    m.put("name", row.name());
    m.put("baseCurrency", row.baseCurrency());
    m.put("status", row.status());
    m.put("version", row.version());
    m.put("createdAt", Db.iso(row.createdAt()));
    m.put("asOf", Db.iso(ctx.now));
    m.put("valuationConvention", Messages.get("portfolio.valuation_convention"));
    m.put("initialCapital", dt(row.initialCapital()));
    m.put("netContributions", dt(contributions));
    m.put("cash", dt(cash));
    m.put("reservedCash", dt(cash - free));
    m.put("availableCash", dt(free));
    m.put("positionsValue", dt(positionsValue));
    m.put("equity", dt(equity));
    m.put("profit", dt(equity - contributions));
    m.put("realizedPnl", dt(ctx.book.ledger().realizedPnl()));
    m.put("unrealizedPnl", dt(positionsValue - costBasis));
    m.put("feesPaid", dt(ctx.book.ledger().feesPaid()));
    m.put("spreadCost", dt(ctx.book.ledger().spreadCostPaid()));
    m.put("maxPositionWeightPct", row.maxPositionWeightPct());
    m.put("openOrders", openOrders);
    m.put("positions", positions);
    return m;
  }

  private List<EquityPoint> dailyEquity(Ctx ctx, List<CashEntryRow> cashEntries, List<ExecutionRow> executions) {
    return Analytics.reconstructDailyEquity(ctx.row.createdAt(), ctx.now, ctx.row.initialCapital(),
        cashEntries.stream().map(e -> new CashEntryInput(e.type(), e.amount(), e.balanceAfter(), e.occurredAt()))
            .toList(),
        executions.stream().map(e -> new ExecutionInput(e.symbol(), e.side(), e.quantity(), e.executedAt())).toList(),
        (symbol, at) -> {
          MarketQuote q = provider.quote(instrument(ctx, symbol).providerSymbol(), at);
          return q == null ? 0.0 : q.mid();
        });
  }

  private static OrderRequest toRequest(TradingDtos.OrderTerms dto) {
    if (!"LIMIT".equals(dto.type()) && dto.limitPrice() != null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", Messages.get("portfolio.limit_price_only"));
    }
    if (!"STOP".equals(dto.type()) && dto.stopPrice() != null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", Messages.get("portfolio.stop_price_only"));
    }
    return new OrderRequest(dto.symbol(), OrderSide.valueOf(dto.side()), OrderType.valueOf(dto.type()),
        dto.quantity(),
        "LIMIT".equals(dto.type()) && dto.limitPrice() != null ? Money.toAmount(dto.limitPrice()) : null,
        "STOP".equals(dto.type()) && dto.stopPrice() != null ? Money.toAmount(dto.stopPrice()) : null);
  }

  /** sha256 of JSON.stringify([symbol, side, type, quantity, limitPrice, stopPrice]). */
  static String requestHash(OrderRequest r) {
    String json = "[\"" + r.symbol() + "\",\"" + r.side().name() + "\",\"" + r.type().name() + "\","
        + JsNumbers.toJsString(r.quantity()) + "," + jsonNumber(r.limitPrice()) + "," + jsonNumber(r.stopPrice())
        + "]";
    try {
      return HexFormat.of().formatHex(
          MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String jsonNumber(Double value) {
    return value == null ? "null" : JsNumbers.toJsString(value);
  }

  private NewOrder orderData(Ctx ctx, WorkingOrder order, OrderMeta meta, int sequence, String rejectionCode) {
    return new NewOrder(UUID.fromString(order.id), ctx.row.id(), sequence, meta.instrumentId(), meta.clientOrderId(),
        meta.requestHash(), order.side.name(), order.type.name(), (int) order.quantity, toLong(order.limitPrice),
        toLong(order.stopPrice), order.triggered, order.status, (int) order.filledQuantity,
        toLong(Engine.averagePrice(order)), rejectionCode, order.statusReason, (long) meta.quote().mid(),
        (long) meta.quote().bid(), (long) meta.quote().ask(), meta.quote().asOf(),
        provider.provenance().providerId(), order.expiresAt, order.submittedAt, order.closedAt);
  }

  private static Long toLong(Double value) {
    return value == null ? null : (long) (double) value;
  }

  private double depthUsed(Ctx ctx, UUID instrumentId, OrderSide side, MarketQuote quote) {
    return repo.depthUsed(ctx.row.id(), instrumentId, side.name(), quote.asOf(), quote.asOf().plus(QUOTE_PERIOD));
  }

  private InstrumentRow instrument(Ctx ctx, String symbol) {
    InstrumentRow instrument = ctx.bySymbol.get(symbol);
    if (instrument == null) {
      throw new ApiException(HttpStatus.NOT_FOUND, "INSTRUMENT_NOT_FOUND", Messages.get("portfolio.instrument_not_found"));
    }
    return instrument;
  }

  private MarketQuote quote(Ctx ctx, String symbol) {
    MarketQuote quote = ctx.quotes.get(symbol);
    if (quote == null) {
      InstrumentRow instrument = instrument(ctx, symbol);
      MarketQuote q = provider.quote(instrument.providerSymbol(), ctx.now);
      if (q == null) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "NO_PRICE", Messages.get("portfolio.no_price"));
      }
      quote = q.withSymbol(symbol);
      ctx.quotes.put(symbol, quote);
    }
    return quote;
  }

  private Function<String, InstrumentTerms> termsOf(Ctx ctx) {
    return symbol -> {
      InstrumentRow i = instrument(ctx, symbol);
      return new InstrumentTerms(symbol, i.assetClass(), i.sector(), i.status(), i.lotSize(),
          TradingRules.FEE_SCHEDULES.get(i.assetClass()));
    };
  }
}
