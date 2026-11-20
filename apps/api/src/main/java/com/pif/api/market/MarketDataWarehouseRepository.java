package com.pif.api.market;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Read-side access to the market data warehouse (CMF / Stooq / RSS / crises). */
@Repository
public class MarketDataWarehouseRepository {

  private final JdbcClient jdbc;

  public MarketDataWarehouseRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public boolean tablesPresent() {
    Integer n = jdbc.sql(
            "SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name='market_price_bars'")
        .query(Integer.class).single();
    return n != null && n > 0;
  }

  public record Bar(LocalDate sessionDate, long open, long high, long low, long close, Long volume, String quality,
      String sourceId) {}

  public Optional<Bar> latestBar(String sourceSymbol) {
    return jdbc.sql("""
        SELECT session_date, open_millimes, high_millimes, low_millimes, close_millimes, volume, quality_flag, source_id
        FROM market_price_bars
        WHERE source_symbol = :sym
        ORDER BY session_date DESC
        LIMIT 1
        """)
        .param("sym", sourceSymbol)
        .query(this::bar)
        .optional();
  }

  /**
   * Latest close (+ previous session close) for many source symbols in one round-trip.
   * Used by the market tape / instrument list so real warehouse names are not left quote-less.
   */
  public record LatestQuote(Bar latest, Long previousCloseMillimes) {}

  public Map<String, LatestQuote> latestQuotesBySourceSymbols(List<String> sourceSymbols) {
    Map<String, LatestQuote> out = new LinkedHashMap<>();
    if (sourceSymbols == null || sourceSymbols.isEmpty() || !tablesPresent()) return out;
    List<String> unique = sourceSymbols.stream().filter(s -> s != null && !s.isBlank()).distinct().toList();
    if (unique.isEmpty()) return out;
    // Chunk to keep ANY() bindings bounded.
    final int chunk = 400;
    for (int i = 0; i < unique.size(); i += chunk) {
      List<String> slice = unique.subList(i, Math.min(i + chunk, unique.size()));
      jdbc.sql("""
          WITH ranked AS (
            SELECT source_symbol, session_date, open_millimes, high_millimes, low_millimes, close_millimes,
                   volume, quality_flag, source_id,
                   ROW_NUMBER() OVER (PARTITION BY source_symbol ORDER BY session_date DESC) AS rn
            FROM market_price_bars
            WHERE source_symbol = ANY(:syms)
          )
          SELECT a.source_symbol, a.session_date, a.open_millimes, a.high_millimes, a.low_millimes, a.close_millimes,
                 a.volume, a.quality_flag, a.source_id, b.close_millimes AS prev_close
          FROM ranked a
          LEFT JOIN ranked b ON b.source_symbol = a.source_symbol AND b.rn = 2
          WHERE a.rn = 1
          """)
          .param("syms", slice.toArray(String[]::new))
          .query((rs, n) -> {
            String sym = rs.getString("source_symbol");
            Bar latest = bar(rs, n);
            Long prev = (Long) rs.getObject("prev_close");
            out.put(sym, new LatestQuote(latest, prev));
            return sym;
          })
          .list();
    }
    return out;
  }

  public Optional<Bar> barOnOrBefore(String sourceSymbol, LocalDate asOf) {
    return jdbc.sql("""
        SELECT session_date, open_millimes, high_millimes, low_millimes, close_millimes, volume, quality_flag, source_id
        FROM market_price_bars
        WHERE source_symbol = :sym AND session_date <= :d
        ORDER BY session_date DESC
        LIMIT 1
        """)
        .param("sym", sourceSymbol)
        .param("d", Date.valueOf(asOf))
        .query(this::bar)
        .optional();
  }

  public List<Bar> barsBetween(String sourceSymbol, LocalDate from, LocalDate to) {
    return jdbc.sql("""
        SELECT session_date, open_millimes, high_millimes, low_millimes, close_millimes, volume, quality_flag, source_id
        FROM market_price_bars
        WHERE source_symbol = :sym AND session_date >= :f AND session_date <= :t
        ORDER BY session_date ASC
        """)
        .param("sym", sourceSymbol)
        .param("f", Date.valueOf(from))
        .param("t", Date.valueOf(to))
        .query(this::bar)
        .list();
  }

  public List<Map<String, Object>> crisisEpisodes() {
    return jdbc.sql("""
        SELECT id, title_fr, start_date, end_date, summary_fr, references_json, instruments_hint
        FROM market_crisis_episodes ORDER BY start_date
        """)
        .query((rs, n) -> {
          Map<String, Object> m = new LinkedHashMap<>();
          m.put("id", rs.getString("id"));
          m.put("title", rs.getString("title_fr"));
          m.put("startDate", rs.getDate("start_date").toLocalDate().toString());
          m.put("endDate", rs.getDate("end_date").toLocalDate().toString());
          m.put("summary", rs.getString("summary_fr"));
          m.put("references", rs.getString("references_json"));
          m.put("instrumentsHint", rs.getString("instruments_hint"));
          m.put("kind", "HISTORICAL_EPISODE");
          return m;
        })
        .list();
  }

  public List<Map<String, Object>> realNews(int limit) {
    return realNews(limit, false);
  }

