package com.pif.api.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class MessagesTest {

  @Test
  void knownKeysResolveToFrench() {
    assertThat(Messages.get("validation.failed")).isEqualTo("\u00c9chec de la validation");
    assertThat(Messages.get("auth.invalid_credentials")).contains("e-mail");
    assertThat(Messages.format("portfolio.limit", 5)).contains("5");
    assertThat(Messages.format("global.not_found", "GET", "/x")).contains("GET").contains("/x");
  }

  @Test
  void missingKeyFallsBackToKey() {
    assertThat(Messages.get("does.not.exist")).isEqualTo("does.not.exist");
  }
}