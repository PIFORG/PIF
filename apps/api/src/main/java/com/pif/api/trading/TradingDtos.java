package com.pif.api.trading;

import static com.pif.api.web.ApiDocs.describe;
import static com.pif.api.web.ApiDocs.object;
import static com.pif.api.web.ApiDocs.optionalQuery;
import static com.pif.api.web.ApiDocs.pattern;
import static com.pif.api.web.ApiDocs.prop;
import static com.pif.api.web.ApiDocs.text;
import static com.pif.api.web.Validation.isIn;
import static com.pif.api.web.Validation.isString;
import static com.pif.api.web.Validation.matches;
import static com.pif.api.web.Validation.maxLength;
import static com.pif.api.web.Validation.minLength;
import static com.pif.api.web.Validation.mustBeInteger;
import static com.pif.api.web.Validation.mustBeIsoDate;
import static com.pif.api.web.Validation.mustBeNumber;
import static com.pif.api.web.Validation.mustBeString;
import static com.pif.api.web.Validation.mustMatch;
import static com.pif.api.web.Validation.notGreaterThan;
import static com.pif.api.web.Validation.notLessThan;
import static com.pif.api.web.Validation.oneOf;
import static com.pif.api.web.Validation.shorterThan;
import static com.pif.api.web.Validation.longerThan;

import com.pif.api.admin.AdminDtos;
import com.pif.api.web.ApiDocs;
import com.pif.api.web.JsNumbers;
import com.pif.api.web.Messages;
import com.pif.api.web.Validation;
import com.pif.api.web.Validation.Checker;
import io.swagger.v3.oas.models.media.NumberSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * DTOs of apps/api/src/trading/dto/trading.dto.ts with the observable behaviour of the global ValidationPipe:
 * whitelist + forbidNonWhitelisted, class-transformer's implicit conversion (Number(value) for numbers, String(value)
 * for strings), then class-validator's default messages, bottom decorator first. Own properties of a subclass are
 * validated before inherited ones, as class-validator orders its metadata.
 */
public final class TradingDtos {

  static final List<String> ORDER_SIDES = List.of("BUY", "SELL");
  static final List<String> ORDER_TYPES = List.of("MARKET", "LIMIT", "STOP");
  static final List<String> ASSET_CLASSES = List.of("EQUITY", "FUND", "BOND", "COMMODITY", "FX");
  static final List<String> HISTORY_RANGES = List.of("1D", "5D", "1M", "3M", "6M", "ALL");
  static final List<String> ORDER_STATUS_FILTERS = List.of("open", "closed", "all");
  static final List<String> CASH_FLOW_TYPES = List.of("DEPOSIT", "WITHDRAWAL");

  private static final Pattern NAME = Pattern.compile("^[\\p{L}\\p{N} .,'&()-]+\\z");
  private static final String NAME_MESSAGE = Messages.get("validation.portfolio_name_chars");
  private static final Pattern SYMBOL = Pattern.compile("^[A-Z]{2,16}\\z");
  private static final Pattern CLIENT_ORDER_ID = Pattern.compile("^[A-Za-z0-9_-]{8,80}\\z");

  private TradingDtos() {}

  public record InstrumentQuery(String q, String assetClass) {}

  public record HistoryQuery(String range) {}

  public record OrderListQuery(String status, Integer limit) {}

  public record LimitQuery(Integer limit) {}

  public record CreatePortfolio(String name, double initialCapital, Integer maxPositionWeightPct) {}

  /** {@code limitPrice}/{@code stopPrice} are null when the property was absent (validation refuses null). */
  public record OrderTerms(String symbol, String side, String type, double quantity, Double limitPrice,
      Double stopPrice) {}

  public record SubmitOrder(OrderTerms terms, String clientOrderId, int expectedVersion, String quoteAsOf) {}

  public record CashFlow(String type, double amount, int expectedVersion) {}

  // ---------- OpenAPI ----------

