package com.pif.api.market;

import java.util.Map;

/** French display labels for market metadata. Internal sector keys stay unchanged for logic. */
public final class MarketDisplay {

  private static final Map<String, String> SECTOR_LABELS = Map.ofEntries(
      Map.entry("Banking", "Secteur bancaire"),
      Map.entry("Telecom", "T\u00e9l\u00e9coms"),
      Map.entry("Consumer staples", "Biens de consommation de base"),
      Map.entry("Materials", "Mat\u00e9riaux"),
      Map.entry("Technology", "Technologies"),
      Map.entry("Utilities", "Services aux collectivit\u00e9s"),
      Map.entry("Fixed income", "Obligations"),
      Map.entry("Energy", "\u00c9nergie"),
      Map.entry("Currencies", "Devises"));

  private MarketDisplay() {}

  public static String sectorLabel(String sector) {
    if (sector == null) return null;
    return SECTOR_LABELS.getOrDefault(sector, sector);
  }
}