package com.pif.api.finance;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.ToDoubleFunction;

/** Risk measures (apps/api/src/finance/risk.ts). */
public final class Risk {

  public static final int MIN_VOLATILITY_RETURNS = 5;
  public static final int MIN_VAR_OBSERVATIONS = 30;
  public static final double DEFAULT_VAR_CONFIDENCE = 0.95;

  private Risk() {}

  public record VarResult(double valueAtRisk, double expectedShortfall) {}

  public record StressLine(String symbol, double value, double shockPct, double impact) {}

  public record StressResult(double impact, List<StressLine> breakdown) {}

  /** Largest peak-to-trough fall of a value series, as a fraction of the peak. */
  public static double maxDrawdown(double[] series) {
    double peak = Double.NEGATIVE_INFINITY;
    double worst = 0;
    for (double value : series) {
      peak = Math.max(peak, value);
      if (peak > 0) worst = Math.max(worst, (peak - value) / peak);
    }
    return worst;
  }

  /** Sample standard deviation (n − 1); null below two observations. */
  public static Double sampleStdDev(double[] values) {
    if (values.length < 2) return null;
    double sum = 0;
    for (double value : values) sum += value;
    double mean = sum / values.length;
    double squares = 0;
    for (double value : values) squares += (value - mean) * (value - mean);
    return Math.sqrt(squares / (values.length - 1));
  }

  /** Period-on-period simple returns; periods starting from zero are skipped. */
  public static double[] simpleReturns(double[] series) {
    double[] out = new double[Math.max(0, series.length - 1)];
    int n = 0;
    for (int i = 1; i < series.length; i++) {
      if (series[i - 1] != 0) out[n++] = series[i] / series[i - 1] - 1;
    }
    return Arrays.copyOf(out, n);
  }

  public static VarResult historicalVaR(double[] pnl) {
    return historicalVaR(pnl, DEFAULT_VAR_CONFIDENCE);
  }

  /** True when every observation is a finite number (no NaN, no ±Infinity). */
  public static boolean allFinite(double[] sample) {
    for (double value : sample) {
      if (!Double.isFinite(value)) return false;
    }
    return true;
  }

  /**
   * Historical simulation on a P&amp;L sample: VaR is the loss at index ⌊(1 − c)·n⌋ of the sorted
   * P&amp;L; ES is the mean loss of the observations at or below it. Null below 30 observations.
   * A confidence outside (1/n, 1] reads past the sample exactly as the TypeScript array access does.
   *
   * <p>Missing-data policy (intentional difference from TypeScript, see FINANCIAL_PARITY.md): a sample
   * with a non-finite observation is invalid data, not a risk figure. TypeScript returns an
   * engine-dependent number for it; this refuses it, so callers report the metric as unavailable
   * instead of showing a VaR (or a zero) computed from corrupt input.
   *
   * @throws InvalidSampleException when an observation is NaN or infinite
   */
  public static VarResult historicalVaR(double[] pnl, double confidence) {
    if (pnl.length < MIN_VAR_OBSERVATIONS) return null;
    if (!allFinite(pnl)) throw new InvalidSampleException(pnl.length);
    double[] sorted = ascending(pnl);
    double index = Math.floor((1 - confidence) * sorted.length);
    int tailLength = sliceEnd(index + 1, sorted.length);
    double sum = 0;
    for (int i = 0; i < tailLength; i++) sum += sorted[i];
    return new VarResult(Math.max(0, -elementAt(sorted, index)), Math.max(0, -sum / tailLength));
  }

  /** P&amp;L of today's holdings under one scenario of simple returns per symbol (full linear revaluation). */
  public static double scenarioPnl(Map<String, Double> values, ToDoubleFunction<String> returnOf) {
    double total = 0;
    for (Map.Entry<String, Double> entry : JsSemantics.entries(values)) {
      total += entry.getValue() * returnOf.applyAsDouble(entry.getKey());
    }
    return total;
  }

  /**
   * Instantaneous stress: each holding moves by its shock; lines are sorted by symbol. TypeScript
   * sorts with {@code localeCompare} in the server's ICU locale; this uses the JDK root-locale
   * collator, which orders letters and digits identically but differs on spaces and some punctuation.
   */
  public static StressResult stressImpact(Map<String, Double> values, ToDoubleFunction<String> shockOf) {
    Collator collator = Collator.getInstance(Locale.ROOT);
    collator.setStrength(Collator.TERTIARY);
    collator.setDecomposition(Collator.CANONICAL_DECOMPOSITION);
    List<Map.Entry<String, Double>> entries = new ArrayList<>(JsSemantics.entries(values));
    entries.sort((a, b) -> collator.compare(a.getKey(), b.getKey()));
    List<StressLine> breakdown = new ArrayList<>(entries.size());
    for (Map.Entry<String, Double> entry : entries) {
      double value = entry.getValue();
      double move = shockOf.applyAsDouble(entry.getKey());
      breakdown.add(new StressLine(entry.getKey(), value, move * 100, JsSemantics.round(value * move)));
    }
    double impact = 0;
    for (StressLine line : breakdown) impact += line.impact();
    return new StressResult(impact, List.copyOf(breakdown));
  }

  /**
   * {@code [...values].sort((a, b) => a - b)}: stable, with −0 and +0 equal. The order around a
   * NaN depends on the JavaScript engine's sort algorithm and is not reproduced.
   */
  private static double[] ascending(double[] values) {
    double[] from = values.clone();
    double[] to = new double[from.length];
    for (int width = 1; width < from.length; width *= 2) {
      for (int lo = 0; lo < from.length; lo += 2 * width) {
        int mid = Math.min(lo + width, from.length);
        int hi = Math.min(lo + 2 * width, from.length);
        int i = lo;
        int j = mid;
        int k = lo;
        while (i < mid && j < hi) to[k++] = from[j] < from[i] ? from[j++] : from[i++];
        while (i < mid) to[k++] = from[i++];
        while (j < hi) to[k++] = from[j++];
      }
      double[] swap = from;
      from = to;
      to = swap;
    }
    return from;
  }

  /** {@code array[index]} read as a number: NaN (−undefined) outside the array. */
  private static double elementAt(double[] array, double index) {
    return index >= 0 && index < array.length && index == Math.floor(index) ? array[(int) index] : Double.NaN;
  }

  /** Length of {@code array.slice(0, end)}. */
  private static int sliceEnd(double end, int length) {
    if (Double.isNaN(end)) return 0;
    double relative = end < 0 ? Math.ceil(end) : Math.floor(end);
    if (relative < 0) return (int) Math.max(length + relative, 0);
    return (int) Math.min(relative, length);
  }
}
