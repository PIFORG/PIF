package com.pif.api.backtest;

import com.pif.api.backtest.BacktestDtos.RunRequest;
import com.pif.api.backtest.BacktestEngine.Config;
import com.pif.api.backtest.BacktestEngine.EquityPoint;
import com.pif.api.backtest.BacktestEngine.Result;
import com.pif.api.backtest.BacktestEngine.Trade;
import com.pif.api.backtest.Strategy.Bar;
import com.pif.api.data.Db;
import com.pif.api.finance.Money;
import com.pif.api.market.MarketDataWarehouseRepository;
import com.pif.api.market.PricePoint;
import com.pif.api.market.Provenance;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.trading.TradingRepository;
import com.pif.api.trading.TradingRepository.InstrumentRow;
import com.pif.api.web.ApiException;
import java.time.Clock;
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
import java.util.TreeSet;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Synchronous historical backtests. Fictional symbols use {@link SimulatedMarketProvider};
 * warehouse-backed instruments use validated session closes (no look-ahead beyond {@code end}).
 */
@Service
public class BacktestService {

  private static final Provenance HISTORICAL_PROVENANCE = new Provenance(
      "market-warehouse-v1",
      "HISTORICAL",
      "MIXED",
      "Backtest sur clôtures historiques warehouse (CMF/Yahoo) et/ou simulateur fictif. "
          + "Pas de cotation live.");

  private final SimulatedMarketProvider provider;
  private final TradingRepository trading;
  private final MarketDataWarehouseRepository warehouse;
  private final Clock clock;

  public BacktestService(SimulatedMarketProvider provider, TradingRepository trading,
      MarketDataWarehouseRepository warehouse, Clock clock) {
    this.provider = provider;
    this.trading = trading;
    this.warehouse = warehouse;
    this.clock = clock;
  }

  public Map<String, Object> run(RunRequest request) {
    List<String> symbols = request.symbols().stream().map(s -> s.toUpperCase(Locale.ROOT)).distinct().toList();
    List<InstrumentRow> instruments = new ArrayList<>(symbols.size());
    boolean anyHistorical = false;
    boolean anyFictional = false;
    for (String symbol : symbols) {
      InstrumentRow row = trading.instrumentBySymbol(symbol).orElse(null);
      if (row == null && provider.supports(symbol)) {
        // Legacy path: symbol known only to the simulator catalog.
        anyFictional = true;
        instruments.add(null);
        continue;
      }
      if (row == null) {
        throw new ApiException(HttpStatus.NOT_FOUND, "INSTRUMENT_NOT_FOUND",
            com.pif.api.web.Messages.format("portfolio.instrument_not_found_symbol", symbol));
      }
      // Indices may be analysed in backtests (returns/drawdowns) but remain non-tradable on the desk.
      if (row.fictional()) anyFictional = true;
      else anyHistorical = true;
      instruments.add(row);
    }

    Instant start = Instant.parse(request.start());
    Instant end = Instant.parse(request.end());
    Instant dataStart = provider.dataStart();
    Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
    if (!anyHistorical && start.isBefore(dataStart)) start = dataStart;
    if (end.isAfter(now)) end = now;
    if (!end.isAfter(start)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
          com.pif.api.web.Messages.get("backtest.history_insufficient"));
    }

