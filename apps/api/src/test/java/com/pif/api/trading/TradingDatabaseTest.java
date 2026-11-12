package com.pif.api.trading;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.crypto.PasswordHasher;
import com.pif.api.data.AuthRepository;
import com.pif.api.data.Db;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Portfolio and order workflows against the isolated *_test PostgreSQL database: row locking, idempotency, version
 * checks and ledger invariants under concurrent requests. The market clock is pinned (one millisecond per read) so
 * every quote is deterministic. Disposable accounts only; their portfolios cascade away after each test.
 */
@Tag("database")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class TradingDatabaseTest {

  private static final String DOMAIN = "@spring-trading-db-test.test";
  private static final Instant START = Instant.parse("2026-11-10T09:00:00.500Z");
  private static final int THREADS = 6;

  /** Advances one millisecond per read, so stored timestamps stay distinct and ordered. */
  static final class SteppingClock extends Clock {
    private final AtomicLong millis = new AtomicLong();

    void set(Instant at) {
      millis.set(at.toEpochMilli());
    }

    void advance(Duration by) {
      millis.addAndGet(by.toMillis());
    }

    @Override
    public Instant instant() {
      return Instant.ofEpochMilli(millis.getAndIncrement());
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }
  }

  @TestConfiguration
  static class PinnedClock {
    @Bean
    @Primary
    SteppingClock steppingClock() {
      return new SteppingClock();
    }
  }

  @Autowired JdbcClient jdbc;
  @Autowired AuthRepository users;
  @Autowired PasswordHasher hasher;
  @Autowired PortfoliosService portfolios;
  @Autowired SteppingClock clock;

  @BeforeEach
  void pinClock() {
    clock.set(START);
  }

  @AfterEach
  void removeDisposableUsers() {
    jdbc.sql("DELETE FROM users WHERE email LIKE ?").param("%" + DOMAIN).update();
  }

  // ---------- helpers ----------

  private AuthUser newInvestor() {
    UUID id = UUID.randomUUID();
    Instant now = Db.now();
    jdbc.sql("INSERT INTO users (id, email, first_name, last_name, password_hash, email_verified, email_verified_at, "
            + "status, role, created_at, updated_at) VALUES (?, ?, 'Db', 'Trader', ?, true, ?, 'ACTIVE', "
            + "'INVESTOR'::\"UserRole\", ?, ?)")
        .params(id, "trader-" + id.toString().substring(0, 8) + DOMAIN, hasher.hash("Db-Test-Pass-1!"), Db.ts(now),
            Db.ts(now), Db.ts(now))
        .update();
    return new AuthUser(users.findUserById(id).orElseThrow(), UUID.randomUUID());
  }

  private UUID newPortfolio(AuthUser user, String name, double capital) {
    Map<String, Object> created = portfolios.create(user, new TradingDtos.CreatePortfolio(name, capital, null));
    return UUID.fromString((String) created.get("id"));
  }

  private static TradingDtos.OrderTerms market(String symbol, String side, double quantity) {
    return new TradingDtos.OrderTerms(symbol, side, "MARKET", quantity, null, null);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> map(Object value) {
    return (Map<String, Object>) value;
  }

  private Map<String, Object> preview(AuthUser user, UUID id, TradingDtos.OrderTerms terms) {
    return portfolios.preview(user, id, terms);
  }

  private TradingDtos.SubmitOrder submission(Map<String, Object> preview, TradingDtos.OrderTerms terms, String key) {
    return new TradingDtos.SubmitOrder(terms, key, (Integer) preview.get("portfolioVersion"),
        (String) map(preview.get("quote")).get("asOf"));
  }

  private static String errorCode(Callable<?> call) {
    try {
      call.call();
    } catch (ApiException e) {
      return e.errorCode();
    } catch (Exception e) {
      throw new AssertionError("Unexpected exception", e);
    }
    throw new AssertionError("Expected an ApiException");
  }

  /** Runs every task at once (behind a start gate) and returns each outcome: the result map or the error code. */
  private static List<Object> concurrently(List<Callable<Map<String, Object>>> tasks) throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
    try {
      CountDownLatch gate = new CountDownLatch(1);
      List<Future<Object>> futures = new ArrayList<>();
      for (Callable<Map<String, Object>> task : tasks) {
        futures.add(pool.submit(() -> {
          gate.await();
          try {
            return task.call();
          } catch (ApiException e) {
            return e.errorCode();
          }
        }));
      }
      gate.countDown();
      List<Object> outcomes = new ArrayList<>();
      for (Future<Object> f : futures) outcomes.add(f.get());
      return outcomes;
    } finally {
      pool.shutdownNow();
    }
  }

  private int count(String table, UUID portfolioId) {
    return jdbc.sql("SELECT count(*) FROM " + table + " WHERE portfolio_id = ?").param(portfolioId)
        .query(Integer.class).single();
  }

  private int version(UUID portfolioId) {
    return jdbc.sql("SELECT version FROM trading_portfolios WHERE id = ?").param(portfolioId)
        .query(Integer.class).single();
  }

  /** Cash equals the ledger sum and the last balance, and every sequence runs 1..n without gaps. */
  private void assertLedgerConsistent(UUID portfolioId) {
    long cash = jdbc.sql("SELECT cash_millimes FROM trading_portfolios WHERE id = ?").param(portfolioId)
        .query(Long.class).single();
    long sum = jdbc.sql("SELECT coalesce(sum(amount_millimes), 0) FROM portfolio_cash_entries WHERE portfolio_id = ?")
        .param(portfolioId).query(Long.class).single();
    long last = jdbc.sql("SELECT balance_after_millimes FROM portfolio_cash_entries WHERE portfolio_id = ? "
        + "ORDER BY sequence DESC LIMIT 1").param(portfolioId).query(Long.class).single();
    assertThat(sum).isEqualTo(cash);
    assertThat(last).isEqualTo(cash);
    for (String table : List.of("portfolio_cash_entries", "trading_orders", "trading_executions")) {
      List<Integer> sequences = jdbc.sql("SELECT sequence FROM " + table + " WHERE portfolio_id = ? ORDER BY sequence")
          .param(portfolioId).query(Integer.class).list();
      for (int i = 0; i < sequences.size(); i++) assertThat(sequences.get(i)).as(table).isEqualTo(i + 1);
    }
  }

  // ---------- portfolios ----------

  @Test
  void createRecordsOpeningCapitalOnce() {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Core", 25_000);

    assertThat(version(id)).isZero();
    assertThat(count("portfolio_cash_entries", id)).isEqualTo(1);
    assertThat(jdbc.sql("SELECT kind::text FROM portfolio_valuation_snapshots WHERE portfolio_id = ?").param(id)
        .query(String.class).list()).containsExactly("OPENING");
    assertThat(jdbc.sql("SELECT cash_millimes FROM trading_portfolios WHERE id = ?").param(id)
        .query(Long.class).single()).isEqualTo(25_000_000L);
    assertLedgerConsistent(id);
  }

  @Test
  void concurrentCreatesRespectTheLimitAndUniqueNames() throws Exception {
    AuthUser user = newInvestor();
    List<Callable<Map<String, Object>>> tasks = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      String name = "Book " + i;
      tasks.add(() -> portfolios.create(user, new TradingDtos.CreatePortfolio(name, 10_000, null)));
    }
    List<Object> outcomes = concurrently(tasks);

    assertThat(outcomes.stream().filter(Map.class::isInstance)).hasSize(TradingRules.MAX_PORTFOLIOS_PER_USER);
    assertThat(outcomes.stream().filter("PORTFOLIO_LIMIT"::equals)).hasSize(8 - TradingRules.MAX_PORTFOLIOS_PER_USER);
    assertThat(jdbc.sql("SELECT count(*) FROM trading_portfolios WHERE user_id = ?").param(user.id())
        .query(Integer.class).single()).isEqualTo(TradingRules.MAX_PORTFOLIOS_PER_USER);
  }

  @Test
  void concurrentCreatesWithTheSameNameKeepOne() throws Exception {
    AuthUser user = newInvestor();
    List<Callable<Map<String, Object>>> tasks = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      tasks.add(() -> portfolios.create(user, new TradingDtos.CreatePortfolio("Same", 10_000, null)));
    }
    List<Object> outcomes = concurrently(tasks);

    assertThat(outcomes.stream().filter(Map.class::isInstance)).hasSize(1);
    assertThat(outcomes.stream().filter("PORTFOLIO_NAME_TAKEN"::equals)).hasSize(3);
    UUID id = jdbc.sql("SELECT id FROM trading_portfolios WHERE user_id = ?").param(user.id())
        .query(UUID.class).single();
    assertThat(count("portfolio_cash_entries", id)).isEqualTo(1);
  }

  @Test
  void anotherUsersPortfolioIsNotFound() {
    AuthUser owner = newInvestor();
    AuthUser other = newInvestor();
    UUID id = newPortfolio(owner, "Private", 10_000);

    assertThat(errorCode(() -> portfolios.get(other, id))).isEqualTo("PORTFOLIO_NOT_FOUND");
    assertThat(errorCode(() -> portfolios.preview(other, id, market("CTB", "BUY", 1))))
        .isEqualTo("PORTFOLIO_NOT_FOUND");
  }

  // ---------- orders ----------

  @Test
  void marketBuyFillsAndKeepsTheLedgerConsistent() {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Fill", 100_000);
    TradingDtos.OrderTerms terms = market("CTB", "BUY", 100);

    Map<String, Object> result = portfolios.submit(user, id, submission(preview(user, id, terms), terms, "fill-1"));

    assertThat(result.get("replayed")).isEqualTo(false);
    assertThat(map(result.get("order")).get("status")).isEqualTo("FILLED");
    assertThat(version(id)).isEqualTo(1);
    assertThat(count("trading_executions", id)).isEqualTo(1);
    assertThat(jdbc.sql("SELECT quantity FROM portfolio_positions WHERE portfolio_id = ?").param(id)
        .query(Double.class).single()).isEqualTo(100.0);
    assertLedgerConsistent(id);
  }

  @Test
  void concurrentOrdersOnOneVersionFillExactlyOnce() throws Exception {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Race", 100_000);
    TradingDtos.OrderTerms terms = market("CTB", "BUY", 50);
    Map<String, Object> preview = preview(user, id, terms);
    List<Callable<Map<String, Object>>> tasks = new ArrayList<>();
    for (int i = 0; i < THREADS; i++) {
      String key = "race-" + i;
      tasks.add(() -> portfolios.submit(user, id, submission(preview, terms, key)));
    }
    List<Object> outcomes = concurrently(tasks);

    assertThat(outcomes.stream().filter(Map.class::isInstance)).hasSize(1);
    assertThat(outcomes.stream().filter("PORTFOLIO_CHANGED"::equals)).hasSize(THREADS - 1);
    assertThat(count("trading_orders", id)).isEqualTo(1);
    assertThat(count("trading_executions", id)).isEqualTo(1);
    assertThat(version(id)).isEqualTo(1);
    assertLedgerConsistent(id);
  }

  @Test
  void concurrentRetriesOfOneOrderAreReplayed() throws Exception {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Retry", 100_000);
    TradingDtos.OrderTerms terms = market("CTB", "BUY", 40);
    TradingDtos.SubmitOrder submission = submission(preview(user, id, terms), terms, "retry-1");
    List<Callable<Map<String, Object>>> tasks = new ArrayList<>();
    for (int i = 0; i < THREADS; i++) tasks.add(() -> portfolios.submit(user, id, submission));
    List<Object> outcomes = concurrently(tasks);

    assertThat(outcomes).allMatch(Map.class::isInstance);
    List<Map<String, Object>> results = outcomes.stream().map(TradingDatabaseTest::map).toList();
    assertThat(results.stream().filter(r -> Boolean.FALSE.equals(r.get("replayed")))).hasSize(1);
    assertThat(results.stream().map(r -> map(r.get("order")).get("id")).distinct()).hasSize(1);
    assertThat(count("trading_orders", id)).isEqualTo(1);
    assertThat(count("trading_executions", id)).isEqualTo(1);
    assertLedgerConsistent(id);
  }

  @Test
  void aReusedKeyWithDifferentTermsIsRefused() {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Keys", 100_000);
    TradingDtos.OrderTerms first = market("CTB", "BUY", 10);
    portfolios.submit(user, id, submission(preview(user, id, first), first, "same-key"));
    TradingDtos.OrderTerms second = market("CTB", "BUY", 11);
    TradingDtos.SubmitOrder reuse = submission(preview(user, id, second), second, "same-key");

    assertThat(errorCode(() -> portfolios.submit(user, id, reuse))).isEqualTo("IDEMPOTENCY_KEY_REUSED");
    assertThat(count("trading_orders", id)).isEqualTo(1);
  }

  @Test
  void aStaleQuoteIsRefusedWithoutWriting() {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Stale", 100_000);
    TradingDtos.OrderTerms terms = market("CTB", "BUY", 10);
    TradingDtos.SubmitOrder submission = submission(preview(user, id, terms), terms, "stale-1");
    clock.advance(Duration.ofMinutes(5));

    assertThat(errorCode(() -> portfolios.submit(user, id, submission))).isEqualTo("QUOTE_CHANGED");
    assertThat(count("trading_orders", id)).isZero();
    assertThat(version(id)).isZero();
    assertLedgerConsistent(id);
  }

  @Test
  void aRejectedOrderIsStoredWithoutMovingCash() {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Reject", 100_000);
    TradingDtos.OrderTerms terms = market("MDX", "SELL", 10);

    Map<String, Object> result = portfolios.submit(user, id, submission(preview(user, id, terms), terms, "reject-1"));

    Map<String, Object> order = map(result.get("order"));
    assertThat(order.get("status")).isEqualTo("REJECTED");
    assertThat(order.get("statusReason")).isNotNull();
    assertThat(jdbc.sql("SELECT rejection_code FROM trading_orders WHERE portfolio_id = ?").param(id)
        .query(String.class).single()).isNotBlank();
    assertThat(count("trading_executions", id)).isZero();
    assertThat(count("portfolio_cash_entries", id)).isEqualTo(1);
    assertThat(version(id)).isZero();
    assertLedgerConsistent(id);
  }

  @Test
  void aWorkingLimitOrderReservesCashAndCancelsOnce() {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Limit", 100_000);
    double mid = ((Number) map(preview(user, id, market("CTB", "BUY", 1)).get("quote")).get("mid")).doubleValue();
    double limit = Math.round(mid * 0.98 * 1000) / 1000.0;
    TradingDtos.OrderTerms terms = new TradingDtos.OrderTerms("CTB", "BUY", "LIMIT", 20, limit, null);

    Map<String, Object> placed = portfolios.submit(user, id, submission(preview(user, id, terms), terms, "limit-1"));
    Map<String, Object> order = map(placed.get("order"));
    assertThat(order.get("status")).isEqualTo("OPEN");
    assertThat(((Number) map(placed.get("portfolio")).get("reservedCash")).doubleValue()).isPositive();

    String orderId = (String) order.get("id");
    Map<String, Object> cancelled = portfolios.cancel(user, id, UUID.fromString(orderId), orderId);
    assertThat(map(cancelled.get("order")).get("status")).isEqualTo("CANCELLED");
    assertThat(((Number) map(cancelled.get("portfolio")).get("reservedCash")).doubleValue()).isZero();
    assertThat(errorCode(() -> portfolios.cancel(user, id, UUID.fromString(orderId), orderId)))
        .isEqualTo("ORDER_NOT_OPEN");
    assertThat(count("trading_executions", id)).isZero();
    assertLedgerConsistent(id);
  }

  // ---------- cash ----------

  @Test
  void concurrentCashFlowsOnOneVersionApplyOnce() throws Exception {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Cash", 10_000);
    List<Callable<Map<String, Object>>> tasks = new ArrayList<>();
    for (int i = 0; i < THREADS; i++) {
      tasks.add(() -> portfolios.cashFlow(user, id, new TradingDtos.CashFlow("DEPOSIT", 1_000, 0)));
    }
    List<Object> outcomes = concurrently(tasks);

    assertThat(outcomes.stream().filter(Map.class::isInstance)).hasSize(1);
    assertThat(outcomes.stream().filter("PORTFOLIO_CHANGED"::equals)).hasSize(THREADS - 1);
    assertThat(count("portfolio_cash_entries", id)).isEqualTo(2);
    assertThat(jdbc.sql("SELECT cash_millimes FROM trading_portfolios WHERE id = ?").param(id)
        .query(Long.class).single()).isEqualTo(11_000_000L);
    assertLedgerConsistent(id);
  }

  @Test
  void anOverdrawnWithdrawalWritesNothing() {
    AuthUser user = newInvestor();
    UUID id = newPortfolio(user, "Withdraw", 10_000);

    assertThat(errorCode(() -> portfolios.cashFlow(user, id, new TradingDtos.CashFlow("WITHDRAWAL", 10_000.001, 0))))
        .isEqualTo("INSUFFICIENT_CASH");
    assertThat(count("portfolio_cash_entries", id)).isEqualTo(1);
    assertThat(count("portfolio_valuation_snapshots", id)).isEqualTo(1);
    assertThat(version(id)).isZero();
    assertLedgerConsistent(id);
  }
}