  public static Map<String, Schema<?>> openApiSchemas() {
    Map<String, Schema<?>> s = new LinkedHashMap<>();
    StringSchema name = text(1, 60);
    name.setPattern("^[\\p{L}\\p{N} .,'&()-]+$");
    s.put("CreatePortfolioDto", object(List.of("name", "initialCapital"), prop("name", name),
        prop("initialCapital", describe(number("1000", "1000000"),
            "Virtual starting cash in TND (DT), 1 000 to 1 000 000, at most 3 decimals.")),
        prop("maxPositionWeightPct", describe(number("10", "100"),
            "Largest share of equity one holding may reach after a buy, in percent. Defaults to 50."))));
    s.put("PreviewOrderDto", orderSchema(false));
    s.put("SubmitOrderDto", orderSchema(true));
    s.put("CashFlowDto", object(List.of("type", "amount", "expectedVersion"),
        prop("type", ApiDocs.oneOf(CASH_FLOW_TYPES)),
        prop("amount", describe(number("0.001", "1000000"),
            "Virtual DT, more than 0 and at most 1 000 000, at most 3 decimals.")),
        prop("expectedVersion", describe(number("0", null),
            "Portfolio version from your last read. Prevents applying the same flow twice."))));
    return s;
  }

  private static Schema<?> orderSchema(boolean submit) {
    var symbol = prop("symbol", pattern("^[A-Z]{2,16}$"));
    var side = prop("side", ApiDocs.oneOf(ORDER_SIDES));
    var type = prop("type", describe(ApiDocs.oneOf(ORDER_TYPES), "STOP orders are protective sells."));
    var quantity = prop("quantity", number("1", "1000000"));
    var limitPrice = prop("limitPrice", describe(number("0.001", "1000000"),
        "DT, at most 3 decimals. Required for LIMIT orders, not allowed otherwise."));
    var stopPrice = prop("stopPrice", describe(number("0.001", "1000000"),
        "DT, at most 3 decimals. Required for STOP orders, not allowed otherwise."));
    if (!submit) {
      return object(List.of("symbol", "side", "type", "quantity"), symbol, side, type, quantity, limitPrice, stopPrice);
    }
    return object(List.of("symbol", "side", "type", "quantity", "clientOrderId", "expectedVersion", "quoteAsOf"),
        symbol, side, type, quantity, limitPrice, stopPrice,
        prop("clientOrderId", describe(pattern("^[A-Za-z0-9_-]{8,80}$"),
            "Client-generated key. Resending the same key and terms returns the original order.")),
        prop("expectedVersion", describe(number("0", null), "Portfolio version from your last read or preview. A "
            + "different current version means the portfolio changed (409).")),
        prop("quoteAsOf", describe(text(), "The `quote.asOf` your preview used. If the price has moved to a new quote "
            + "since, the order is refused (409) so you can review it.")));
  }

  public static Map<String, List<Parameter>> openApiQueries() {
    Parameter limit = optionalQuery("limit", withDefault(number("1", "200"), 100));
    return Map.of(
        "InstrumentQueryDto", List.of(optionalQuery("q", text(null, 40)),
            optionalQuery("assetClass", ApiDocs.oneOf(ASSET_CLASSES))),
        "HistoryQueryDto", List.of(optionalQuery("range", withDefault(ApiDocs.oneOf(HISTORY_RANGES), "1M"))),
        "OrderListQueryDto", List.of(optionalQuery("status", withDefault(ApiDocs.oneOf(ORDER_STATUS_FILTERS), "all")),
            limit),
        "LimitQueryDto", List.of(limit));
  }

  private static NumberSchema number(String minimum, String maximum) {
    NumberSchema s = new NumberSchema();
    if (minimum != null) s.setMinimum(new BigDecimal(minimum));
    if (maximum != null) s.setMaximum(new BigDecimal(maximum));
    return s;
  }

  @SuppressWarnings("unchecked")
  private static <T> Schema<T> withDefault(Schema<T> schema, Object value) {
    schema.setDefault(value instanceof Integer i ? (T) BigDecimal.valueOf(i) : (T) value);
    return schema;
  }

  // ---------- queries ----------

  public static InstrumentQuery instruments(Map<String, Object> query) {
    Checker c = new Checker(query, Set.of("q", "assetClass"));
    Object q = c.raw("q");
    if (q instanceof String s) q = Validation.jsTrim(s);
    if (q != null) {
      if (!maxLength(q, 40)) c.add(shorterThan("q", 40));
      if (!isString(q)) c.add(mustBeString("q"));
    }
    Object assetClass = c.raw("assetClass");
    if (assetClass != null && !isIn(assetClass, ASSET_CLASSES)) c.add(oneOf("assetClass", ASSET_CLASSES));
    c.requireValid();
    return new InstrumentQuery((String) q, (String) assetClass);
  }

