package com.pif.api.mail;

import com.pif.api.mail.EmailTemplates.Brand;
import com.pif.api.mail.EmailTemplates.TemplateParts;
import com.pif.api.mail.MailTransport.Captured;
import com.pif.api.mail.MailTransport.DeliveryResult;
import com.pif.api.mail.MailTransport.Failed;
import com.pif.api.mail.MailTransport.OutgoingMail;
import com.pif.api.mail.MailTransport.SmtpAccepted;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

/**
 * Sends transactional mail (apps/api/src/email/email.service.ts). Messages are queued on a small bounded executor,
 * so HTTP responses never wait for the relay and delivery failures never reach the caller: responses cannot be used
 * to probe account existence, and a failed notice never undoes the security action that triggered it. Every outcome
 * is logged with the recipient masked; tokens never appear in logs.
 */
@Service
public class MailService {

  private static final Logger log = LoggerFactory.getLogger(MailService.class);
  private static final Pattern EMAIL_IN_TEXT = Pattern.compile("[^\\s<>\"'@]+@[^\\s<>\"'@]+\\.[^\\s<>\"'@]+");
  private static final int QUEUE_CAPACITY = 1000;

  private final MailTransport transport;
  private final MailSettings settings;
  private final ExecutorService executor;
  private final Set<CompletableFuture<DeliveryResult>> pending = ConcurrentHashMap.newKeySet();

  @Autowired
  public MailService(MailTransport transport, MailSettings settings) {
    this(transport, settings, defaultExecutor());
  }

  MailService(MailTransport transport, MailSettings settings, ExecutorService executor) {
    this.transport = transport;
    this.settings = settings;
    this.executor = executor;
  }

