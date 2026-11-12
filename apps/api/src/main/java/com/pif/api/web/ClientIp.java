package com.pif.api.web;

import com.pif.api.config.PifProperties;
import com.pif.api.crypto.TokenCrypto;
import jakarta.servlet.http.HttpServletRequest;

/** Express req.ip: the socket address, or the left-most X-Forwarded-For entry when TRUST_PROXY=true. */
public final class ClientIp {

  private ClientIp() {}

  public static String of(HttpServletRequest req, PifProperties props) {
    if (props.trustProxy()) {
      String forwarded = req.getHeader("X-Forwarded-For");
      if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",")[0].strip();
    }
    return TokenCrypto.nodeStyleAddress(req.getRemoteAddr());
  }
}
