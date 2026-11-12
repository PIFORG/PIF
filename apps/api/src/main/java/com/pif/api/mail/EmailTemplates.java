package com.pif.api.mail;

import com.pif.api.web.Validation;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Transactional email templates (French user-facing copy). Structure mirrors the historical NestJS layout;
 * wording is localized for MarketLab.
 */
public final class EmailTemplates {

  private EmailTemplates() {}

  public record TemplateParts(String subject, String preheader, String text, String html) {}

  /** appUrl: public web origin used for non-token links; supportUrl: optional help link. */
  public record Brand(String appName, String shortName, String appUrl, String supportUrl) {}

  private enum Kind { REQUEST, SECURITY, INFO }

  private record Action(String url, String label, Integer expiresMinutes) {}

  private record Fact(String label, String value) {}

  private record Message(Kind kind, String eyebrow, String subject, String preheader, String title,
      List<String> paragraphs, List<Fact> facts, Action action, String notice, String firstName) {}

  private static final String CANVAS = "#081322";
  private static final String CARD = "#0B1422";
  private static final String PANEL = "#0F1C2E";
  private static final String BORDER = "#1B2B40";
  private static final String HEADING = "#F4F8FF";
  private static final String BODY = "#B8C8DA";
  private static final String MUTED = "#8A9BB0";
  private static final String PRIMARY = "#2563EB";
  private static final String ACCENT = "#38BDF8";
  private static final String ATTENTION = "#F5B544";
  private static final String FONT = "Arial, Helvetica, sans-serif";

  public static String escapeHtml(String s) {
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
        .replace("'", "&#39;");
  }

  private static String shortName(Brand b) {
    String s = b.shortName() == null ? "" : Validation.jsTrim(b.shortName());
    return s.isEmpty() ? "MTRS" : s;
  }

  private static String appLink(Brand b, String path) {
    return isSet(b.appUrl()) ? stripTrailingSlash(b.appUrl()) + path : null;
  }

  private static String greeting(String firstName) {
    String name = firstName == null ? "" : Validation.jsTrim(firstName);
    return name.isEmpty() ? "Bonjour," : "Bonjour " + name + ",";
  }

  private static String defaultNotice(Kind kind) {
    return switch (kind) {
      case REQUEST -> "Si vous n'avez pas demande cela, aucune action n'est requise — rien ne change tant que le lien n'est pas utilise.";
      case SECURITY -> "Si ce n'etait pas vous, reinitialisez immediatement votre mot de passe depuis la page de connexion et verifiez vos sessions actives.";
      case INFO -> "Vous recevez ce message parce qu'un compte a ete cree avec cette adresse e-mail.";
    };
  }

  public static String expiryLine(int minutes) {
    if (minutes % 60 == 0) {
      int hours = minutes / 60;
      return "Ce lien expire dans " + hours + " heure" + (hours == 1 ? "" : "s") + " et ne peut etre utilise qu'une seule fois.";
    }
    return "Ce lien expire dans " + minutes + " minutes et ne peut etre utilise qu'une seule fois.";
  }

  private static List<String> footerLines(Brand b, Message m) {
    List<String> lines = new ArrayList<>();
    lines.add(m.notice() != null ? m.notice() : defaultNotice(m.kind()));
    if (isSet(b.supportUrl())) lines.add("Besoin d'aide ? " + b.supportUrl());
    lines.add("Ceci est un message automatique de " + shortName(b) + " — " + b.appName()
        + ". Les reponses ne sont pas surveillees.");
    lines.add(shortName(b) + " est un environnement de trading simule : aucun argent ni titre reel n'est en jeu.");
    return lines;
  }

