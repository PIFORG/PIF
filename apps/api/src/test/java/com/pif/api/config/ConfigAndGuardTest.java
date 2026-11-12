package com.pif.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.pif.api.auth.RefreshCookieTestAccess;
import com.pif.api.data.Db;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;

class ConfigAndGuardTest {

  @Test
  void databaseUrlIsConvertedToJdbcSettings() {
    Map<String, Object> props = DotEnvEnvironmentPostProcessor.toDatasource(
        "postgresql://app%40user:p%3Ass@db.local:5433/PIF_test?schema=public");
    assertThat(props.get("spring.datasource.url")).isEqualTo("jdbc:postgresql://db.local:5433/PIF_test?currentSchema=public");
    assertThat(props.get("spring.datasource.username")).isEqualTo("app@user");
    assertThat(props.get("spring.datasource.password")).isEqualTo("p:ss");
    assertThat(props.get("pif.database.name")).isEqualTo("PIF_test");
  }

  @Test
  void dotEnvParsing(@TempDir Path dir) throws Exception {
    Path file = dir.resolve(".env");
    Files.writeString(file, "# comment\nA=1\nB=\"two words\"\nexport C='x=y'\nD=plain # trailing\n\nBROKEN\n");
    Map<String, Object> values = DotEnvEnvironmentPostProcessor.parse(file);
    assertThat(values).containsEntry("A", "1").containsEntry("B", "two words").containsEntry("C", "x=y")
        .containsEntry("D", "plain").doesNotContainKey("BROKEN");
  }

  @Test
  void apiDocsFollowSwaggerEnabledThenNodeEnvLikeNest() {
    assertThat(DotEnvEnvironmentPostProcessor.apiDocsEnabled(null, "development")).isTrue();
    assertThat(DotEnvEnvironmentPostProcessor.apiDocsEnabled(null, null)).isTrue();
    assertThat(DotEnvEnvironmentPostProcessor.apiDocsEnabled(null, "production")).isFalse();
    assertThat(DotEnvEnvironmentPostProcessor.apiDocsEnabled("true", "production")).isTrue();
    assertThat(DotEnvEnvironmentPostProcessor.apiDocsEnabled("false", "development")).isFalse();
  }

  @Test
  void startupGuardOnlyAllowsTestDatabasesUnlessExplicitlyNamed() {
    assertThat(DatabaseStartupChecks.isAllowedTarget("PIF_spring_test", "")).isTrue();
    assertThat(DatabaseStartupChecks.isAllowedTarget("PIF_test", "")).isTrue();
    assertThat(DatabaseStartupChecks.isAllowedTarget("PIF", "")).isFalse();
    assertThat(DatabaseStartupChecks.isAllowedTarget("PIF", "OTHER")).isFalse();
    assertThat(DatabaseStartupChecks.isAllowedTarget("PIF", "PIF")).isTrue();
    assertThat(DatabaseStartupChecks.isAllowedTarget("", "")).isFalse();
    assertThat(DatabaseStartupChecks.databaseName("jdbc:postgresql://localhost:5432/PIF?currentSchema=public"))
        .isEqualTo("PIF");
  }

  @Test
  void durationsFollowTheNestFormat() {
    assertThat(PifProperties.parseDuration("15m", "X")).isEqualTo(Duration.ofMinutes(15));
    assertThat(PifProperties.parseDuration("7d", "X")).isEqualTo(Duration.ofDays(7));
    assertThatThrownBy(() -> PifProperties.parseDuration("0m", "X")).isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> PifProperties.parseDuration("15 minutes", "X")).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void requiredSecretsAreEnforcedAndNeverPrinted() {
    assertThatThrownBy(() -> new PifProperties(new MockEnvironment()))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("JWT_ACCESS_SECRET is required");
    PifProperties props = new PifProperties(new MockEnvironment()
        .withProperty("JWT_ACCESS_SECRET", "s".repeat(40))
        .withProperty("AUTH_TOKEN_PEPPER", "p")
        .withProperty("AUTH_IP_HASH_PEPPER", "q")
        .withProperty("MFA_ENCRYPTION_KEY", "00".repeat(32))
        .withProperty("APP_API_URL", "http://localhost:3002"));
    assertThat(props.toString()).doesNotContain("sss");
    assertThat(props.csrfAllowedOrigins()).containsExactly("http://localhost:4200", "http://localhost:3002");
  }

  @Test
  void refreshCookieSerializationMatchesExpress() {
    // Captured clear-cookie header: mtrs_refresh=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax
    assertThat(RefreshCookieTestAccess.clear()).isEqualTo(
        "mtrs_refresh=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax");
    assertThat(RefreshCookieTestAccess.set("abc", Instant.parse("2026-11-17T18:44:06.789Z"))).isEqualTo(
        "mtrs_refresh=abc; Path=/api/auth; Expires=Tue, 17 Nov 2026 18:44:06 GMT; HttpOnly; SameSite=Lax");
  }

  @Test
  void isoDatesMatchJavaScriptToIsoString() {
    assertThat(Db.iso(Instant.parse("2026-11-10T12:00:00Z"))).isEqualTo("2026-11-10T12:00:00.000Z");
    assertThat(Db.iso(Instant.parse("2026-11-10T12:00:00.123456Z"))).isEqualTo("2026-11-10T12:00:00.123Z");
  }
}
