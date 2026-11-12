package com.pif.api.mail;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * Development transport: renders the full RFC 5322 message (CRLF line endings) and stores it as .eml plus
 * .html/.txt renditions and a .json summary, in the same layout as the NestJS preview inbox. Nothing is sent over
 * the network.
 */
public final class PreviewMailTransport implements MailTransport {

  private static final Pattern PREVIEW_ID = Pattern.compile("^[0-9]{8}T[0-9]{9}Z-[a-z0-9-]{1,60}-[0-9a-f]{8}$");
  private static final DateTimeFormatter COMPACT =
      DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmssSSS'Z'", Locale.ROOT).withZone(ZoneOffset.UTC);
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final ObjectMapper JSON = JsonMapper.builder().enable(SerializationFeature.INDENT_OUTPUT).build();

  private final Path dir;
  private final int keep;
  private final Session session = Session.getInstance(new Properties());

  public PreviewMailTransport(Path dir, int keep) {
    this.dir = dir;
    this.keep = keep;
  }

  public Path directory() {
    return dir;
  }

  public static boolean isPreviewId(String id) {
    return PREVIEW_ID.matcher(id).matches();
  }

  @Override
  public MailSettings.Mode mode() {
    return MailSettings.Mode.PREVIEW;
  }

  @Override
  public void verify() throws IOException {
    Files.createDirectories(dir);
    if (!Files.isWritable(dir)) throw new IOException("Preview directory is not writable");
  }

  @Override
  public synchronized DeliveryResult send(OutgoingMail mail) {
    try {
      Files.createDirectories(dir);
      Instant now = Instant.now();
      String slug = mail.template().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-]", "-");
      slug = slug.substring(0, Math.min(60, slug.length()));
      if (slug.isEmpty()) slug = "message";
      byte[] random = new byte[4];
      RANDOM.nextBytes(random);
      String id = COMPACT.format(now) + "-" + slug + "-" + HexFormat.of().formatHex(random);

      MimeMessage message = MimeMessages.build(session, mail);
      ByteArrayOutputStream raw = new ByteArrayOutputStream();
      message.writeTo(raw);

      Map<String, Object> meta = new LinkedHashMap<>();
      meta.put("id", id);
      meta.put("template", mail.template());
      meta.put("to", mail.to());
      meta.put("subject", mail.subject());
      meta.put("createdAt", DateTimeFormatter.ISO_INSTANT.format(now.truncatedTo(java.time.temporal.ChronoUnit.MILLIS)));

      Files.write(dir.resolve(id + ".eml"), raw.toByteArray());
      Files.writeString(dir.resolve(id + ".html"), mail.html(), StandardCharsets.UTF_8);
      Files.writeString(dir.resolve(id + ".txt"), mail.text(), StandardCharsets.UTF_8);
      Files.writeString(dir.resolve(id + ".json"), JSON.writeValueAsString(meta), StandardCharsets.UTF_8);
      prune();
      String messageId = message.getMessageID();
      return new Captured(messageId == null ? "" : messageId, id);
    } catch (Exception e) {
      return new Failed(e.getClass().getSimpleName() + " " + (e.getMessage() == null ? "" : e.getMessage()), 1);
    }
  }

  private void prune() throws IOException {
    List<String> ids;
    try (Stream<Path> files = Files.list(dir)) {
      ids = files.map(p -> p.getFileName().toString())
          .filter(f -> f.endsWith(".json"))
          .map(f -> f.substring(0, f.length() - ".json".length()))
          .filter(PreviewMailTransport::isPreviewId)
          .sorted()
          .toList();
    }
    for (String id : ids.subList(0, Math.max(0, ids.size() - keep))) {
      for (String ext : List.of(".eml", ".html", ".txt", ".json")) {
        Files.deleteIfExists(dir.resolve(id + ext));
      }
    }
  }
}