  private static String renderText(Brand b, Message m) {
    List<String> out = new ArrayList<>(List.of(greeting(m.firstName()), ""));
    for (String p : m.paragraphs()) {
      out.add(p);
      out.add("");
    }
    if (m.facts() != null && !m.facts().isEmpty()) {
      for (Fact f : m.facts()) out.add(f.label() + ": " + f.value());
      out.add("");
    }
    if (m.action() != null) {
      out.add(m.action().label() + ":");
      out.add(m.action().url());
      out.add("");
      if (m.action().expiresMinutes() != null) {
        out.add(expiryLine(m.action().expiresMinutes()));
        out.add("");
      }
    }
    out.add("—");
    out.addAll(footerLines(b, m));
    return String.join("\n", out);
  }

  private static final String P_STYLE =
      "margin:0 0 16px;font-family:" + FONT + ";font-size:16px;line-height:1.6;color:" + BODY + ";";

  private static String factsHtml(List<Fact> facts) {
    String rows = facts.stream().map(f -> "<tr>\n"
        + "<td style=\"padding:10px 16px;font-family:" + FONT + ";font-size:13px;color:" + MUTED
        + ";white-space:nowrap;vertical-align:top;\">" + escapeHtml(f.label()) + "</td>\n"
        + "<td style=\"padding:10px 16px;font-family:" + FONT + ";font-size:14px;color:" + HEADING
        + ";word-break:break-all;\">" + escapeHtml(f.value()) + "</td>\n"
        + "</tr>").collect(Collectors.joining());
    return "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" bgcolor=\""
        + PANEL + "\" style=\"background:" + PANEL + ";border:1px solid " + BORDER
        + ";border-radius:8px;margin:4px 0 20px;\">" + rows + "</table>";
  }

  private static String actionHtml(Action a) {
    String url = escapeHtml(a.url());
    String button = "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" "
        + "style=\"margin:8px 0 24px;\">\n"
        + "<tr><td align=\"center\" bgcolor=\"" + PRIMARY + "\" style=\"border-radius:8px;background:" + PRIMARY
        + ";\">\n"
        + "<a href=\"" + url + "\" target=\"_blank\" rel=\"noopener\" style=\"display:inline-block;padding:14px 28px;"
        + "font-family:" + FONT + ";font-size:16px;font-weight:bold;line-height:20px;color:#FFFFFF;"
        + "text-decoration:none;border-radius:8px;\">" + escapeHtml(a.label()) + "</a>\n"
        + "</td></tr></table>";
    String expiry = a.expiresMinutes() == null ? ""
        : "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" "
            + "style=\"margin:0 0 20px;\">\n"
            + "<tr><td bgcolor=\"" + PANEL + "\" style=\"background:" + PANEL + ";border-left:3px solid " + ATTENTION
            + ";border-radius:4px;padding:12px 16px;font-family:" + FONT + ";font-size:14px;line-height:1.5;color:"
            + BODY + ";\">" + escapeHtml(expiryLine(a.expiresMinutes())) + "</td></tr></table>";
    String fallback = "<p style=\"margin:0 0 6px;font-family:" + FONT + ";font-size:13px;line-height:1.5;color:"
        + MUTED + ";\">Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :</p>\n"
        + "<p style=\"margin:0;font-family:" + FONT + ";font-size:13px;line-height:1.5;word-break:break-all;\">"
        + "<a href=\"" + url + "\" target=\"_blank\" rel=\"noopener\" style=\"color:" + ACCENT
        + ";text-decoration:underline;\">" + url + "</a></p>";
    return button + expiry + fallback;
  }

