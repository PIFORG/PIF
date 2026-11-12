package com.pif.api.mail;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** In-memory mail sink for tests: records every message and can simulate a relay outage. */
public final class RecordingMailTransport implements MailTransport {

  private static final Pattern TOKEN_LINK = Pattern.compile("[?&]token=([^\\s\"&<]+)");

  private final List<OutgoingMail> sent = new CopyOnWriteArrayList<>();
  private volatile boolean failing;

  @Override
  public MailSettings.Mode mode() {
    return MailSettings.Mode.PREVIEW;
  }

  @Override
  public DeliveryResult send(OutgoingMail mail) {
    sent.add(mail);
    if (failing) return new Failed("Simulated relay outage", 3);
    return new Captured("<junit@test>", "junit");
  }

  @Override
  public void verify() {}

  public void failDeliveries(boolean fail) {
    this.failing = fail;
  }

  public void clear() {
    sent.clear();
    failing = false;
  }

  public List<OutgoingMail> to(String address, String template) {
    List<OutgoingMail> out = new ArrayList<>();
    for (OutgoingMail m : sent) {
      if (m.to().equalsIgnoreCase(address) && (template == null || template.equals(m.template()))) out.add(m);
    }
    return out;
  }

  /** The raw token from the single action link of a message (decoded). */
  public static String tokenOf(OutgoingMail mail) {
    Matcher m = TOKEN_LINK.matcher(mail.text());
    if (!m.find()) throw new AssertionError("No token link in " + mail.template());
    return java.net.URLDecoder.decode(m.group(1), java.nio.charset.StandardCharsets.UTF_8);
  }

  public static boolean containsTokenLink(OutgoingMail mail) {
    return TOKEN_LINK.matcher(mail.text()).find() || TOKEN_LINK.matcher(mail.html()).find();
  }
}
