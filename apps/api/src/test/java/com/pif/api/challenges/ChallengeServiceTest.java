package com.pif.api.challenges;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.pif.api.data.UserRow;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ChallengeServiceTest {

  @Test
  void investorCanJoinAndSubmitRanking() {
    ChallengeService service = new ChallengeService();
    AuthUser investor = user("INVESTOR");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> list = (List<Map<String, Object>>) service.list().get("challenges");
    String id = (String) list.get(0).get("id");
    service.join(investor, id);
    Map<String, Object> detail = service.submit(investor, id, 112_000);
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> ranking = (List<Map<String, Object>>) detail.get("ranking");
    assertThat(ranking).hasSize(1);
    assertThat(((Number) ranking.get(0).get("scorePct")).doubleValue()).isEqualTo(12.0);
  }

  @Test
  void nonAdminCannotCreate() {
    ChallengeService service = new ChallengeService();
    assertThatThrownBy(() -> service.create(user("INVESTOR"), "Mon defi", "desc", 100_000.0))
        .isInstanceOf(ApiException.class);
  }

  private static AuthUser user(String role) {
    UUID id = UUID.randomUUID();
    UserRow row = new UserRow(id, "a@b.test", "Ada", "Lovelace", "hash", role, "BEGINNER", true, Instant.now(),
        "ACTIVE", 0, null, false, null, null, null, 0, null, Instant.now(), Instant.now(), null, null);
    return new AuthUser(row, null);
  }
}