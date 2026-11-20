package com.pif.api.trading;

import static com.pif.api.trading.TradingViews.dt;
import static com.pif.api.trading.TradingViews.enrichQuoteMeta;
import static com.pif.api.trading.TradingViews.instrumentView;
import static com.pif.api.trading.TradingViews.quoteView;

import com.pif.api.backtest.TechnicalIndicators;
import com.pif.api.backtest.TechnicalIndicators.BollingerPoint;
import com.pif.api.backtest.TechnicalIndicators.MacdPoint;
import com.pif.api.data.Db;
import com.pif.api.finance.JsSemantics;
import com.pif.api.finance.Money;
import com.pif.api.market.MarketDataWarehouseRepository;
import com.pif.api.market.MarketDataWarehouseRepository.Bar;
import com.pif.api.market.MarketDataWarehouseRepository.LatestQuote;
import com.pif.api.market.MarketQuote;
import com.pif.api.market.PricePoint;
import com.pif.api.market.Provenance;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.TradingRepository.InstrumentRow;
import com.pif.api.web.ApiException;
import com.pif.api.web.Messages;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Instruments, quotes and history: simulated fictional books, warehouse bars for real instruments. */
@Service
public class MarketService {

  private static final Duration DAY = Duration.ofDays(1);
  /** Historical warehouse closes (CMF/BVMT, Yahoo). Kind is HISTORICAL; freshness is last session close, not live. */
  private static final Provenance HISTORICAL_PROVENANCE = Provenance.WAREHOUSE_HISTORICAL;

  private final TradingRepository repo;
  private final SimulatedMarketProvider provider;
  private final MarketDataWarehouseRepository warehouse;
  private final Clock clock;

  public MarketService(TradingRepository repo, SimulatedMarketProvider provider,
      MarketDataWarehouseRepository warehouse, Clock clock) {
    this.repo = repo;
    this.provider = provider;
    this.warehouse = warehouse;
    this.clock = clock;
  }

  Instant now() {
    return clock.instant().truncatedTo(ChronoUnit.MILLIS);
  }

  public Map<String, Object> status() {
    Instant now = now();
    MarketQuote quote = provider.quote("CTB", now);
    Map<String, Object> period = null;
    if (quote != null) {
      period = new LinkedHashMap<>();
      period.put("start", Db.iso(quote.asOf()));
      period.put("end", Db.iso(quote.asOf().plusMillis(SimulatedMarketProvider.BUCKET_MS)));
    }
    Map<String, Object> m = new LinkedHashMap<>();
    Map<String, Object> coverage = warehouse.tablesPresent() ? warehouse.coverageSummary() : Map.of("available", false);
    boolean hasReal = Boolean.TRUE.equals(coverage.get("available"))
        && coverage.get("bars") instanceof Number n && n.longValue() > 0;
    m.put("provenance", hasReal ? HISTORICAL_PROVENANCE.toJson() : provider.provenance().toJson());
    m.put("serverTime", Db.iso(now));
    m.put("dataStart", Db.iso(provider.dataStart()));
    m.put("quotePeriodSeconds", SimulatedMarketProvider.BUCKET_MS / 1000);
    m.put("currentPeriod", period);
    m.put("tradingHours", hasReal
        ? "Instruments réels : dernière clôture historique disponible (différée). Instruments fictifs : simulateur 24/7."
        : "Le marché simulé cote en continu, 24 h sur 24, 7 jours sur 7.");
    m.put("dataKinds", hasReal ? List.of("FICTIONAL", "HISTORICAL") : List.of("FICTIONAL"));
    m.put("freshnessPolicy", Map.of(
        "historical", "LAST_AVAILABLE_SESSION_CLOSE",
        "fictional", "SIMULATED_CONTINUOUS_5M",
        "live", "NOT_CONNECTED"));
    m.put("warehouse", coverage);
    m.put("quality", Map.of(
        "missingObservationPolicy",
        "Avant l'époque de simulation, les cotations sont nulles ; les fenêtres de risque incomplètes signalent les "
            + "indicateurs comme indisponibles, jamais comme un zéro silencieux. "
            + "Les barres historiques absentes ne sont jamais interpolées.",
        "corporateActions", Messages.get("market.corporate_actions"),
        "adjustments", "Historique CMF/Stooq : clôtures telles que fournies (pas d'ajustement split silencieux)."));
    m.put("assetClassConventions", List.of(
        Map.of("assetClass", "EQUITY", "status", "LIVE", "note",
            "Valorisation au mid, spread bid/ask, barème de frais actions."),
        Map.of("assetClass", "FUND", "status", "LIVE", "note",
            "Proxy de fonds obligataire (GOV) : volatilité et bêta plus faibles ; pas de prix sale/net ni d'intérêts courus."),
        Map.of("assetClass", "BOND", "status", "LIVE_ON_TEST_DB", "note",
            "TNDB seedé sur PIF_spring_test (obligation notionnelle). Base PIF principale non migrée."),
        Map.of("assetClass", "COMMODITY", "status", "LIVE_ON_TEST_DB", "note",
            "OILX seedé sur PIF_spring_test (indice pétrole fictif)."),
        Map.of("assetClass", "FX", "status", "LIVE_ON_TEST_DB", "note",
            "EURT seedé sur PIF_spring_test (EUR/TND synthétique) ; pas d'intérêt overnight.")));
    return m;
  }

