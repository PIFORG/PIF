package com.pif.api.market;

import java.util.Locale;
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
      Map.entry("Currencies", "Devises"),
      Map.entry("Banque", "Banque"),
      Map.entry("Technologie", "Technologie"),
      Map.entry("Macro", "Macro\u00e9conomie"),
      Map.entry("Consommation", "Consommation"),
      Map.entry("Mati\u00e8res premi\u00e8res", "Mati\u00e8res premi\u00e8res"),
      // RSS category keys
      Map.entry("regulator", "R\u00e9gulateur"),
      Map.entry("central_bank", "Banque centrale"),
      Map.entry("markets", "March\u00e9s"),
      Map.entry("equities", "Actions"),
      Map.entry("bonds", "Obligations"),
      Map.entry("commodities", "Mati\u00e8res premi\u00e8res"),
      Map.entry("fx", "Devises"),
      Map.entry("crypto", "Crypto"),
      Map.entry("economy", "\u00c9conomie"),
      Map.entry("policy", "Politique"),
      Map.entry("earnings", "R\u00e9sultats"));

  private MarketDisplay() {}

  public static String sectorLabel(String sector) {
    if (sector == null || sector.isBlank()) return "March\u00e9s";
    String key = sector.trim();
    String mapped = SECTOR_LABELS.get(key);
    if (mapped != null) return mapped;
    mapped = SECTOR_LABELS.get(key.toLowerCase(Locale.ROOT));
    if (mapped != null) return mapped;
    // Title-case underscore categories: central_bank -> already mapped; else humanize lightly
    if (key.contains("_")) {
      return key.replace('_', ' ');
    }
    return key;
  }
}