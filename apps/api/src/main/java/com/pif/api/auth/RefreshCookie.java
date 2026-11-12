package com.pif.api.auth;

import com.pif.api.config.PifProperties;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import org.springframework.stereotype.Component;

/**
 * The HttpOnly refresh cookie, serialized exactly as Express res.cookie / res.clearCookie
 * (attribute order: Domain, Path, Expires, HttpOnly, Secure, SameSite).
 */
@Component
public class RefreshCookie {

  private static final DateTimeFormatter HTTP_DATE =
      DateTimeFormatter.ofPattern("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.ENGLISH).withZone(ZoneOffset.UTC);

  private final PifProperties props;

  public RefreshCookie(PifProperties props) {
    this.props = props;
  }

  public String name() {
    return props.cookieName();
  }

  public void set(HttpServletResponse res, String value, Instant expiresAt) {
    res.addHeader("Set-Cookie", serialize(value, expiresAt));
  }

  public void clear(HttpServletResponse res) {
    res.addHeader("Set-Cookie", serialize("", Instant.EPOCH));
  }

  String serialize(String value, Instant expiresAt) {
    StringBuilder sb = new StringBuilder(props.cookieName()).append('=').append(value);
    if (props.cookieDomain() != null) sb.append("; Domain=").append(props.cookieDomain());
    sb.append("; Path=").append(props.cookiePath());
    sb.append("; Expires=").append(HTTP_DATE.format(expiresAt));
    sb.append("; HttpOnly");
    if (props.cookieSecure()) sb.append("; Secure");
    String sameSite = props.cookieSameSite();
    if (sameSite != null && !sameSite.isEmpty()) {
      sb.append("; SameSite=").append(Character.toUpperCase(sameSite.charAt(0))).append(sameSite.substring(1).toLowerCase());
    }
    return sb.toString();
  }
}
