package com.pif.api.echo;

import com.pif.api.actuarial.ActuarialService;
import com.pif.api.ai.AiService;
import com.pif.api.finance.Risk;
import com.pif.api.learning.LearningService;
import com.pif.api.learning.StoriesService;
import com.pif.api.market.MarketDataWarehouseRepository;
import com.pif.api.market.NewsService;
import com.pif.api.security.AuthUser;
import com.pif.api.stress.StressDtos;
import com.pif.api.stress.StressFactors;
import com.pif.api.stress.StressService;
import com.pif.api.trading.MarketService;
import com.pif.api.trading.PortfoliosService;
import com.pif.api.trading.TradingDtos;
import com.pif.api.web.ApiException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * The only door between ÉCHO and the platform: a fixed allowlist of READ-ONLY tools, each delegating to an
 * existing business service with the caller's identity. ÉCHO has no SQL, no HTTP and no write access to
 * orders, portfolios or missions through this class. Ownership checks are performed by the services
 * themselves (a foreign portfolio or session id answers 404 exactly as through the regular API).
 */
@Component
public class EchoFinancialTools {

  private final PortfoliosService portfolios;
  private final MarketService market;
  private final MarketDataWarehouseRepository warehouse;
  private final AiService ai;
  private final LearningService learning;
  private final StoriesService stories;
  private final ActuarialService actuarial;
  private final StressService stress;
  private final NewsService news;

  public EchoFinancialTools(PortfoliosService portfolios, MarketService market,
      MarketDataWarehouseRepository warehouse, AiService ai, LearningService learning, StoriesService stories,
      ActuarialService actuarial, StressService stress, NewsService news) {
    this.portfolios = portfolios;
    this.market = market;
    this.warehouse = warehouse;
    this.ai = ai;
    this.learning = learning;
    this.stories = stories;
    this.actuarial = actuarial;
    this.stress = stress;
    this.news = news;
  }

  /** Allowlisted tool names, recorded in every answer's {@code toolsUsed}. */
  public static final List<String> ALLOWLIST = List.of("portfolio.list", "portfolio.get", "portfolio.analytics",
      "portfolio.preTradeRisk", "portfolio.preview", "portfolio.orders", "portfolio.executions",
      "market.instrument", "market.history", "market.crises", "market.crisisBars", "market.coverage", "news.feed",
      "ai.overview", "ai.model", "learning.sessions", "learning.session", "learning.assessment",
      "learning.whatIfHold", "stories.feed", "stories.get", "actuarial.presets", "actuarial.price",
      "actuarial.scenarios", "actuarial.scenario", "stress.run");

  // ------------------------------------------------------------------ portfolios (ownership enforced by service)

  @SuppressWarnings("unchecked")
  List<Map<String, Object>> portfolioList(AuthUser user) {
    return (List<Map<String, Object>>) portfolios.list(user).get("portfolios");
  }

  Map<String, Object> portfolio(AuthUser user, UUID id) {
    return portfolios.get(user, id);
  }

  Map<String, Object> analytics(AuthUser user, UUID id) {
    return portfolios.analytics(user, id, id.toString());
  }

  Map<String, Object> preTradeRisk(AuthUser user, UUID id, TradingDtos.OrderTerms terms) {
    return portfolios.preTradeRisk(user, id, terms);
  }

  @SuppressWarnings("unchecked")
  List<Map<String, Object>> orders(AuthUser user, UUID id, String status, int limit) {
    return (List<Map<String, Object>>) portfolios.orders(user, id,
        new TradingDtos.OrderListQuery(status, Math.min(limit, 20))).get("orders");
  }

  @SuppressWarnings("unchecked")
  List<Map<String, Object>> executions(AuthUser user, UUID id, int limit) {
    return (List<Map<String, Object>>) portfolios.executions(user, id,
        new TradingDtos.LimitQuery(Math.min(limit, 50))).get("executions");
  }

  // ------------------------------------------------------------------ market (public catalogue data)

  Optional<Map<String, Object>> instrument(String symbol) {
    if (symbol == null || symbol.isBlank() || symbol.length() > 32) return Optional.empty();
    try {
      return Optional.of(market.getInstrument(symbol));
    } catch (ApiException e) {
      if (e.status() == HttpStatus.NOT_FOUND) return Optional.empty();
      throw e;
    }
  }

  /** Daily mid series for a bounded range ("1M", "3M", "6M"); never more than ~180 sessions. */
  @SuppressWarnings("unchecked")
  List<Map<String, Object>> history(String symbol, String range) {
    String r = List.of("1M", "3M", "6M").contains(range) ? range : "6M";
    Map<String, Object> h = market.history(symbol, new TradingDtos.HistoryQuery(r));
    return (List<Map<String, Object>>) h.getOrDefault("points", List.of());
  }

