package com.pif.api.backtest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.pif.api.backtest.TechnicalIndicators.BollingerPoint;
import com.pif.api.backtest.TechnicalIndicators.MacdPoint;
import org.junit.jupiter.api.Test;

/** Deterministic golden numbers for indicator warm-up and formulas. */
class TechnicalIndicatorsTest {

  @Test
  void smaIsNullUntilWarmAndUsesExactWindowMean() {
    double[] closes = {1, 2, 3, 4, 5};
    Double[] sma = TechnicalIndicators.sma(closes, 3);
    assertNull(sma[0]);
    assertNull(sma[1]);
    assertEquals(2.0, sma[2]);
    assertEquals(3.0, sma[3]);
    assertEquals(4.0, sma[4]);
  }

  @Test
  void emaSeedsWithSmaThenAppliesAlpha() {
    double[] closes = {1, 2, 3, 4, 5};
    Double[] ema = TechnicalIndicators.ema(closes, 3);
    // seed = (1+2+3)/3 = 2; alpha = 2/4 = 0.5
    assertNull(ema[0]);
    assertNull(ema[1]);
    assertEquals(2.0, ema[2]);
    assertEquals(3.0, ema[3]); // 0.5*4 + 0.5*2
    assertEquals(4.0, ema[4]); // 0.5*5 + 0.5*3
  }

  @Test
  void rsiWilderGoldenOnHandSeries() {
    // Period 2: first RSI at index 2.
    // changes: +1, +1 -> avgGain=1, avgLoss=0 -> RSI=100
    // next change -2 -> avgGain=(1+0)/2=0.5, avgLoss=(0+2)/2=1 -> RS=0.5 -> RSI=33.333...
    double[] closes = {10, 11, 12, 10};
    Double[] rsi = TechnicalIndicators.rsi(closes, 2);
    assertNull(rsi[0]);
    assertNull(rsi[1]);
    assertEquals(100.0, rsi[2]);
    assertEquals(100.0 / 3.0, rsi[3], 1e-12);
  }

  @Test
  void macdAndBollingerWarmUp() {
    double[] closes = new double[40];
    for (int i = 0; i < closes.length; i++) closes[i] = 100 + i;

    MacdPoint[] macd = TechnicalIndicators.macd(closes, 3, 5, 2);
    assertNull(macd[3].macd()); // slow EMA not ready until index 4
    assertEquals(TechnicalIndicators.ema(closes, 3)[4] - TechnicalIndicators.ema(closes, 5)[4],
        macd[4].macd(), 1e-12);
    assertNull(macd[4].signal()); // signal needs 2 MACD points (indices 4 and 5)
    assertEquals(macd[5].macd() - macd[5].signal(), macd[5].histogram(), 1e-12);

    BollingerPoint[] bb = TechnicalIndicators.bollinger(closes, 3, 2);
    assertNull(bb[1].mid());
    assertEquals(101.0, TechnicalIndicators.sma(closes, 3)[2]);
    assertEquals(101.0, bb[2].mid());
    double mean = 101.0;
    double var = ((Math.pow(100 - mean, 2) + Math.pow(101 - mean, 2) + Math.pow(102 - mean, 2)) / 2);
    double std = Math.sqrt(var);
    assertEquals(mean + 2 * std, bb[2].upper(), 1e-12);
    assertEquals(mean - 2 * std, bb[2].lower(), 1e-12);
  }
}
