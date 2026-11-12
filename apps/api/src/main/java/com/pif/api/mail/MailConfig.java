package com.pif.api.mail;

import java.nio.file.Path;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MailConfig {

  /** MAIL_TRANSPORT=preview is rejected in production by MailSettings; unset means the real SMTP relay. */
  @Bean
  MailTransport mailTransport(MailSettings settings) {
    if (settings.mode() == MailSettings.Mode.PREVIEW) {
      return new PreviewMailTransport(Path.of(settings.previewDir()).toAbsolutePath().normalize(), 200);
    }
    return new SmtpMailTransport(new SmtpMailTransport.Settings(settings.host(), settings.port(), settings.secure(),
        settings.requireTls(), settings.user(), settings.pass()));
  }
}
