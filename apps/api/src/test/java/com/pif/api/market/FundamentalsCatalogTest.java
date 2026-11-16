package com.pif.api.market;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

class FundamentalsCatalogTest {

  @Test
  void computesRatiosFromPedagogicalStatements() {
    FundamentalsCatalog.Statement s = FundamentalsCatalog.of("CTB");
    assertThat(s).isNotNull();
    Map<String, Object> view = FundamentalsCatalog.view(s, 42.5);
    @SuppressWarnings("unchecked")
    Map<String, Object> ratios = (Map<String, Object>) view.get("ratios");
    assertThat(ratios.get("returnOnEquity")).isInstanceOf(Number.class);
    assertThat(ratios.get("debtToEquity")).isInstanceOf(Number.class);
    assertThat(ratios.get("netProfitMargin")).isInstanceOf(Number.class);
    assertThat(view.get("provenance")).asString().contains("SYNTHETIC");
    assertThat(((java.util.List<?>) view.get("limitations"))).isNotEmpty();
  }

  @Test
  void isDeterministicPerSymbol() {
    assertThat(FundamentalsCatalog.of("TEK").revenue()).isEqualTo(FundamentalsCatalog.of("TEK").revenue());
    assertThat(FundamentalsCatalog.of("TEK").revenue()).isNotEqualTo(FundamentalsCatalog.of("CTB").revenue());
  }
}