  private static String renderHtml(Brand b, Message m) {
    String brandShort = escapeHtml(shortName(b));
    String preheaderPad = "&#8203;&nbsp;".repeat(40);
    List<String> bodyParts = new ArrayList<>();
    bodyParts.add("<p style=\"" + P_STYLE + "\">" + escapeHtml(greeting(m.firstName())) + "</p>");
    for (String p : m.paragraphs()) bodyParts.add("<p style=\"" + P_STYLE + "\">" + escapeHtml(p) + "</p>");
    bodyParts.add(m.facts() != null && !m.facts().isEmpty() ? factsHtml(m.facts()) : "");
    bodyParts.add(m.action() != null ? actionHtml(m.action()) : "");
    String body = String.join("\n", bodyParts);
    String footer = footerLines(b, m).stream().map(line -> {
      if (isSet(b.supportUrl()) && line.equals("Need help? " + b.supportUrl())) {
        String href = escapeHtml(b.supportUrl());
        return "<p style=\"margin:0 0 8px;\">Need help? <a href=\"" + href + "\" target=\"_blank\" rel=\"noopener\" "
            + "style=\"color:" + ACCENT + ";\">" + href + "</a></p>";
      }
      return "<p style=\"margin:0 0 8px;\">" + escapeHtml(line) + "</p>";
    }).collect(Collectors.joining("\n"));

    return "<!DOCTYPE html>\n"
        + "<html lang=\"fr\">\n"
        + "<head>\n"
        + "<meta charset=\"utf-8\"/>\n"
        + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>\n"
        + "<meta name=\"x-apple-disable-message-reformatting\"/>\n"
        + "<meta name=\"color-scheme\" content=\"dark\"/>\n"
        + "<meta name=\"supported-color-schemes\" content=\"dark\"/>\n"
        + "<title>" + escapeHtml(m.subject()) + "</title>\n"
        + "<style>\n"
        + "@media only screen and (max-width:620px){\n"
        + "  .mtrs-card{padding:28px 20px !important;}\n"
        + "  .mtrs-title{font-size:24px !important;}\n"
        + "}\n"
        + "</style>\n"
        + "</head>\n"
        + "<body style=\"margin:0;padding:0;background:" + CANVAS + ";\" bgcolor=\"" + CANVAS + "\">\n"
        + "<div style=\"display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;"
        + "line-height:1px;color:" + CANVAS + ";\">" + escapeHtml(m.preheader()) + preheaderPad + "</div>\n"
        + "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" bgcolor=\""
        + CANVAS + "\" style=\"background:" + CANVAS + ";\">\n"
        + "<tr><td align=\"center\" style=\"padding:32px 12px;\">\n"
        + "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" "
        + "style=\"max-width:600px;\">\n"
        + "<tr><td style=\"padding:0 4px 20px;\">\n"
        + "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\"><tr>\n"
        + "<td width=\"34\" height=\"34\" align=\"center\" bgcolor=\"" + PRIMARY + "\" style=\"width:34px;height:34px;"
        + "background:" + PRIMARY + ";border-radius:8px;font-family:" + FONT
        + ";font-size:15px;font-weight:bold;color:#FFFFFF;\">M</td>\n"
        + "<td style=\"padding-left:12px;font-family:" + FONT + ";font-size:17px;font-weight:bold;letter-spacing:2px;"
        + "color:" + HEADING + ";\">" + brandShort + "<span style=\"color:" + ACCENT + ";\">.</span></td>\n"
        + "<td style=\"padding-left:12px;font-family:" + FONT + ";font-size:12px;color:" + MUTED + ";\">"
        + escapeHtml(b.appName()) + "</td>\n"
        + "</tr></table>\n"
        + "</td></tr>\n"
        + "<tr><td class=\"mtrs-card\" bgcolor=\"" + CARD + "\" style=\"background:" + CARD + ";border:1px solid "
        + BORDER + ";border-radius:12px;padding:40px;\">\n"
        + "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:0 0 20px;\">"
        + "<tr><td width=\"48\" height=\"3\" bgcolor=\"" + ACCENT + "\" style=\"width:48px;height:3px;background:"
        + ACCENT + ";border-radius:2px;font-size:0;line-height:0;\">&nbsp;</td></tr></table>\n"
        + "<p style=\"margin:0 0 10px;font-family:" + FONT + ";font-size:12px;font-weight:bold;letter-spacing:1.5px;"
        + "text-transform:uppercase;color:" + ACCENT + ";\">" + escapeHtml(m.eyebrow()) + "</p>\n"
        + "<h1 class=\"mtrs-title\" style=\"margin:0 0 24px;font-family:" + FONT + ";font-size:27px;line-height:1.25;"
        + "font-weight:bold;color:" + HEADING + ";\">" + escapeHtml(m.title()) + "</h1>\n"
        + body + "\n"
        + "</td></tr>\n"
        + "<tr><td style=\"padding:24px 8px 8px;font-family:" + FONT + ";font-size:12px;line-height:1.6;color:"
        + MUTED + ";\">\n"
        + footer + "\n"
        + "</td></tr>\n"
        + "</table>\n"
        + "</td></tr>\n"
        + "</table>\n"
        + "</body>\n"
        + "</html>";
  }

