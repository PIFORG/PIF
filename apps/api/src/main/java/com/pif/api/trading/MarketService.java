package com.pif.api.trading;

import static com.pif.api.trading.TradingViews.dt;
import static com.pif.api.trading.TradingViews.instrumentView;
import static com.pif.api.trading.TradingViews.quoteView;

import com.pif.api.backtest.TechnicalIndicators;
import com.pif.api.backtest.TechnicalIndicators.BollingerPoint;
import com.pif.api.backtest.TechnicalIndicators.MacdPoint;
import com.pif.api.data.Db;
import com.pif.api.finance.JsSemantics;
import com.pif.api.finance.Money;
import com.pif.api.market.MarketQuote;
import com.pif.api.market.PricePoint;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.TradingRepository.InstrumentRow;
import com.pif.api.web.ApiException;
import com.pif.api.web.Messages;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** apps/api/src/trading/market.service.ts: instruments, simulated quotes with provenance, history and watchlist. */
@Service
public class MarketService {

  private static final Duration DAY = Duration.ofDays(1);

  private final TradingRepository repo;
  private final SimulatedMarketProvider provider;
  private final Clock clock;

  public MarketService(TradingRepository repo, SimulatedMarketProvider provider, Clock clock) {
    this.repo = repo;
    this.provider = provider;
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
    m.put("provenance", provider.provenance().toJson());
    m.put("serverTime", Db.iso(now));
    m.put("dataStart", Db.iso(provider.dataStart()));
    m.put("quotePeriodSeconds", SimulatedMarketProvider.BUCKET_MS / 1000);
    m.put("currentPeriod", period);
    m.put("tradingHours", "Le marché simulé cote en continu, 24 h sur 24, 7 jours sur 7.");
    m.put("dataKinds", List.of("FICTIONAL"));
    m.put("quality", Map.of(
        "missingObservationPolicy",
        "Avant l'époque de simulation, les cotations sont nulles ; les fenêtres de risque incomplètes signalent les "
            + "indicateurs comme indisponibles, jamais comme un zéro silencieux.",
        "corporateActions", Messages.get("market.corporate_actions"),
        "adjustments", "Aucun — les clôtures sont des mids simulés non ajustés."));
    m.put("assetClassConventions", List.of(
        Map.of("assetClass", "EQUITY", "status", "LIVE", "note",
            "Valorisation au mid, spread bid/ask, barème de frais actions."),
        Map.of("assetClass", "FUND", "status", "LIVE", "note",
            "Proxy de fonds obligataire (GOV) : volatilité et bêta plus faibles ; pas de prix sale/net ni d'intérêts courus."),
        Map.of("assetClass", "BOND", "status", "PENDING_DB_APPROVAL", "note",
            "Extension enum/seed préparée ; la base PIF principale reste inchangée jusqu'à validation."),
        Map.of("assetClass", "COMMODITY", "status", "PENDING_DB_APPROVAL", "note",
            "Rendement continu de type future synthétique prévu."),
        Map.of("assetClass", "FX", "status", "PENDING_DB_APPROVAL", "note",
            "Paires cotées en TND prévues ; pas d'intérêt overnight.")));
    return m;
  }

  public Map<String, Object> listInstruments(TradingDtos.InstrumentQuery query) {
    String q = query.q() == null || query.q().isEmpty() ? null : query.q();
    List<InstrumentRow> instruments = repo.searchInstruments(query.assetClass(), q);
    Instant now = now();
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("provenance", provider.provenance().toJson());
    m.put("asOf", Db.iso(now));
    m.put("instruments", instruments.stream().map(i -> withQuote(i, now)).toList());
    return m;
  }

  public Map<String, Object> getInstrument(String symbol) {
    return withQuote(findInstrument(symbol), now());
  }

  public Map<String, Object> history(String symbol, TradingDtos.HistoryQuery query) {
    InstrumentRow instrument = findInstrument(symbol);
    String range = query.range() == null ? "1M" : query.range();
    Instant now = now();
    List<PricePoint> points = points(instrument.providerSymbol(), range, now);
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
    return m;
  }

  /**
   * Technical overlays on the same mid series as history. Indicator values are null during warm-up. Daily ranges
   * use daily closes; 1D/5D use the intraday mid samples from {@link #history}.
   */
  public Map<String, Object> indicators(String symbol, String range, List<String> kinds) {
    InstrumentRow instrument = findInstrument(symbol);
    Instant now = now();
    List<PricePoint> points = points(instrument.providerSymbol(), range, now);
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
      item.put("instrument", withQuote(w.instrument(), now));
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

  private Map<String, Object> withQuote(InstrumentRow instrument, Instant now) {
    MarketQuote quote = provider.supports(instrument.providerSymbol())
        ? provider.quote(instrument.providerSymbol(), now) : null;
    List<PricePoint> closes = quote != null
        ? provider.dailyCloses(instrument.providerSymbol(), now.minus(DAY.multipliedBy(2)), now) : List.of();
    Double previousClose = closes.isEmpty() ? null : closes.get(closes.size() - 1).mid();
    Map<String, Object> m = instrumentView(instrument, provider.provenance());
    m.put("quote", quote == null ? null : quoteView(quote));
    m.put("previousClose", previousClose == null ? null : dt(previousClose));
    m.put("changePct", quote != null && previousClose != null && previousClose != 0
        ? JsSemantics.round((quote.mid() / previousClose - 1) * 10_000) / 100 : null);
    return m;
  }

  private List<PricePoint> points(String symbol, String range, Instant now) {
    if ("1D".equals(range)) return provider.intraday(symbol, now.minus(DAY), now, 1);
    if ("5D".equals(range)) return withCurrent(symbol, provider.intraday(symbol, now.minus(DAY.multipliedBy(5)), now, 6), now);
    Integer days = switch (range) {
      case "1M" -> 30;
      case "3M" -> 90;
      case "6M" -> 180;
      default -> null;
    };
    Instant from = days == null ? provider.dataStart() : now.minus(DAY.multipliedBy(days));
    return withCurrent(symbol, provider.dailyCloses(symbol, from, now), now);
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
}
