package com.pif.api.echo;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/** French number formatting for spoken and written answers (no rounding of the underlying evidence values). */
final class EchoFormat {

  private EchoFormat() {}

  private static DecimalFormat df(String pattern) {
    DecimalFormatSymbols s = DecimalFormatSymbols.getInstance(Locale.FRANCE);
    s.setGroupingSeparator(' ');
    s.setDecimalSeparator(',');
    return new DecimalFormat(pattern, s);
  }

  static String money(Double v, String currency) {
    if (v == null || !Double.isFinite(v)) return "n.d.";
    return df("#,##0.00").format(v) + " " + (currency == null ? "TND" : currency);
  }

  /** {@code ratio} = 0.123 → "12,3 %". */
  static String pct(Double ratio) {
    if (ratio == null || !Double.isFinite(ratio)) return "n.d.";
    return df("0.0").format(ratio * 100) + " %";
  }

  static String signedPct(Double ratio) {
    if (ratio == null || !Double.isFinite(ratio)) return "n.d.";
    return (ratio > 0 ? "+" : "") + pct(ratio);
  }

  /** Percentage points between two ratios. */
  static String pp(Double delta) {
    if (delta == null || !Double.isFinite(delta)) return "n.d.";
    return (delta > 0 ? "+" : "") + df("0.0").format(delta * 100) + " pt";
  }

  static String num(Double v, int decimals) {
    if (v == null || !Double.isFinite(v)) return "n.d.";
    return df(decimals == 0 ? "#,##0" : "#,##0." + "0".repeat(decimals)).format(v);
  }

  static String day(String iso) {
    return iso == null ? "n.d." : iso.length() >= 10 ? iso.substring(0, 10) : iso;
  }
}