  public Map<String, Object> listInstruments(TradingDtos.InstrumentQuery query) {
    String q = query.q() == null || query.q().isEmpty() ? null : query.q();
    List<InstrumentRow> instruments = repo.searchInstruments(query.assetClass(), q, query.market());
    Instant now = now();
    boolean anyReal = instruments.stream().anyMatch(i -> !i.fictional());
    Map<String, LatestQuote> warehouseQuotes = prefetchWarehouseQuotes(instruments);
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("provenance", (anyReal ? HISTORICAL_PROVENANCE : provider.provenance()).toJson());
    m.put("asOf", Db.iso(now));
    m.put("count", instruments.size());
    m.put("marketFilter", query.market());
    m.put("warehouseQuotes", warehouseQuotes.size());
    // Real instruments: batch last-session closes from warehouse. Fictional: simulator quotes.
    m.put("instruments", instruments.stream().map(i -> {
      if (!i.fictional()) {
        LatestQuote lq = warehouseQuoteFor(i, warehouseQuotes);
        if (lq != null) return withWarehouseListQuote(i, lq);
      }
      return withQuote(i, now, i.fictional());
    }).toList());
    return m;
  }

  private Map<String, LatestQuote> prefetchWarehouseQuotes(List<InstrumentRow> instruments) {
    if (!warehouse.tablesPresent()) return Map.of();
    List<String> keys = new ArrayList<>();
    for (InstrumentRow i : instruments) {
      if (i.fictional()) continue;
      if (i.providerSymbol() != null && !i.providerSymbol().isBlank()) keys.add(i.providerSymbol());
      if (i.symbol() != null && !i.symbol().isBlank()) keys.add(i.symbol());
    }
    return warehouse.latestQuotesBySourceSymbols(keys);
  }

  private static LatestQuote warehouseQuoteFor(InstrumentRow i, Map<String, LatestQuote> bySource) {
    if (bySource.isEmpty()) return null;
    LatestQuote byProvider = i.providerSymbol() == null ? null : bySource.get(i.providerSymbol());
    if (byProvider != null) return byProvider;
    return i.symbol() == null ? null : bySource.get(i.symbol());
  }

