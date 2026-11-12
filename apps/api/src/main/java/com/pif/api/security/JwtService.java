package com.pif.api.security;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.pif.api.config.PifProperties;
import java.text.ParseException;
import java.time.Instant;
import java.util.Date;
import org.springframework.stereotype.Component;

/**
 * HS256 access tokens interchangeable with the NestJS API (legacy-NestJS-DTO-parity + passport-jwt):
 * claims {sub, sid, sv, iat, exp, iss, aud}, same secret, issuer and audience, no clock tolerance.
 */
@Component
public class JwtService {

  public record AccessClaims(String sub, String sid, Integer sv) {}

  private final PifProperties props;
  private final MACSigner signer;
  private final MACVerifier verifier;

  public JwtService(PifProperties props) throws JOSEException {
    this.props = props;
    byte[] secret = props.jwtAccessSecret();
    this.signer = new MACSigner(secret);
    this.verifier = new MACVerifier(secret);
  }

  public String sign(String userId, String sessionId, int securityVersion, Instant now) {
    long iat = now.getEpochSecond();
    JWTClaimsSet claims = new JWTClaimsSet.Builder()
        .subject(userId)
        .claim("sid", sessionId)
        .claim("sv", securityVersion)
        .issueTime(Date.from(Instant.ofEpochSecond(iat)))
        .expirationTime(Date.from(Instant.ofEpochSecond(iat + props.jwtAccessExpiresIn().toSeconds())))
        .issuer(props.jwtIssuer())
        .audience(props.jwtAudience())
        .build();
    SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).build(), claims);
    try {
      jwt.sign(signer);
    } catch (JOSEException e) {
      throw new IllegalStateException("Access token signing failed", e);
    }
    return jwt.serialize();
  }

  /** Returns the claims of a valid token, or null for any signature, algorithm, issuer, audience or expiry failure. */
  public AccessClaims verify(String token, Instant now) {
    try {
      SignedJWT jwt = SignedJWT.parse(token);
      if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm())) return null;
      if (!jwt.verify(verifier)) return null;
      JWTClaimsSet claims = jwt.getJWTClaimsSet();
      Date exp = claims.getExpirationTime();
      if (exp == null || !now.isBefore(exp.toInstant())) return null;
      Date nbf = claims.getNotBeforeTime();
      if (nbf != null && now.isBefore(nbf.toInstant())) return null;
      if (!props.jwtIssuer().equals(claims.getIssuer())) return null;
      if (claims.getAudience() == null || !claims.getAudience().contains(props.jwtAudience())) return null;
      Object sv = claims.getClaim("sv");
      Object sid = claims.getClaim("sid");
      return new AccessClaims(
          claims.getSubject(),
          sid instanceof String s ? s : null,
          sv instanceof Number n ? n.intValue() : null);
    } catch (ParseException | JOSEException | IllegalStateException e) {
      return null;
    }
  }
}
