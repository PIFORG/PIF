package com.pif.api.mail;

import jakarta.mail.Address;
import jakarta.mail.AuthenticationFailedException;
import jakarta.mail.MessagingException;
import jakarta.mail.SendFailedException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.MimeMessage;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.function.LongConsumer;
import org.eclipse.angus.mail.smtp.SMTPAddressFailedException;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;

/**
 * SMTP relay transport with the timeouts, TLS floor and retry policy of SmtpMailTransport in
 * apps/api/src/email/mail-transport.ts: 10 s connect, 20 s socket, TLS 1.2+, certificate and host-name checks,
 * and up to two retries (after 1 s and 4 s) for transient failures only.
 */
public final class SmtpMailTransport implements MailTransport {

  public record Settings(String host, int port, boolean secure, boolean requireTls, String user, String pass) {
    @Override
    public String toString() {
      return "Settings[host=" + host + ", port=" + port + ", secure=" + secure + ", secrets redacted]";
    }
  }

  private final Settings settings;
  private final long[] retryDelaysMs;
  private final LongConsumer sleep;
  private final Session session;

  public SmtpMailTransport(Settings settings) {
    this(settings, new long[] {1_000, 4_000}, SmtpMailTransport::sleepQuietly);
  }

  SmtpMailTransport(Settings settings, long[] retryDelaysMs, LongConsumer sleep) {
    this.settings = settings;
    this.retryDelaysMs = retryDelaysMs.clone();
    this.sleep = sleep;
    this.session = Session.getInstance(properties(settings));
  }

  static Properties properties(Settings s) {
    String p = s.secure() ? "mail.smtps." : "mail.smtp.";
    Properties props = new Properties();
    props.put(p + "host", s.host());
    props.put(p + "port", String.valueOf(s.port()));
    props.put(p + "connectiontimeout", "10000");
    props.put(p + "timeout", "20000");
    props.put(p + "writetimeout", "20000");
    props.put(p + "auth", String.valueOf(s.user() != null));
    props.put(p + "ssl.protocols", "TLSv1.3 TLSv1.2");
    props.put(p + "ssl.checkserveridentity", "true");
    if (!s.secure()) {
      props.put(p + "starttls.enable", "true");
      props.put(p + "starttls.required", String.valueOf(s.requireTls()));
    }
    return props;
  }

  @Override
  public MailSettings.Mode mode() {
    return MailSettings.Mode.SMTP;
  }

  @Override
  public void verify() throws MessagingException {
    try (Transport transport = connect()) {
      // Connecting (and authenticating when configured) is the whole check.
    }
  }

  private Transport connect() throws MessagingException {
    Transport transport = session.getTransport(settings.secure() ? "smtps" : "smtp");
    transport.connect(settings.host(), settings.port(), settings.user(), settings.pass());
    return transport;
  }

  @Override
  public DeliveryResult send(OutgoingMail mail) {
    MimeMessage message;
    try {
      message = MimeMessages.build(session, mail);
    } catch (MessagingException e) {
      return new Failed(describe(e), 1);
    }
    int attempt = 0;
    for (;;) {
      attempt += 1;
      try (Transport transport = connect()) {
        transport.sendMessage(message, message.getAllRecipients());
        String messageId = message.getMessageID();
        return new SmtpAccepted(messageId == null ? "" : messageId, List.of(mail.to()), List.of());
      } catch (SendFailedException e) {
        List<String> sent = addresses(e.getValidSentAddresses());
        if (!sent.isEmpty()) {
          String messageId = messageId(message);
          return new SmtpAccepted(messageId, sent, addresses(e.getInvalidAddresses()));
        }
        if (!retry(attempt, e)) {
          return isTransient(e) ? new Failed(describe(e), attempt)
              : new Failed("Recipient rejected by SMTP relay " + describe(e), attempt);
        }
      } catch (MessagingException | RuntimeException e) {
        if (!retry(attempt, e)) return new Failed(describe(e), attempt);
      }
    }
  }

  private boolean retry(int attempt, Exception e) {
    if (attempt - 1 >= retryDelaysMs.length || !isTransient(e)) return false;
    sleep.accept(retryDelaysMs[attempt - 1]);
    return true;
  }

  /** 4xx SMTP replies and network-level failures may succeed later; 5xx and authentication errors never will. */
  static boolean isTransient(Throwable e) {
    if (e instanceof AuthenticationFailedException) return false;
    Integer code = returnCode(e);
    if (code != null) return code >= 400 && code < 500;
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof IOException) return true;
      if (t instanceof MessagingException me && me.getNextException() instanceof IOException) return true;
    }
    return false;
  }

  private static Integer returnCode(Throwable e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof SMTPSendFailedException s && s.getReturnCode() > 0) return s.getReturnCode();
      if (t instanceof SMTPAddressFailedException a && a.getReturnCode() > 0) return a.getReturnCode();
      if (t instanceof MessagingException me && me.getNextException() != null && me.getNextException() != t) {
        Integer nested = returnCode(me.getNextException());
        if (nested != null) return nested;
      }
    }
    return null;
  }

  static String describe(Throwable e) {
    Integer code = returnCode(e);
    StringBuilder out = new StringBuilder(e.getClass().getSimpleName());
    if (code != null) out.append(" SMTP ").append(code);
    if (e.getMessage() != null && !e.getMessage().isBlank()) out.append(' ').append(e.getMessage().strip());
    return out.toString();
  }

  private static List<String> addresses(Address[] addresses) {
    return addresses == null ? List.of() : Arrays.stream(addresses).map(Address::toString).toList();
  }

  private static String messageId(MimeMessage message) {
    try {
      String id = message.getMessageID();
      return id == null ? "" : id;
    } catch (MessagingException e) {
      return "";
    }
  }

  private static void sleepQuietly(long ms) {
    try {
      Thread.sleep(ms);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }
}