  private Map<String, Object> withWarehouseListQuote(InstrumentRow instrument, LatestQuote lq) {
    Bar b = lq.latest();
    double mid = b.close();
    double half = Math.max(1, Math.round(mid * 0.001));
    Instant asOf = b.sessionDate().atTime(15, 0).toInstant(ZoneOffset.UTC);
    MarketQuote quote = new MarketQuote(instrument.symbol(), asOf, mid, Math.max(1, mid - half), mid + half, 10_000);
    Double previousClose = lq.previousCloseMillimes() == null ? null : lq.previousCloseMillimes().doubleValue();
    Map<String, Object> m = instrumentView(instrument, HISTORICAL_PROVENANCE);
    Map<String, Object> q = quoteView(quote, now());
    enrichQuoteMeta(q, true, asOf);
    m.put("quote", q);
    m.put("previousClose", previousClose == null ? null : dt(previousClose));
    // Null unreliable day moves (sparse/illiquid bars) so tape/KPIs never show absurd %.
    m.put("changePct", reliableChangePct(quote.mid(), previousClose));
    m.put("dataKind", "HISTORICAL");
    m.put("freshness", "LAST_AVAILABLE_SESSION_CLOSE");
    m.put("tradable", isTradable(instrument));
    m.put("market", marketOf(instrument));
    m.put("observationAsOf", Db.iso(asOf));
    m.put("priceLabel", "Clôture historique (dernière séance disponible)");
    Map<String, Object> meta = parseMetadata(instrument.metadataJson());
    if (meta.get("minDate") != null || meta.get("maxDate") != null || meta.get("bars") != null) {
      Map<String, Object> coverage = new LinkedHashMap<>();
      coverage.put("from", meta.get("minDate"));
      coverage.put("to", meta.get("maxDate"));
      coverage.put("bars", meta.get("bars"));
      coverage.put("sourceId", instrument.providerId());
      coverage.put("sourceSymbol", instrument.providerSymbol());
      m.put("coverage", coverage);
    }
    return m;
  }

  public Map<String, Object> getInstrument(String symbol) {
    return withQuote(findInstrument(symbol), now(), true);
  }

  public Map<String, Object> history(String symbol, TradingDtos.HistoryQuery query) {
    InstrumentRow instrument = findInstrument(symbol);
    String range = query.range() == null ? "1M" : query.range();
    Instant now = now();
    List<PricePoint> points = points(instrument, range, now);
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("symbol", instrument.symbol());
    m.put("range", range);
    m.put("resolution", instrument.fictional()
        ? ("1D".equals(range) ? "5m" : "5D".equals(range) ? "30m" : "1d")
        : "1d");
    m.put("currency", instrument.quoteCurrency());
    m.put("provenance", (instrument.fictional() ? provider.provenance() : HISTORICAL_PROVENANCE).toJson());
    m.put("dataKind", instrument.fictional() ? "FICTIONAL" : "HISTORICAL");
    m.put("freshness", instrument.fictional() ? "SIMULATED_CONTINUOUS_5M" : "LAST_AVAILABLE_SESSION_CLOSE");
    m.put("tradable", isTradable(instrument));
    m.put("market", marketOf(instrument));
    m.put("points", points.stream().map(p -> {
      Map<String, Object> point = new LinkedHashMap<>();
      point.put("at", Db.iso(p.at()));
      point.put("mid", dt(p.mid()));
      return point;
    }).toList());
    return m;
  }

