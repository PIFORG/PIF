package com.pif.api.market;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Fil d'actualités pédagogiques. Les items sont synthétiques et étiquetés comme tels —
 * jamais présentés comme des dépêches de marché en direct.
 */
public final class NewsCatalog {

  private NewsCatalog() {}

  public static Map<String, Object> feed() {
    List<Map<String, Object>> items = new ArrayList<>();
    items.add(item("n1", "CTB", "Banque",
        "Carthage Bank (fictive) publie des résultats semestriels pédagogiques en hausse",
        "Scénario de formation : bénéfice net en progression dans l'univers simulé.",
        Instant.parse("2026-11-10T09:00:00Z")));
    items.add(item("n2", "TEK", "Technologie",
        "TunisTech (fictive) annonce un investissement dans le cloud éducatif",
        "Actualité synthétique pour illustrer un choc sectoriel technologique.",
        Instant.parse("2026-11-11T14:30:00Z")));
    items.add(item("n3", "SFX", "Matières premières",
        "Sfax Phosphates (fictive) : tension sur les prix des matières premières simulées",
        "Contenu pédagogique — aucune cotation réelle n'est citée.",
        Instant.parse("2026-11-12T08:15:00Z")));
    items.add(item("n4", null, "Macro",
        "Scénario macro : inflation et taux dans l'économie fictive PIF",
        "Briefing de marché pour missions pédagogiques et tests de résistance.",
        Instant.parse("2026-11-13T11:00:00Z")));
    items.add(item("n5", "OLV", "Consommation",
        "Olivia Foods (fictive) : demande domestique stable dans le simulateur",
        "Nouvelle étiquetée SYNTHETIC_PEDAGOGICAL.",
        Instant.parse("2026-11-14T16:45:00Z")));

    Map<String, Object> body = new LinkedHashMap<>();
    body.put("items", items);
    body.put("source", Map.of(
        "id", "pif-pedagogical-news-v1",
        "kind", "SYNTHETIC_PEDAGOGICAL",
        "description",
        "Fil d'actualités synthétiques pour l'apprentissage. Ce ne sont pas des dépêches de marché réelles."));
    body.put("retrievedAt", Instant.now().toString());
    body.put("availability", "LOCAL_CATALOG");
    body.put("limitations", List.of(
        "Aucun fournisseur externe gratuit n'est branché dans cette version.",
        "Les titres sont inventés pour l'univers fictif Market Trading Room.",
        "Ne pas présenter ce fil comme des actualités en direct."));
    return body;
  }

  private static Map<String, Object> item(String id, String symbol, String sector, String title, String summary,
      Instant publishedAt) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", id);
    m.put("title", title);
    m.put("summary", summary);
    m.put("symbol", symbol);
    m.put("sector", sector);
    m.put("publishedAt", publishedAt.toString());
    m.put("provenance", "SYNTHETIC_PEDAGOGICAL");
    m.put("originalUrl", null);
    m.put("fetchedAt", Instant.now().toString());
    m.put("availability", "AVAILABLE");
    return m;
  }
}
