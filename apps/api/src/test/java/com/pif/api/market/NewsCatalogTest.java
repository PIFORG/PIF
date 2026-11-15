package com.pif.api.market;



import static org.assertj.core.api.Assertions.assertThat;



import java.util.List;

import java.util.Map;

import org.junit.jupiter.api.Test;



class NewsCatalogTest {



  @Test

  void feedIsSyntheticPedagogicalAndNeverClaimsLiveWire() {

    Map<String, Object> feed = NewsCatalog.feed();

    @SuppressWarnings("unchecked")

    Map<String, Object> source = (Map<String, Object>) feed.get("source");

    assertThat(source.get("kind")).isEqualTo("SYNTHETIC_PEDAGOGICAL");

    assertThat(source.get("description").toString().toLowerCase()).contains("synth");

    @SuppressWarnings("unchecked")

    List<Map<String, Object>> items = (List<Map<String, Object>>) feed.get("items");

    assertThat(items).isNotEmpty();

    assertThat(items.get(0).get("provenance")).isEqualTo("SYNTHETIC_PEDAGOGICAL");

    assertThat(items.get(0)).containsKeys("title", "publishedAt", "sector", "originalUrl", "fetchedAt");

    @SuppressWarnings("unchecked")

    List<String> limitations = (List<String>) feed.get("limitations");

    assertThat(limitations.stream().anyMatch(l -> l.toLowerCase().contains("direct"))).isTrue();

  }

}

