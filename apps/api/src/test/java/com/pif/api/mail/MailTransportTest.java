package com.pif.api.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.pif.api.mail.MailTransport.Captured;
import com.pif.api.mail.MailTransport.DeliveryResult;
import com.pif.api.mail.MailTransport.Failed;
import com.pif.api.mail.MailTransport.OutgoingMail;
import com.pif.api.mail.MailTransport.SmtpAccepted;
import jakarta.mail.AuthenticationFailedException;
import jakarta.mail.MessagingException;
import jakarta.mail.Multipart;
import jakarta.mail.internet.MimeMessage;
import java.io.IOException;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mock.env.MockEnvironment;

/** SMTP and preview transports, configuration validation and the mail service, all against local sinks only. */
@ExtendWith(OutputCaptureExtension.class)
class MailTransportTest {

  @RegisterExtension
  static final GreenMailExtension smtp = new GreenMailExtension(ServerSetupTest.SMTP)
      .withConfiguration(GreenMailConfiguration.aConfig().withUser("relay-user", "relay-pass"));

  private static OutgoingMail message(String to) {
    return new OutgoingMail("verify-email", "MTRS <noreply@mtrs.example.test>", to, "help@mtrs.example.test",
        "Vérifiez – your email", "Plain body https://app.example.test/verify-email?token=abc",
        "<p>HTML body</p>");
  }

  private static SmtpMailTransport.Settings greenMail(String user, String pass) {
    return new SmtpMailTransport.Settings("127.0.0.1", ServerSetupTest.SMTP.getPort(), false, false, user, pass);
  }

  // ---------- SMTP ----------

  @Test
  void smtpRelayAcceptsAMultipartMessageWithTheOriginalHeaders() throws Exception {
    SmtpMailTransport transport = new SmtpMailTransport(greenMail("relay-user", "relay-pass"));
    DeliveryResult result = transport.send(message("ada@example.test"));

    assertThat(result).isInstanceOf(SmtpAccepted.class);
    assertThat(result.state()).isEqualTo("smtp-accepted");
    assertThat(((SmtpAccepted) result).accepted()).containsExactly("ada@example.test");
    MimeMessage[] received = smtp.getReceivedMessages();
    assertThat(received).hasSize(1);
    MimeMessage m = received[0];
    assertThat(m.getSubject()).isEqualTo("Vérifiez – your email");
    assertThat(m.getAllRecipients()[0].toString()).isEqualTo("ada@example.test");
    assertThat(m.getFrom()[0].toString()).contains("noreply@mtrs.example.test");
    assertThat(m.getReplyTo()[0].toString()).isEqualTo("help@mtrs.example.test");
    assertThat(m.getHeader("X-MTRS-Template")).containsExactly("verify-email");
    assertThat(m.getContentType()).startsWith("multipart/alternative");
    Multipart parts = (Multipart) m.getContent();
    assertThat(parts.getCount()).isEqualTo(2);
    assertThat(parts.getBodyPart(0).getContentType()).startsWith("text/plain");
    assertThat(parts.getBodyPart(1).getContentType()).startsWith("text/html");
    assertThat(GreenMailUtil.getBody(parts.getBodyPart(1))).contains("HTML body");
  }

  @Test
  void rejectedCredentialsFailOnceWithoutRetryAndWithoutLeakingTheSecret() {
    List<Long> sleeps = new ArrayList<>();
    SmtpMailTransport transport = new SmtpMailTransport(greenMail("relay-user", "wrong-secret-value"),
        new long[] {1_000, 4_000}, sleeps::add);
    DeliveryResult result = transport.send(message("ada@example.test"));

    assertThat(result).isInstanceOf(Failed.class);
    assertThat(((Failed) result).attempts()).isEqualTo(1);
    assertThat(((Failed) result).reason()).doesNotContain("wrong-secret-value");
    assertThat(sleeps).isEmpty();
    assertThat(smtp.getReceivedMessages()).isEmpty();
  }

  @Test
  void unreachableRelayIsRetriedTwiceThenReportedAsFailed() throws IOException {
    int closedPort;
    try (ServerSocket socket = new ServerSocket(0)) {
      closedPort = socket.getLocalPort();
    }
    List<Long> sleeps = new ArrayList<>();
    SmtpMailTransport transport = new SmtpMailTransport(
        new SmtpMailTransport.Settings("127.0.0.1", closedPort, false, false, null, null),
        new long[] {1_000, 4_000}, sleeps::add);
    DeliveryResult result = transport.send(message("ada@example.test"));

    assertThat(result).isInstanceOf(Failed.class);
    assertThat(((Failed) result).attempts()).isEqualTo(3);
    assertThat(sleeps).containsExactly(1_000L, 4_000L);
  }