  /**
   * Technical overlays on the same mid series as history. Indicator values are null during warm-up. Daily ranges
   * use daily closes; 1D/5D use the intraday mid samples from {@link #history}.
   */
  public Map<String, Object> indicators(String symbol, String range, List<String> kinds) {
    InstrumentRow instrument = findInstrument(symbol);
    Instant now = now();
    List<PricePoint> points = points(instrument, range, now);
    double[] closes = points.stream().mapToDouble(p -> Money.fromAmount(p.mid())).toArray();
    Map<String, Object> series = new LinkedHashMap<>();
    for (String kind : kinds) {
      switch (kind) {
        case "SMA" -> series.put("SMA", nullableSeries(TechnicalIndicators.sma(closes, 20)));
        case "EMA" -> series.put("EMA", nullableSeries(TechnicalIndicators.ema(closes, 20)));
        case "RSI" -> series.put("RSI", nullableSeries(TechnicalIndicators.rsi(closes, 14)));
        case "MACD" -> {
          MacdPoint[] macd = TechnicalIndicators.macd(closes);
          List<Map<String, Object>> rows = new ArrayList<>(macd.length);
          for (MacdPoint p : macd) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("macd", p.macd());
            row.put("signal", p.signal());
            row.put("histogram", p.histogram());
            rows.add(row);
          }
          series.put("MACD", rows);
        }
        case "BB" -> {
          BollingerPoint[] bb = TechnicalIndicators.bollinger(closes);
          List<Map<String, Object>> rows = new ArrayList<>(bb.length);
          for (BollingerPoint p : bb) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("mid", p.mid());
            row.put("upper", p.upper());
            row.put("lower", p.lower());
            rows.add(row);
          }
          series.put("BB", rows);
        }
        default -> throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
            Messages.format("backtest.unknown_indicator", kind));
      }
    }
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("symbol", instrument.symbol());
    m.put("range", range);
    m.put("resolution", "1D".equals(range) ? "5m" : "5D".equals(range) ? "30m" : "1d");
    m.put("currency", instrument.quoteCurrency());
    m.put("provenance", provider.provenance().toJson());
    m.put("points", points.stream().map(p -> {
      Map<String, Object> point = new LinkedHashMap<>();
      point.put("at", Db.iso(p.at()));
      point.put("mid", dt(p.mid()));
      return point;
    }).toList());
    m.put("indicators", series);
    m.put("defaults", Map.of(
        "SMA", "period=20",
        "EMA", "period=20",
        "RSI", "period=14 Wilder",
        "MACD", "12/26/9",
        "BB", "period=20 k=2 sample stdev"));
    return m;
  }

  private static List<Double> nullableSeries(Double[] values) {
    List<Double> out = new ArrayList<>(values.length);
    for (Double v : values) out.add(v);
    return out;
  }

  public Map<String, Object> watchlist(AuthUser user) {
    Instant now = now();
    List<Map<String, Object>> items = repo.watchlist(user.id()).stream().map(w -> {
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("addedAt", Db.iso(w.createdAt()));
      item.put("instrument", withQuote(w.instrument(), now, true));
      return item;
    }).toList();
    return Map.of("items", items);
  }

  public Map<String, Object> addToWatchlist(AuthUser user, String symbol) {
    InstrumentRow instrument = findInstrument(symbol);
    repo.watch(user.id(), instrument.id(), Db.now());
    return watchlist(user);
  }

  public Map<String, Object> removeFromWatchlist(AuthUser user, String symbol) {
    InstrumentRow instrument = findInstrument(symbol);
    repo.unwatch(user.id(), instrument.id());
    return watchlist(user);
  }

  InstrumentRow findInstrument(String symbol) {
    return repo.instrumentBySymbol(symbol.toUpperCase(Locale.ROOT)).orElseThrow(() ->
        new ApiException(HttpStatus.NOT_FOUND, "INSTRUMENT_NOT_FOUND", Messages.get("portfolio.instrument_not_found")));
  }

  private Map<String, Object> withQuote(InstrumentRow instrument, Instant now, boolean loadLiveQuote) {
    Provenance prov = instrument.fictional() ? provider.provenance() : HISTORICAL_PROVENANCE;
    MarketQuote quote = null;
    Double previousClose = null;
    if (loadLiveQuote) {
      quote = quoteFor(instrument, now);
      if (!instrument.fictional() && warehouse.tablesPresent()) {
        // Prefer warehouse previous session (works even when the last bar is older than 5 days).
        Optional<String> src = warehouse.resolveSourceSymbol(instrument.providerSymbol(), instrument.symbol());
        if (src.isPresent()) {
          Map<String, LatestQuote> one = warehouse.latestQuotesBySourceSymbols(List.of(src.get()));
          LatestQuote lq = one.get(src.get());
          if (lq != null && lq.previousCloseMillimes() != null) {
            previousClose = lq.previousCloseMillimes().doubleValue();
          }
        }
        if (previousClose == null) {
          List<PricePoint> closes = historicalTail(instrument, 10);
          previousClose = closes.size() >= 2 ? closes.get(closes.size() - 2).mid()
              : closes.isEmpty() ? null : closes.get(closes.size() - 1).mid();
        }
      } else {
        List<PricePoint> closes = historicalPoints(instrument,
            now.minus(DAY.multipliedBy(5)).atZone(ZoneOffset.UTC).toLocalDate(),
            now.atZone(ZoneOffset.UTC).toLocalDate());
        if (closes.isEmpty() && quote != null && instrument.fictional() && provider.supports(instrument.providerSymbol())) {
          closes = provider.dailyCloses(instrument.providerSymbol(), now.minus(DAY.multipliedBy(2)), now);
        }
        previousClose = closes.size() >= 2 ? closes.get(closes.size() - 2).mid()
            : closes.isEmpty() ? null : closes.get(closes.size() - 1).mid();
      }
    } else if (instrument.fictional() && provider.supports(instrument.providerSymbol())) {
      quote = provider.quote(instrument.providerSymbol(), now);
    }
    Map<String, Object> m = instrumentView(instrument, prov);
    Map<String, Object> q = quote == null ? null : quoteView(quote, now);
    if (q != null) enrichQuoteMeta(q, !instrument.fictional(), quote.asOf());
    m.put("quote", q);
    m.put("previousClose", previousClose == null ? null : dt(previousClose));
    m.put("changePct", quote == null ? null : reliableChangePct(quote.mid(), previousClose));
    m.put("dataKind", instrument.fictional() ? "FICTIONAL" : "HISTORICAL");
    m.put("freshness", instrument.fictional() ? "SIMULATED_CONTINUOUS_5M" : "LAST_AVAILABLE_SESSION_CLOSE");
    m.put("tradable", isTradable(instrument));
    m.put("market", marketOf(instrument));
    Map<String, Object> meta = parseMetadata(instrument.metadataJson());
    if (meta.get("minDate") != null || meta.get("maxDate") != null || meta.get("bars") != null) {
      Map<String, Object> coverage = new LinkedHashMap<>();
      coverage.put("from", meta.get("minDate"));
      coverage.put("to", meta.get("maxDate"));
      coverage.put("bars", meta.get("bars"));
      coverage.put("sourceId", instrument.providerId());
      coverage.put("sourceSymbol", instrument.providerSymbol());
      m.put("coverage", coverage);
    }
    if (quote != null && !instrument.fictional()) {
      m.put("observationAsOf", Db.iso(quote.asOf()));
      m.put("priceLabel", "Clôture historique (dernière séance disponible)");
    }
    if ("BOND".equals(instrument.assetClass()) && "TNDB".equals(instrument.symbol())) {
      var terms = com.pif.api.finance.BondValuation.tndbDefault();
      var bond = com.pif.api.finance.BondValuation.value(terms, 0);
      Map<String, Object> bondView = new LinkedHashMap<>();
      bondView.put("faceValue", terms.faceValue());
      bondView.put("annualCouponRate", terms.annualCouponRate());
      bondView.put("couponsPerYear", terms.couponsPerYear());
      bondView.put("yearsToMaturity", terms.yearsToMaturity());
      bondView.put("yieldToMaturity", terms.yieldToMaturity());
      bondView.put("cleanPrice", bond.cleanPrice());
      bondView.put("accruedInterest", bond.accruedInterest());
      bondView.put("dirtyPrice", bond.dirtyPrice());
      bondView.put("macaulayDurationYears", bond.macaulayDurationYears());
      bondView.put("modifiedDuration", bond.modifiedDuration());
      bondView.put("nextCoupon", bond.nextCoupon());
      bondView.put("note", "Valorisation notionnelle pédagogique (flux actualisés), hors courbe de taux complète.");
      m.put("bond", bondView);
    }
    if ("FX".equals(instrument.assetClass()) && "EURT".equals(instrument.symbol())) {
      m.put("fx", Map.of(
          "base", "EUR",
          "quote", "TND",
          "pair", "EUR/TND",
          "note", "Paire synthétique ; conversion = quantité × mid, précision monétaire Money.toAmount."));
    }
    return m;
  }

  private List<PricePoint> points(InstrumentRow instrument, String range, Instant now) {
    String providerSymbol = instrument.providerSymbol();
    if (!instrument.fictional() && warehouse.tablesPresent()) {
      int days = switch (range) {
        case "1D", "5D" -> 10;
        case "1M" -> 30;
        case "3M" -> 90;
        case "6M" -> 180;
        default -> 3650;
      };
      LocalDate to = now.atZone(ZoneOffset.UTC).toLocalDate();
      LocalDate from = to.minusDays(days);
      List<PricePoint> hist = historicalPoints(instrument, from, to);
      // Sparse/stale warehouse series (last bar older than the window) → last available bars.
      // Never fall through to the fictional simulator (provider symbols like ISIN are unknown there).
      if (hist.isEmpty()) hist = historicalTail(instrument, days);
      return hist;
    }
    if (providerSymbol == null || !provider.supports(providerSymbol)) return List.of();
    if ("1D".equals(range)) return provider.intraday(providerSymbol, now.minus(DAY), now, 1);
    if ("5D".equals(range)) {
      return withCurrent(providerSymbol, provider.intraday(providerSymbol, now.minus(DAY.multipliedBy(5)), now, 6), now);
    }
    Integer days = switch (range) {
      case "1M" -> 30;
      case "3M" -> 90;
      case "6M" -> 180;
      default -> null;
    };
    Instant from = days == null ? provider.dataStart() : now.minus(DAY.multipliedBy(days));
    return withCurrent(providerSymbol, provider.dailyCloses(providerSymbol, from, now), now);
  }

  /** Last {@code minDays} calendar days ending at the latest warehouse session for this instrument. */
  private List<PricePoint> historicalTail(InstrumentRow instrument, int minDays) {
    Optional<String> src = warehouse.resolveSourceSymbol(instrument.providerSymbol(), instrument.symbol());
    if (src.isEmpty()) return List.of();
    Optional<Bar> latest = warehouse.latestBar(src.get());
    if (latest.isEmpty()) return List.of();
    LocalDate to = latest.get().sessionDate();
    LocalDate from = to.minusDays(Math.max(minDays, 30));
    return historicalPoints(instrument, from, to);
  }

  private List<PricePoint> withCurrent(String symbol, List<PricePoint> points, Instant now) {
    MarketQuote quote = provider.quote(symbol, now);
    if (quote == null || (!points.isEmpty() && !points.get(points.size() - 1).at().isBefore(quote.asOf()))) {
      return points;
    }
    List<PricePoint> out = new ArrayList<>(points);
    out.add(new PricePoint(quote.asOf(), quote.mid()));
    return out;
  }

  private MarketQuote quoteFor(InstrumentRow instrument, Instant now) {
    if (!instrument.fictional() && warehouse.tablesPresent()) {
      Optional<String> src = warehouse.resolveSourceSymbol(instrument.providerSymbol(), instrument.symbol());
      if (src.isPresent()) {
        Optional<Bar> bar = warehouse.latestBar(src.get());
        if (bar.isPresent()) {
          Bar b = bar.get();
          double mid = b.close();
          double half = Math.max(1, Math.round(mid * 0.001));
          Instant asOf = b.sessionDate().atTime(15, 0).toInstant(ZoneOffset.UTC);
          return new MarketQuote(instrument.symbol(), asOf, mid, Math.max(1, mid - half), mid + half, 10_000);
        }
      }
    }
    return provider.supports(instrument.providerSymbol()) ? provider.quote(instrument.providerSymbol(), now) : null;
  }

  private List<PricePoint> historicalPoints(InstrumentRow instrument, LocalDate from, LocalDate to) {
    if (instrument.fictional() || !warehouse.tablesPresent()) return List.of();
    Optional<String> src = warehouse.resolveSourceSymbol(instrument.providerSymbol(), instrument.symbol());
    if (src.isEmpty()) return List.of();
    List<Bar> bars = warehouse.barsBetween(src.get(), from, to);
    List<PricePoint> out = new ArrayList<>(bars.size());
    for (Bar b : bars) {
      out.add(new PricePoint(b.sessionDate().atTime(15, 0).toInstant(ZoneOffset.UTC), b.close()));
    }
    return out;
  }

  public Map<String, Object> crisisEpisodes() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("kind", "HISTORICAL_EPISODES");
    m.put("note",
        "Épisodes documentés pour simulations. Les séries renvoyées sont bornées à [startDate, endDate] "
            + "pour éviter toute fuite d'information future. Couverture BVMT dès 2018 ; US Yahoo dès 2008.");
    List<Map<String, Object>> episodes = warehouse.tablesPresent() ? warehouse.crisisEpisodes() : List.of();
    if (warehouse.tablesPresent()) {
      for (Map<String, Object> ep : episodes) {
        LocalDate start = LocalDate.parse(String.valueOf(ep.get("startDate")));
        LocalDate end = LocalDate.parse(String.valueOf(ep.get("endDate")));
        ep.put("series", warehouse.crisisSeriesCoverage(start, end));
        ep.put("bvmtCoverage", !end.isBefore(LocalDate.of(2018, 1, 1)));
        ep.put("usCoverage", !end.isBefore(LocalDate.of(2008, 1, 1)));
      }
    }
    m.put("episodes", episodes);
    return m;
  }

  public boolean isTradable(InstrumentRow instrument) {
    if (instrument.fictional()) return true;
    Map<String, Object> meta = parseMetadata(instrument.metadataJson());
    Object tradable = meta.get("tradable");
    if (tradable instanceof Boolean b) return b;
    if ("Indice".equalsIgnoreCase(instrument.sector())) return false;
    return true;
  }

  private static String marketOf(InstrumentRow instrument) {
    Map<String, Object> meta = parseMetadata(instrument.metadataJson());
    Object market = meta.get("market");
    if (market != null) return String.valueOf(market);
    if ("TND".equalsIgnoreCase(instrument.quoteCurrency()) || "CMF_BVMT_HIST".equals(instrument.providerId())) {
      return "TN";
    }
    if ("USD".equalsIgnoreCase(instrument.quoteCurrency()) || "YAHOO".equals(instrument.providerId())) {
      return "US";
    }
    return "UNKNOWN";
  }

  /**
   * Day change for UI (percentage points). Returns null when the previous close is too thin
   * or the implied move is implausible for a single session — keeps tape/KPIs honest.
   */
  static Double reliableChangePct(double midMillimes, Double previousCloseMillimes) {
    if (previousCloseMillimes == null || previousCloseMillimes == 0) return null;
    if (Math.abs(previousCloseMillimes) < 50) return null; // < 0.05 unit
    double pct = (midMillimes / previousCloseMillimes - 1.0) * 100.0;
    if (!Double.isFinite(pct) || Math.abs(pct) > 40.0) return null;
    return JsSemantics.round(pct * 100.0) / 100.0;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> parseMetadata(String json) {
    if (json == null || json.isBlank()) return Map.of();
    try {
      return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Map.class);
    } catch (Exception e) {
      return Map.of();
    }
  }
}
