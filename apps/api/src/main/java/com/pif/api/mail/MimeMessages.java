package com.pif.api.mail;

import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import java.nio.charset.StandardCharsets;

/** Builds the same message shape as Nodemailer: multipart/alternative (text, html) plus X-MTRS-Template. */
final class MimeMessages {

  private MimeMessages() {}

  static MimeMessage build(Session session, MailTransport.OutgoingMail mail) throws MessagingException {
    MimeMessage message = new MimeMessage(session);
    message.setFrom(parseSingle(mail.from(), "from"));
    message.setRecipient(MimeMessage.RecipientType.TO, parseSingle(mail.to(), "to"));
    if (mail.replyTo() != null) {
      message.setReplyTo(new InternetAddress[] {parseSingle(mail.replyTo(), "replyTo")});
    }
    message.setSubject(mail.subject(), StandardCharsets.UTF_8.name());
    message.setHeader("X-MTRS-Template", mail.template());

    MimeBodyPart text = new MimeBodyPart();
    text.setText(mail.text(), StandardCharsets.UTF_8.name(), "plain");
    MimeBodyPart html = new MimeBodyPart();
    html.setText(mail.html(), StandardCharsets.UTF_8.name(), "html");
    MimeMultipart alternative = new MimeMultipart("alternative");
    alternative.addBodyPart(text);
    alternative.addBodyPart(html);
    message.setContent(alternative);
    message.setSentDate(new java.util.Date());
    message.saveChanges();
    return message;
  }

  /** Header injection is impossible: addresses are parsed strictly and must be exactly one mailbox. */
  private static InternetAddress parseSingle(String value, String field) throws MessagingException {
    if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
      throw new MessagingException("Invalid " + field + " address");
    }
    InternetAddress[] parsed = InternetAddress.parse(value, true);
    if (parsed.length != 1) throw new MessagingException("Invalid " + field + " address");
    parsed[0].validate();
    return parsed[0];
  }
}
