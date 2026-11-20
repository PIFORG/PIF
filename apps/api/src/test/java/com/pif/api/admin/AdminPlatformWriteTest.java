package com.pif.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.pif.api.ai.AiService;
import com.pif.api.audit.AuditService;
import com.pif.api.challenges.ChallengeService;
import com.pif.api.data.UserRow;
import com.pif.api.market.NewsService;
import com.pif.api.security.AuthUser;
import com.pif.api.stress.StressService;
import com.pif.api.web.ApiException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AdminPlatformWriteTest {

  private PlatformAdminStore store;
  private AdminPlatformService service;
  private AuthUser admin;

  @BeforeEach
  void setUp() {
    store = new PlatformAdminStore(null);
    AuditService audit = new AuditService(null, null) {
      @Override
      public void record(Event event) {}
    };
    service = new AdminPlatformService(
        mock(AiService.class),
        mock(StressService.class),
        new ChallengeService(),
        store,
        audit,
        new NewsService(store, mock(com.pif.api.market.MarketDataWarehouseRepository.class)));
    admin = user("ADMIN");
  }

  @Test
  void publishesAndRemovesAdminNews() {
    Map<String, Object> item = service.publishNews(admin, "Titre pedagogique assez long", "Resume", "CTB", "Banque");
    assertThat(item.get("adminManaged")).isEqualTo(true);
    assertThat(store.newsItems()).hasSize(1);
    Map<String, Object> feed = service.news(admin);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> items = (List<Map<String, Object>>) feed.get("items");
    assertThat(items.get(0).get("title")).isEqualTo("Titre pedagogique assez long");
    assertThat(items.get(0).get("adminManaged")).isEqualTo(true);
    service.deleteNews(admin, String.valueOf(item.get("id")));
    assertThat(store.newsItems()).isEmpty();
  }

  @Test
  void disablesMissionFlag() {
    String slug = com.pif.api.learning.engine.MissionCatalog.MISSIONS.get(0).slug();
    service.setMissionDisabled(admin, slug, true);
    assertThat(store.isDisabled(PlatformAdminStore.FLAG_MISSION_PREFIX + slug)).isTrue();
  }

  @Test
  void updatesSimulationParamsAndPausesNews() {
    service.updateSimulationParams(admin, true, 150);
    Map<String, Object> feed = service.news(admin);
    assertThat(feed.get("availability")).isEqualTo("PAUSED_BY_ADMIN");
    assertThat(feed.get("items")).asList().isEmpty();
  }

  @Test
  void rejectsInvestorNewsPublish() {
    assertThatThrownBy(() -> service.publishNews(user("INVESTOR"), "Titre pedagogique assez long", null, null, null))
        .isInstanceOf(ApiException.class);
  }

  private static AuthUser user(String role) {
    UUID id = UUID.randomUUID();
    UserRow row = new UserRow(id, "a@b.test", "Ada", "Lovelace", "hash", role, "BEGINNER", true, Instant.now(),
        "ACTIVE", 0, null, false, null, null, null, 0, null, Instant.now(), Instant.now(), null, null);
    return new AuthUser(row, null);
  }
}