package com.pif.api.learning.engine;

import com.pif.api.finance.JsSemantics;
import com.pif.api.web.JsNumbers;
import java.math.BigDecimal;
import java.math.RoundingMode;

/** JavaScript number semantics the engine's texts and sorts depend on. */
public final class Js {

  private Js() {}

  /** {@code String(x)}. */
  public static String str(double x) {
    return JsNumbers.toJsString(x);
  }

  /** {@code Math.round(x)}. */
  public static double round(double x) {
    return JsSemantics.round(x);
  }

  public static boolean isInteger(double x) {
    return JsSemantics.isInteger(x);
  }

  /** {@code x.toFixed(digits)}, including the sign of negative values that round to zero ("-0.00"). */
  public static String toFixed(double x, int digits) {
    if (!Double.isFinite(x) || Math.abs(x) >= 1e21) return JsNumbers.toJsString(x);
    String sign = x < 0 ? "-" : "";
    return sign + new BigDecimal(Math.abs(x)).setScale(digits, RoundingMode.HALF_UP).toPlainString();
  }

  /** The result of a {@code (a, b) => a - b} comparator: NaN and ±0 differences compare equal. */
  public static int compare(double a, double b) {
    double d = a - b;
    return d < 0 ? -1 : d > 0 ? 1 : 0;
  }
}