  @Test
  void onlyTemporaryFailuresAreTransient() {
    assertThat(SmtpMailTransport.isTransient(
        new SMTPSendFailedException("RCPT", 451, "try later", null, null, null, null))).isTrue();
    assertThat(SmtpMailTransport.isTransient(
        new SMTPSendFailedException("RCPT", 550, "no such user", null, null, null, null))).isFalse();
    assertThat(SmtpMailTransport.isTransient(new AuthenticationFailedException("535"))).isFalse();
    assertThat(SmtpMailTransport.isTransient(new MessagingException("io", new IOException("reset")))).isTrue();
    assertThat(SmtpMailTransport.isTransient(new MessagingException("bad address"))).isFalse();
  }

  @Test
  void headerInjectionInARecipientIsRefusedBeforeConnecting() {
    SmtpMailTransport transport = new SmtpMailTransport(greenMail(null, null));
    DeliveryResult result = transport.send(message("ada@example.test\r\nBcc: victim@example.test"));
    assertThat(result).isInstanceOf(Failed.class);
    assertThat(smtp.getReceivedMessages()).isEmpty();
  }

  @Test
  void smtpSettingsUseStrictTimeoutsAndModernTls() {
    var props = SmtpMailTransport.properties(
        new SmtpMailTransport.Settings("relay.example.test", 587, false, true, "u", "p"));
    assertThat(props.getProperty("mail.smtp.connectiontimeout")).isEqualTo("10000");
    assertThat(props.getProperty("mail.smtp.timeout")).isEqualTo("20000");
    assertThat(props.getProperty("mail.smtp.ssl.protocols")).isEqualTo("TLSv1.3 TLSv1.2");
    assertThat(props.getProperty("mail.smtp.ssl.checkserveridentity")).isEqualTo("true");
    assertThat(props.getProperty("mail.smtp.starttls.required")).isEqualTo("true");
    assertThat(new SmtpMailTransport.Settings("h", 1, false, false, "u", "secret-pass").toString())
        .doesNotContain("secret-pass").doesNotContain("u,");
  }

  // ---------- preview ----------

  @Test
  void previewWritesTheFourFilesAndKeepsOnlyTheNewest(@TempDir Path dir) throws Exception {
    PreviewMailTransport preview = new PreviewMailTransport(dir, 3);
    String lastId = null;
    for (int i = 0; i < 5; i++) {
      DeliveryResult result = preview.send(message("user" + i + "@example.test"));
      assertThat(result).isInstanceOf(Captured.class);
      assertThat(result.state()).isEqualTo("captured");
      lastId = ((Captured) result).previewId();
      assertThat(PreviewMailTransport.isPreviewId(lastId)).isTrue();
      Thread.sleep(2);
    }
    for (String ext : List.of(".eml", ".html", ".txt", ".json")) {
      assertThat(dir.resolve(lastId + ext)).exists();
    }
    String json = Files.readString(dir.resolve(lastId + ".json"));
    assertThat(json).contains("\"to\" : \"user4@example.test\"").contains("\"template\" : \"verify-email\"");
    try (Stream<Path> files = Files.list(dir)) {
      assertThat(files.filter(p -> p.toString().endsWith(".json")).count()).isEqualTo(3);
    }
  }

  // ---------- settings ----------

  private static MockEnvironment env() {
    return new MockEnvironment().withProperty("NODE_ENV", "development");
  }

  @Test
  void settingsRejectInvalidValuesLikeTheNestEnvironmentValidation() {
    assertThatThrownBy(() -> new MailSettings(env().withProperty("MAIL_TRANSPORT", "sendmail")))
        .hasMessageContaining("MAIL_TRANSPORT");
    assertThatThrownBy(() -> new MailSettings(env().withProperty("SMTP_PORT", "0"))).hasMessageContaining("SMTP_PORT");
    assertThatThrownBy(() -> new MailSettings(env().withProperty("SMTP_SECURE", "yes")))
        .hasMessageContaining("SMTP_SECURE");
    assertThatThrownBy(() -> new MailSettings(env().withProperty("MAIL_REPLY_TO", "not-an-address")))
        .hasMessageContaining("MAIL_REPLY_TO");
  }

