package com.pif.api.auth;

import com.pif.api.config.PifProperties;
import com.pif.api.crypto.TokenCrypto;
import com.pif.api.security.AuthUser;
import com.pif.api.web.ApiException;
import com.pif.api.web.ClientIp;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.RequestFilters;
import com.pif.api.web.RouteAnnotations.AccountThrottle;
import com.pif.api.web.RouteAnnotations.CsrfProtected;
import com.pif.api.web.RouteAnnotations.Public;
import com.pif.api.web.RouteAnnotations.Throttle;
import com.pif.api.web.ApiDocs;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import com.pif.api.web.PathParams;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** Routes of apps/api/src/auth/auth.controller.ts. */
@RestController
@RequestMapping("/auth")
@CsrfProtected
@Tag(name = "Authentication")
public class AuthController {

  private static final String REFRESH_COOKIE_NOTE = "The refresh token is stored in an HttpOnly cookie scoped to "
      + "`/api/auth`; it is never returned in the response body.";
  private static final String MFA = "Multi-Factor Authentication";
  private static final String USERS = "User Management";
  private static final String ACCOUNT_SECURITY = "Account Security";
  private static final String SESSIONS = "Sessions";

  private final AuthService auth;
  private final AccountService accounts;
  private final SecurityService security;
  private final RefreshCookie cookie;
  private final PifProperties props;
  private final ObjectMapper mapper;

  public AuthController(AuthService auth, AccountService accounts, SecurityService security, RefreshCookie cookie,
      PifProperties props, ObjectMapper mapper) {
    this.auth = auth;
    this.accounts = accounts;
    this.security = security;
    this.cookie = cookie;
    this.props = props;
    this.mapper = mapper;
  }

  @Public
  @Throttle(limit = 10, ttlSeconds = 60)
  @AccountThrottle(limit = 20, ttlSeconds = 15 * 60)
  @PostMapping("/login")
  @Operation(summary = "Sign in", description = "Returns a short-lived access token for the **Authorize** button. "
      + REFRESH_COOKIE_NOTE + " When two-step verification is enabled, the response has `mfaRequired: true`; finish "
      + "with `POST /auth/mfa/verify-login`.")
  @ApiDocs.Body("LoginDto")
  public Map<String, Object> login(HttpServletRequest req, HttpServletResponse res) {
    AuthDtos.Login dto = AuthDtos.login(JsonBodyCache.get(req, mapper));
    AuthService.LoginResult result = auth.login(dto.email(), dto.password(), meta(req));
    res.setHeader("Cache-Control", "no-store");
    Map<String, Object> body = new LinkedHashMap<>();
    switch (result) {
      case AuthService.MfaChallenge challenge -> {
        body.put("mfaRequired", true);
        body.put("mfaChallengeToken", challenge.mfaChallengeToken());
        body.put("errorCode", null);
      }
      case AuthService.SignedIn signedIn -> {
        cookie.set(res, signedIn.session().refreshToken(), signedIn.session().refreshExpiresAt());
        body.put("mfaRequired", false);
        body.put("accessToken", signedIn.session().accessToken());
        body.put("user", signedIn.session().user());
      }
    }
    return body;
  }

  @Public
  @Throttle(limit = 5, ttlSeconds = 60)
  @PostMapping("/mfa/verify-login")
  @Tag(name = MFA)
  @Operation(summary = "Complete sign-in with a verification code", description = "Accepts an authenticator code or "
      + "a recovery code and returns the access token. " + REFRESH_COOKIE_NOTE)
  @ApiDocs.Body("MfaVerifyLoginDto")
  public Map<String, Object> verifyMfaLogin(HttpServletRequest req, HttpServletResponse res) {
    AuthDtos.MfaVerifyLogin dto = AuthDtos.mfaVerifyLogin(JsonBodyCache.get(req, mapper));
    AuthService.IssuedSession session =
        auth.verifyMfaLogin(dto.mfaChallengeToken(), dto.totpCode(), dto.recoveryCode(), meta(req));
    cookie.set(res, session.refreshToken(), session.refreshExpiresAt());
    res.setHeader("Cache-Control", "no-store");
    return tokens(session);
  }