    List<Bar> bars = alignedDailyBars(symbols, instruments, start, end);
    if (bars.size() < 2) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
          com.pif.api.web.Messages.get("backtest.need_two_closes"));
    }

    Map<String, Object> params = new LinkedHashMap<>(request.params());
    double riskFree = 0;
    Object rf = params.remove("riskFreeAnnual");
    if (rf instanceof Number n) riskFree = n.doubleValue();

    Strategy strategy = BacktestDtos.strategyOf(request.strategy());
    Config config = new Config(request.initialCash(), request.feeBps(), request.slippageBps(), riskFree);
    Result result = BacktestEngine.run(strategy, symbols, bars, params, config);
    BacktestMetrics.Metrics metrics = BacktestMetrics.compute(result, request.initialCash(), riskFree, bars, symbols);

    Provenance provenance = anyHistorical
        ? (anyFictional ? HISTORICAL_PROVENANCE : HISTORICAL_PROVENANCE)
        : provider.provenance();

    Map<String, Object> m = new LinkedHashMap<>();
    m.put("provenance", provenance.toJson());
    m.put("dataKinds", anyHistorical && anyFictional
        ? List.of("HISTORICAL", "FICTIONAL")
        : anyHistorical ? List.of("HISTORICAL") : List.of("FICTIONAL"));
    m.put("executionConvention", result.executionConvention());
    m.put("assumptions", assumptions(anyHistorical));
    m.put("strategy", request.strategy());
    m.put("symbols", symbols);
    m.put("start", Db.iso(bars.get(0).at()));
    m.put("end", Db.iso(bars.get(bars.size() - 1).at()));
    m.put("initialCash", request.initialCash());
    m.put("feeBps", request.feeBps());
    m.put("slippageBps", request.slippageBps());
    m.put("params", request.params());
    m.put("barCount", bars.size());
    m.put("metrics", BacktestMetrics.toJson(metrics));
    m.put("equityCurve", result.equityCurve().stream().map(BacktestService::equityJson).toList());
    m.put("drawdown", result.equityCurve().stream().map(p -> {
      Map<String, Object> d = new LinkedHashMap<>();
      d.put("at", Db.iso(p.at()));
      d.put("drawdown", p.drawdown());
      return d;
    }).toList());
    m.put("trades", result.trades().stream().map(BacktestService::tradeJson).toList());
    m.put("finalCash", result.finalCash());
    m.put("finalPositions", result.finalPositions());
    return m;
  }

  private List<Bar> alignedDailyBars(List<String> symbols, List<InstrumentRow> instruments,
      Instant from, Instant to) {
    Map<String, Map<Instant, Double>> bySymbol = new LinkedHashMap<>();
    TreeSet<Instant> dates = new TreeSet<>();
    LocalDate fromDate = from.atZone(ZoneOffset.UTC).toLocalDate();
    LocalDate toDate = to.atZone(ZoneOffset.UTC).toLocalDate();
    for (int i = 0; i < symbols.size(); i++) {
      String symbol = symbols.get(i);
      InstrumentRow row = instruments.get(i);
      List<PricePoint> closes = closesFor(symbol, row, from, to, fromDate, toDate);
      Map<Instant, Double> series = new LinkedHashMap<>();
      for (PricePoint p : closes) {
        Instant at = p.at();
        if (at.isBefore(from) || at.isAfter(to)) continue;
        series.put(at, Money.fromAmount(p.mid()));
        dates.add(at);
      }
      bySymbol.put(symbol, series);
    }
    List<Bar> bars = new ArrayList<>();
    for (Instant at : dates) {
      Map<String, Double> closes = new LinkedHashMap<>();
      boolean complete = true;
      for (String symbol : symbols) {
        Double mid = bySymbol.get(symbol).get(at);
        if (mid == null) {
          complete = false;
          break;
        }
        closes.put(symbol, mid);
      }
      if (complete) bars.add(new Bar(at, closes));
    }
    return bars;
  }

  private List<PricePoint> closesFor(String symbol, InstrumentRow row, Instant from, Instant to,
      LocalDate fromDate, LocalDate toDate) {
    if (row != null && !row.fictional() && warehouse.tablesPresent()) {
      Optional<String> src = warehouse.resolveSourceSymbol(row.providerSymbol(), row.symbol());
      if (src.isPresent()) {
        List<MarketDataWarehouseRepository.Bar> bars = warehouse.barsBetween(src.get(), fromDate, toDate);
        List<PricePoint> out = new ArrayList<>(bars.size());
        for (MarketDataWarehouseRepository.Bar b : bars) {
          // mid in millimes (Money scale), same convention as SimulatedMarketProvider.
          out.add(new PricePoint(b.sessionDate().atTime(15, 0).toInstant(ZoneOffset.UTC), (double) b.close()));
        }
        if (!out.isEmpty()) return out;
      }
    }
    String providerSymbol = row != null ? row.providerSymbol() : symbol;
    if (!provider.supports(providerSymbol)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "HISTORY_UNAVAILABLE",
          "Aucune série historique disponible pour " + symbol + " sur la période demandée.");
    }
    return provider.dailyCloses(providerSymbol, from, to);
  }

  private static Map<String, Object> equityJson(EquityPoint p) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("at", Db.iso(p.at()));
    m.put("equity", p.equity());
    m.put("cash", p.cash());
    m.put("positionsValue", p.positionsValue());
    m.put("drawdown", p.drawdown());
    return m;
  }

  private static Map<String, Object> tradeJson(Trade t) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("at", Db.iso(t.at()));
    m.put("symbol", t.symbol());
    m.put("side", t.side());
    m.put("quantity", t.quantity());
    m.put("price", t.price());
    m.put("fee", t.fee());
    m.put("slippageCost", t.slippageCost());
    m.put("cashAfter", t.cashAfter());
    return m;
  }

  private static List<String> assumptions(boolean historical) {
    List<String> list = new ArrayList<>();
    if (historical) {
      list.add("Les symboles historiques utilisent les clôtures warehouse (CMF/Yahoo) bornées à la fenêtre demandée — pas de fuite future.");
      list.add("Prix bruts tels que fournis (pas d'ajustement split silencieux). Devises TND/USD selon l'instrument.");
    } else {
      list.add("Les prix sont des clôtures journalières déterministes FICTIONAL du SimulatedMarketProvider (pif-simulated-v1).");
    }
    list.add("Convention d'exécution NEXT_CLOSE : signal après la clôture t, exécution à la clôture t+1 (pas de look-ahead).");
    list.add("Fractions d'actions autorisées ; pas de taille de lot ni de contrainte de profondeur en v1.");
    list.add("Commission = notionnel × feeBps / 10 000 ; slippage décale l'exécution par rapport au mid de slippageBps.");
    list.add("Pas de dividendes, opérations sur titres, emprunt ni financement overnight.");
    list.add("Annualisation sur 365 jours civils et √365 pour volatilité/Sharpe.");
    list.add("Résultat synchrone uniquement — pas de file de jobs, pas de persistance des exécutions.");
    return list;
  }
}
