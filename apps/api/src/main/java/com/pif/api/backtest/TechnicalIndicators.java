package com.pif.api.backtest;

import java.util.Arrays;

/**
 * Classic technical indicators on a close series. Every series is the same length as {@code closes}; values before
 * the warm-up window are {@code null}. No look-ahead: the value at index {@code i} uses only {@code closes[0..i]}.
 *
 * <p>Conventions (see {@code docs/trading/TECHNICAL_ANALYSIS.md}):
 * <ul>
 *   <li>SMA: arithmetic mean of the last {@code period} closes; ready at index {@code period - 1}.</li>
 *   <li>EMA: seeded with the SMA of the first {@code period} closes, then
 *       {@code alpha = 2/(period+1)}, {@code ema_t = alpha*close_t + (1-alpha)*ema_{t-1}}.</li>
 *   <li>RSI: Wilder smoothing of average gain/loss over {@code period} (default 14).</li>
 *   <li>MACD: EMA(fast) - EMA(slow); signal = EMA of the MACD line; histogram = MACD - signal.</li>
 *   <li>Bollinger: SMA +/- {@code k} * sample standard deviation of the window (n-1).</li>
 * </ul>
 */
public final class TechnicalIndicators {

  private TechnicalIndicators() {}

  public record MacdPoint(Double macd, Double signal, Double histogram) {}

  public record BollingerPoint(Double mid, Double upper, Double lower) {}

  /** Simple moving average. Null until {@code period} observations are available. */
  public static Double[] sma(double[] closes, int period) {
    requirePeriod(period);
    Double[] out = new Double[closes.length];
    if (closes.length < period) return out;
    double sum = 0;
    for (int i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  /** Exponential moving average; null until the SMA seed at {@code period - 1}. */
  public static Double[] ema(double[] closes, int period) {
    requirePeriod(period);
    Double[] out = new Double[closes.length];
    if (closes.length < period) return out;
    double sum = 0;
    for (int i = 0; i < period; i++) sum += closes[i];
    double prev = sum / period;
    out[period - 1] = prev;
    double alpha = 2.0 / (period + 1);
    for (int i = period; i < closes.length; i++) {
      prev = alpha * closes[i] + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  /** Wilder RSI in 0..100. Null until {@code period} returns are available (index {@code period}). */
  public static Double[] rsi(double[] closes, int period) {
    requirePeriod(period);
    Double[] out = new Double[closes.length];
    if (closes.length <= period) return out;
    double avgGain = 0;
    double avgLoss = 0;
    for (int i = 1; i <= period; i++) {
      double change = closes[i] - closes[i - 1];
      if (change >= 0) avgGain += change;
      else avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    out[period] = rsiFromAverages(avgGain, avgLoss);
    for (int i = period + 1; i < closes.length; i++) {
      double change = closes[i] - closes[i - 1];
      double gain = change > 0 ? change : 0;
      double loss = change < 0 ? -change : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = rsiFromAverages(avgGain, avgLoss);
    }
    return out;
  }

  public static Double[] rsi(double[] closes) {
    return rsi(closes, 14);
  }

  /**
   * MACD line, signal line and histogram. Defaults 12 / 26 / 9. MACD ready when both EMAs are ready; signal after
   * {@code signalPeriod} MACD points.
   */
  public static MacdPoint[] macd(double[] closes, int fast, int slow, int signalPeriod) {
    if (fast < 1 || slow < 1 || signalPeriod < 1) {
      throw new IllegalArgumentException("MACD periods must be >= 1");
    }
    if (fast >= slow) throw new IllegalArgumentException("MACD fast period must be < slow period");
    Double[] fastEma = ema(closes, fast);
    Double[] slowEma = ema(closes, slow);
    Double[] macdLine = new Double[closes.length];
    for (int i = 0; i < closes.length; i++) {
      if (fastEma[i] != null && slowEma[i] != null) macdLine[i] = fastEma[i] - slowEma[i];
    }
    Double[] signal = emaOfNullable(macdLine, signalPeriod);
    MacdPoint[] out = new MacdPoint[closes.length];
    for (int i = 0; i < closes.length; i++) {
      Double m = macdLine[i];
      Double s = signal[i];
      out[i] = new MacdPoint(m, s, m != null && s != null ? m - s : null);
    }
    return out;
  }

  public static MacdPoint[] macd(double[] closes) {
    return macd(closes, 12, 26, 9);
  }

  /** Bollinger bands; mid = SMA. Sample std-dev uses {@code n - 1}. */
  public static BollingerPoint[] bollinger(double[] closes, int period, double k) {
    requirePeriod(period);
    if (!(k > 0) || Double.isNaN(k) || Double.isInfinite(k)) {
      throw new IllegalArgumentException("Bollinger k must be a positive finite number");
    }
    Double[] mid = sma(closes, period);
    BollingerPoint[] out = new BollingerPoint[closes.length];
    for (int i = 0; i < closes.length; i++) {
      if (mid[i] == null) {
        out[i] = new BollingerPoint(null, null, null);
        continue;
      }
      double mean = mid[i];
      double squares = 0;
      for (int j = i - period + 1; j <= i; j++) {
        double d = closes[j] - mean;
        squares += d * d;
      }
      double std = Math.sqrt(squares / (period - 1));
      out[i] = new BollingerPoint(mean, mean + k * std, mean - k * std);
    }
    return out;
  }

  public static BollingerPoint[] bollinger(double[] closes) {
    return bollinger(closes, 20, 2);
  }

  private static double rsiFromAverages(double avgGain, double avgLoss) {
    if (avgLoss == 0) return 100;
    double rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /** EMA over a series that may contain leading nulls; seed starts at the first fully available window of values. */
  private static Double[] emaOfNullable(Double[] series, int period) {
    Double[] out = new Double[series.length];
    int first = -1;
    for (int i = 0; i < series.length; i++) {
      if (series[i] != null) {
        first = i;
        break;
      }
    }
    if (first < 0 || series.length - first < period) return out;
    double sum = 0;
    int seedAt = first + period - 1;
    for (int i = first; i <= seedAt; i++) {
      if (series[i] == null) return out;
      sum += series[i];
    }
    double prev = sum / period;
    out[seedAt] = prev;
    double alpha = 2.0 / (period + 1);
    for (int i = seedAt + 1; i < series.length; i++) {
      if (series[i] == null) break;
      prev = alpha * series[i] + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  private static void requirePeriod(int period) {
    if (period < 1) throw new IllegalArgumentException("period must be >= 1");
  }

  /** Copy helpers for tests / callers that prefer primitive arrays with NaN warm-up. */
  public static double[] toPrimitiveNaN(Double[] values) {
    double[] out = new double[values.length];
    Arrays.setAll(out, i -> values[i] == null ? Double.NaN : values[i]);
    return out;
  }
}
