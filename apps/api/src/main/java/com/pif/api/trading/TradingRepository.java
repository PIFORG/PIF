package com.pif.api.trading;

import com.pif.api.data.Db;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Queries of apps/api/src/trading/market.service.ts and portfolios.service.ts on the Prisma-owned trading tables.
 * Identifiers and timestamps that Prisma fills in the client (ids, created_at, updated_at, recorded_at) are bound
 * explicitly. Callers that mutate a portfolio hold its row lock (see {@link #lockPortfolio}).
 */
@Repository
public class TradingRepository {

  public record InstrumentRow(UUID id, String symbol, String name, String assetClass, String sector,
      String quoteCurrency, String status, int priceDecimals, int quantityDecimals, int lotSize, String providerId,
      String providerSymbol, boolean fictional) {}

  public record PortfolioRow(UUID id, UUID userId, String name, String baseCurrency, String status,
      long initialCapital, long cash, long netContributions, long realizedPnl, long feesPaid, long spreadCost,
      int maxPositionWeightPct, int version, Instant matchedThrough, Instant createdAt) {}

  public record PositionRow(UUID instrumentId, int quantity, long costBasis) {}

  public record OrderRow(UUID id, String symbol, String clientOrderId, String requestHash, String side, String type,
      int quantity, Long limitPrice, Long stopPrice, boolean triggered, String status, int filledQuantity,
      Long averagePrice, String rejectionCode, String statusReason, long quoteMid, long quoteBid, long quoteAsk,
      Instant quoteAsOf, String providerId, Instant expiresAt, Instant submittedAt, Instant closedAt, int sequence) {}

  public record ExecutionRow(UUID id, UUID orderId, String symbol, String side, int quantity, long price,
      long notional, long fee, long spreadCost, long realizedPnl, long quoteMid, long quoteBid, long quoteAsk,
      String providerId, Instant executedAt, int sequence, Instant recordedAt) {}

  public record CashEntryRow(UUID id, String type, long amount, long balanceAfter, UUID executionId,
      String description, Instant occurredAt, int sequence) {}

  public record FlowSnapshotRow(long equity, long externalFlow, Instant asOf) {}

  public record WatchRow(Instant createdAt, InstrumentRow instrument) {}

  public record Sequences(int order, int execution, int cash) {}

  public record NewOrder(UUID id, UUID portfolioId, int sequence, UUID instrumentId, String clientOrderId,
      String requestHash, String side, String type, int quantity, Long limitPrice, Long stopPrice, boolean triggered,
      String status, int filledQuantity, Long averagePrice, String rejectionCode, String statusReason, long quoteMid,
      long quoteBid, long quoteAsk, Instant quoteAsOf, String providerId, Instant expiresAt, Instant submittedAt,
      Instant closedAt) {}

  public record NewExecution(UUID orderId, UUID portfolioId, int sequence, UUID instrumentId, String side,
      int quantity, long price, long notional, long fee, long spreadCost, long realizedPnl, long quoteMid,
      long quoteBid, long quoteAsk, String providerId, Instant executedAt) {}

  public record NewSnapshot(UUID portfolioId, String kind, long equity, long cash, long positionsValue,
      long netContributions, long externalFlow, Instant asOf) {}

  private static final String INSTRUMENT_COLUMNS = "i.id, i.symbol, i.name, i.asset_class::text AS asset_class, "
      + "i.sector, i.quote_currency, i.status::text AS status, i.price_decimals, i.quantity_decimals, i.lot_size, "
      + "i.provider_id, i.provider_symbol, i.fictional";

  private static final String PORTFOLIO_COLUMNS = "id, user_id, name, base_currency, status::text AS status, "
      + "initial_capital_millimes, cash_millimes, net_contributions_millimes, realized_pnl_millimes, "
      + "fees_paid_millimes, spread_cost_millimes, max_position_weight_pct, version, matched_through, created_at";

  private static final String ORDER_COLUMNS = "o.id, i.symbol, o.client_order_id, o.request_hash, "
      + "o.side::text AS side, o.type::text AS type, o.quantity, o.limit_price_millimes, o.stop_price_millimes, "
      + "o.triggered, o.status::text AS status, o.filled_quantity, o.average_price_millimes, o.rejection_code, "
      + "o.status_reason, o.quote_mid_millimes, o.quote_bid_millimes, o.quote_ask_millimes, o.quote_as_of, "
      + "o.provider_id, o.expires_at, o.submitted_at, o.closed_at, o.sequence";

  private static final String EXECUTION_COLUMNS = "e.id, e.order_id, i.symbol, e.side::text AS side, e.quantity, "
      + "e.price_millimes, e.notional_millimes, e.fee_millimes, e.spread_cost_millimes, e.realized_pnl_millimes, "
      + "e.quote_mid_millimes, e.quote_bid_millimes, e.quote_ask_millimes, e.provider_id, e.executed_at, e.sequence, "
      + "e.recorded_at";

  private static final String CASH_COLUMNS = "id, type::text AS type, amount_millimes, balance_after_millimes, "
      + "execution_id, description, occurred_at, sequence";

  private final JdbcClient jdbc;

  public TradingRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  // ---------- instruments and watchlist ----------

  public List<InstrumentRow> instruments() {
    return jdbc.sql("SELECT " + INSTRUMENT_COLUMNS + " FROM instruments i").query(TradingRepository::instrument).list();
  }

  /** Prisma `contains` + mode "insensitive" on symbol, name or sector: ILIKE '%q%' with the value unescaped. */
  public List<InstrumentRow> searchInstruments(String assetClass, String q) {
    StringBuilder sql = new StringBuilder("SELECT " + INSTRUMENT_COLUMNS + " FROM instruments i WHERE 1 = 1");
    List<Object> params = new ArrayList<>();
    if (assetClass != null) {
      sql.append(" AND i.asset_class = ?::\"InstrumentAssetClass\"");
      params.add(assetClass);
    }
    if (q != null) {
      sql.append(" AND (i.symbol ILIKE ? OR i.name ILIKE ? OR i.sector ILIKE ?)");
      String like = "%" + q + "%";
      params.add(like);
      params.add(like);
      params.add(like);
    }
    sql.append(" ORDER BY i.symbol ASC");
    return jdbc.sql(sql.toString()).params(params).query(TradingRepository::instrument).list();
  }

  public Optional<InstrumentRow> instrumentBySymbol(String symbol) {
    return jdbc.sql("SELECT " + INSTRUMENT_COLUMNS + " FROM instruments i WHERE i.symbol = ?")
        .param(symbol).query(TradingRepository::instrument).optional();
  }

  public List<WatchRow> watchlist(UUID userId) {
    return jdbc.sql("SELECT w.created_at AS watched_at, " + INSTRUMENT_COLUMNS + " FROM watchlist_items w "
            + "JOIN instruments i ON i.id = w.instrument_id WHERE w.user_id = ? ORDER BY w.created_at ASC")
        .param(userId)
        .query((rs, n) -> new WatchRow(Db.instant(rs, "watched_at"), instrument(rs, n))).list();
  }

  public void watch(UUID userId, UUID instrumentId, Instant now) {
    jdbc.sql("INSERT INTO watchlist_items (id, user_id, instrument_id, created_at) VALUES (?, ?, ?, ?) "
            + "ON CONFLICT (user_id, instrument_id) DO NOTHING")
        .params(Db.newId(), userId, instrumentId, Db.ts(now)).update();
  }

  public void unwatch(UUID userId, UUID instrumentId) {
    jdbc.sql("DELETE FROM watchlist_items WHERE user_id = ? AND instrument_id = ?").params(userId, instrumentId).update();
  }

  // ---------- portfolios ----------

  /** Serializes per-user portfolio creation (count limit and name check) for the rest of the transaction. */
  public void lockUserPortfolios(UUID userId) {
    jdbc.sql("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))").param("trading-portfolios:" + userId)
        .query((rs, n) -> 1).list();
  }

  /** Row lock on the caller's portfolio; false when it does not exist or belongs to someone else. */
  public boolean lockPortfolio(UUID id, UUID userId) {
    return !jdbc.sql("SELECT id FROM trading_portfolios WHERE id = ? AND user_id = ? FOR UPDATE")
        .params(id, userId).query((rs, n) -> 1).list().isEmpty();
  }

  public int countPortfolios(UUID userId) {
    return jdbc.sql("SELECT count(*) FROM trading_portfolios WHERE user_id = ?").param(userId)
        .query(Integer.class).single();
  }

  public List<UUID> portfolioIds(UUID userId) {
    return jdbc.sql("SELECT id FROM trading_portfolios WHERE user_id = ? ORDER BY created_at ASC").param(userId)
        .query((rs, n) -> Db.uuid(rs, "id")).list();
  }

  public PortfolioRow portfolio(UUID id) {
    return jdbc.sql("SELECT " + PORTFOLIO_COLUMNS + " FROM trading_portfolios WHERE id = ?").param(id)
        .query(TradingRepository::portfolioRow).single();
  }

  public void insertPortfolio(UUID id, UUID userId, String name, long capital, int maxPositionWeightPct,
      Instant now) {
    jdbc.sql("INSERT INTO trading_portfolios (id, user_id, name, initial_capital_millimes, cash_millimes, "
            + "net_contributions_millimes, max_position_weight_pct, matched_through, created_at, updated_at) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .params(id, userId, name, capital, capital, capital, maxPositionWeightPct, Db.ts(now), Db.ts(now),
            Db.ts(Db.now()))
        .update();
  }

  /** The balances and match time persisted after trading; the version moves when a decision input changed. */
  public PortfolioRow updateAfterTrading(UUID id, long cash, long realizedPnl, long feesPaid, long spreadCost,
      Instant matchedThrough, boolean bumpVersion) {
    return jdbc.sql("UPDATE trading_portfolios SET cash_millimes = ?, realized_pnl_millimes = ?, "
            + "fees_paid_millimes = ?, spread_cost_millimes = ?, matched_through = ?, updated_at = ?, "
            + "version = version + ? WHERE id = ? RETURNING " + PORTFOLIO_COLUMNS)
        .params(cash, realizedPnl, feesPaid, spreadCost, Db.ts(matchedThrough), Db.ts(Db.now()),
            bumpVersion ? 1 : 0, id)
        .query(TradingRepository::portfolioRow).single();
  }

  public PortfolioRow updateAfterCashFlow(UUID id, long cash, long signedFlow) {
    return jdbc.sql("UPDATE trading_portfolios SET cash_millimes = ?, "
            + "net_contributions_millimes = net_contributions_millimes + ?, version = version + 1, updated_at = ? "
            + "WHERE id = ? RETURNING " + PORTFOLIO_COLUMNS)
        .params(cash, signedFlow, Db.ts(Db.now()), id)
        .query(TradingRepository::portfolioRow).single();
  }

  // ---------- positions ----------

  /** No ORDER BY, like Prisma's findMany without orderBy: the summary's stable sort keeps this order on ties. */
  public List<PositionRow> positions(UUID portfolioId) {
    return jdbc.sql("SELECT instrument_id, quantity, cost_basis_millimes FROM portfolio_positions "
            + "WHERE portfolio_id = ?")
        .param(portfolioId)
        .query((rs, n) -> new PositionRow(Db.uuid(rs, "instrument_id"), rs.getInt("quantity"),
            rs.getLong("cost_basis_millimes")))
        .list();
  }

  public void deletePosition(UUID portfolioId, UUID instrumentId) {
    jdbc.sql("DELETE FROM portfolio_positions WHERE portfolio_id = ? AND instrument_id = ?")
        .params(portfolioId, instrumentId).update();
  }

  public void upsertPosition(UUID portfolioId, UUID instrumentId, int quantity, long costBasis, Instant openedAt) {
    Object now = Db.ts(Db.now());
    jdbc.sql("INSERT INTO portfolio_positions (id, portfolio_id, instrument_id, quantity, cost_basis_millimes, "
            + "opened_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (portfolio_id, instrument_id) "
            + "DO UPDATE SET quantity = EXCLUDED.quantity, cost_basis_millimes = EXCLUDED.cost_basis_millimes, "
            + "updated_at = EXCLUDED.updated_at")
        .params(Db.newId(), portfolioId, instrumentId, quantity, costBasis, Db.ts(openedAt), now).update();
  }

  // ---------- orders and executions ----------

  public List<OrderRow> workingOrders(UUID portfolioId) {
    return jdbc.sql("SELECT " + ORDER_COLUMNS + " FROM trading_orders o JOIN instruments i ON i.id = o.instrument_id "
            + "WHERE o.portfolio_id = ? AND o.status IN ('OPEN', 'PARTIALLY_FILLED') "
            + "ORDER BY o.submitted_at ASC, o.sequence ASC")
        .param(portfolioId).query(TradingRepository::orderRow).list();
  }

  /** Σ notional of the executions of each order. */
  public Map<UUID, Long> filledValues(List<UUID> orderIds) {
    Map<UUID, Long> out = new HashMap<>();
    if (orderIds.isEmpty()) return out;
    String placeholders = String.join(", ", java.util.Collections.nCopies(orderIds.size(), "?"));
    jdbc.sql("SELECT order_id, sum(notional_millimes) AS total FROM trading_executions "
            + "WHERE order_id IN (" + placeholders + ") GROUP BY order_id")
        .params(new ArrayList<Object>(orderIds))
        .query((rs, n) -> Map.entry(Db.uuid(rs, "order_id"), rs.getLong("total"))).list()
        .forEach(e -> out.put(e.getKey(), e.getValue()));
    return out;
  }

  public Sequences nextSequences(UUID portfolioId) {
    return jdbc.sql("SELECT (SELECT coalesce(max(sequence), 0) FROM trading_orders WHERE portfolio_id = ?) AS o, "
            + "(SELECT coalesce(max(sequence), 0) FROM trading_executions WHERE portfolio_id = ?) AS e, "
            + "(SELECT coalesce(max(sequence), 0) FROM portfolio_cash_entries WHERE portfolio_id = ?) AS c")
        .params(portfolioId, portfolioId, portfolioId)
        .query((rs, n) -> new Sequences(rs.getInt("o") + 1, rs.getInt("e") + 1, rs.getInt("c") + 1)).single();
  }

  public Optional<OrderRow> orderByClientId(UUID portfolioId, String clientOrderId) {
    return jdbc.sql("SELECT " + ORDER_COLUMNS + " FROM trading_orders o JOIN instruments i ON i.id = o.instrument_id "
            + "WHERE o.portfolio_id = ? AND o.client_order_id = ?")
        .params(portfolioId, clientOrderId).query(TradingRepository::orderRow).optional();
  }

  public Optional<OrderRow> order(UUID portfolioId, UUID orderId) {
    return jdbc.sql("SELECT " + ORDER_COLUMNS + " FROM trading_orders o JOIN instruments i ON i.id = o.instrument_id "
            + "WHERE o.id = ? AND o.portfolio_id = ?")
        .params(orderId, portfolioId).query(TradingRepository::orderRow).optional();
  }

  /** status: "open" (working), "closed" (anything else) or "all"; newest first. */
  public List<OrderRow> orders(UUID portfolioId, String status, int limit) {
    String filter = switch (status) {
      case "open" -> " AND o.status IN ('OPEN', 'PARTIALLY_FILLED')";
      case "closed" -> " AND o.status NOT IN ('OPEN', 'PARTIALLY_FILLED')";
      default -> "";
    };
    return jdbc.sql("SELECT " + ORDER_COLUMNS + " FROM trading_orders o JOIN instruments i ON i.id = o.instrument_id "
            + "WHERE o.portfolio_id = ?" + filter + " ORDER BY o.submitted_at DESC, o.sequence DESC LIMIT ?")
        .params(portfolioId, limit).query(TradingRepository::orderRow).list();
  }

  public void insertOrder(NewOrder o) {
    Object now = Db.ts(Db.now());
    jdbc.sql("INSERT INTO trading_orders (id, portfolio_id, sequence, instrument_id, client_order_id, request_hash, "
            + "side, type, quantity, limit_price_millimes, stop_price_millimes, triggered, status, filled_quantity, "
            + "average_price_millimes, rejection_code, status_reason, quote_mid_millimes, quote_bid_millimes, "
            + "quote_ask_millimes, quote_as_of, provider_id, expires_at, submitted_at, closed_at, created_at, "
            + "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?::\"TradingOrderSide\", ?::\"TradingOrderType\", ?, ?, ?, ?, "
            + "?::\"TradingOrderStatus\", ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .params(o.id(), o.portfolioId(), o.sequence(), o.instrumentId(), o.clientOrderId(), o.requestHash(), o.side(),
            o.type(), o.quantity(), o.limitPrice(), o.stopPrice(), o.triggered(), o.status(), o.filledQuantity(),
            o.averagePrice(), o.rejectionCode(), o.statusReason(), o.quoteMid(), o.quoteBid(), o.quoteAsk(),
            Db.ts(o.quoteAsOf()), o.providerId(), Db.ts(o.expiresAt()), Db.ts(o.submittedAt()),
            Db.ts(o.closedAt()), now, now)
        .update();
  }

  public void updateOrder(UUID id, String status, int filledQuantity, Long averagePrice, boolean triggered,
      String statusReason, Instant closedAt) {
    jdbc.sql("UPDATE trading_orders SET status = ?::\"TradingOrderStatus\", filled_quantity = ?, "
            + "average_price_millimes = ?, triggered = ?, status_reason = ?, closed_at = ?, updated_at = ? "
            + "WHERE id = ?")
        .params(status, filledQuantity, averagePrice, triggered, statusReason, Db.ts(closedAt), Db.ts(Db.now()), id)
        .update();
  }

  public UUID insertExecution(NewExecution e) {
    UUID id = Db.newId();
    jdbc.sql("INSERT INTO trading_executions (id, order_id, portfolio_id, sequence, instrument_id, side, quantity, "
            + "price_millimes, notional_millimes, fee_millimes, spread_cost_millimes, realized_pnl_millimes, "
            + "quote_mid_millimes, quote_bid_millimes, quote_ask_millimes, provider_id, executed_at, recorded_at) "
            + "VALUES (?, ?, ?, ?, ?, ?::\"TradingOrderSide\", ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .params(id, e.orderId(), e.portfolioId(), e.sequence(), e.instrumentId(), e.side(), e.quantity(), e.price(),
            e.notional(), e.fee(), e.spreadCost(), e.realizedPnl(), e.quoteMid(), e.quoteBid(), e.quoteAsk(),
            e.providerId(), Db.ts(e.executedAt()), Db.ts(Db.now()))
        .update();
    return id;
  }

  public List<ExecutionRow> executionsOfOrder(UUID orderId) {
    return jdbc.sql("SELECT " + EXECUTION_COLUMNS + " FROM trading_executions e JOIN instruments i "
            + "ON i.id = e.instrument_id WHERE e.order_id = ? ORDER BY e.executed_at ASC, e.sequence ASC")
        .param(orderId).query(TradingRepository::executionRow).list();
  }

  public List<ExecutionRow> executionsNewestFirst(UUID portfolioId, int limit) {
    return jdbc.sql("SELECT " + EXECUTION_COLUMNS + " FROM trading_executions e JOIN instruments i "
            + "ON i.id = e.instrument_id WHERE e.portfolio_id = ? ORDER BY e.executed_at DESC, e.sequence DESC LIMIT ?")
        .params(portfolioId, limit).query(TradingRepository::executionRow).list();
  }

  public List<ExecutionRow> executionsOldestFirst(UUID portfolioId) {
    return jdbc.sql("SELECT " + EXECUTION_COLUMNS + " FROM trading_executions e JOIN instruments i "
            + "ON i.id = e.instrument_id WHERE e.portfolio_id = ? ORDER BY e.executed_at ASC, e.sequence ASC")
        .param(portfolioId).query(TradingRepository::executionRow).list();
  }

  /** Units already executed by this portfolio on one side of an instrument within [from, to). */
  public long depthUsed(UUID portfolioId, UUID instrumentId, String side, Instant from, Instant to) {
    return jdbc.sql("SELECT coalesce(sum(quantity), 0) FROM trading_executions WHERE portfolio_id = ? "
            + "AND instrument_id = ? AND side = ?::\"TradingOrderSide\" AND executed_at >= ? AND executed_at < ?")
        .params(portfolioId, instrumentId, side, Db.ts(from), Db.ts(to)).query(Long.class).single();
  }

  // ---------- cash ledger and snapshots ----------

  public void insertCashEntry(UUID portfolioId, int sequence, String type, long amount, long balanceAfter,
      UUID executionId, String description, Instant occurredAt) {
    jdbc.sql("INSERT INTO portfolio_cash_entries (id, portfolio_id, sequence, type, amount_millimes, "
            + "balance_after_millimes, execution_id, description, occurred_at, created_at) "
            + "VALUES (?, ?, ?, ?::\"CashEntryType\", ?, ?, ?, ?, ?, ?)")
        .params(Db.newId(), portfolioId, sequence, type, amount, balanceAfter, executionId, description,
            Db.ts(occurredAt), Db.ts(Db.now()))
        .update();
  }

  public List<CashEntryRow> cashEntriesNewestFirst(UUID portfolioId, int limit) {
    return jdbc.sql("SELECT " + CASH_COLUMNS + " FROM portfolio_cash_entries WHERE portfolio_id = ? "
            + "ORDER BY occurred_at DESC, sequence DESC LIMIT ?")
        .params(portfolioId, limit).query(TradingRepository::cashRow).list();
  }

  public List<CashEntryRow> cashEntriesOldestFirst(UUID portfolioId) {
    return jdbc.sql("SELECT " + CASH_COLUMNS + " FROM portfolio_cash_entries WHERE portfolio_id = ? "
            + "ORDER BY occurred_at ASC, sequence ASC")
        .param(portfolioId).query(TradingRepository::cashRow).list();
  }

  public long cashLedgerSum(UUID portfolioId) {
    return jdbc.sql("SELECT coalesce(sum(amount_millimes), 0) FROM portfolio_cash_entries WHERE portfolio_id = ?")
        .param(portfolioId).query(Long.class).single();
  }

  public void insertSnapshot(NewSnapshot s) {
    jdbc.sql("INSERT INTO portfolio_valuation_snapshots (id, portfolio_id, kind, equity_millimes, cash_millimes, "
            + "positions_value_millimes, net_contributions_millimes, external_flow_millimes, as_of, created_at) "
            + "VALUES (?, ?, ?::\"ValuationSnapshotKind\", ?, ?, ?, ?, ?, ?, ?)")
        .params(Db.newId(), s.portfolioId(), s.kind(), s.equity(), s.cash(), s.positionsValue(), s.netContributions(),
            s.externalFlow(), Db.ts(s.asOf()), Db.ts(Db.now()))
        .update();
  }

  /** OPENING and CASH_FLOW snapshots: equity just before each external flow, oldest first. */
  public List<FlowSnapshotRow> flowSnapshots(UUID portfolioId) {
    return jdbc.sql("SELECT equity_millimes, external_flow_millimes, as_of FROM portfolio_valuation_snapshots "
            + "WHERE portfolio_id = ? AND kind IN ('OPENING', 'CASH_FLOW') ORDER BY as_of ASC, created_at ASC")
        .param(portfolioId)
        .query((rs, n) -> new FlowSnapshotRow(rs.getLong("equity_millimes"), rs.getLong("external_flow_millimes"),
            Db.instant(rs, "as_of")))
        .list();
  }

  // ---------- row mappers ----------

  private static InstrumentRow instrument(ResultSet rs, int n) throws SQLException {
    return new InstrumentRow(Db.uuid(rs, "id"), rs.getString("symbol"), rs.getString("name"),
        rs.getString("asset_class"), rs.getString("sector"), rs.getString("quote_currency"), rs.getString("status"),
        rs.getInt("price_decimals"), rs.getInt("quantity_decimals"), rs.getInt("lot_size"),
        rs.getString("provider_id"), rs.getString("provider_symbol"), rs.getBoolean("fictional"));
  }

  private static PortfolioRow portfolioRow(ResultSet rs, int n) throws SQLException {
    return new PortfolioRow(Db.uuid(rs, "id"), Db.uuid(rs, "user_id"), rs.getString("name"),
        rs.getString("base_currency"), rs.getString("status"), rs.getLong("initial_capital_millimes"),
        rs.getLong("cash_millimes"), rs.getLong("net_contributions_millimes"), rs.getLong("realized_pnl_millimes"),
        rs.getLong("fees_paid_millimes"), rs.getLong("spread_cost_millimes"), rs.getInt("max_position_weight_pct"),
        rs.getInt("version"), Db.instant(rs, "matched_through"), Db.instant(rs, "created_at"));
  }

  private static OrderRow orderRow(ResultSet rs, int n) throws SQLException {
    return new OrderRow(Db.uuid(rs, "id"), rs.getString("symbol"), rs.getString("client_order_id"),
        rs.getString("request_hash"), rs.getString("side"), rs.getString("type"), rs.getInt("quantity"),
        nullableLong(rs, "limit_price_millimes"), nullableLong(rs, "stop_price_millimes"), rs.getBoolean("triggered"),
        rs.getString("status"), rs.getInt("filled_quantity"), nullableLong(rs, "average_price_millimes"),
        rs.getString("rejection_code"), rs.getString("status_reason"), rs.getLong("quote_mid_millimes"),
        rs.getLong("quote_bid_millimes"), rs.getLong("quote_ask_millimes"), Db.instant(rs, "quote_as_of"),
        rs.getString("provider_id"), Db.instant(rs, "expires_at"), Db.instant(rs, "submitted_at"),
        Db.instant(rs, "closed_at"), rs.getInt("sequence"));
  }

  private static ExecutionRow executionRow(ResultSet rs, int n) throws SQLException {
    return new ExecutionRow(Db.uuid(rs, "id"), Db.uuid(rs, "order_id"), rs.getString("symbol"), rs.getString("side"),
        rs.getInt("quantity"), rs.getLong("price_millimes"), rs.getLong("notional_millimes"),
        rs.getLong("fee_millimes"), rs.getLong("spread_cost_millimes"), rs.getLong("realized_pnl_millimes"),
        rs.getLong("quote_mid_millimes"), rs.getLong("quote_bid_millimes"), rs.getLong("quote_ask_millimes"),
        rs.getString("provider_id"), Db.instant(rs, "executed_at"), rs.getInt("sequence"),
        Db.instant(rs, "recorded_at"));
  }

  private static CashEntryRow cashRow(ResultSet rs, int n) throws SQLException {
    return new CashEntryRow(Db.uuid(rs, "id"), rs.getString("type"), rs.getLong("amount_millimes"),
        rs.getLong("balance_after_millimes"), Db.uuid(rs, "execution_id"), rs.getString("description"),
        Db.instant(rs, "occurred_at"), rs.getInt("sequence"));
  }

  private static Long nullableLong(ResultSet rs, String column) throws SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }
}
