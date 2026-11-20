package com.pif.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.pif.api.ai.AiService;
import com.pif.api.audit.AuditService;
import com.pif.api.challenges.ChallengeService;
import com.pif.api.crypto.PasswordHasher;
import com.pif.api.data.Db;
import com.pif.api.data.UserRow;
import com.pif.api.learning.LearningService;
import com.pif.api.learning.engine.MissionCatalog;
import com.pif.api.security.AuthUser;
import com.pif.api.stress.StressDtos;
import com.pif.api.stress.StressFactors;
import com.pif.api.stress.StressService;
import com.pif.api.trading.TradingRepository;
import com.pif.api.web.ApiException;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Proves administrator content survives a fresh in-process reload from PostgreSQL
 * (simulates Spring Boot restart). Runs only against *_test databases.
 */
@Tag("database")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class AdminPlatformPersistenceDatabaseTest {

  private static final String DOMAIN = "@spring-admin-persist-db-test.test";
  private static final String CHALLENGE_TITLE = "Defi persistence DB test";

  @Autowired PlatformAdminStore store;
  @Autowired PlatformAdminRepository repository;
  @Autowired AdminPlatformService platform;
  @Autowired ChallengeService challenges;
  @Autowired AiService ai;
  @Autowired StressService stress;
  @Autowired LearningService learning;
  @Autowired TradingRepository trading;
  @Autowired AuditService audit;
  @Autowired PasswordHasher hasher;
  @Autowired JdbcClient jdbc;
  @Autowired Environment env;

  private AuthUser admin;
  private AuthUser investor;
  private String haltedSymbol;

  @BeforeEach
  void setUp() {
    assertThat(env.getProperty("spring.datasource.url", "")).containsPattern("/[^/?]+_test(\\?|$)");
    repository.resetSchemaProbe();
    challenges.resetSchemaProbe();
    assertThat(repository.schemaReady()).as("migration 20261119220000 must be applied on isolated DB").isTrue();
    assertThat(store.durable()).as("store durable after schema probe reset").isTrue();
    cleanupRows();
    store.reload();
    challenges.reload();
    admin = createUser("ADMIN");
    investor = createUser("INVESTOR");
  }

  @AfterEach
  void tearDown() {
    if (haltedSymbol != null) {
      try {
        trading.updateInstrumentStatus(haltedSymbol, "ACTIVE");
      } catch (RuntimeException ignored) {
      }
      haltedSymbol = null;
    }
    cleanupRows();
    store.reload();
    challenges.reload();
  }

  private void cleanupRows() {
    jdbc.sql("DELETE FROM platform_challenge_entries WHERE challenge_id IN "
            + "(SELECT id FROM platform_challenges WHERE title = ?)")
        .param(CHALLENGE_TITLE).update();
    jdbc.sql("DELETE FROM platform_challenges WHERE title = ?").param(CHALLENGE_TITLE).update();
    jdbc.sql("DELETE FROM platform_news_items WHERE id LIKE 'admin-news-%'").update();
    jdbc.sql("DELETE FROM platform_admin_flags WHERE key LIKE 'mission:%' OR key LIKE 'ai:%' OR key LIKE 'stress:%' OR key = 'sim:params'")
        .update();
    jdbc.sql("DELETE FROM audit_events WHERE actor_user_id IN (SELECT id FROM users WHERE email LIKE ?)")
        .param("%" + DOMAIN).update();
    jdbc.sql("DELETE FROM learning_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)")
        .param("%" + DOMAIN).update();
    jdbc.sql("DELETE FROM users WHERE email LIKE ?").param("%" + DOMAIN).update();
  }

  private AuthUser createUser(String role) {
    UUID id = UUID.randomUUID();
    Instant now = Db.now();
    String email = role.toLowerCase() + "-" + id.toString().substring(0, 8) + DOMAIN;
    jdbc.sql("INSERT INTO users (id, email, first_name, last_name, password_hash, role, email_verified, "
            + "email_verified_at, status, created_at, updated_at) "
            + "VALUES (?, ?, 'Persist', 'Tester', ?, ?::\"UserRole\", true, ?, 'ACTIVE'::\"UserStatus\", ?, ?)")
        .params(id, email, hasher.hash("Db-Test-Pass-1!"), role, Db.ts(now), Db.ts(now), Db.ts(now))
        .update();
    UserRow row = new UserRow(id, email, "Persist", "Tester", "hash", role, "BEGINNER", true, now, "ACTIVE",
        0, null, false, null, null, null, 0, null, now, now, null, null);
    return new AuthUser(row, null);
  }

  @Test
  void newsFlagsChallengesAndSimSurviveFreshStoreReload() {
    assertThat(store.durable()).as("store must be durable against PostgreSQL").isTrue();
    Map<String, Object> published = platform.publishNews(admin, "Actualite durable de test pedagogique",
        "Resume durable", "CTB", "Banque");
    String newsId = String.valueOf(published.get("id"));
    assertThat(newsId).startsWith("admin-news-");
    Integer newsRows = jdbc.sql("SELECT COUNT(*) FROM platform_news_items WHERE id = ?").param(newsId)
        .query(Integer.class).single();
    assertThat(newsRows).as("news must be in PostgreSQL immediately after publish").isEqualTo(1);
    platform.setMissionDisabled(admin, MissionCatalog.MISSIONS.get(0).slug(), true);
    Integer flagRows = jdbc.sql("SELECT COUNT(*) FROM platform_admin_flags WHERE key = ?")
        .param(PlatformAdminStore.FLAG_MISSION_PREFIX + MissionCatalog.MISSIONS.get(0).slug())
        .query(Integer.class).single();
    assertThat(flagRows).as("flag must be in PostgreSQL immediately after set").isEqualTo(1);

    String missionSlug = MissionCatalog.MISSIONS.get(0).slug();
    platform.setMissionDisabled(admin, missionSlug, true);
    platform.setAiModelDisabled(admin, "market-return-gbm", true);
    platform.setStressPresetDisabled(admin, "rate-shock", true);
    platform.updateSimulationParams(admin, true, 150);

    Map<String, Object> challenge = platform.createChallenge(admin, CHALLENGE_TITLE,
        "Capital equitable pour test de persistance.", 50_000.0);
    String challengeId = String.valueOf(challenge.get("id"));

    PlatformAdminStore fresh = new PlatformAdminStore(repository);
    fresh.reload();
    ChallengeService freshChallenges = new ChallengeService(jdbc);
    freshChallenges.reload();

    assertThat(fresh.news(newsId)).isPresent();
    assertThat(fresh.news(newsId).orElseThrow().get("title"))
        .isEqualTo("Actualite durable de test pedagogique");
    assertThat(fresh.isDisabled(PlatformAdminStore.FLAG_MISSION_PREFIX + missionSlug)).isTrue();
    assertThat(fresh.isDisabled(PlatformAdminStore.FLAG_AI_PREFIX + "market-return-gbm")).isTrue();
    assertThat(fresh.isDisabled(PlatformAdminStore.FLAG_STRESS_PREFIX + "rate-shock")).isTrue();
    assertThat(fresh.simulationParams().get("newsPaused")).isEqualTo(true);
    assertThat(fresh.simulationParams().get("depthScalePct")).isEqualTo(150);
    assertThat(freshChallenges.list().get("challenges")).asList()
        .anySatisfy(c -> {
          @SuppressWarnings("unchecked")
          Map<String, Object> row = (Map<String, Object>) c;
          assertThat(row.get("id")).isEqualTo(challengeId);
          assertThat(row.get("title")).isEqualTo(CHALLENGE_TITLE);
        });

    platform.deleteNews(admin, newsId);
    PlatformAdminStore afterDelete = new PlatformAdminStore(repository);
    afterDelete.reload();
    assertThat(afterDelete.news(newsId)).isEmpty();

    platform.setMissionDisabled(admin, missionSlug, false);
    platform.setAiModelDisabled(admin, "market-return-gbm", false);
    platform.setStressPresetDisabled(admin, "rate-shock", false);
  }

  @Test
  void disabledMissionAiAndStressAreEnforcedByServicesAfterReload() {
    String missionSlug = MissionCatalog.MISSIONS.get(0).slug();
    platform.setMissionDisabled(admin, missionSlug, true);
    platform.setAiModelDisabled(admin, "market-return-gbm", true);
    platform.setStressPresetDisabled(admin, "rate-shock", true);

    store.reload();

    assertThatThrownBy(() -> learning.start(investor, missionSlug, null))
        .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.errorCode()).isEqualTo("MISSION_DISABLED"));

    assertThatThrownBy(() -> ai.predictLatest())
        .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.errorCode()).isEqualTo("MODEL_DISABLED"));

    assertThatThrownBy(() -> stress.run(new StressDtos.RunRequest("rate-shock", StressFactors.NEUTRAL, 1.0)))
        .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.errorCode()).isEqualTo("SCENARIO_DISABLED"));

    platform.setMissionDisabled(admin, missionSlug, false);
    platform.setAiModelDisabled(admin, "market-return-gbm", false);
    platform.setStressPresetDisabled(admin, "rate-shock", false);
  }

  @Test
  void instrumentHaltPersistsInInstrumentsTable() {
    var instruments = trading.instruments();
    assertThat(instruments).isNotEmpty();
    haltedSymbol = instruments.get(0).symbol();
    platform.setInstrumentStatus(admin, haltedSymbol, "HALTED");

    String status = jdbc.sql("SELECT status::text FROM instruments WHERE symbol = ?")
        .param(haltedSymbol).query(String.class).single();
    assertThat(status).isEqualTo("HALTED");

    assertThat(trading.instruments().stream().filter(i -> i.symbol().equals(haltedSymbol)).findFirst())
        .isPresent()
        .get()
        .extracting(TradingRepository.InstrumentRow::status)
        .isEqualTo("HALTED");

    platform.setInstrumentStatus(admin, haltedSymbol, "ACTIVE");
    haltedSymbol = null;
  }

  @Test
  void investorCannotMutateAdminContent() {
    assertThatThrownBy(() -> platform.publishNews(investor, "Titre pedagogique assez long", null, null, null))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> platform.setMissionDisabled(investor, "my-first-trade", true))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> platform.createChallenge(investor, CHALLENGE_TITLE, "x", 50_000.0))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void concurrentFlagWritesRemainConsistent() throws Exception {
    String keySlug = MissionCatalog.MISSIONS.get(1).slug();
    ExecutorService pool = Executors.newFixedThreadPool(8);
    CountDownLatch start = new CountDownLatch(1);
    AtomicInteger failures = new AtomicInteger();
    Future<?>[] futures = new Future<?>[8];
    for (int i = 0; i < 8; i++) {
      boolean disable = i % 2 == 0;
      futures[i] = pool.submit(() -> {
        try {
          start.await();
          platform.setMissionDisabled(admin, keySlug, disable);
        } catch (Exception e) {
          failures.incrementAndGet();
        }
      });
    }
    start.countDown();
    for (Future<?> f : futures) f.get();
    pool.shutdown();
    assertThat(failures.get()).isZero();

    store.reload();
    String value = jdbc.sql("SELECT value FROM platform_admin_flags WHERE key = ?")
        .param(PlatformAdminStore.FLAG_MISSION_PREFIX + keySlug)
        .query(String.class).optional().orElse(null);
    assertThat(value).isIn(PlatformAdminStore.DISABLED, PlatformAdminStore.ENABLED);
    platform.setMissionDisabled(admin, keySlug, false);
  }

  @Test
  void auditEventsRecordedForAdminWrites() {
    Map<String, Object> item = platform.publishNews(admin, "Audit actualite pedagogique XX", "s", null, null);
    Integer count = jdbc.sql(
            "SELECT COUNT(*) FROM audit_events WHERE event_type = 'ADMIN_NEWS_PUBLISH' AND actor_user_id = ?")
        .param(admin.user().id()).query(Integer.class).single();
    assertThat(count).isGreaterThanOrEqualTo(1);
    platform.deleteNews(admin, String.valueOf(item.get("id")));
  }
}