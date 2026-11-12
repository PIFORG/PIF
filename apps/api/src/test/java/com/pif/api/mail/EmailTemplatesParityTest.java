package com.pif.api.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.pif.api.mail.EmailTemplates.Brand;
import com.pif.api.mail.EmailTemplates.TemplateParts;
import org.junit.jupiter.api.Test;

/** Smoke-checks that transactional emails render in French (Nest byte-parity retired with the TS templates). */
class EmailTemplatesParityTest {

  private static final Brand BRAND = new Brand("PIF MarketLab", "MTRS", "https://app.example", "https://help.example");

  @Test
  void verifyEmailIsFrench() {
    TemplateParts t = EmailTemplates.verifyEmail(BRAND, "Ada", "https://app.example/verify?t=1", 60);
    assertThat(t.subject()).contains("Verifiez");
    assertThat(t.text()).contains("Bonjour Ada,").contains("Confirmer");
    assertThat(t.html()).contains("lang=\"fr\"").contains("Bonjour Ada,");
  }

  @Test
  void securityAndInfoTemplatesStayFrench() {
    assertThat(EmailTemplates.welcome(BRAND, "Ada").subject()).contains("pret");
    assertThat(EmailTemplates.resetPassword(BRAND, "Ada", "https://x", 30).subject()).contains("Reinitialisez");
    assertThat(EmailTemplates.resetPassword(BRAND, "Ada", "https://x", 30).text()).contains("reinitialisation");
    assertThat(EmailTemplates.mfaEnabled(BRAND, null).text()).contains("Bonjour,").contains("deux etapes");
    assertThat(EmailTemplates.accountSuspended(BRAND, "Ada").subject()).contains("suspendu");
    assertThat(EmailTemplates.smtpTest(BRAND).preheader()).contains("SMTP");
    assertThat(EmailTemplates.expiryLine(120)).contains("2 heures");
    assertThat(EmailTemplates.expiryLine(45)).contains("45 minutes");
  }

  @Test
  void maskEmailKeepsLocalPrefix() {
    assertThat(EmailTemplates.maskEmail("alice@example.com")).isEqualTo("al***@example.com");
  }
}