  @Public
  @PostMapping("/refresh")
  @Operation(summary = "Refresh the access token", description = "Uses the refresh cookie (no request body) and "
      + "rotates it. Requests must come from an allowed origin. Presenting an already-rotated token revokes the "
      + "session.")
  @ApiResponse(responseCode = "200", description = "A new access token; the rotated refresh cookie is set")
  @ApiResponse(responseCode = "401", description = "Refresh cookie missing, invalid, expired, superseded or reused "
      + "(`REFRESH_MISSING`, `REFRESH_INVALID`, `REFRESH_EXPIRED`, `REFRESH_SUPERSEDED`, `REFRESH_REUSE_DETECTED`)")
  public Map<String, Object> refresh(HttpServletRequest req, HttpServletResponse res) {
    try {
      AuthService.IssuedSession session = auth.refresh(cookieValue(req), meta(req));
      cookie.set(res, session.refreshToken(), session.refreshExpiresAt());
      res.setHeader("Cache-Control", "no-store");
      return tokens(session);
    } catch (ApiException e) {
      // A superseded token means a concurrent request already set the replacement cookie.
      if (!"REFRESH_SUPERSEDED".equals(e.errorCode())) cookie.clear(res);
      throw e;
    }
  }

  @Public
  @PostMapping("/logout")
  @Operation(summary = "Sign out", description = "Revokes the current session identified by the refresh cookie or "
      + "access token, and clears the cookie.")
  public Map<String, Object> logout(HttpServletRequest req, HttpServletResponse res) {
    String authorization = req.getHeader("Authorization");
    String bearer = authorization != null && authorization.startsWith("Bearer ")
        ? authorization.substring(7).strip() : null;
    Map<String, Object> result = auth.logout(cookieValue(req), bearer, meta(req));
    cookie.clear(res);
    res.setHeader("Cache-Control", "no-store");
    return result;
  }

  @GetMapping("/me")
  @Tag(name = USERS)
  @Operation(summary = "Get the signed-in user")
  public Map<String, Object> me(HttpServletRequest req) {
    return auth.me(AuthUser.from(req).id());
  }

  @PatchMapping("/me")
  @Tag(name = USERS)
  @Operation(summary = "Update the profile")
  @ApiDocs.Body("UpdateProfileDto")
  public Map<String, Object> updateMe(HttpServletRequest req) {
    AuthDtos.UpdateProfile dto = AuthDtos.updateProfile(JsonBodyCache.get(req, mapper));
    return auth.updateProfile(AuthUser.from(req), dto.firstName(), dto.lastName(), dto.experienceLevel());
  }

  @GetMapping("/me/preferences")
  @Tag(name = USERS)
  @Operation(summary = "Get preferences", description = "Same data as `GET /users/me/preferences`.")
  public Map<String, Object> getMyPreferences(HttpServletRequest req) {
    return auth.getPreferences(AuthUser.from(req)).toJson();
  }

  @PatchMapping("/me/preferences")
  @Tag(name = USERS)
  @Operation(summary = "Update preferences", description = "Same behaviour as `PATCH /users/me/preferences`.")
  @ApiDocs.Body("UpdatePreferencesDto")
  public Map<String, Object> updateMyPreferences(HttpServletRequest req) {
    return auth.updatePreferences(AuthUser.from(req), AuthDtos.updatePreferences(JsonBodyCache.get(req, mapper)))
        .toJson();
  }

  // ---------- registration and recovery ----------

