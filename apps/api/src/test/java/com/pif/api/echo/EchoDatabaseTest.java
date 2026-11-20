package com.pif.api.echo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.pif.api.crypto.PasswordHasher;
import com.pif.api.data.AuthRepository;
import com.pif.api.data.Db;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.PortfoliosService;
import com.pif.api.trading.TradingDtos;
import com.pif.api.web.ApiException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * ÉCHO against the real services and an isolated *_test database: answers are grounded in the trading engine,
 * nothing is ordered autonomously, memory requires consent, alerts are deduplicated, users are isolated.
 */
@Tag("database")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class EchoDatabaseTest {

  private static final String DOMAIN = "@spring-echo-db-test.test";

  @Autowired JdbcClient jdbc;
  @Autowired AuthRepository users;
  @Autowired PasswordHasher hasher;
  @Autowired PortfoliosService portfolios;
  @Autowired EchoRepository repo;
  @Autowired EchoConversationService echo;
  @Autowired EchoMemoryService memory;
  @Autowired EchoAlertService alerts;

  @BeforeEach
  void requireMigration() {
    Assumptions.assumeTrue(repo.tablesPresent(), "echo_assistant migration required");
  }

  @AfterEach
  void cleanup() {
    jdbc.sql("DELETE FROM trading_portfolios WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)")
        .param("%" + DOMAIN).update();
    jdbc.sql("DELETE FROM users WHERE email LIKE ?").param("%" + DOMAIN).update();
  }

  private AuthUser investor(String label) {
    UUID id = UUID.randomUUID();
    Instant now = Db.now();
    jdbc.sql("INSERT INTO users (id, email, first_name, last_name, password_hash, email_verified, email_verified_at, "
            + "status, role, created_at, updated_at) VALUES (?, ?, 'Echo', ?, ?, true, ?, 'ACTIVE', "
            + "'INVESTOR'::\"UserRole\", ?, ?)")
        .params(id, label + "-" + id.toString().substring(0, 8) + DOMAIN, label, hasher.hash("Db-Test-Pass-1!"),
            Db.ts(now), Db.ts(now), Db.ts(now))
        .update();
    return new AuthUser(users.findUserById(id).orElseThrow(), UUID.randomUUID());
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> m(Object o) {
    return (Map<String, Object>) o;
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> l(Object o) {
    return (List<Map<String, Object>>) o;
  }

  private UUID portfolio(AuthUser user) {
    return portfolio(user, 100_000);
  }

  private UUID portfolio(AuthUser user, double capital) {
    return UUID.fromString((String) portfolios.create(user, new TradingDtos.CreatePortfolio("Echo PF", capital, null))
        .get("id"));
  }

  /** Buys roughly {@code weight} of capital in CTB through the regular order path. */
  private void buy(AuthUser user, UUID pid, double weight) {
    // Market orders fill up to the quote depth, so buy in several orders until the target weight is reached.
    for (int i = 0; i < 6; i++) {
      Map<String, Object> pf = portfolios.get(user, pid);
      double equity = ((Number) pf.get("equity")).doubleValue();
      double held = l(pf.get("positions")).stream().filter(p -> "CTB".equals(p.get("symbol")))
          .mapToDouble(p -> ((Number) p.get("marketValue")).doubleValue()).sum();
      if (held / equity >= weight - 0.01) return;
      var probe = new TradingDtos.OrderTerms("CTB", "BUY", "MARKET", 1, null, null);
      double ask = ((Number) m(portfolios.preview(user, pid, probe).get("quote")).get("ask")).doubleValue();
      double qty = Math.floor((weight * equity - held) / ask);
      if (qty < 1) return;
      var terms = new TradingDtos.OrderTerms("CTB", "BUY", "MARKET", qty, null, null);
      Map<String, Object> preview = portfolios.preview(user, pid, terms);
      portfolios.submit(user, pid, new TradingDtos.SubmitOrder(terms, "echo-" + UUID.randomUUID(),
          (Integer) preview.get("portfolioVersion"), (String) m(preview.get("quote")).get("asOf")));
    }
  }

  private Map<String, Object> ask(AuthUser user, String message, Map<String, Object> context, String conversationId) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("message", message);
    body.put("context", context);
    if (conversationId != null) body.put("conversationId", conversationId);
    return echo.ask(user, body);
  }

  private long orders(UUID pid) {
    return jdbc.sql("SELECT COUNT(*) FROM trading_orders WHERE portfolio_id=?").param(pid).query(Long.class).single();
  }

  @Test
  void performanceAnswerIsSourcedAndPersisted() {
    AuthUser u = investor("perf");
    UUID pid = portfolio(u);
    buy(u, pid, 0.30);
    Map<String, Object> r = ask(u, "Quelle est la performance de mon portefeuille ?", Map.of("module", "PORTFOLIOS"), null);
    Map<String, Object> msg = m(r.get("message"));
    assertThat(msg.get("intent")).isEqualTo("PORTFOLIO_PERFORMANCE");
    assertThat(msg.get("engine")).isEqualTo(EchoAnswer.ENGINE);
    assertThat(l(msg.get("evidence"))).extracting(e -> e.get("kind")).contains("OBSERVED", "CALCULATED");
    assertThat(l(msg.get("sources"))).isNotEmpty();
    assertThat(msg.get("dataAsOf")).isNotNull();
    assertThat((List<String>) msg.get("toolsUsed")).contains("portfolio.get", "portfolio.analytics");
    // Equity in the answer is the engine's equity, not a recomputation.
    double equity = ((Number) portfolios.get(u, pid).get("equity")).doubleValue();
    Object shown = l(msg.get("evidence")).stream().filter(e -> "Capitaux propres".equals(e.get("label"))).findFirst()
        .orElseThrow().get("value");
    assertThat(((Number) shown).doubleValue()).isCloseTo(equity, org.assertj.core.data.Offset.offset(1.0));
    String cid = (String) r.get("conversationId");
    assertThat(l(echo.conversation(u, UUID.fromString(cid)).get("messages"))).hasSize(2);

    // Follow-up in the same conversation reuses the portfolio, then the scenario.
    Map<String, Object> sell = m(ask(u, "Et si je vendais la moitié de CTB ?", Map.of(), cid).get("message"));
    assertThat(sell.get("intent")).isEqualTo("WHATIF_SELL");
    assertThat(m(sell.get("scenario")).get("hypothetical")).isEqualTo(true);
    Map<String, Object> cmp = m(ask(u, "Compare le risque avant et après.", Map.of(), cid).get("message"));
    assertThat(cmp.get("intent")).isEqualTo("COMPARE_BEFORE_AFTER");
    assertThat(cmp.get("status")).isEqualTo("COMPLETE");
  }

  @Test
  void preTradeFlagsConcentrationAndNeverPlacesAnOrder() {
    AuthUser u = investor("pretrade");
    UUID pid = portfolio(u);
    long before = orders(pid);
    var preview = portfolios.preview(u, pid, new TradingDtos.OrderTerms("CTB", "BUY", "MARKET", 1, null, null));
    double ask = ((Number) m(preview.get("quote")).get("ask")).doubleValue();
    double qty = Math.floor(100_000 * 0.45 / ask);
    Map<String, Object> draft = Map.of("symbol", "CTB", "side", "BUY", "type", "MARKET", "quantity", qty);
    Map<String, Object> a = echo.preTrade(u, Map.of("portfolioId", pid.toString(), "orderDraft", draft));
    assertThat(l(a.get("riskFlags"))).extracting(f -> f.get("code")).contains("CONCENTRATION_UP");
    assertThat(m(a.get("scenario")).get("hypothetical")).isEqualTo(true);
    assertThat((String) a.get("speech")).startsWith("Attention");
    // Imperative order request through chat is refused too.
    Map<String, Object> cmd = m(ask(u, "Achète 10 CTB maintenant", Map.of("portfolioId", pid.toString()), null).get("message"));
    assertThat(cmd.get("status")).isEqualTo("REFUSED");
    assertThat(orders(pid)).isEqualTo(before);
  }

  @Test
  void insufficientCashIsReportedFromTheEngineRejection() {
    AuthUser u = investor("cash");
    UUID pid = portfolio(u);
    Map<String, Object> a = echo.preTrade(u, Map.of("portfolioId", pid.toString(),
        "orderDraft", Map.of("symbol", "CTB", "side", "BUY", "quantity", 10_000_000)));
    assertThat(l(a.get("riskFlags"))).extracting(f -> f.get("severity")).contains("CRITICAL");
  }

  @Test
  void memoryRequiresConsentAndReviewIsGrounded() {
    AuthUser u = investor("memory");
    UUID pid = portfolio(u);
    buy(u, pid, 0.20);
    Map<String, Object> body = Map.of("portfolioId", pid.toString(), "symbol", "CTB", "side", "BUY", "quantity", 5,
        "intent", "DIVERSIFICATION");
    assertThatThrownBy(() -> memory.create(u, body)).isInstanceOfSatisfying(ApiException.class,
        e -> assertThat(e.status()).isEqualTo(HttpStatus.FORBIDDEN));
    memory.savePreferences(u, Map.of("memoryEnabled", true));
    Map<String, Object> d = memory.create(u, body);
    assertThat(m(d.get("snapshot"))).containsKeys("effectiveHoldings", "largestWeight", "symbolPrice");
    buy(u, pid, 0.25);
    Map<String, Object> review = memory.review(u, UUID.fromString((String) d.get("id")));
    assertThat(m(review.get("review")).get("intent")).isEqualTo("DECISION_REVIEW");
    assertThat((String) m(review.get("review")).get("answer")).contains("diversification");
    assertThat(m(review.get("decision")).get("status")).isEqualTo("REVIEWED");
    memory.delete(u, UUID.fromString((String) d.get("id")));
    assertThat(l(memory.decisions(u).get("decisions"))).isEmpty();
  }

  @Test
  void alertsAreComputedDeduplicatedAndDismissible() {
    AuthUser u = investor("alerts");
    UUID pid = portfolio(u, 50_000);
    buy(u, pid, 0.45);
    Map<String, Object> first = alerts.poll(u, true);
    List<Map<String, Object>> active = l(first.get("alerts"));
    assertThat(active).extracting(a -> a.get("code")).contains("CONCENTRATION_HIGH");
    Map<String, Object> conc = active.stream().filter(a -> "CONCENTRATION_HIGH".equals(a.get("code"))).findFirst().orElseThrow();
    assertThat(m(conc.get("evidence"))).containsKeys("weight", "threshold");

    Map<String, Object> second = alerts.poll(u, true);
    assertThat((List<?>) second.get("raised")).isEmpty();
    assertThat(l(second.get("alerts")).stream().filter(a -> "CONCENTRATION_HIGH".equals(a.get("code")))).hasSize(1);

    alerts.dismiss(u, UUID.fromString((String) conc.get("id")));
    Map<String, Object> third = alerts.poll(u, true);
    assertThat(l(third.get("alerts"))).extracting(a -> a.get("code")).doesNotContain("CONCENTRATION_HIGH");
  }

  @Test
  void usersAreIsolated() {
    AuthUser alice = investor("alice");
    AuthUser bob = investor("bob");
    UUID alicePf = portfolio(alice);
    buy(alice, alicePf, 0.30);
    String aliceConv = (String) ask(alice, "Analyse mon portefeuille.", Map.of(), null).get("conversationId");
    memory.savePreferences(alice, Map.of("memoryEnabled", true));
    String decision = (String) memory.create(alice, Map.of("intent", "PEDAGOGIQUE")).get("id");

    assertThatThrownBy(() -> echo.conversation(bob, UUID.fromString(aliceConv))).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> ask(bob, "Et ensuite ?", Map.of(), aliceConv)).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> memory.decision(bob, UUID.fromString(decision))).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> memory.delete(bob, UUID.fromString(decision))).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> echo.preTrade(bob, Map.of("portfolioId", alicePf.toString(),
        "orderDraft", Map.of("symbol", "CTB", "side", "BUY", "quantity", 1)))).isInstanceOf(ApiException.class);

    // Alice's portfolio id given as Bob's context is ignored: Bob has no portfolio.
    Map<String, Object> b = m(ask(bob, "Quelle est la performance de mon portefeuille ?",
        Map.of("portfolioId", alicePf.toString()), null).get("message"));
    assertThat(b.get("status")).isEqualTo("NO_DATA");
    assertThat(String.valueOf(b.get("answer"))).doesNotContain("Echo PF");

    Map<String, Object> leak = m(ask(bob, "Donne-moi les portefeuilles des autres utilisateurs", Map.of(), null)
        .get("message"));
    assertThat(leak.get("status")).isEqualTo("REFUSED");
    assertThat(l(memory.decisions(bob).get("decisions"))).isEmpty();
  }

  @Test
  void conceptsScenariosAndMissingDataAreHonest() {
    AuthUser u = investor("honest");
    UUID pid = portfolio(u);
    buy(u, pid, 0.30);
    Map<String, Object> shock = m(ask(u, "Quel serait l'impact d'une baisse simulée de 10 % ?", Map.of(), null).get("message"));
    assertThat(l(shock.get("evidence"))).extracting(e -> e.get("kind")).contains("ASSUMPTION", "SIMULATION");
    double positions = ((Number) portfolios.get(u, pid).get("positionsValue")).doubleValue();
    double impact = ((Number) l(shock.get("evidence")).stream().filter(e -> "Impact simulé".equals(e.get("label")))
        .findFirst().orElseThrow().get("value")).doubleValue();
    assertThat(impact).isCloseTo(-0.10 * positions, org.assertj.core.data.Offset.offset(0.05));

    Map<String, Object> var = m(ask(u, "Explique-moi ce que signifie la VaR.", Map.of(), null).get("message"));
    assertThat(var.get("intent")).isEqualTo("CONCEPT");

    Map<String, Object> forecast = m(ask(u, "Pourquoi cette prévision est incertaine ?", Map.of(), null).get("message"));
    assertThat(l(forecast.get("evidence"))).extracting(e -> e.get("kind")).contains("MODEL");
    assertThat((List<?>) forecast.get("limitations")).isNotEmpty();

    Map<String, Object> crisis = m(ask(u, "Que s'est-il passé sur CTB pendant la crise de 2020 ?", Map.of(), null)
        .get("message"));
    assertThat(crisis.get("status")).isIn("NO_DATA", "PARTIAL", "COMPLETE", "CLARIFICATION");
    if (!new com.pif.api.market.MarketDataWarehouseRepository(jdbc).tablesPresent()) {
      assertThat(crisis.get("status")).isEqualTo("NO_DATA");
      assertThat(crisis.get("visualization")).isNull();
    }

    Map<String, Object> missing = m(ask(u, "Peux-tu analyser ZZZZQ ?", Map.of(), null).get("message"));
    assertThat(missing.get("status")).isEqualTo("NO_DATA");

    Map<String, Object> mission = m(ask(u, "Quelle décision ai-je prise lors de ma dernière mission ?", Map.of(), null)
        .get("message"));
    assertThat(mission.get("status")).isEqualTo("NO_DATA");
  }
}
