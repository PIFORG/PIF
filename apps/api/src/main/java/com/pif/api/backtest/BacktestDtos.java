package com.pif.api.backtest;

import static com.pif.api.web.ApiDocs.describe;
import static com.pif.api.web.ApiDocs.object;
import static com.pif.api.web.ApiDocs.prop;
import static com.pif.api.web.ApiDocs.text;
import static com.pif.api.web.Validation.isIn;
import static com.pif.api.web.Validation.isString;
import static com.pif.api.web.Validation.mustBeIsoDate;
import static com.pif.api.web.Validation.mustBeNumber;
import static com.pif.api.web.Validation.mustBeString;
import static com.pif.api.web.Validation.mustMatch;
import static com.pif.api.web.Validation.notGreaterThan;
import static com.pif.api.web.Validation.notLessThan;
import static com.pif.api.web.Validation.oneOf;

import com.pif.api.admin.AdminDtos;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.ApiException;
import com.pif.api.web.JsNumbers;
import com.pif.api.web.Messages;
import com.pif.api.web.Validation;
import com.pif.api.web.Validation.Checker;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.NumberSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/** Request validation for {@code POST /api/backtests/run}. */
public final class BacktestDtos {

  static final List<String> STRATEGIES = List.of(
      BuyAndHoldStrategy.ID, MovingAverageCrossoverStrategy.ID, PeriodicRebalancingStrategy.ID);

  private static final Pattern SYMBOL = Pattern.compile("^[A-Z]{2,16}\\z");
  private static final Set<String> ALLOWED_PARAMS =
      Set.of("shortPeriod", "longPeriod", "rebalanceEvery", "riskFreeAnnual");

  private BacktestDtos() {}

  public record RunRequest(String strategy, List<String> symbols, String start, String end,
      Map<String, Object> params, double initialCash, double feeBps, double slippageBps) {}

  public static Map<String, Schema<?>> openApiSchemas() {
    Map<String, Schema<?>> s = new LinkedHashMap<>();
    ArraySchema symbols = new ArraySchema().items(new StringSchema().pattern("^[A-Z]{2,16}$"));
    symbols.setMinItems(1);
    symbols.setMaxItems(7);
    s.put("RunBacktestDto", object(
        List.of("strategy", "symbols", "start", "end", "initialCash"),
        prop("strategy", describe(ApiDocs.oneOf(STRATEGIES), "Strategy identifier.")),
        prop("symbols", describe(symbols, "One or more fictional instrument symbols.")),
        prop("start", describe(text(), "Inclusive ISO-8601 start (UTC).")),
        prop("end", describe(text(), "Inclusive ISO-8601 end (UTC).")),
        prop("params", describe(object(List.of()), "Strategy parameters (shortPeriod, longPeriod, rebalanceEvery, riskFreeAnnual).")),
        prop("initialCash", describe(number("1000", "1000000"), "Starting virtual cash in DT.")),
        prop("feeBps", describe(number("0", "100"), "Commission in basis points of notional. Default 0.")),
        prop("slippageBps", describe(number("0", "100"), "Slippage in basis points vs mid. Default 0."))));
    return s;
  }

  public static RunRequest run(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("strategy", "symbols", "start", "end", "params", "initialCash", "feeBps",
        "slippageBps"));
    Object strategy = c.stringValue("strategy");
    if (!isIn(strategy, STRATEGIES)) c.add(oneOf("strategy", STRATEGIES));
    if (!isString(strategy)) c.add(mustBeString("strategy"));

    Object symbolsRaw = c.raw("symbols");
    List<String> symbols = new ArrayList<>();
    if (!(symbolsRaw instanceof List<?> list) || list.isEmpty()) {
      c.add(Messages.get("validation.symbols_nonempty"));
    } else if (list.size() > 7) {
      c.add(Messages.get("validation.symbols_max"));
    } else {
      for (int i = 0; i < list.size(); i++) {
        Object item = list.get(i);
        if (!(item instanceof String s) || !SYMBOL.matcher(s).matches()) {
          c.add(mustMatch("symbols[" + i + "]", "^[A-Z]{2,16}$"));
        } else {
          symbols.add(s);
        }
      }
    }

    Object start = c.stringValue("start");
    if (!(start instanceof String startStr && AdminDtos.isIso8601Strict(startStr))) {
      c.add(mustBeIsoDate("start"));
    }
    Object end = c.stringValue("end");
    if (!(end instanceof String endStr && AdminDtos.isIso8601Strict(endStr))) {
      c.add(mustBeIsoDate("end"));
    }

