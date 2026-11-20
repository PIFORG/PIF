package com.pif.api.market;

import com.pif.api.admin.PlatformAdminStore;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * News feed for the French UI: French warehouse items when available, otherwise the pedagogical
 * French catalog. English RSS is not shown on the tape.
 */
@Service
public class NewsService {

  private final PlatformAdminStore store;
  private final MarketDataWarehouseRepository warehouse;

  public NewsService(PlatformAdminStore store, MarketDataWarehouseRepository warehouse) {
    this.store = store;
    this.warehouse = warehouse;
  }

  public Map<String, Object> feed() {
    Map<String, Object> sim = store.simulationParams();
    if (Boolean.TRUE.equals(sim.get("newsPaused"))) {
      Map<String, Object> body = new LinkedHashMap<>();
      body.put("items", List.of());
      body.put("availability", "PAUSED_BY_ADMIN");
      body.put("limitations", List.of(
          "Le fil a été mis en pause par un administrateur.",
          "Les titres pédagogiques reprendront après réactivation."));
      return body;
    }

    List<Map<String, Object>> items = new ArrayList<>();
    int realFrCount = 0;
    if (warehouse.tablesPresent()) {
      List<Map<String, Object>> realFr = warehouse.realNews(40, true).stream()
          .filter(this::isFrenchItem)
          .toList();
      items.addAll(realFr);
      realFrCount = realFr.size();
    }
    for (Map<String, Object> extra : store.newsItems()) {
      if (isFrenchItem(extra)) {
        items.add(0, localizeItem(extra));
      }
    }

    Map<String, Object> body;
    if (realFrCount > 0 || !items.isEmpty()) {
      if (items.size() < 5) {
        // Compléter avec le catalogue pédagogique FR pour un fil lisible.
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> catalog =
            new ArrayList<>((List<Map<String, Object>>) NewsCatalog.feed().get("items"));
        for (Map<String, Object> c : catalog) {
          if (items.stream().noneMatch(i -> String.valueOf(i.get("id")).equals(String.valueOf(c.get("id"))))) {
            items.add(localizeItem(c));
          }
        }
      }
      body = new LinkedHashMap<>();
      body.put("items", items.stream().map(this::localizeItem).toList());
      body.put("source", Map.of(
          "id", "market-news-fr-v1",
          "kind", realFrCount > 0 ? "FRENCH_WAREHOUSE" : "FRENCH_ADMIN_AND_CATALOG",
          "description",
          "Fil d'actualités en français (sources FR / Tunisie ou catalogue pédagogique)."));
      body.put("availability", realFrCount > 0 ? "WAREHOUSE_FR" : "FRENCH_MIXED");
      body.put("limitations", List.of(
          "Interface en français : les dépêches anglaises du warehouse ne sont pas affichées ici.",
          "Les horodatages correspondent à la publication source."));
    } else {
      body = NewsCatalog.feed();
      @SuppressWarnings("unchecked")
      List<Map<String, Object>> base = new ArrayList<>((List<Map<String, Object>>) body.get("items"));
      body.put("items", base.stream().map(this::localizeItem).toList());
      body.put("availability", "LOCAL_CATALOG_FR");
    }
    body.put("adminPublishedCount", store.newsItems().size());
    body.put("realNewsCount", realFrCount);
    body.put("locale", "fr-FR");
    return body;
  }

  private boolean isFrenchItem(Map<String, Object> item) {
    // Admin-published pedagogical items are authored for the French UI — never drop them
    // because the title lacks accents or stopwords.
    if (Boolean.TRUE.equals(item.get("adminManaged"))) return true;
    String lang = String.valueOf(item.getOrDefault("language", "")).toLowerCase(Locale.ROOT);
    if (lang.startsWith("fr")) return true;
    String market = String.valueOf(item.getOrDefault("market", "")).toUpperCase(Locale.ROOT);
    if ("TN".equals(market) && looksFrench(String.valueOf(item.getOrDefault("title", "")))) return true;
    String provenance = String.valueOf(item.getOrDefault("provenance", "")).toUpperCase(Locale.ROOT);
    if (provenance.contains("PEDAGOGICAL") || provenance.contains("SYNTHETIC") || provenance.contains("ADMIN")) {
      return looksFrench(String.valueOf(item.getOrDefault("title", "")));
    }
    return looksFrench(String.valueOf(item.getOrDefault("title", "")));
  }

  private static boolean looksFrench(String title) {
    if (title == null || title.isBlank()) return false;
    // Pedagogical catalog and FR copy use accents / French stopwords.
    String t = title.toLowerCase(Locale.ROOT);
    if (t.matches(".*[àâäéèêëïîôùûüç].*")) return true;
    return t.contains(" le ") || t.contains(" la ") || t.contains(" les ") || t.contains(" des ")
        || t.contains("une ") || t.contains("dans ") || t.contains("pour ") || t.contains("marché")
        || t.contains("banque") || t.contains("tunis") || t.contains("scénario") || t.contains("fictive");
  }

  private Map<String, Object> localizeItem(Map<String, Object> raw) {
    Map<String, Object> m = new LinkedHashMap<>(raw);
    m.put("sector", MarketDisplay.sectorLabel(String.valueOf(m.getOrDefault("sector", "Marchés"))));
    if (!m.containsKey("language") || m.get("language") == null) {
      m.put("language", "fr");
    }
    return m;
  }
}
