package com.pif.api.auth;

import com.pif.api.config.PifProperties;
import com.pif.api.crypto.PasswordHasher;
import com.pif.api.data.AuthRepository;
import com.pif.api.data.Db;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.stereotype.Component;

/** Creates the local test account through the normal users table and authentication flow. */
@Component
public class TestAccountInitializer implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(TestAccountInitializer.class);
  private static final String EMAIL = "test@gmail.com";
  private static final String PASSWORD = "Test123456";

  private final AuthRepository repo;
  private final PasswordHasher passwords;
  private final PifProperties props;

  public TestAccountInitializer(AuthRepository repo, PasswordHasher passwords, PifProperties props) {
    this.repo = repo;
    this.passwords = passwords;
    this.props = props;
  }

  @Override
  public void run(ApplicationArguments args) {
    if (props.isProduction()) {
      log.info("Test account seeding is disabled in production.");
      return;
    }

    try {
      if (repo.emailInUse(EMAIL)) {
        log.info("Non-production test account already exists; leaving it unchanged.");
        return;
      }
      int inserted = repo.insertTestUserIfAbsent(UUID.randomUUID(), EMAIL, "Test", "User",
          passwords.hashBcrypt(PASSWORD), Db.now());
      log.info(inserted == 1
          ? "Created the non-production test account."
          : "Non-production test account already exists; leaving it unchanged.");
    } catch (DataAccessResourceFailureException e) {
      log.warn("Could not seed the non-production test account because the database is unavailable.", e);
    }
  }
}