    Map<String, Object> params = new LinkedHashMap<>();
    Object paramsRaw = c.raw("params");
    if (paramsRaw != null) {
      if (!(paramsRaw instanceof Map<?, ?> map)) {
        c.add(Messages.get("validation.params_object"));
      } else {
        for (Map.Entry<?, ?> e : map.entrySet()) {
          String key = String.valueOf(e.getKey());
          if (!ALLOWED_PARAMS.contains(key)) {
            c.add(Messages.format("validation.property_forbidden", "params." + key));
            continue;
          }
          Object num = toNumber(e.getValue());
          if (!(num instanceof Double d) || d.isNaN() || d.isInfinite()) {
            c.add(Messages.format("validation.must_be_number", "params." + key));
          } else {
            params.put(key, d);
          }
        }
      }
    }

    Object cash = toNumber(c.raw("initialCash"));
    numberRules(c, "initialCash", cash, 1_000, 1_000_000);
    Object fee = toNumber(c.raw("feeBps"));
    if (fee == null) fee = 0.0;
    numberRules(c, "feeBps", fee, 0, 100);
    Object slip = toNumber(c.raw("slippageBps"));
    if (slip == null) slip = 0.0;
    numberRules(c, "slippageBps", slip, 0, 100);

    c.requireValid();

    if (start instanceof String s1 && end instanceof String s2) {
      try {
        if (java.time.Instant.parse(s2).isBefore(java.time.Instant.parse(s1))) {
          throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", Messages.get("validation.end_after_start"));
        }
      } catch (ApiException e) {
        throw e;
      } catch (RuntimeException e) {
        throw ApiException.validation(List.of(Messages.get("validation.start_end_instant")));
      }
    }

    return new RunRequest((String) strategy, List.copyOf(symbols), (String) start, (String) end, params,
        (Double) cash, (Double) fee, (Double) slip);
  }

  static Strategy strategyOf(String id) {
    return switch (id) {
      case BuyAndHoldStrategy.ID -> new BuyAndHoldStrategy();
      case MovingAverageCrossoverStrategy.ID -> new MovingAverageCrossoverStrategy();
      case PeriodicRebalancingStrategy.ID -> new PeriodicRebalancingStrategy();
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", Messages.get("backtest.unknown_strategy"));
    };
  }

  private static void numberRules(Checker c, String field, Object value, double min, double max) {
    if (!(value instanceof Double d) || d.isNaN() || d.isInfinite()) {
      c.add(mustBeNumber(field));
      return;
    }
    if (d > max) c.add(notGreaterThan(field, JsNumbers.toJsString(max)));
    if (d < min) c.add(notLessThan(field, JsNumbers.toJsString(min)));
  }

  private static Object toNumber(Object raw) {
    if (raw == null) return null;
    if (raw instanceof Number n) return n.doubleValue();
    if (raw instanceof String s) return AdminDtos.jsNumber(s);
    if (raw instanceof Boolean b) return b ? 1.0 : 0.0;
    return Double.NaN;
  }

  private static NumberSchema number(String min, String max) {
    NumberSchema n = new NumberSchema();
    if (min != null) n.setMinimum(new java.math.BigDecimal(min));
    if (max != null) n.setMaximum(new java.math.BigDecimal(max));
    return n;
  }

  /** Query parsing for {@code GET .../indicators}. */
  public static List<String> indicatorKinds(Map<String, String[]> query) {
    String raw = first(query, "kinds");
    if (raw == null || raw.isBlank()) return List.of("SMA", "EMA", "RSI", "MACD", "BB");
    List<String> kinds = new ArrayList<>();
    for (String part : raw.split(",")) {
      String k = part.trim().toUpperCase(Locale.ROOT);
      if (k.isEmpty()) continue;
      if (!Set.of("SMA", "EMA", "RSI", "MACD", "BB").contains(k)) {
        throw ApiException.validation(List.of(Messages.get("validation.kinds_list")));
      }
      kinds.add(k);
    }
    if (kinds.isEmpty()) throw ApiException.validation(List.of(Messages.get("validation.kinds_empty")));
    return kinds;
  }

  public static String historyRange(Map<String, String[]> query) {
    String range = first(query, "range");
    if (range == null || range.isBlank()) return "3M";
    if (!List.of("1D", "5D", "1M", "3M", "6M", "ALL").contains(range)) {
      throw ApiException.validation(List.of(Messages.get("validation.range_indicators")));
    }
    return range;
  }

  private static String first(Map<String, String[]> query, String key) {
    String[] values = query.get(key);
    return values == null || values.length == 0 ? null : values[0];
  }
}