  @Test
  void productionRefusesPreviewLoopbackPlaintextAndPlaceholderSenders() {
    MockEnvironment good = new MockEnvironment().withProperty("NODE_ENV", "production")
        .withProperty("MAIL_TRANSPORT", "smtp").withProperty("SMTP_HOST", "smtp.relay.example.com")
        .withProperty("SMTP_PORT", "587").withProperty("SMTP_USER", "u").withProperty("SMTP_PASS", "p")
        .withProperty("EMAIL_FROM", "MTRS <noreply@mtrs-app.com>");
    assertThat(new MailSettings(good).mode()).isEqualTo(MailSettings.Mode.SMTP);

    assertThatThrownBy(() -> new MailSettings(copy(good).withProperty("MAIL_TRANSPORT", "preview")))
        .hasMessageContaining("preview");
    assertThatThrownBy(() -> new MailSettings(copy(good).withProperty("SMTP_HOST", "localhost")))
        .hasMessageContaining("SMTP_HOST");
    assertThatThrownBy(() -> new MailSettings(copy(good).withProperty("SMTP_REQUIRE_TLS", "false")))
        .hasMessageContaining("SMTP_REQUIRE_TLS");
    assertThatThrownBy(() -> new MailSettings(copy(good).withProperty("SMTP_PASS", "")))
        .hasMessageContaining("SMTP_PASS");
    assertThatThrownBy(() -> new MailSettings(copy(good).withProperty("EMAIL_FROM", "noreply@localhost")))
        .hasMessageContaining("EMAIL_FROM");
  }

  private static MockEnvironment copy(MockEnvironment source) {
    MockEnvironment out = new MockEnvironment();
    for (String key : List.of("NODE_ENV", "MAIL_TRANSPORT", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
        "EMAIL_FROM")) {
      out.setProperty(key, source.getProperty(key));
    }
    return out;
  }

  @Test
  void settingsNeverPrintTheRelayPassword() {
    MailSettings settings = new MailSettings(env().withProperty("SMTP_USER", "relay-user")
        .withProperty("SMTP_PASS", "very-secret-relay-pass"));
    assertThat(settings.toString()).doesNotContain("very-secret-relay-pass");
  }

  // ---------- service ----------

  private static MailSettings serviceSettings() {
    return new MailSettings(env().withProperty("MAIL_TRANSPORT", "preview")
        .withProperty("APP_FRONTEND_URL", "http://localhost:4200/").withProperty("EMAIL_FROM", "noreply@example.test"));
  }

  @Test
  void linksCarryTheEncodedTokenAndLogsNeverContainIt(CapturedOutput output) throws Exception {
    RecordingMailTransport sink = new RecordingMailTransport();
    MailService service = new MailService(sink, serviceSettings());
    String token = "ab+/=c" + "f".repeat(58);
    DeliveryResult result = service.sendPasswordReset("grace.hopper@example.test", "Grace", token, 30).get();

    assertThat(result.state()).isEqualTo("captured");
    OutgoingMail sent = sink.to("grace.hopper@example.test", "reset-password").getFirst();
    assertThat(sent.text()).contains("http://localhost:4200/reset-password?token=ab%2B%2F%3Dc" + "f".repeat(58));
    assertThat(RecordingMailTransport.tokenOf(sent)).isEqualTo(token);
    assertThat(output.getAll()).doesNotContain(token).doesNotContain("grace.hopper@example.test")
        .contains("gr***@example.test");
  }

  @Test
  void linksUseTheApprovedFrontendUnlessAMigrationOriginIsConfigured() throws Exception {
    MailSettings defaults = new MailSettings(env().withProperty("MAIL_TRANSPORT", "preview")
        .withProperty("APP_FRONTEND_URL", "http://localhost:3000").withProperty("EMAIL_FROM", "noreply@example.test"));
    assertThat(defaults.linkBaseUrl()).isEqualTo("http://localhost:3000");

    MailSettings migration = new MailSettings(env().withProperty("MAIL_TRANSPORT", "preview")
        .withProperty("APP_FRONTEND_URL", "http://localhost:3000").withProperty("EMAIL_FROM", "noreply@example.test")
        .withProperty("CORS_ORIGINS", "http://localhost:3000, http://localhost:4200")
        .withProperty("MIGRATION_FRONTEND_URL", "http://localhost:4200/"));
    assertThat(migration.linkBaseUrl()).isEqualTo("http://localhost:4200");
    assertThat(migration.frontendUrl()).isEqualTo("http://localhost:3000");

    RecordingMailTransport sink = new RecordingMailTransport();
    MailService service = new MailService(sink, migration);
    service.sendVerification("ada@example.test", "Ada", "t".repeat(64), 60).get();
    service.sendPasswordReset("ada@example.test", "Ada", "r".repeat(64), 30).get();
    service.sendEmailChangeConfirm("new@example.test", "Ada", "c".repeat(64), 60).get();
    service.sendWelcome("ada@example.test", "Ada").get();
    assertThat(sink.to("ada@example.test", "verify-email").getFirst().text())
        .contains("http://localhost:4200/verify-email?token=" + "t".repeat(64));
    assertThat(sink.to("ada@example.test", "reset-password").getFirst().text())
        .contains("http://localhost:4200/reset-password?token=" + "r".repeat(64));
    assertThat(sink.to("new@example.test", "email-change-confirm").getFirst().text())
        .contains("http://localhost:4200/confirm-email-change?token=" + "c".repeat(64));
    assertThat(sink.to("ada@example.test", "welcome").getFirst().text())
        .as("non-token links keep the approved frontend").doesNotContain("localhost:4200");
  }