  private static TemplateParts build(Brand b, Message m) {
    return new TemplateParts(m.subject(), m.preheader(), renderText(b, m), renderHtml(b, m));
  }

  private static Action maybeAction(String url, String label) {
    return url != null && !url.isEmpty() ? new Action(url, label, null) : null;
  }

  private static Message message(Kind kind, String eyebrow, String subject, String preheader, String title,
      List<String> paragraphs, List<Fact> facts, Action action, String notice, String firstName) {
    return new Message(kind, eyebrow, subject, preheader, title, paragraphs, facts, action, notice, firstName);
  }

  public static TemplateParts verifyEmail(Brand b, String firstName, String verifyUrl, int expiresMinutes) {
    String s = shortName(b);
    return build(b, message(Kind.REQUEST, "Verification du compte", "Verifiez votre e-mail pour " + s,
        "Confirmez votre adresse e-mail pour activer votre espace de trading simule " + s + ".",
        "Confirmez votre adresse e-mail",
        List.of("Merci d'avoir cree un compte " + b.appName() + ". Confirmez votre adresse e-mail pour l'activer et "
                + "commencer a utiliser votre espace de trading virtuel.",
            "L'ouverture du lien affiche une page de confirmation ; votre adresse n'est confirmee qu'apres avoir "
                + "appui sur le bouton."),
        null, new Action(verifyUrl, "Confirmer l'adresse e-mail", expiresMinutes), null, firstName));
  }

  public static TemplateParts welcome(Brand b, String firstName) {
    String s = shortName(b);
    return build(b, message(Kind.INFO, "Compte pret", "Votre compte " + s + " est pret",
        "Votre adresse e-mail est confirmee. Connectez-vous pour ouvrir votre espace de marche simule.", "Bienvenue sur " + s,
        List.of("Votre adresse e-mail est confirmee et votre compte est actif.",
            "Tout dans l'espace de travail est simule avec des fonds virtuels, pour vous exercer sans risquer "
                + "d'argent reel."),
        null, maybeAction(appLink(b, "/login"), "Se connecter a " + s),
        "Si vous n'avez pas cree ce compte, reinitialisez son mot de passe depuis la page de connexion et verifiez "
            + "ses sessions actives.",
        firstName));
  }

  public static TemplateParts resetPassword(Brand b, String firstName, String resetUrl, int expiresMinutes) {
    String s = shortName(b);
    return build(b, message(Kind.REQUEST, "Reinitialisation du mot de passe", "Reinitialisez votre mot de passe " + s,
        "Utilisez ce lien a usage unique pour choisir un nouveau mot de passe.", "Reinitialiser le mot de passe",
        List.of("Nous avons recu une demande de reinitialisation du mot de passe de votre compte.",
            "La reinitialisation vous deconnecte sur tous les appareils et annule tout changement d'e-mail en cours."),
        null, new Action(resetUrl, "Choisir un nouveau mot de passe", expiresMinutes), null, firstName));
  }