  public static HistoryQuery history(Map<String, Object> query) {
    Checker c = new Checker(query, Set.of("range"));
    Object range = c.raw("range");
    if (range != null && !isIn(range, HISTORY_RANGES)) c.add(oneOf("range", HISTORY_RANGES));
    c.requireValid();
    return new HistoryQuery((String) range);
  }

  public static OrderListQuery orders(Map<String, Object> query) {
    Checker c = new Checker(query, Set.of("status", "limit"));
    Object status = c.raw("status");
    if (status != null && !isIn(status, ORDER_STATUS_FILTERS)) c.add(oneOf("status", ORDER_STATUS_FILTERS));
    Integer limit = limitField(c);
    c.requireValid();
    return new OrderListQuery((String) status, limit);
  }

  public static LimitQuery limit(Map<String, Object> query) {
    Checker c = new Checker(query, Set.of("limit"));
    Integer limit = limitField(c);
    c.requireValid();
    return new LimitQuery(limit);
  }

  /** @IsOptional() @Transform(Number) @IsInt() @Min(1) @Max(200). */
  private static Integer limitField(Checker c) {
    Object raw = c.raw("limit");
    if (raw == null) return null;
    Object value = toNumber(raw);
    if (!max(value, 200)) c.add(notGreaterThan("limit", 200));
    if (!min(value, 1)) c.add(notLessThan("limit", 1));
    if (!isInt(value)) c.add(mustBeInteger("limit"));
    return value instanceof Double d && isInt(d) && d >= 1 && d <= 200 ? d.intValue() : null;
  }

  // ---------- bodies ----------

