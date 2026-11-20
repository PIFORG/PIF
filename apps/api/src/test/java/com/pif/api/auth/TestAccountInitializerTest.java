package com.pif.api.auth;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.pif.api.config.PifProperties;
import com.pif.api.crypto.PasswordHasher;
import com.pif.api.data.AuthRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.mock.env.MockEnvironment;

class TestAccountInitializerTest {

  @Test
  void doesNotSeedTheTestAccountInProduction() {
    AuthRepository repo = mock(AuthRepository.class);
    TestAccountInitializer initializer =
        new TestAccountInitializer(repo, new PasswordHasher(), productionProperties());

    initializer.run(new DefaultApplicationArguments(new String[0]));

    verifyNoInteractions(repo);
  }

  private static PifProperties productionProperties() {
    MockEnvironment env = new MockEnvironment()
        .withProperty("NODE_ENV", "production")
        .withProperty("JWT_ACCESS_SECRET", "test-jwt-secret")
        .withProperty("AUTH_TOKEN_PEPPER", "test-token-pepper")
        .withProperty("AUTH_IP_HASH_PEPPER", "test-ip-pepper")
        .withProperty("MFA_ENCRYPTION_KEY", "00".repeat(32));
    return new PifProperties(env);
  }
}