  /** Volatility and drawdown computed with the platform's own {@link Risk} functions. */
  record SeriesStats(int observations, String from, String to, double first, double last, double returnPct,
      Double dailyVol, Double annualVol, double maxDrawdown) {}

  static Optional<SeriesStats> stats(List<Map<String, Object>> points) {
    if (points == null || points.size() < 3) return Optional.empty();
    double[] mids = points.stream().mapToDouble(p -> ((Number) p.get("mid")).doubleValue()).toArray();
    for (double v : mids) if (!(v > 0)) return Optional.empty();
    double[] returns = Risk.simpleReturns(mids);
    Double sd = Risk.sampleStdDev(returns);
    return Optional.of(new SeriesStats(mids.length, String.valueOf(points.getFirst().get("at")),
        String.valueOf(points.getLast().get("at")), mids[0], mids[mids.length - 1],
        mids[mids.length - 1] / mids[0] - 1, sd, sd == null ? null : sd * Math.sqrt(252), Risk.maxDrawdown(mids)));
  }

  Map<String, Object> crises() {
    return market.crisisEpisodes();
  }

  boolean warehousePresent() {
    return warehouse.tablesPresent();
  }

  /** Session closes between two dates for one source symbol; bounded by the episode length. */
  List<MarketDataWarehouseRepository.Bar> crisisBars(String sourceSymbol, LocalDate from, LocalDate to) {
    if (!warehouse.tablesPresent() || sourceSymbol == null) return List.of();
    return warehouse.barsBetween(sourceSymbol, from, to);
  }

  Map<String, Object> coverage() {
    return warehouse.tablesPresent() ? warehouse.coverageSummary() : Map.of();
  }

  @SuppressWarnings("unchecked")
  List<Map<String, Object>> news(int limit) {
    Object items = news.feed().get("items");
    if (!(items instanceof List<?> list)) return List.of();
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object o : list) {
      if (out.size() >= limit) break;
      if (o instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
    }
    return out;
  }

  // ------------------------------------------------------------------ AI models (existing registry)

  Map<String, Object> aiOverview() {
    return ai.overview();
  }

  Map<String, Object> aiModel(String id) {
    return ai.model(id);
  }

  // ------------------------------------------------------------------ learning (read-only; never mentor())

  List<Map<String, Object>> learningSessions(AuthUser user) {
    return learning.sessions(user);
  }

  Map<String, Object> learningSession(AuthUser user, UUID id) {
    return learning.getSession(user, id);
  }

  Optional<Map<String, Object>> assessment(AuthUser user, UUID id) {
    try {
      return Optional.of(learning.assessment(user, id));
    } catch (ApiException e) {
      if (e.status() == HttpStatus.NOT_FOUND) return Optional.empty();
      throw e;
    }
  }

  Map<String, Object> whatIfHold(AuthUser user, UUID id, int fromSeq) {
    return learning.whatIfHold(user, id, fromSeq);
  }

  Map<String, Object> storiesFeed(AuthUser user) {
    return stories.feed(user);
  }

  Map<String, Object> story(AuthUser user, String slug) {
    return stories.get(user, slug);
  }

  // ------------------------------------------------------------------ actuarial & bank stress (pure computations)

  Map<String, Object> actuarialPresets() {
    return actuarial.presets();
  }

  Map<String, Object> actuarialPrice(Map<String, Object> assumptions) {
    return actuarial.price(assumptions);
  }

  @SuppressWarnings("unchecked")
  List<Map<String, Object>> actuarialScenarios(AuthUser user) {
    return (List<Map<String, Object>>) actuarial.scenarios(user.id()).get("scenarios");
  }

  Map<String, Object> actuarialScenario(AuthUser user, UUID id) {
    return actuarial.scenario(user.id(), id);
  }

  Map<String, Object> stressRun(String presetId) {
    StressFactors.Preset preset = StressFactors.preset(presetId == null ? "recession" : presetId);
    if (preset == null) preset = StressFactors.preset("recession");
    return stress.run(new StressDtos.RunRequest(preset.id(), preset.factors(), 1.0));
  }

  // ------------------------------------------------------------------ numeric helpers

  static Double num(Object o) {
    if (o instanceof Number n) return n.doubleValue();
    if (o instanceof Map<?, ?> m && m.get("value") instanceof Number n) return n.doubleValue();
    return null;
  }

  @SuppressWarnings("unchecked")
  static Object at(Map<String, Object> root, String... path) {
    Object cur = root;
    for (String p : path) {
      if (!(cur instanceof Map<?, ?> m)) return null;
      cur = ((Map<String, Object>) m).get(p);
    }
    return cur;
  }

  static Map<String, Object> map(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
    return m;
  }
}
