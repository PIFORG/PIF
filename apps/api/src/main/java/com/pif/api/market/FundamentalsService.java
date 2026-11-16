package com.pif.api.market;

import com.pif.api.web.ApiException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class FundamentalsService {

  private final SimulatedMarketProvider provider;

  public FundamentalsService(SimulatedMarketProvider provider) {
    this.provider = provider;
  }

  public Map<String, Object> forSymbol(String symbol) {
    String sym = symbol == null ? "" : symbol.trim().toUpperCase(Locale.ROOT);
    FundamentalsCatalog.Statement statement = FundamentalsCatalog.of(sym);
    if (statement == null) {
      throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Instrument introuvable pour l'analyse fondamentale.");
    }
    Double price = null;
    try {
      MarketQuote q = provider.quote(sym, Instant.now());
      if (q != null) price = q.mid();
    } catch (RuntimeException ignored) {
      // optional
    }
    return FundamentalsCatalog.view(statement, price);
  }

  public Map<String, Object> compare(String symbolsCsv) {
    if (symbolsCsv == null || symbolsCsv.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Indiquez au moins deux symboles.");
    }
    List<String> symbols = Arrays.stream(symbolsCsv.split(","))
        .map(s -> s.trim().toUpperCase(Locale.ROOT))
        .filter(s -> !s.isEmpty())
        .distinct()
        .limit(5)
        .toList();
    if (symbols.size() < 2) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "La comparaison exige au moins deux symboles.");
    }
    List<Map<String, Object>> rows = new ArrayList<>();
    for (String symbol : symbols) rows.add(forSymbol(symbol));
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("items", rows);
    body.put("note", "Comparaison pedagogique sur donnees synthetiques.");
    return body;
  }
}