  @Test
  void migrationLinkOriginMustBeTrustedAndIsRefusedInProduction() {
    MockEnvironment base = env().withProperty("MAIL_TRANSPORT", "preview").withProperty("EMAIL_FROM", "noreply@example.test")
        .withProperty("CORS_ORIGINS", "http://localhost:3000,http://localhost:4200");
    for (String bad : List.of("https://evil.example", "http://localhost:4200/app", "http://localhost:4200/?x=1",
        "javascript:alert(1)", "http://user:pass@localhost:4200")) {
      MockEnvironment e = copyAll(base).withProperty("MIGRATION_FRONTEND_URL", bad);
      assertThatThrownBy(() -> new MailSettings(e)).as(bad).hasMessageContaining("MIGRATION_FRONTEND_URL");
    }
    MockEnvironment production = new MockEnvironment().withProperty("NODE_ENV", "production")
        .withProperty("MAIL_TRANSPORT", "smtp").withProperty("SMTP_HOST", "smtp.relay.example-mail.com")
        .withProperty("EMAIL_FROM", "noreply@mtrs-mail.com").withProperty("CORS_ORIGINS", "https://app.mtrs-mail.com")
        .withProperty("MIGRATION_FRONTEND_URL", "https://app.mtrs-mail.com");
    assertThatThrownBy(() -> new MailSettings(production)).hasMessageContaining("must not be set in production");
  }

  private static MockEnvironment copyAll(MockEnvironment source) {
    MockEnvironment out = new MockEnvironment();
    for (String key : List.of("NODE_ENV", "MAIL_TRANSPORT", "EMAIL_FROM", "CORS_ORIGINS")) {
      if (source.getProperty(key) != null) out.setProperty(key, source.getProperty(key));
    }
    return out;
  }

  @Test
  void deliveryFailuresAreReportedNotThrown(CapturedOutput output) throws Exception {
    MailTransport broken = new MailTransport() {
      @Override public MailSettings.Mode mode() { return MailSettings.Mode.SMTP; }
      @Override public DeliveryResult send(OutgoingMail mail) { throw new IllegalStateException("relay exploded"); }
      @Override public void verify() {}
    };
    MailService service = new MailService(broken, serviceSettings());
    DeliveryResult result = service.sendAccountLocked("ada@example.test", "Ada", 15).get();
    assertThat(result).isInstanceOf(Failed.class);
    assertThat(result.state()).isEqualTo("failed");
    assertThat(output.getAll()).contains("Email delivery failed").doesNotContain("ada@example.test");
  }

  @Test
  void aFullQueueFailsFastInsteadOfBlockingTheRequest() throws Exception {
    CompletableFuture<Void> gate = new CompletableFuture<>();
    MailTransport slow = new MailTransport() {
      @Override public MailSettings.Mode mode() { return MailSettings.Mode.PREVIEW; }
      @Override public DeliveryResult send(OutgoingMail mail) {
        gate.join();
        return new Captured("<id>", "id");
      }
      @Override public void verify() {}
    };
    ExecutorService executor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>(1));
    MailService service = new MailService(slow, serviceSettings(), executor);
    service.sendWelcome("a@example.test", "A");
    service.sendWelcome("b@example.test", "B");
    DeliveryResult rejected = service.sendWelcome("c@example.test", "C").get(1, TimeUnit.SECONDS);
    assertThat(rejected).isInstanceOf(Failed.class);
    assertThat(((Failed) rejected).attempts()).isZero();
    gate.complete(null);
    executor.shutdown();
  }

  @Test
  void redactionMasksEveryAddressInAFailureReason() {
    assertThat(MailService.redact("550 <john.doe@example.test> rejected; cc jane@x.test"))
        .doesNotContain("john.doe@example.test").doesNotContain("jane@x.test").contains("jo***@example.test");
  }
}