  private static ExecutorService defaultExecutor() {
    AtomicInteger counter = new AtomicInteger();
    return new ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>(QUEUE_CAPACITY), r -> {
      Thread t = new Thread(r, "mail-" + counter.incrementAndGet());
      t.setDaemon(true);
      return t;
    });
  }

  public MailSettings.Mode mode() {
    return transport.mode();
  }

  @EventListener(ApplicationReadyEvent.class)
  public void verifyOnStartup() {
    if (settings.testEnv()) return;
    try {
      transport.verify();
      if (transport instanceof PreviewMailTransport preview) {
        log.warn("Mail transport: PREVIEW - messages are written to {} and are NOT delivered.", preview.directory());
      } else {
        log.info("Mail transport: SMTP relay connection and authentication verified");
      }
    } catch (Exception e) {
      log.error("Mail transport {} failed verification: {}. Transactional email will not be sent until this is fixed.",
          transport.mode(), redact(SmtpMailTransport.describe(e)));
    }
  }

  /** Waits for queued messages (tests and graceful shutdown). */
  public void awaitPending(Duration timeout) {
    CompletableFuture<?>[] snapshot = pending.toArray(CompletableFuture[]::new);
    try {
      CompletableFuture.allOf(snapshot).get(timeout.toMillis(), TimeUnit.MILLISECONDS);
    } catch (Exception e) {
      log.warn("Timed out waiting for {} queued email(s)", snapshot.length);
    }
  }

  @PreDestroy
  void shutdown() {
    executor.shutdown();
    try {
      if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
        log.warn("Email queue did not drain before shutdown");
        executor.shutdownNow();
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      executor.shutdownNow();
    }
  }

  private Brand brand() {
    return new Brand(settings.appName(), "MTRS", settings.frontendUrl(), settings.supportUrl());
  }

  private String link(String path, String rawToken) {
    String base = settings.linkBaseUrl().replaceAll("/$", "");
    return base + path + "?token=" + encodeUriComponent(rawToken);
  }

  /** Synchronous delivery with logging; never throws. */
  DeliveryResult deliver(String template, String to, TemplateParts t) {
    DeliveryResult result;
    try {
      result = transport.send(new OutgoingMail(template, settings.from(), to, settings.replyTo(), t.subject(),
          t.text(), t.html()));
    } catch (RuntimeException e) {
      result = new Failed(SmtpMailTransport.describe(e), 1);
    }
    String target = "template=" + template + " to=" + EmailTemplates.maskEmail(to);
    switch (result) {
      case Captured c -> log.info("Email captured to local preview (not delivered): {} preview={}", target,
          c.previewId());
      case SmtpAccepted a -> log.info("Email accepted by SMTP relay (inbox delivery not confirmed): {}", target);
      case Failed f -> log.error("Email delivery failed: {} attempts={} reason={}", target, f.attempts(),
          redact(f.reason()));
    }
    return result;
  }

  /** Queues a message; the future completes with the transport outcome (or Failed when the queue is full). */
  CompletableFuture<DeliveryResult> queue(String template, String to, TemplateParts t) {
    try {
      CompletableFuture<DeliveryResult> future = CompletableFuture.supplyAsync(() -> deliver(template, to, t),
          executor);
      pending.add(future);
      future.whenComplete((r, e) -> pending.remove(future));
      log.debug("Email queued: template={} to={}", template, EmailTemplates.maskEmail(to));
      return future;
    } catch (RejectedExecutionException e) {
      Failed failed = new Failed("Email queue is full", 0);
      log.error("Email delivery failed: template={} to={} attempts=0 reason={}", template,
          EmailTemplates.maskEmail(to), failed.reason());
      return CompletableFuture.completedFuture(failed);
    }
  }

  static String redact(String reason) {
    Matcher m = EMAIL_IN_TEXT.matcher(reason);
    StringBuilder out = new StringBuilder();
    while (m.find()) m.appendReplacement(out, Matcher.quoteReplacement(EmailTemplates.maskEmail(m.group())));
    m.appendTail(out);
    return out.toString();
  }

  static String encodeUriComponent(String value) {
    StringBuilder out = new StringBuilder();
    for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
      int c = b & 0xff;
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
          || "-_.!~*'()".indexOf(c) >= 0) {
        out.append((char) c);
      } else {
        out.append('%').append(String.format("%02X", c));
      }
    }
    return out.toString();
  }

  // ---------- messages (same templates, recipients and arguments as email.service.ts) ----------

  public CompletableFuture<DeliveryResult> sendVerification(String to, String firstName, String rawToken,
      int expiresMinutes) {
    return queue("verify-email", to,
        EmailTemplates.verifyEmail(brand(), firstName, link("/verify-email", rawToken), expiresMinutes));
  }

  public CompletableFuture<DeliveryResult> sendWelcome(String to, String firstName) {
    return queue("welcome", to, EmailTemplates.welcome(brand(), firstName));
  }

  public CompletableFuture<DeliveryResult> sendPasswordReset(String to, String firstName, String rawToken,
      int expiresMinutes) {
    return queue("reset-password", to,
        EmailTemplates.resetPassword(brand(), firstName, link("/reset-password", rawToken), expiresMinutes));
  }

  public CompletableFuture<DeliveryResult> sendEmailChangeConfirm(String newEmail, String firstName, String rawToken,
      int expiresMinutes) {
    return queue("email-change-confirm", newEmail, EmailTemplates.emailChangeConfirm(brand(), firstName,
        link("/confirm-email-change", rawToken), newEmail, expiresMinutes));
  }

  public CompletableFuture<DeliveryResult> sendEmailChangeRequested(String oldEmail, String firstName,
      String newEmail) {
    return queue("email-change-requested", oldEmail,
        EmailTemplates.emailChangeRequested(brand(), firstName, EmailTemplates.maskEmail(newEmail)));
  }

  public CompletableFuture<DeliveryResult> sendEmailChangedToOld(String oldEmail, String firstName, String newEmail) {
    return queue("email-changed-old", oldEmail,
        EmailTemplates.emailChangedOldAddress(brand(), firstName, EmailTemplates.maskEmail(newEmail)));
  }

  public CompletableFuture<DeliveryResult> sendEmailChangedToNew(String newEmail, String firstName) {
    return queue("email-changed-new", newEmail, EmailTemplates.emailChangedNewAddress(brand(), firstName));
  }

  public CompletableFuture<DeliveryResult> sendPasswordChanged(String to, String firstName, String via) {
    return queue("password-changed", to, EmailTemplates.passwordChanged(brand(), firstName, via));
  }

  public CompletableFuture<DeliveryResult> sendAccountLocked(String to, String firstName, int lockMinutes) {
    return queue("account-locked", to, EmailTemplates.accountLocked(brand(), firstName, lockMinutes));
  }

  public CompletableFuture<DeliveryResult> sendSessionsRevoked(String to, String firstName, String scope) {
    return queue("sessions-revoked", to, EmailTemplates.sessionsRevoked(brand(), firstName, scope));
  }

  public CompletableFuture<DeliveryResult> sendMfaEnabled(String to, String firstName) {
    return queue("mfa-enabled", to, EmailTemplates.mfaEnabled(brand(), firstName));
  }

  public CompletableFuture<DeliveryResult> sendMfaDisabled(String to, String firstName) {
    return queue("mfa-disabled", to, EmailTemplates.mfaDisabled(brand(), firstName));
  }

  public CompletableFuture<DeliveryResult> sendMfaRecoveryCodesRegenerated(String to, String firstName) {
    return queue("mfa-recovery-codes-regenerated", to, EmailTemplates.mfaRecoveryCodesRegenerated(brand(), firstName));
  }

  public CompletableFuture<DeliveryResult> sendAccountDeactivated(String to, String firstName,
      boolean byAdministrator) {
    return queue("account-deactivated", to, EmailTemplates.accountDeactivated(brand(), firstName, byAdministrator));
  }

  public CompletableFuture<DeliveryResult> sendAccountSuspended(String to, String firstName) {
    return queue("account-suspended", to, EmailTemplates.accountSuspended(brand(), firstName));
  }

  public CompletableFuture<DeliveryResult> sendAccountReactivated(String to, String firstName,
      boolean needsVerification) {
    return queue("account-reactivated", to, EmailTemplates.accountReactivated(brand(), firstName, needsVerification));
  }

  public CompletableFuture<DeliveryResult> sendAccountDeletionScheduled(String to, String firstName) {
    return queue("account-deletion-scheduled", to, EmailTemplates.accountDeletionScheduled(brand(), firstName));
  }

  public CompletableFuture<DeliveryResult> sendAccountExists(String to, String firstName) {
    return queue("account-exists", to, EmailTemplates.accountExists(brand(), firstName));
  }
}
