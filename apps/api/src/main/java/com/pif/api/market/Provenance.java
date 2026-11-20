package com.pif.api.market;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Where prices come from. FICTIONAL = simulator; HISTORICAL = warehouse session closes (CMF/Yahoo);
 * DELAYED/LIVE reserved for a contractual real-time feed — not used for warehouse last-close.
 */
public record Provenance(String providerId, String kind, String currency, String description) {

  /** Warehouse session closes (CMF/BVMT, Yahoo) — last available close, not a live feed. */
  public static final Provenance WAREHOUSE_HISTORICAL = new Provenance(
      "market-warehouse-v1",
      "HISTORICAL",
      "MIXED",
      "Observations de séance historiques validées (CMF/BVMT, Yahoo). Affiche la dernière clôture disponible — "
          + "ce n'est ni un cours live ni un simple « delayed quote » d'un feed temps réel.");

  public Map<String, Object> toJson() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("providerId", providerId);
    m.put("kind", kind);
    m.put("currency", currency);
    m.put("description", description);
    return m;
  }
}
