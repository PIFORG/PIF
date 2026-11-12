package com.pif.api.web;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/**
 * JavaScript's number-to-text conversions, so responses and messages read exactly as the NestJS API writes them.
 * Java's {@link Double#toString} gives the same shortest round-trip digits as ECMAScript's Number::toString (both
 * pick the closest, then even, candidate); only the layout differs, and that is what this class reproduces.
 */
public final class JsNumbers {

  private JsNumbers() {}

  /** {@code String(x)} / {@code Number.prototype.toString()}. */
  public static String toJsString(double x) {
    if (Double.isNaN(x)) return "NaN";
    if (Double.isInfinite(x)) return x > 0 ? "Infinity" : "-Infinity";
    if (x == 0) return "0";
    String sign = x < 0 ? "-" : "";
    BigDecimal shortest = new BigDecimal(Double.toString(Math.abs(x))).stripTrailingZeros();
    String digits = shortest.unscaledValue().toString();
    int k = digits.length();
    int n = k - shortest.scale();
    if (k <= n && n <= 21) return sign + digits + "0".repeat(n - k);
    if (0 < n && n <= 21) return sign + digits.substring(0, n) + "." + digits.substring(n);
    if (-6 < n && n <= 0) return sign + "0." + "0".repeat(-n) + digits;
    int e = n - 1;
    String mantissa = k == 1 ? digits : digits.charAt(0) + "." + digits.substring(1);
    return sign + mantissa + "e" + (e >= 0 ? "+" : "-") + Math.abs(e);
  }

  /** JSON.stringify of a number: NaN and ±Infinity become null, −0 becomes 0. */
  public static String toJson(double x) {
    return Double.isFinite(x) ? toJsString(x) : null;
  }

  /** {@code x.toFixed(digits)}: the exact binary value rounded half up (ties to the larger magnitude). */
  public static String toFixed(double x, int digits) {
    if (!Double.isFinite(x)) return toJsString(x);
    if (Math.abs(x) >= 1e21) return toJsString(x);
    BigDecimal rounded = new BigDecimal(Math.abs(x)).setScale(digits, RoundingMode.HALF_UP);
    String sign = x < 0 && rounded.signum() != 0 ? "-" : "";
    return sign + rounded.toPlainString();
  }

  /**
   * {@code x.toLocaleString('en-US', { minimumFractionDigits, maximumFractionDigits })}: ICU rounds the shortest
   * decimal form of the double half away from zero, then groups thousands with commas.
   */
  public static String toLocaleEnUs(double x, int minFractionDigits, int maxFractionDigits) {
    if (Double.isNaN(x)) return "NaN";
    if (Double.isInfinite(x)) return x > 0 ? "∞" : "-∞";
    BigDecimal value = new BigDecimal(Double.toString(x)).setScale(maxFractionDigits, RoundingMode.HALF_UP);
    DecimalFormat format = new DecimalFormat("#,##0", DecimalFormatSymbols.getInstance(Locale.US));
    format.setMinimumFractionDigits(minFractionDigits);
    format.setMaximumFractionDigits(maxFractionDigits);
    format.setRoundingMode(RoundingMode.HALF_UP);
    String text = format.format(value);
    return text.startsWith("-") && value.signum() == 0 ? text.substring(1) : text;
  }

  /** {@code x.toLocaleString('en-US')}: at most 3 fraction digits. */
  public static String toLocaleEnUs(double x) {
    return toLocaleEnUs(x, 0, 3);
  }
}
