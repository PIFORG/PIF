package com.pif.api.backtest;

import com.pif.api.backtest.BacktestDtos.RunRequest;
import com.pif.api.backtest.BacktestEngine.Config;
import com.pif.api.backtest.BacktestEngine.EquityPoint;
import com.pif.api.backtest.BacktestEngine.Result;
import com.pif.api.backtest.BacktestEngine.Trade;
import com.pif.api.backtest.Strategy.Bar;
import com.pif.api.data.Db;
import com.pif.api.finance.Money;
import com.pif.api.market.PricePoint;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.web.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Synchronous historical backtests on {@link SimulatedMarketProvider} daily closes. No database writes - prices are
 * regenerated from the deterministic fictional provider (ephemeral / in-memory only).
 */
@Service
public class BacktestService {

  private final SimulatedMarketProvider provider;
  private final Clock clock;

  public BacktestService(SimulatedMarketProvider provider, Clock clock) {
    this.provider = provider;
    this.clock = clock;
  }

  public Map<String, Object> run(RunRequest request) {
    List<String> symbols = request.symbols().stream().map(s -> s.toUpperCase(Locale.ROOT)).distinct().toList();
    for (String symbol : symbols) {
      if (!provider.supports(symbol)) {
        throw new ApiException(HttpStatus.NOT_FOUND, "INSTRUMENT_NOT_FOUND",
            com.pif.api.web.Messages.format("portfolio.instrument_not_found_symbol", symbol));
      }
    }

    Instant start = Instant.parse(request.start());
    Instant end = Instant.parse(request.end());
    Instant dataStart = provider.dataStart();
    Instant now = clock.instant().truncatedTo(ChronoUnit.MILLIS);
    if (start.isBefore(dataStart)) start = dataStart;
    if (end.isAfter(now)) end = now;
    if (!end.isAfter(start)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR",
          com.pif.api.web.Messages.get("backtest.history_insufficient"));
    }

    List<Bar> bars = alignedDailyBars(symbols, start, end);
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

    Map<String, Object> m = new LinkedHashMap<>();
    m.put("provenance", provider.provenance().toJson());
    m.put("executionConvention", result.executionConvention());
    m.put("assumptions", assumptions());
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

  private List<Bar> alignedDailyBars(List<String> symbols, Instant from, Instant to) {
    Map<String, Map<Instant, Double>> bySymbol = new LinkedHashMap<>();
    TreeSet<Instant> dates = new TreeSet<>();
    for (String symbol : symbols) {
      List<PricePoint> closes = provider.dailyCloses(symbol, from, to);
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

  private static List<String> assumptions() {
    return List.of(
        "Les prix sont des clôtures journalières déterministes FICTIONAL du SimulatedMarketProvider (pif-simulated-v1).",
        "Convention d'exécution NEXT_CLOSE : signal après la clôture t, exécution à la clôture t+1 (pas de look-ahead).",
        "Fractions d'actions autorisées ; pas de taille de lot ni de contrainte de profondeur en v1.",
        "Commission = notionnel × feeBps / 10 000 ; slippage décale l'exécution par rapport au mid de slippageBps.",
        "Pas de dividendes, opérations sur titres, emprunt ni financement overnight.",
        "Annualisation sur 365 jours civils et √365 pour volatilité/Sharpe.",
        "Résultat synchrone uniquement — pas de file de jobs, pas de persistance des exécutions.");
  }
}
