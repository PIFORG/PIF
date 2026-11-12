package com.pif.api.market;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Where prices come from. Only FICTIONAL is implemented; HISTORICAL, DELAYED and LIVE exist so a real feed can be
 * labelled honestly.
 */
public record Provenance(String providerId, String kind, String currency, String description) {

  public Map<String, Object> toJson() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("providerId", providerId);
    m.put("kind", kind);
    m.put("currency", currency);
    m.put("description", description);
    return m;
  }
}
