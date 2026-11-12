package com.pif.api.learning.engine;

import com.pif.api.finance.JsSemantics;
import com.pif.api.finance.Quote;
import com.pif.api.learning.engine.Definitions.AssetDefinition;
import com.pif.api.learning.engine.Definitions.EventRegime;
import com.pif.api.learning.engine.Definitions.MarketEventDefinition;
import com.pif.api.learning.engine.Definitions.ScenarioDefinition;
import com.pif.api.learning.engine.Definitions.Shock;
import com.pif.api.market.Rng;
import java.util.ArrayList;
import java.util.List;

/**
 * The reference price path of a scenario (apps/api/src/learning/engine/market.ts). {@code log} and {@code exp} use
 * {@link StrictMath} (fdlibm, as V8), so every mission replays the same quotes as the NestJS engine.
 */
public final class MarketPath {

  public record MidPoint(int step, double mid, double bid, double ask) {}

  private final List<String> symbols;
  private final int historySteps;
  private final int steps;
  /** quotes[historySteps + step][assetIndex] for step ∈ [−historySteps, steps]. */
  private final Quote[][] quotes;

  private MarketPath(List<String> symbols, int historySteps, int steps, Quote[][] quotes) {
    this.symbols = symbols;
    this.historySteps = historySteps;
    this.steps = steps;
    this.quotes = quotes;
  }

  public List<String> symbols() {
    return symbols;
  }

  public int historySteps() {
    return historySteps;
  }

  public int steps() {
    return steps;
  }

  public int length() {
    return quotes.length;
  }

  private record RegimeEffect(double volMultiplier, double driftShift, double spreadMultiplier,
      double depthMultiplier) {}

  private static boolean affects(MarketEventDefinition event, String symbol) {
    List<String> symbols = event.regime().symbols();
    return symbols == null || symbols.contains(symbol);
  }

  private static RegimeEffect regimeAt(List<MarketEventDefinition> events, int step, String symbol) {
    double vol = 1;
    double drift = 0;
    double spread = 1;
    double depth = 1;
    for (MarketEventDefinition event : events) {
      EventRegime regime = event.regime();
      if (regime == null || step < event.step() || step >= event.step() + regime.steps() || !affects(event, symbol)) {
        continue;
      }
      vol *= regime.volMultiplier() == null ? 1 : regime.volMultiplier();
      drift += regime.driftShiftPerStep() == null ? 0 : regime.driftShiftPerStep();
      spread *= regime.spreadMultiplier() == null ? 1 : regime.spreadMultiplier();
      depth *= regime.depthMultiplier() == null ? 1 : regime.depthMultiplier();
    }
    return new RegimeEffect(vol, drift, spread, depth);
  }

  /** Jump (as a simple return) applied on the move into {@code step}, if an event shocks this symbol then. */
  public static double shockAt(List<MarketEventDefinition> events, int step, String symbol) {
    double total = 0;
    for (MarketEventDefinition event : events) {
      if (event.step() != step) continue;
      Double own = null;
      Double wildcard = null;
      for (Shock s : event.shocks()) {
        if (own == null && s.symbol().equals(symbol)) own = s.move();
        if (wildcard == null && "*".equals(s.symbol())) wildcard = s.move();
      }
      Double move = own != null ? own : wildcard;
      if (move != null) total = (1 + total) * (1 + move) - 1;
    }
    return total;
  }

  public static MarketPath generate(ScenarioDefinition scenario) {
    Rng rng = new Rng(scenario.seed());
    List<AssetDefinition> assets = scenario.assets();
    List<MarketEventDefinition> events = scenario.events();
    int historySteps = scenario.historySteps();
    int length = historySteps + scenario.steps() + 1;
    double[][] logs = new double[length][assets.size()];

    for (int k = 1; k < length; k++) {
      int step = k - historySteps;
      double factor = rng.normal();
      for (int i = 0; i < assets.size(); i++) {
        AssetDefinition asset = assets.get(i);
        double idio = rng.normal();
        RegimeEffect regime = step > 0 ? regimeAt(events, step, asset.symbol()) : null;
        double vol = asset.volPerStep() * (regime == null ? 1 : regime.volMultiplier());
        double shock = step > 0 ? shockAt(events, step, asset.symbol()) : 0;
        double beta = Math.min(1, Math.max(0, asset.beta()));
        double r = asset.driftPerStep()
            + (regime == null ? 0 : regime.driftShift())
            + vol * (beta * factor + Math.sqrt(1 - beta * beta) * idio)
            + StrictMath.log(1 + shock);
        logs[k][i] = logs[k - 1][i] + r;
      }
    }

    Quote[][] quotes = new Quote[length][assets.size()];
    for (int k = 0; k < length; k++) {
      int step = k - historySteps;
      for (int i = 0; i < assets.size(); i++) {
        AssetDefinition asset = assets.get(i);
        double shifted = logs[k][i] - logs[historySteps][i] + StrictMath.log(asset.initialPrice());
        double mid = Math.max(1, JsSemantics.round(StrictMath.exp(shifted) * 1000));
        RegimeEffect regime = step > 0 ? regimeAt(events, step, asset.symbol()) : null;
        double half = Math.max(1, JsSemantics.round(
            (mid * asset.spreadBps() * (regime == null ? 1 : regime.spreadMultiplier())) / 20_000));
        double depth = Math.max(1, JsSemantics.round(asset.depth() * (regime == null ? 1 : regime.depthMultiplier())));
        quotes[k][i] = new Quote(mid, Math.max(1, mid - half), mid + half, depth);
      }
    }
    List<String> symbols = assets.stream().map(AssetDefinition::symbol).toList();
    return new MarketPath(symbols, historySteps, scenario.steps(), quotes);
  }

  public Quote quoteAt(int step, String symbol) {
    int i = symbols.indexOf(symbol);
    if (i < 0) throw new IllegalArgumentException("Unknown symbol " + symbol);
    int k = historySteps + step;
    if (k < 0 || k >= quotes.length) throw new IllegalArgumentException("Step " + step + " is outside the scenario");
    return quotes[k][i];
  }

  /** Mid prices for one symbol from the first history observation up to and including {@code step} (never beyond). */
  public List<MidPoint> midSeriesUpTo(int step, String symbol) {
    int i = symbols.indexOf(symbol);
    int last = Math.min(historySteps + step, quotes.length - 1);
    List<MidPoint> out = new ArrayList<>();
    for (int k = 0; k <= last; k++) {
      Quote q = quotes[k][i];
      out.add(new MidPoint(k - historySteps, q.mid(), q.bid(), q.ask()));
    }
    return out;
  }
}
