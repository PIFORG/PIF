package com.pif.api.rooms;

import com.pif.api.finance.Money;
import com.pif.api.market.MarketDataWarehouseRepository;
import com.pif.api.market.MarketDataWarehouseRepository.Bar;
import com.pif.api.market.MarketQuote;
import com.pif.api.market.SimulatedMarketProvider;
import com.pif.api.rooms.MarketRoomsRepository.MemberRow;
import com.pif.api.rooms.MarketRoomsRepository.RoomRow;
import com.pif.api.rooms.RoomEconomy.Rules;
import com.pif.api.trading.TradingRepository;
import com.pif.api.trading.TradingRepository.InstrumentRow;
import com.pif.api.trading.TradingRepository.PortfolioRow;
import com.pif.api.trading.TradingRepository.PositionRow;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Mark-to-market valuation for room portfolios (currency units, not millimes).
 * <p>Net worth = cash + MTM positions − outstanding virtual credit debt.
 * External capital (point conversions + outstanding credit) is excluded from trading return.
 */
@Component
public class RoomValuation {

  private final TradingRepository trading;
  private final SimulatedMarketProvider provider;
  private final MarketDataWarehouseRepository warehouse;
  private final JdbcClient jdbc;

  public RoomValuation(TradingRepository trading, SimulatedMarketProvider provider,
      MarketDataWarehouseRepository warehouse, JdbcClient jdbc) {
    this.trading = trading;
    this.provider = provider;
    this.warehouse = warehouse;
    this.jdbc = jdbc;
  }

  public record Snapshot(
      double cash,
      double positionsMarketValue,
      double costBasis,
      double grossEquity,
      double creditDebt,
      double netWorth,
      double initialCapital,
      double convertedCapital,
      double externalCapital,
      double tradingReturnPct,
      double unrealizedPnl,
      double realizedPnl,
      double feesPaid,
      boolean valuationComplete,
      int missingQuotes,
      String valuationAsOf,
      String pricingPolicy,
      List<Map<String, Object>> positions) {}

  public Snapshot value(RoomRow room, MemberRow member, Instant now) {
    PortfolioRow pf = trading.portfolio(member.portfolioId());
    Rules rules = RoomEconomy.Rules.fromJson(parseRules(room.rulesJson()));
    double cash = Money.fromAmount(pf.cash());
    double realized = Money.fromAmount(pf.realizedPnl());
    double fees = Money.fromAmount(pf.feesPaid());
    double creditDebt = Money.fromAmount(member.creditDebtMillimes());
    double converted = Money.fromAmount(member.convertedCapitalMillimes());
    double initial = Money.fromAmount(rules.initialCapitalMillimes());
    // Capital that did not come from market P&L: conversions + remaining credit debt.
    double external = converted + creditDebt;
    String baseCurrency = pf.baseCurrency() == null ? "TND" : pf.baseCurrency();

    LocalDate asOfDate = room.simClockDate();
    boolean historical = asOfDate != null && !"FICTIONAL".equalsIgnoreCase(room.marketScope());
    String policy = historical
        ? "MARK_TO_MARKET_ON_OR_BEFORE_" + asOfDate
        : "MARK_TO_MARKET_SIMULATOR_OR_LAST_AVAILABLE_CLOSE";
    Instant valuationInstant = historical
        ? asOfDate.atTime(15, 0).toInstant(ZoneOffset.UTC)
        : now;

    List<Map<String, Object>> positionsJson = new ArrayList<>();
    double positionsValue = 0;
    double costBasis = 0;
    int missing = 0;
    int currencyMismatch = 0;

    for (PositionRow pos : trading.positions(member.portfolioId())) {
      if (pos.quantity() <= 0) continue; // liquidated / flat lots ignored
      InstrumentRow inst = instrument(pos.instrumentId());
      double cost = Money.fromAmount(pos.costBasis());
      costBasis += cost;
      if (inst == null) {
        missing++;
        continue;
      }
      if (inst.quoteCurrency() != null && !inst.quoteCurrency().equalsIgnoreCase(baseCurrency)) {
        // No silent FX conversion — flag incomplete so ranking is not presented as exact.
        currencyMismatch++;
      }
      Optional<Double> midMillimes = midMillimes(inst, historical ? asOfDate : null, now);
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("symbol", inst.symbol());
      row.put("currency", inst.quoteCurrency());
      row.put("quantity", pos.quantity());
      row.put("costBasis", cost);
      if (midMillimes.isEmpty()) {
        missing++;
        row.put("priceAvailable", false);
        row.put("marketValue", null);
        positionsJson.add(row);
        continue;
      }
      double mid = midMillimes.get();
      double mvMillimes = Money.notional(mid, pos.quantity());
      double mv = Money.fromAmount(Math.round(mvMillimes));
      positionsValue += mv;
      row.put("priceAvailable", true);
      row.put("price", Money.fromAmount(Math.round(mid)));
      row.put("marketValue", mv);
      row.put("unrealizedPnl", mv - cost);
      row.put("quoteAsOf", valuationInstant.toString());
      positionsJson.add(row);
    }

    double grossEquity = cash + positionsValue;
    // Net worth = cash + MTM positions − outstanding virtual credit (borrowed funds already sit in cash).
    double netWorth = grossEquity - creditDebt;
    double tradingReturnPct = RoomEconomy.tradingReturnPct(grossEquity, initial, external);
    int gaps = missing + currencyMismatch;
    boolean complete = gaps == 0;

    return new Snapshot(
        cash,
        positionsValue,
        costBasis,
        grossEquity,
        creditDebt,
        netWorth,
        initial,
        converted,
        external,
        tradingReturnPct,
        positionsValue - costBasis,
        realized,
        fees,
        complete,
        gaps,
        valuationInstant.toString(),
        policy + "|BASE=" + baseCurrency,
        positionsJson);
  }