  /** Prefer French items when {@code frenchOnly} is true; otherwise French first then others. */
  public List<Map<String, Object>> realNews(int limit, boolean frenchOnly) {
    String sql = """
        SELECT id::text AS id, source_id, title, summary, original_url, published_at, language, market, category, verification
        FROM market_news_items_real
        WHERE (:frOnly = false OR language ILIKE 'fr%' OR market = 'TN')
        ORDER BY CASE WHEN language ILIKE 'fr%' THEN 0 WHEN market = 'TN' THEN 1 ELSE 2 END,
                 published_at DESC
        LIMIT :lim
        """;
    return jdbc.sql(sql)
        .param("lim", limit)
        .param("frOnly", frenchOnly)
        .query((rs, n) -> {
          Map<String, Object> m = new LinkedHashMap<>();
          m.put("id", rs.getString("id"));
          m.put("title", rs.getString("title"));
          m.put("summary", rs.getString("summary"));
          m.put("symbol", null);
          m.put("sector", MarketDisplay.sectorLabel(rs.getString("category")));
          Instant published = rs.getTimestamp("published_at").toInstant();
          m.put("publishedAt", published.toString());
          m.put("provenance", "REAL_RSS");
          m.put("sourceId", rs.getString("source_id"));
          m.put("originalUrl", rs.getString("original_url"));
          m.put("fetchedAt", Instant.now().toString());
          m.put("availability", "AVAILABLE");
          m.put("verification", rs.getString("verification"));
          m.put("language", rs.getString("language"));
          m.put("market", rs.getString("market"));
          return m;
        })
        .list();
  }

  public Map<String, Object> coverageSummary() {
    Map<String, Object> m = new LinkedHashMap<>();
    if (!tablesPresent()) {
      m.put("available", false);
      return m;
    }
    m.put("available", true);
    m.put("bars", jdbc.sql("SELECT COUNT(*)::bigint AS n FROM market_price_bars").query(Long.class).single());
    m.put("instruments", jdbc.sql("SELECT COUNT(*)::bigint AS n FROM market_instruments_ext").query(Long.class).single());
    m.put("news", jdbc.sql("SELECT COUNT(*)::bigint AS n FROM market_news_items_real").query(Long.class).single());
    m.put("crises", jdbc.sql("SELECT COUNT(*)::bigint AS n FROM market_crisis_episodes").query(Long.class).single());
    List<Map<String, Object>> bySource = jdbc.sql("""
        SELECT source_id, COUNT(*)::bigint AS bars, MIN(session_date) AS min_d, MAX(session_date) AS max_d
        FROM market_price_bars GROUP BY source_id ORDER BY source_id
        """)
        .query((rs, n) -> {
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("sourceId", rs.getString("source_id"));
          row.put("bars", rs.getLong("bars"));
          row.put("minDate", rs.getDate("min_d") == null ? null : rs.getDate("min_d").toLocalDate().toString());
          row.put("maxDate", rs.getDate("max_d") == null ? null : rs.getDate("max_d").toLocalDate().toString());
          return row;
        })
        .list();
    m.put("bySource", bySource);
    return m;
  }

  /**
   * Instruments with at least one bar inside [start, end], for crisis exploration.
   * Limited to a readable sample of liquid names per source.
   */
  public List<Map<String, Object>> crisisSeriesCoverage(LocalDate start, LocalDate end) {
    return jdbc.sql("""
        SELECT b.source_id,
               b.source_symbol,
               COUNT(*)::bigint AS bars,
               MIN(b.session_date) AS min_d,
               MAX(b.session_date) AS max_d,
               MIN(b.close_millimes) AS min_close,
               MAX(b.close_millimes) AS max_close
        FROM market_price_bars b
        WHERE b.session_date >= :f AND b.session_date <= :t
          AND b.source_symbol IN (
            SELECT provider_symbol FROM instruments WHERE fictional = false AND provider_symbol IS NOT NULL
            UNION
            SELECT source_symbol FROM market_instruments_ext WHERE source_id = 'YAHOO'
          )
        GROUP BY b.source_id, b.source_symbol
        HAVING COUNT(*) >= 3
        ORDER BY b.source_id, bars DESC
        LIMIT 40
        """)
        .param("f", Date.valueOf(start))
        .param("t", Date.valueOf(end))
        .query((rs, n) -> {
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("sourceId", rs.getString("source_id"));
          row.put("sourceSymbol", rs.getString("source_symbol"));
          row.put("bars", rs.getLong("bars"));
          row.put("from", rs.getDate("min_d").toLocalDate().toString());
          row.put("to", rs.getDate("max_d").toLocalDate().toString());
          long minC = rs.getLong("min_close");
          long maxC = rs.getLong("max_close");
          row.put("minCloseMillimes", minC);
          row.put("maxCloseMillimes", maxC);
          if (minC > 0) {
            row.put("rangePct", Math.round((maxC / (double) minC - 1.0) * 10_000.0) / 100.0);
          }
          return row;
        })
        .list();
  }

  /** Resolve warehouse source_symbol for a trading instrument via provider_symbol or symbol. */
  public Optional<String> resolveSourceSymbol(String providerSymbol, String symbol) {
    Optional<String> byProvider = jdbc.sql("""
        SELECT source_symbol FROM market_instruments_ext
        WHERE source_symbol = :p OR trading_symbol = :p OR trading_symbol = :s
        ORDER BY CASE WHEN source_id = 'CMF_BVMT_HIST' THEN 0 ELSE 1 END
        LIMIT 1
        """)
        .param("p", providerSymbol)
        .param("s", symbol)
        .query(String.class)
        .optional();
    return byProvider;
  }

  private Bar bar(ResultSet rs, int n) throws SQLException {
    Long open = (Long) rs.getObject("open_millimes");
    Long high = (Long) rs.getObject("high_millimes");
    Long low = (Long) rs.getObject("low_millimes");
    long close = rs.getLong("close_millimes");
    Long vol = (Long) rs.getObject("volume");
    return new Bar(
        rs.getDate("session_date").toLocalDate(),
        open == null ? close : open,
        high == null ? close : high,
        low == null ? close : low,
        close,
        vol,
        rs.getString("quality_flag"),
        rs.getString("source_id"));
  }
}