  public static CreatePortfolio createPortfolio(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("name", "initialCapital", "maxPositionWeightPct"));
    Object name = c.stringValue("name");
    if (name instanceof String s) name = Validation.jsTrim(s);
    if (!matches(name, NAME)) c.add(NAME_MESSAGE);
    if (!maxLength(name, 60)) c.add(shorterThan("name", 60));
    if (!minLength(name, 1)) c.add(longerThan("name", 1));
    if (!isString(name)) c.add(mustBeString("name"));
    Object capital = toNumber(c.raw("initialCapital"));
    numberRules(c, "initialCapital", capital, 1_000, 1_000_000);
    Object weight = toNumber(c.raw("maxPositionWeightPct"));
    if (weight != null) intRules(c, "maxPositionWeightPct", weight, 10, 100.0);
    c.requireValid();
    return new CreatePortfolio((String) name, (Double) capital,
        weight == null ? null : ((Double) weight).intValue());
  }

  public static OrderTerms previewOrder(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("symbol", "side", "type", "quantity", "limitPrice", "stopPrice"));
    OrderTerms terms = orderTerms(c, body);
    c.requireValid();
    return terms;
  }

  public static SubmitOrder submitOrder(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("symbol", "side", "type", "quantity", "limitPrice", "stopPrice",
        "clientOrderId", "expectedVersion", "quoteAsOf"));
    Object clientOrderId = c.stringValue("clientOrderId");
    if (!matches(clientOrderId, CLIENT_ORDER_ID)) c.add(mustMatch("clientOrderId", "^[A-Za-z0-9_-]{8,80}$"));
    if (!isString(clientOrderId)) c.add(mustBeString("clientOrderId"));
    Object version = toNumber(c.raw("expectedVersion"));
    intRules(c, "expectedVersion", version, 0, null);
    Object quoteAsOf = c.stringValue("quoteAsOf");
    if (!(quoteAsOf instanceof String s && AdminDtos.isIso8601Strict(s))) {
      c.add(mustBeIsoDate("quoteAsOf"));
    }
    OrderTerms terms = orderTerms(c, body);
    c.requireValid();
    return new SubmitOrder(terms, (String) clientOrderId, ((Double) version).intValue(), (String) quoteAsOf);
  }

  public static CashFlow cashFlow(Map<String, Object> body) {
    Checker c = new Checker(body, Set.of("type", "amount", "expectedVersion"));
    Object type = c.stringValue("type");
    if (!isIn(type, CASH_FLOW_TYPES)) c.add(oneOf("type", CASH_FLOW_TYPES));
    Object amount = toNumber(c.raw("amount"));
    numberRules(c, "amount", amount, 0.001, 1_000_000);
    Object version = toNumber(c.raw("expectedVersion"));
    intRules(c, "expectedVersion", version, 0, null);
    c.requireValid();
    return new CashFlow((String) type, (Double) amount, ((Double) version).intValue());
  }

  private static OrderTerms orderTerms(Checker c, Map<String, Object> body) {
    Object symbol = c.stringValue("symbol");
    if (!matches(symbol, SYMBOL)) c.add(mustMatch("symbol", "^[A-Z]{2,16}$"));
    if (!isString(symbol)) c.add(mustBeString("symbol"));
    Object side = c.stringValue("side");
    if (!isIn(side, ORDER_SIDES)) c.add(oneOf("side", ORDER_SIDES));
    Object type = c.stringValue("type");
    if (!isIn(type, ORDER_TYPES)) c.add(oneOf("type", ORDER_TYPES));
    Object quantity = toNumber(c.raw("quantity"));
    intRules(c, "quantity", quantity, 1, 1_000_000.0);
    Object limitPrice = toNumber(body.get("limitPrice"));
    if ("LIMIT".equals(type) || body.containsKey("limitPrice")) {
      numberRules(c, "limitPrice", limitPrice, 0.001, 1_000_000);
    }
    Object stopPrice = toNumber(body.get("stopPrice"));
    if ("STOP".equals(type) || body.containsKey("stopPrice")) {
      numberRules(c, "stopPrice", stopPrice, 0.001, 1_000_000);
    }
    return new OrderTerms(symbol instanceof String s ? s : null, side instanceof String s ? s : null,
        type instanceof String s ? s : null, quantity instanceof Double d ? d : Double.NaN,
        limitPrice instanceof Double d ? d : null, stopPrice instanceof Double d ? d : null);
  }

  // ---------- class-validator semantics ----------

  /** @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false }) @Min(min) @Max(max). */
  private static void numberRules(Checker c, String field, Object value, double min, double max) {
    if (!max(value, max)) c.add(notGreaterThan(field, JsNumbers.toJsString(max)));
    if (!min(value, min)) c.add(notLessThan(field, JsNumbers.toJsString(min)));
    if (!isNumber3(value)) c.add(mustBeNumber(field));
  }

  /** @IsInt() @Min(min) [@Max(max)]. */
  private static void intRules(Checker c, String field, Object value, double min, Double max) {
    if (max != null && !max(value, max)) c.add(notGreaterThan(field, JsNumbers.toJsString(max)));
    if (!min(value, min)) c.add(notLessThan(field, JsNumbers.toJsString(min)));
    if (!isInt(value)) c.add(mustBeInteger(field));
  }

  /**
   * class-transformer's implicit conversion for a number property: Number(value), null kept, arrays kept as arrays
   * (their elements are converted, but an array never passes a number rule).
   */
  static Object toNumber(Object raw) {
    if (raw == null) return null;
    if (raw instanceof BigInteger b) return b.doubleValue();
    if (raw instanceof Number n) return n.doubleValue();
    if (raw instanceof String s) return AdminDtos.jsNumber(s);
    if (raw instanceof Boolean b) return b ? 1.0 : 0.0;
    if (raw instanceof List<?>) return raw;
    return Double.NaN;
  }

  private static boolean min(Object v, double min) {
    return v instanceof Double d && d >= min;
  }

  private static boolean max(Object v, double max) {
    return v instanceof Double d && d <= max;
  }

  private static boolean isInt(Object v) {
    return v instanceof Double d && Double.isFinite(d) && d == Math.rint(d);
  }

  /**
   * isNumber with maxDecimalPlaces 3: decimals are counted on the JavaScript text of the number. For a fraction
   * written in exponent form without a dot (1e-7), class-validator throws a TypeError and NestJS answers 500; this
   * port reports the constraint as failed (400) instead.
   */
  private static boolean isNumber3(Object v) {
    if (!(v instanceof Double d) || d.isNaN() || d.isInfinite()) return false;
    if (d % 1 != 0) {
      String text = JsNumbers.toJsString(d);
      int dot = text.indexOf('.');
      if (dot < 0 || text.length() - dot - 1 > 3) return false;
    }
    return true;
  }
}
