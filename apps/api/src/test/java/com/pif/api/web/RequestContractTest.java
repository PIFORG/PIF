package com.pif.api.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.pif.api.auth.AuthDtos;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** Validation messages (French) and rate-limit counting for the Spring API. */
class RequestContractTest {

  private static List<String> details(Runnable call) {
    try {
      call.run();
    } catch (ApiException e) {
      assertThat(e.errorCode()).isEqualTo("VALIDATION_ERROR");
      assertThat(e.getMessage()).isEqualTo(Messages.get("validation.failed"));
      return e.details();
    }
    throw new AssertionError("expected a validation error");
  }

  private static Map<String, Object> body(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
    return m;
  }

  @Test
  void loginValidationIsFrench() {
    assertThat(details(() -> AuthDtos.login(body("email", "x", "password", "", "extra", 1)))).containsExactly(
        Messages.format("validation.property_forbidden", "extra"),
        Messages.format("validation.email", "email"),
        Messages.format("validation.longer_than", "password", 1));
    assertThat(details(() -> AuthDtos.login(body()))).containsExactly(
        Messages.format("validation.email", "email"),
        Messages.format("validation.shorter_than", "password", 128),
        Messages.format("validation.longer_than", "password", 1),
        Messages.format("validation.must_be_string", "password"));
  }

  @Test
  void loginNormalizesEmail() {
    AuthDtos.Login dto = AuthDtos.login(body("email", "\u00a0 Alice@Example.COM \ufeff", "password", "x"));
    assertThat(dto.email()).isEqualTo("alice@example.com");
    assertThat(AuthDtos.login(body("email", "a@b.co", "password", 12345678)).password()).isEqualTo("12345678");
  }

  @Test
  void mfaVerifyValidationIsFrench() {
    assertThat(details(() -> AuthDtos.mfaVerifyLogin(body("mfaChallengeToken", "short"))))
        .containsExactly(Messages.format("validation.longer_than", "mfaChallengeToken", 32));
    assertThat(details(() -> AuthDtos.mfaVerifyLogin(body("mfaChallengeToken", "a".repeat(32), "totpCode", "12345a"))))
        .containsExactly(Messages.format("validation.regex", "totpCode", "^\\d{6}$"));
    assertThat(AuthDtos.mfaVerifyLogin(body("mfaChallengeToken", "a".repeat(36))).totpCode()).isNull();
  }

  @Test
  void preferencesValidationIsFrench() {
    assertThat(details(() -> AuthDtos.updatePreferences(body("preferredCurrency", "XXX", "timezone", "Mars/Base",
        "chartTheme", "neon", "reduceMotion", "false", "trainingDifficulty", "expert")))).containsExactly(
        Messages.format("validation.currency_supported", "preferredCurrency"),
        Messages.format("validation.timezone_iana", "timezone"),
        Messages.format("validation.one_of", "chartTheme", "trading_desk, light, dark"),
        Messages.format("validation.one_of", "trainingDifficulty", "adaptive, beginner, intermediate, advanced"),
        Messages.format("validation.boolean", "reduceMotion"));
    assertThat(AuthDtos.updatePreferences(body("preferredCurrency", " tnd ", "timezone", "Africa/Tunis"))).isNotNull();
  }

  @Test
  void emailRules() {
    assertThat(Validation.isEmail("a@b.co")).isTrue();
    assertThat(Validation.isEmail("first.last+tag@sub.example.org")).isTrue();
    assertThat(Validation.isEmail("x")).isFalse();
    assertThat(Validation.isEmail("a@b")).isFalse();
    assertThat(Validation.isEmail("a@b.c")).isFalse();
    assertThat(Validation.isEmail("a..b@example.com")).isFalse();
    assertThat(Validation.isEmail("a@-b.com")).isFalse();
    assertThat(Validation.isEmail("Name <a@b.co>")).isFalse();
  }

  @Test
  void throttleCountsLikeNestThrottler() {
    AtomicLong now = new AtomicLong(1_000_000);
    ThrottleStore store = new ThrottleStore(now::get);
    for (int i = 1; i <= 10; i++) {
      ThrottleStore.Result r = store.increment("k", 60_000, 10, 60_000, "default");
      assertThat(r.blocked()).isFalse();
      assertThat(r.totalHits()).isEqualTo(i);
      assertThat(r.timeToExpire()).isEqualTo(60);
    }
    ThrottleStore.Result blocked = store.increment("k", 60_000, 10, 60_000, "default");
    assertThat(blocked.blocked()).isTrue();
    assertThat(blocked.timeToBlockExpire()).isEqualTo(60);
    now.addAndGet(30_000);
    assertThat(store.increment("k", 60_000, 10, 60_000, "default").blocked()).isTrue();
    now.addAndGet(30_001);
    ThrottleStore.Result after = store.increment("k", 60_000, 10, 60_000, "default");
    assertThat(after.blocked()).isFalse();
    assertThat(after.totalHits()).isEqualTo(1);
  }

  @Test
  void invalidJsonIsRejected() {
    tools.jackson.databind.ObjectMapper mapper = tools.jackson.databind.json.JsonMapper.builder().build();
    assertThatThrownBy(() -> Validation.parseBody(mapper, "{bad json", "application/json"))
        .isInstanceOf(ApiException.class)
        .hasMessage(Messages.get("validation.body.not_json"));
    assertThat(Validation.parseBody(mapper, "[]", "application/json")).isEmpty();
    assertThat(Validation.parseBody(mapper, "{\"a\":1}", "text/plain")).isEmpty();
  }
}