  public static TemplateParts emailChangeConfirm(Brand b, String firstName, String confirmUrl, String newEmail,
      int expiresMinutes) {
    String s = shortName(b);
    return build(b, message(Kind.REQUEST, "Changement d'e-mail", "Confirmez votre nouvelle adresse e-mail " + s,
        "Confirmez cette adresse pour en faire l'e-mail de connexion de votre compte.", "Confirmez votre nouvelle adresse e-mail",
        List.of("Vous avez demande d'utiliser cette adresse pour votre compte " + b.appName() + ". Votre adresse "
                + "actuelle reste active tant que vous n'avez pas confirme.",
            "La confirmation vous deconnecte sur tous les appareils ; reconnectez-vous avec la nouvelle adresse."),
        List.of(new Fact("Nouvelle adresse", newEmail)),
        new Action(confirmUrl, "Confirmer la nouvelle adresse", expiresMinutes), null, firstName));
  }

  public static TemplateParts emailChangeRequested(Brand b, String firstName, String maskedNewEmail) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Avis de securite", "Changement d'e-mail demande pour votre compte " + s,
        "Rien ne change tant que la nouvelle adresse n'est pas confirmee.", "Changement d'e-mail demande",
        List.of("Une demande de changement d'adresse e-mail a ete faite. Rien ne change tant que la nouvelle adresse "
                + "n'est pas confirmee.",
            "Si ce n'etait pas vous, reinitialisez votre mot de passe maintenant — cela annule aussi le changement en cours."),
        List.of(new Fact("Adresse demandee", maskedNewEmail)),
        maybeAction(appLink(b, "/settings/security"), "Voir les parametres de securite"), null, firstName));
  }

  public static TemplateParts emailChangedOldAddress(Brand b, String firstName, String maskedNewEmail) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Avis de securite", "Votre adresse e-mail " + s + " a ete modifiee",
        "Cette adresse ne permet plus de se connecter a votre compte.", "Adresse e-mail modifiee",
        List.of("L'adresse e-mail de votre compte a ete changee. Cette adresse ne recevra plus les messages du compte, "
            + "et toutes les sessions ont ete deconnectees."),
        List.of(new Fact("Nouvelle adresse", maskedNewEmail)), null,
        "Si vous n'avez pas fait ce changement, contactez immediatement votre administrateur " + s + " — les liens "
            + "de reinitialisation vont desormais vers la nouvelle adresse.",
        firstName));
  }

  public static TemplateParts emailChangedNewAddress(Brand b, String firstName) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Changement d'e-mail termine", "Votre adresse e-mail " + s + " est confirmee",
        "Cette adresse est desormais votre e-mail de connexion. Reconnectez-vous pour continuer.", "Nouvelle adresse e-mail confirmee",
        List.of("Cette adresse est desormais l'e-mail de connexion de votre compte. Pour votre securite, tous les "
            + "appareils ont ete deconnectes ; reconnectez-vous pour continuer."),
        null, maybeAction(appLink(b, "/login"), "Se connecter"), null, firstName));
  }

  public static TemplateParts passwordChanged(Brand b, String firstName, String via) {
    String s = shortName(b);
    boolean reset = "reset".equals(via);
    return build(b, message(Kind.SECURITY, "Avis de securite", "Votre mot de passe " + s + " a ete modifie",
        reset ? "Votre mot de passe a ete reinitialise et tous les appareils ont ete deconnectes."
            : "Votre mot de passe a ete change et les autres appareils ont ete deconnectes.",
        "Mot de passe modifie",
        List.of(reset
            ? "Le mot de passe de votre compte vient d'etre reinitialise via un lien e-mail. Tous les appareils ont "
                + "ete deconnectes et les liens de changement d'e-mail en cours ont ete annules."
            : "Le mot de passe de votre compte vient d'etre change. Les autres appareils ont ete deconnectes et les "
                + "liens de changement d'e-mail en cours ont ete annules."),
        null,
        reset ? maybeAction(appLink(b, "/login"), "Se connecter")
            : maybeAction(appLink(b, "/settings/sessions"), "Voir les sessions actives"),
        null, firstName));
  }

  public static TemplateParts accountLocked(Brand b, String firstName, int lockMinutes) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Avis de securite", "Connexion a " + s + " suspendue apres des echecs",
        "Les nouvelles connexions sont suspendues pendant " + lockMinutes + " minutes apres des echecs repetes.",
        "Connexion temporairement suspendue",
        List.of("Nous avons detecte des echecs de connexion repetes sur votre compte, aussi les nouvelles connexions "
                + "sont suspendues pendant " + lockMinutes + " minutes. Les appareils deja connectes ne sont pas affectes.",
            "Si ces tentatives n'etaient pas les votres, quelqu'un connait peut-etre votre adresse. Envisagez un "
                + "nouveau mot de passe unique et activez la verification en deux etapes."),
        null, maybeAction(appLink(b, "/forgot-password"), "Reinitialiser le mot de passe"), null, firstName));
  }

  public static TemplateParts sessionsRevoked(Brand b, String firstName, String scope) {
    String s = shortName(b);
    boolean all = "all".equals(scope);
    return build(b, message(Kind.SECURITY, "Avis de securite", "Appareils deconnectes de " + s,
        all ? "Tous les appareils ont ete deconnectes de votre compte." : "Tous les autres appareils ont ete deconnectes de votre compte.",
        "Appareils deconnectes",
        List.of(all
            ? "Tous les appareils, y compris celui utilise pour cette demande, ont ete deconnectes de votre compte."
            : "Tous les autres appareils ont ete deconnectes de votre compte. L'appareil utilise reste connecte."),
        null,
        all ? maybeAction(appLink(b, "/login"), "Se connecter")
            : maybeAction(appLink(b, "/settings/sessions"), "Voir les sessions actives"),
        null, firstName));
  }

  public static TemplateParts mfaEnabled(Brand b, String firstName) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Avis de securite", "Verification en deux etapes activee sur " + s,
        "Un code d'authentification est desormais requis a la connexion.", "Verification en deux etapes activee",
        List.of("La verification en deux etapes (application d'authentification) est desormais requise a la connexion. "
                + "Conservez vos codes de recuperation hors ligne en lieu sur.",
            "Les codes de recuperation ne s'affichent qu'une fois dans l'application et ne sont jamais envoyes par e-mail."),
        null, maybeAction(appLink(b, "/settings/security"), "Voir les parametres de securite"), null, firstName));
  }

  public static TemplateParts mfaDisabled(Brand b, String firstName) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Avis de securite", "Verification en deux etapes desactivee sur " + s,
        "Votre compte ne demande plus de code d'authentification a la connexion.", "Verification en deux etapes desactivee",
        List.of("La verification en deux etapes a ete desactivee pour votre compte et vos codes de recuperation ont "
            + "ete invalides. Les autres appareils ont ete deconnectes."),
        null, maybeAction(appLink(b, "/settings/security"), "Voir les parametres de securite"), null, firstName));
  }

  public static TemplateParts mfaRecoveryCodesRegenerated(Brand b, String firstName) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Avis de securite", "Nouveaux codes de recuperation " + s + " generes",
        "Vos precedents codes de recuperation de la verification en deux etapes ne fonctionnent plus.", "Codes de recuperation regeneres",
        List.of("Un nouvel ensemble de codes de recuperation a ete genere pour votre compte. Vos precedents codes "
                + "ne fonctionnent plus.",
            "Les codes de recuperation ne s'affichent qu'une fois dans l'application et ne sont jamais envoyes par e-mail."),
        null, maybeAction(appLink(b, "/settings/security"), "Voir les parametres de securite"), null, firstName));
  }

  public static TemplateParts accountDeactivated(Brand b, String firstName, boolean byAdministrator) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Statut du compte", "Votre compte " + s + " a ete desactive",
        "La connexion est desactivee et tous les appareils ont ete deconnectes.", "Compte desactive",
        List.of(byAdministrator
            ? "Un administrateur a desactive votre compte. La connexion est desactivee et tous les appareils ont ete deconnectes."
            : "Vous avez desactive votre compte. La connexion est desactivee et tous les appareils ont ete deconnectes. "
                + "La reactivation necessite un administrateur."),
        null, null, null, firstName));
  }

  public static TemplateParts accountSuspended(Brand b, String firstName) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Statut du compte", "Votre compte " + s + " a ete suspendu",
        "La connexion est desactivee et tous les appareils ont ete deconnectes.", "Compte suspendu",
        List.of("Un administrateur a suspendu votre compte. La connexion est desactivee et tous les appareils ont ete deconnectes."),
        null, null, null, firstName));
  }

  public static TemplateParts accountReactivated(Brand b, String firstName, boolean needsVerification) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Statut du compte", "Votre compte " + s + " a ete reactive",
        needsVerification ? "Confirmez votre adresse e-mail pour terminer la reactivation de votre compte."
            : "Vous pouvez vous reconnecter.",
        "Compte reactive",
        List.of(needsVerification
            ? "Un administrateur a reactive votre compte. Votre adresse e-mail n'est pas encore confirmee : demandez "
                + "un nouveau lien de verification avant de vous connecter."
            : "Un administrateur a reactive votre compte. Vous pouvez vous reconnecter."),
        null,
        needsVerification ? maybeAction(appLink(b, "/resend-verification"), "Demander un lien de verification")
            : maybeAction(appLink(b, "/login"), "Se connecter"),
        null, firstName));
  }

  public static TemplateParts accountDeletionScheduled(Brand b, String firstName) {
    String s = shortName(b);
    return build(b, message(Kind.SECURITY, "Statut du compte", "Votre compte " + s + " est programme pour suppression",
        "La connexion est desactivee et vos donnees personnelles ont ete retirees.", "Suppression de compte demandee",
        List.of("Vous avez demande la suppression de votre compte. La connexion est desactivee, tous les appareils "
                + "ont ete deconnectes, et votre nom et adresse e-mail ont ete retires du compte.",
            "Ceci est le dernier message que nous enverrons a cette adresse."),
        null, null, null, firstName));
  }

  public static TemplateParts accountExists(Brand b, String firstName) {
    String s = shortName(b);
    return build(b, message(Kind.REQUEST, "Tentative d'inscription", "Quelqu'un a tente de s'inscrire avec votre e-mail " + s,
        "Vous avez deja un compte, aucun nouveau compte n'a ete cree.", "Vous avez deja un compte",
        List.of("Quelqu'un a tente de creer un compte avec cette adresse e-mail, mais vous en avez deja un. Aucun "
                + "nouveau compte n'a ete cree.",
            "Si c'etait vous, connectez-vous plutot — ou utilisez « Mot de passe oublie » sur la page de connexion "
                + "si vous ne vous en souvenez plus."),
        null, maybeAction(appLink(b, "/login"), "Se connecter"), null, firstName));
  }

  /** Operator-triggered relay check; carries no account data. */
  public static TemplateParts smtpTest(Brand b) {
    String s = shortName(b);
    return build(b, message(Kind.INFO, "Controle de livraison", "Controle de livraison SMTP " + s,
        "Si vous pouvez lire ceci, le relais SMTP configure a livre un message dans cette boite.", "Controle de livraison SMTP",
        List.of("Ce message a ete envoye par un operateur pour confirmer que " + b.appName() + " peut livrer des "
                + "e-mails via son relais SMTP configure.",
            "Il ne contient aucune information de compte et ne necessite aucune action."),
        null, null, "Vous avez recu ceci parce qu'un operateur a saisi cette adresse comme destinataire du controle.",
        null));
  }

  public static String maskEmail(String email) {
    String[] parts = email.split("@", -1);
    String local = parts[0];
    String domain = parts.length > 1 ? parts[1] : "";
    if (local.isEmpty() || domain.isEmpty()) return "***";
    return local.substring(0, Math.min(2, local.length())) + "***@" + domain;
  }

  private static boolean isSet(String value) {
    return value != null && !value.isEmpty();
  }

  private static String stripTrailingSlash(String url) {
    return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
  }
}
