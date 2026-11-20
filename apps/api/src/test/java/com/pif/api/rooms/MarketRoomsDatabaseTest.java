package com.pif.api.rooms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.pif.api.crypto.PasswordHasher;
import com.pif.api.data.AuthRepository;
import com.pif.api.data.Db;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.simple.JdbcClient;

@Tag("database")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class MarketRoomsDatabaseTest {

  private static final String DOMAIN = "@spring-rooms-db-test.test";
  private static final Instant START = Instant.parse("2026-11-20T10:00:00.500Z");

  static final class SteppingClock extends Clock {
    private final AtomicLong millis = new AtomicLong();

    void set(Instant at) {
      millis.set(at.toEpochMilli());
    }

    @Override
    public Instant instant() {
      return Instant.ofEpochMilli(millis.getAndIncrement());
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }
  }

  @TestConfiguration
  static class PinnedClock {
    @Bean
    @Primary
    SteppingClock steppingClock() {
      return new SteppingClock();
    }
  }

  @Autowired JdbcClient jdbc;
  @Autowired AuthRepository users;
  @Autowired PasswordHasher hasher;
  @Autowired MarketRoomsService rooms;
  @Autowired MarketRoomsRepository repo;
  @Autowired SteppingClock clock;

  @BeforeEach
  void pinClock() {
    clock.set(START);
    org.junit.jupiter.api.Assumptions.assumeTrue(repo.tablesPresent(), "market_rooms migration required");
  }

  @AfterEach
  void cleanup() {
    jdbc.sql("""
        DELETE FROM market_rooms WHERE host_user_id IN (SELECT id FROM users WHERE email LIKE ?)
        """).param("%" + DOMAIN).update();
    jdbc.sql("""
        DELETE FROM market_room_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)
        """).param("%" + DOMAIN).update();
    jdbc.sql("DELETE FROM trading_portfolios WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)")
        .param("%" + DOMAIN).update();
    jdbc.sql("DELETE FROM users WHERE email LIKE ?").param("%" + DOMAIN).update();
  }

  @Test
  void hostAndGuestShareRoomAndEconomyIsIsolated() {
    AuthUser host = newInvestor("host");
    AuthUser guest = newInvestor("guest");

    Map<String, Object> created = rooms.create(host, Map.of(
        "title", "Salle test collab",
        "mode", "LEARNING",
        "visibility", "PRIVATE",
        "rules", Map.of(
            "initialCapital", 100000,
            "minLearningPointsForCredit", 0,
            "baseCreditLimitPct", 20)));
    String roomId = String.valueOf(created.get("id"));
    String code = String.valueOf(created.get("code"));
    assertThat(created.get("status")).isEqualTo("LOBBY");

    Map<String, Object> joined = rooms.join(guest, Map.of("code", code));
    assertThat(joined.get("participantCount")).isEqualTo(2);

    rooms.start(host, UUID.fromString(roomId));
    assertThat(rooms.detail(guest, UUID.fromString(roomId)).get("status")).isEqualTo("ACTIVE");

    rooms.awardLearning(guest, UUID.fromString(roomId), Map.of(
        "sourceKind", "TUTORIAL",
        "sourceRef", "onboarding-rooms"));
    @SuppressWarnings("unchecked")
    Map<String, Object> you = (Map<String, Object>) rooms.detail(guest, UUID.fromString(roomId)).get("you");
    assertThat(((Number) you.get("learningPoints")).intValue()).isGreaterThanOrEqualTo(15);

    rooms.requestCredit(guest, UUID.fromString(roomId), Map.of(
        "amount", 2000,
        "idempotencyKey", "credit-guest-1"));
    @SuppressWarnings("unchecked")
    Map<String, Object> you2 = (Map<String, Object>) rooms.detail(guest, UUID.fromString(roomId)).get("you");
    assertThat(((Number) you2.get("creditDebt")).doubleValue()).isEqualTo(2000.0);

    Map<String, Object> replay = rooms.requestCredit(guest, UUID.fromString(roomId), Map.of(
        "amount", 2000,
        "idempotencyKey", "credit-guest-1"));
    assertThat(replay.get("idempotentReplay")).isEqualTo(true);

    @SuppressWarnings("unchecked")
    Map<String, Object> boardHost = (Map<String, Object>) ((java.util.List<?>) rooms.detail(host, UUID.fromString(roomId)).get("leaderboard")).get(0);
    assertThat(boardHost).containsKeys("netWorth", "tradingReturnPct", "valuationComplete");
    assertThat(rooms.detail(host, UUID.fromString(roomId)).get("scoreExplanation")).isNotNull();

    Map<String, Object> pf = rooms.portfolio(guest, UUID.fromString(roomId));
    assertThat(pf).containsKeys("netWorth", "markToMarket", "tradingReturnPct");
    @SuppressWarnings("unchecked")
    Map<String, Object> mtm = (Map<String, Object>) pf.get("markToMarket");
    assertThat(mtm.get("formula")).asString().contains("Valeur nette");

    rooms.end(host, UUID.fromString(roomId));
    assertThatThrownBy(() -> rooms.join(newInvestor("late"), Map.of("code", code)))
        .isInstanceOf(ApiException.class);
  }

  private AuthUser newInvestor(String label) {
    UUID id = UUID.randomUUID();
    Instant now = Db.now();
    jdbc.sql("INSERT INTO users (id, email, first_name, last_name, password_hash, email_verified, email_verified_at, "
            + "status, role, created_at, updated_at) VALUES (?, ?, 'Room', ?, ?, true, ?, 'ACTIVE', "
            + "'INVESTOR'::\"UserRole\", ?, ?)")
        .params(id, label + "-" + id.toString().substring(0, 8) + DOMAIN, label, hasher.hash("Db-Test-Pass-1!"),
            Db.ts(now), Db.ts(now), Db.ts(now))
        .update();
    return new AuthUser(users.findUserById(id).orElseThrow(), UUID.randomUUID());
  }
}