  @Public
  @Throttle(limit = 10, ttlSeconds = 60)
  @AccountThrottle(limit = 3, ttlSeconds = 15 * 60)
  @PostMapping("/register")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "Create an account", description = "Emails a single-use verification link "
      + "(`/verify-email?token=…`, default expiry 60 minutes). The response is identical whether or not the address "
      + "is already registered.")
  @ApiDocs.Body("RegisterDto")
  public Map<String, Object> register(HttpServletRequest req) {
    return accounts.register(AuthDtos.register(JsonBodyCache.get(req, mapper)), meta(req));
  }

  @Public
  @PostMapping("/verify-email")
  @Operation(summary = "Verify an email address", description = "Consumes the single-use token from the "
      + "verification email. Opening the emailed link never verifies; only this POST does. Activates the account and "
      + "sends a welcome email.")
  @ApiDocs.Body("VerifyEmailDto")
  public Map<String, Object> verifyEmail(HttpServletRequest req) {
    return accounts.verifyEmail(AuthDtos.verifyEmailToken(JsonBodyCache.get(req, mapper)), meta(req));
  }

  @Public
  @Throttle(limit = 5, ttlSeconds = 60)
  @AccountThrottle(limit = 3, ttlSeconds = 15 * 60)
  @PostMapping("/resend-verification")
  @Operation(summary = "Resend the verification email", description = "Issues a new link only for unverified "
      + "accounts, at most once per cooldown (default 60 seconds); the new link replaces older ones. The response never "
      + "reveals whether the address exists.")
  @ApiDocs.Body("ResendVerificationDto")
  public Map<String, Object> resendVerification(HttpServletRequest req) {
    return accounts.resendVerification(AuthDtos.emailOnly(JsonBodyCache.get(req, mapper)), meta(req));
  }

  @Public
  @Throttle(limit = 5, ttlSeconds = 60)
  @AccountThrottle(limit = 3, ttlSeconds = 15 * 60)
  @PostMapping("/forgot-password")
  @Operation(summary = "Request a password reset", description = "Emails a single-use reset link (default expiry "
      + "30 minutes) to verified, active accounts, at most once per cooldown. The response is identical whether or "
      + "not an account exists for the address.")
  @ApiDocs.Body("ForgotPasswordDto")
  public Map<String, Object> forgotPassword(HttpServletRequest req) {
    return accounts.forgotPassword(AuthDtos.emailOnly(JsonBodyCache.get(req, mapper)), meta(req));
  }

  @Public
  @PostMapping("/reset-password")
  @Operation(summary = "Reset the password", description = "Consumes the emailed reset token, signs out every "
      + "session, cancels pending email changes and sends a password-changed notice.")
  @ApiDocs.Body("ResetPasswordDto")
  public Map<String, Object> resetPassword(HttpServletRequest req) {
    return accounts.resetPassword(AuthDtos.resetPassword(JsonBodyCache.get(req, mapper)), meta(req));
  }

  @PostMapping("/change-password")
  @Tag(name = ACCOUNT_SECURITY)
  @Operation(summary = "Change the password", description = "Requires the current password. Every existing session "
      + "is signed out; this device continues on a new session with a fresh refresh cookie. Sends a password-changed "
      + "notice.")
  @ApiDocs.Body("ChangePasswordDto")
  public Map<String, Object> changePassword(HttpServletRequest req, HttpServletResponse res) {
    AuthService.IssuedSession session = accounts.changePassword(AuthUser.from(req),
        AuthDtos.changePassword(JsonBodyCache.get(req, mapper)), meta(req));
    cookie.set(res, session.refreshToken(), session.refreshExpiresAt());
    res.setHeader("Cache-Control", "no-store");
    return tokens(session);
  }

  // ---------- email change ----------

  @PostMapping("/change-email/request")
  @Tag(name = ACCOUNT_SECURITY)
  @Operation(summary = "Request an email address change", description = "Sends a confirmation link to the new "
      + "address and a notice to the current one.")
  @ApiDocs.Body("ChangeEmailRequestDto")
  public Map<String, Object> requestEmailChange(HttpServletRequest req) {
    return accounts.requestEmailChange(AuthUser.from(req), AuthDtos.changeEmailRequest(JsonBodyCache.get(req, mapper)),
        meta(req));
  }

  @Public
  @PostMapping("/change-email/confirm")
  @Tag(name = ACCOUNT_SECURITY)
  @Operation(summary = "Confirm an email address change", description = "Consumes the token sent to the new "
      + "address, signs out every session and notifies both the old and the new address.")
  @ApiDocs.Body("ChangeEmailConfirmDto")
  public Map<String, Object> confirmEmailChange(HttpServletRequest req) {
    return accounts.confirmEmailChange(AuthDtos.changeEmailConfirmToken(JsonBodyCache.get(req, mapper)), meta(req));
  }

  // ---------- sessions ----------

  @GetMapping("/sessions")
  @Tag(name = SESSIONS)
  @Operation(summary = "List active sessions")
  public List<Map<String, Object>> listSessions(HttpServletRequest req) {
    return security.listSessions(AuthUser.from(req));
  }

  @DeleteMapping("/sessions/{id}")
  @Tag(name = SESSIONS)
  @Operation(summary = "Revoke one of your sessions")
  public Map<String, Object> revokeSession(HttpServletRequest req, @PathVariable("id") String id) {
    return security.revokeSessionOwned(AuthUser.from(req), PathParams.uuid(id), meta(req));
  }

  @PostMapping("/logout-all")
  @Tag(name = SESSIONS)
  @Operation(summary = "Sign out everywhere", description = "Revokes every session, including this one, and clears "
      + "the refresh cookie.")
  public Map<String, Object> logoutAll(HttpServletRequest req, HttpServletResponse res) {
    Map<String, Object> result = security.logoutAll(AuthUser.from(req), meta(req));
    cookie.clear(res);
    return result;
  }

  @DeleteMapping("/sessions")
  @Tag(name = SESSIONS)
  @Operation(summary = "Sign out other sessions", description = "Requires the current password. Keeps this session "
      + "active.")
  @ApiDocs.Body("StepUpPasswordDto")
  public Map<String, Object> revokeOtherSessions(HttpServletRequest req) {
    return security.revokeOtherSessions(AuthUser.from(req), AuthDtos.stepUp(JsonBodyCache.get(req, mapper)),
        meta(req));
  }

  // ---------- two-step verification ----------

  @PostMapping("/mfa/setup")
  @Tag(name = MFA)
  @Operation(summary = "Start authenticator enrollment", description = "Requires reauthentication. Returns the "
      + "secret and an `otpauth://` URI for the authenticator app.")
  @ApiDocs.Body("StepUpPasswordDto")
  public Map<String, Object> mfaSetup(HttpServletRequest req) {
    return security.mfaSetup(AuthUser.from(req), AuthDtos.stepUp(JsonBodyCache.get(req, mapper)), meta(req));
  }

  @PostMapping("/mfa/enable")
  @Tag(name = MFA)
  @Operation(summary = "Enable two-step verification", description = "Confirms enrollment with a code and returns "
      + "one-time recovery codes.")
  @ApiDocs.Body("MfaEnableDto")
  public Map<String, Object> mfaEnable(HttpServletRequest req) {
    return security.mfaEnable(AuthUser.from(req), AuthDtos.mfaEnableCode(JsonBodyCache.get(req, mapper)), meta(req));
  }

  @PostMapping("/mfa/disable")
  @Tag(name = MFA)
  @Operation(summary = "Disable two-step verification", description = "Requires the current password and an "
      + "authenticator or recovery code.")
  @ApiDocs.Body("MfaDisableDto")
  public Map<String, Object> mfaDisable(HttpServletRequest req) {
    return security.mfaDisable(AuthUser.from(req), AuthDtos.mfaDisable(JsonBodyCache.get(req, mapper)), meta(req));
  }

  @PostMapping("/mfa/recovery-codes/regenerate")
  @Tag(name = MFA)
  @Operation(summary = "Regenerate recovery codes", description = "Requires reauthentication. Previous recovery "
      + "codes stop working. Sends a notice email; codes are never emailed.")
  @ApiDocs.Body("StepUpPasswordDto")
  public Map<String, Object> mfaRegenerate(HttpServletRequest req) {
    return security.mfaRegenerateRecovery(AuthUser.from(req), AuthDtos.stepUp(JsonBodyCache.get(req, mapper)),
        meta(req));
  }

  @GetMapping("/mfa/status")
  @Tag(name = MFA)
  @Operation(summary = "Get two-step verification status")
  public Map<String, Object> mfaStatus(HttpServletRequest req) {
    return security.mfaStatus(AuthUser.from(req));
  }

  // ---------- deactivation and deletion ----------

  @PostMapping("/me/deactivate")
  @Tag(name = USERS)
  @Operation(summary = "Deactivate the account", description = "Requires reauthentication. Signs out every session.")
  @ApiDocs.Body("DeactivateAccountDto")
  public Map<String, Object> deactivate(HttpServletRequest req, HttpServletResponse res) {
    Map<String, Object> result = accounts.deactivate(AuthUser.from(req),
        AuthDtos.confirmedStepUp(JsonBodyCache.get(req, mapper), "DEACTIVATE"), meta(req));
    // Only cleared once reauthentication succeeded and sessions were revoked.
    cookie.clear(res);
    return result;
  }

  @DeleteMapping("/me")
  @Tag(name = USERS)
  @Operation(summary = "Request account deletion", description = "Requires reauthentication. Signs out every "
      + "session; the account is scheduled for deletion.")
  @ApiDocs.Body("DeleteAccountDto")
  public Map<String, Object> deleteMe(HttpServletRequest req, HttpServletResponse res) {
    Map<String, Object> result = accounts.deleteAccount(AuthUser.from(req),
        AuthDtos.confirmedStepUp(JsonBodyCache.get(req, mapper), "DELETE"), meta(req));
    cookie.clear(res);
    return result;
  }

  private Map<String, Object> tokens(AuthService.IssuedSession session) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("accessToken", session.accessToken());
    body.put("user", session.user());
    return body;
  }

  private String cookieValue(HttpServletRequest req) {
    if (req.getCookies() == null) return null;
    for (Cookie c : req.getCookies()) {
      if (cookie.name().equals(c.getName())) return c.getValue();
    }
    return null;
  }

  private AuthService.ClientMeta meta(HttpServletRequest req) {
    return AuthService.ClientMeta.of(req, props);
  }
}
