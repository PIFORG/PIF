package com.pif.api.mail;

import java.util.List;

/** Port of apps/api/src/email/mail-transport.ts. */
public interface MailTransport {

  MailSettings.Mode mode();

  DeliveryResult send(OutgoingMail mail);

  /** Throws when the transport is unusable (preview folder not writable, relay unreachable or rejecting auth). */
  void verify() throws Exception;

  record OutgoingMail(String template, String from, String to, String replyTo, String subject, String text,
      String html) {}

  /**
   * What actually happened to a message. {@code Captured}: written to the local preview folder, it never left the
   * machine. {@code SmtpAccepted}: the relay accepted it, which is not proof of inbox delivery. Inbox delivery is never
   * reported because SMTP cannot confirm it.
   */
  sealed interface DeliveryResult {
    String state();
  }

  record Captured(String messageId, String previewId) implements DeliveryResult {
    public String state() { return "captured"; }
  }

  record SmtpAccepted(String messageId, List<String> accepted, List<String> rejected) implements DeliveryResult {
    public String state() { return "smtp-accepted"; }
  }

  record Failed(String reason, int attempts) implements DeliveryResult {
    public String state() { return "failed"; }
  }
}