  public Map<String, Object> toJson(Snapshot s) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("cash", s.cash());
    m.put("positionsMarketValue", s.positionsMarketValue());
    m.put("costBasis", s.costBasis());
    m.put("grossEquity", s.grossEquity());
    m.put("creditDebt", s.creditDebt());
    m.put("netWorth", s.netWorth());
    m.put("initialCapital", s.initialCapital());
    m.put("convertedCapital", s.convertedCapital());
    m.put("externalCapital", s.externalCapital());
    m.put("tradingReturnPct", round1(s.tradingReturnPct()));
    m.put("unrealizedPnl", s.unrealizedPnl());
    m.put("realizedPnl", s.realizedPnl());
    m.put("feesPaid", s.feesPaid());
    m.put("valuationComplete", s.valuationComplete());
    m.put("missingQuotes", s.missingQuotes());
    m.put("valuationAsOf", s.valuationAsOf());
    m.put("pricingPolicy", s.pricingPolicy());
    m.put("positions", s.positions());
    m.put("formula",
        "Valeur nette = Trésorerie + Valeur de marché des positions − Dette virtuelle. "
            + "Rendement trading = (Equity brute − capital externe − capital initial) / capital initial. "
            + "Le capital externe (conversions de points + crédit restant) n'est pas un rendement.");
    m.put("baseCurrencyPolicy",
        "Les cours sont exprimés dans la devise de cotation de chaque instrument ; "
            + "une devise différente de la devise du portefeuille rend la valorisation non exacte "
            + "(pas de conversion FX silencieuse).");
    if (!s.valuationComplete()) {
      m.put("rankingNote",
          "Valorisation incomplète (" + s.missingQuotes()
              + " écart(s) : cours manquants ou devises hétérogènes) — le classement n'est pas exact.");
    }
    return m;
  }

  private Optional<Double> midMillimes(InstrumentRow inst, LocalDate asOf, Instant now) {
    if (!inst.fictional() && warehouse.tablesPresent()) {
      Optional<String> src = warehouse.resolveSourceSymbol(inst.providerSymbol(), inst.symbol());
      if (src.isPresent()) {
        Optional<Bar> bar = asOf != null
            ? warehouse.barOnOrBefore(src.get(), asOf)
            : warehouse.latestBar(src.get());
        if (bar.isPresent()) return Optional.of((double) bar.get().close());
      }
    }
    if (provider.supports(inst.providerSymbol())) {
      Instant at = asOf != null ? asOf.atTime(15, 0).toInstant(ZoneOffset.UTC) : now;
      MarketQuote q = provider.quote(inst.providerSymbol(), at);
      if (q != null) return Optional.of(q.mid());
    }
    return Optional.empty();
  }

  private InstrumentRow instrument(UUID id) {
    return jdbc.sql("""
        SELECT id, symbol, name, asset_class::text AS asset_class, sector, quote_currency, status::text AS status,
               price_decimals, quantity_decimals, lot_size, provider_id, provider_symbol, fictional,
               metadata::text AS metadata_json
        FROM instruments WHERE id = ?
        """)
        .param(id)
        .query((rs, n) -> new InstrumentRow(
            (UUID) rs.getObject("id"),
            rs.getString("symbol"),
            rs.getString("name"),
            rs.getString("asset_class"),
            rs.getString("sector"),
            rs.getString("quote_currency"),
            rs.getString("status"),
            rs.getInt("price_decimals"),
            rs.getInt("quantity_decimals"),
            rs.getInt("lot_size"),
            rs.getString("provider_id"),
            rs.getString("provider_symbol"),
            rs.getBoolean("fictional"),
            rs.getString("metadata_json")))
        .optional()
        .orElse(null);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> parseRules(String json) {
    try {
      return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, Map.class);
    } catch (Exception e) {
      return Map.of();
    }
  }

  private static double round1(double v) {
    return Math.round(v * 10.0) / 10.0;
  }
}
