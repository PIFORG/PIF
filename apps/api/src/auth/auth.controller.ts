import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { CurrentUser, AuthRequestUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ChangeEmailConfirmDto,
  ChangeEmailRequestDto,
  ChangePasswordDto,
  DeleteAccountDto,
  DeactivateAccountDto,
  ForgotPasswordDto,
  LoginDto,
  MfaDisableDto,
  MfaEnableDto,
  MfaVerifyLoginDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  StepUpPasswordDto,
  UpdatePreferencesDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { serializePreferences } from '../common/serializers/user.serializer';
import { AccountThrottle } from '../common/throttling/account-throttle';
import { ApiDoc } from '../common/swagger/api-doc.decorator';
import { API_TAGS } from '../common/swagger/api-tags';

const REFRESH_COOKIE_NOTE =
  'The refresh token is stored in an HttpOnly cookie scoped to `/api/auth`; it is never returned in the response body.';

@Controller('auth')
@UseGuards(CsrfGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
  ) {}

  private setAuthCookies(
    res: Response,
    payload: { refreshToken: string; refreshExpiresAt: Date },
  ) {
    this.cookies.setRefreshCookie(res, payload.refreshToken, payload.refreshExpiresAt);
  }

  @Public()
  @ApiDoc(
    API_TAGS.authentication,
    'Create an account',
    'Emails a single-use verification link (`/verify-email?token=…`, default expiry 60 minutes). The response is identical whether or not the address is already registered.',
  )
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @AccountThrottle(3, 15 * 60_000)
  @HttpCode(201)
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, req);
  }

  @Public()
  @ApiDoc(
    API_TAGS.authentication,
    'Verify an email address',
    'Consumes the single-use token from the verification email. Opening the emailed link never verifies; only this POST does. Activates the account and sends a welcome email.',
  )
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    return this.auth.verifyEmail(dto, req);
  }

  @Public()
  @ApiDoc(
    API_TAGS.authentication,
    'Resend the verification email',
    'Issues a new link only for unverified accounts, at most once per cooldown (default 60 seconds); the new link replaces older ones. The response never reveals whether the address exists.',
  )
  @Post('resend-verification')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @AccountThrottle(3, 15 * 60_000)
  @HttpCode(200)
  resendVerification(@Body() dto: ResendVerificationDto, @Req() req: Request) {
    return this.auth.resendVerification(dto, req);
  }

  @Public()
  @ApiDoc(
    API_TAGS.authentication,
    'Sign in',
    'Returns a short-lived access token for the **Authorize** button. ' +
      REFRESH_COOKIE_NOTE +
      ' When two-step verification is enabled, the response has `mfaRequired: true`; finish with `POST /auth/mfa/verify-login`.',
  )
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @AccountThrottle(20, 15 * 60_000)
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, req);
    if ('refreshToken' in result && result.refreshToken) {
      this.setAuthCookies(res, {
        refreshToken: result.refreshToken,
        refreshExpiresAt: result.refreshExpiresAt!,
      });
      const { refreshToken: _r, refreshExpiresAt: _e, ...publicResult } = result;
      res.setHeader('Cache-Control', 'no-store');
      return publicResult;
    }
    res.setHeader('Cache-Control', 'no-store');
    return result;
  }

  @Public()
  @ApiDoc(
    API_TAGS.mfa,
    'Complete sign-in with a verification code',
    'Accepts an authenticator code or a recovery code and returns the access token. ' + REFRESH_COOKIE_NOTE,
  )
  @Post('mfa/verify-login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  async verifyMfaLogin(
    @Body() dto: MfaVerifyLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyMfaLogin(dto, req);
    this.setAuthCookies(res, {
      refreshToken: result.refreshToken,
      refreshExpiresAt: result.refreshExpiresAt,
    });
    const { refreshToken: _r, refreshExpiresAt: _e, ...publicResult } = result;
    res.setHeader('Cache-Control', 'no-store');
    return publicResult;
  }

  @Public()
  @ApiDoc(
    API_TAGS.authentication,
    'Refresh the access token',
    'Uses the refresh cookie (no request body) and rotates it. Requests must come from an allowed origin. ' +
      'Presenting an already-rotated token revokes the session.',
  )
  @ApiUnauthorizedResponse({
    description:
      'Refresh cookie missing, invalid, expired, superseded or reused (`REFRESH_MISSING`, `REFRESH_INVALID`, ' +
      '`REFRESH_EXPIRED`, `REFRESH_SUPERSEDED`, `REFRESH_REUSE_DETECTED`)',
  })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[this.cookies.name()] as string | undefined;
    try {
      const result = await this.auth.refresh(raw, req);
      this.setAuthCookies(res, {
        refreshToken: result.refreshToken,
        refreshExpiresAt: result.refreshExpiresAt,
      });
      const { refreshToken: _r, refreshExpiresAt: _e, ...publicResult } = result;
      res.setHeader('Cache-Control', 'no-store');
      return publicResult;
    } catch (err) {
      // A superseded token means a concurrent request already set the replacement
      // cookie; clearing here could overwrite it and sign the browser out.
      const body = err instanceof HttpException ? err.getResponse() : null;
      const errorCode =
        body && typeof body === 'object' ? (body as { errorCode?: string }).errorCode : undefined;
      if (errorCode !== 'REFRESH_SUPERSEDED') {
        this.cookies.clearRefreshCookie(res);
      }
      throw err;
    }
  }

  @Public()
  @ApiDoc(
    API_TAGS.authentication,
    'Sign out',
    'Revokes the current session identified by the refresh cookie or access token, and clears the cookie.',
  )
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[this.cookies.name()] as string | undefined;
    const authorization = req.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
    const result = await this.auth.logout(raw, bearer, req);
    this.cookies.clearRefreshCookie(res);
    res.setHeader('Cache-Control', 'no-store');
    return result;
  }

  @Public()
  @ApiDoc(
    API_TAGS.authentication,
    'Request a password reset',
    'Emails a single-use reset link (default expiry 30 minutes) to verified, active accounts, at most once per cooldown. The response is identical whether or not an account exists for the address.',
  )
  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @AccountThrottle(3, 15 * 60_000)
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.auth.forgotPassword(dto, req);
  }

  @Public()
  @ApiDoc(
    API_TAGS.authentication,
    'Reset the password',
    'Consumes the emailed reset token, signs out every session, cancels pending email changes and sends a password-changed notice.',
  )
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto, req);
  }

  @ApiBearerAuth()
  @ApiDoc(
    API_TAGS.accountSecurity,
    'Change the password',
    'Requires the current password. Every existing session is signed out; this device continues on a new session with a fresh refresh cookie. Sends a password-changed notice.',
  )
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(user, dto, req);
    this.setAuthCookies(res, {
      refreshToken: result.refreshToken,
      refreshExpiresAt: result.refreshExpiresAt,
    });
    const { refreshToken: _r, refreshExpiresAt: _e, sessionId: _s, ...publicResult } = result;
    res.setHeader('Cache-Control', 'no-store');
    return publicResult;
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.userManagement, 'Get the signed-in user')
  @Get('me')
  me(@CurrentUser() user: AuthRequestUser) {
    return this.auth.me(user);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.userManagement, 'Update the profile')
  @Patch('me')
  updateMe(@CurrentUser() user: AuthRequestUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.userManagement, 'Get preferences', 'Same data as `GET /users/me/preferences`.')
  @Get('me/preferences')
  async getMyPreferences(@CurrentUser() user: AuthRequestUser) {
    return serializePreferences(await this.auth.getPreferences(user));
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.userManagement, 'Update preferences', 'Same behaviour as `PATCH /users/me/preferences`.')
  @Patch('me/preferences')
  async updateMyPreferences(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return serializePreferences(await this.auth.updatePreferences(user, dto));
  }

  @ApiBearerAuth()
  @ApiDoc(
    API_TAGS.accountSecurity,
    'Request an email address change',
    'Sends a confirmation link to the new address and a notice to the current one.',
  )
  @Post('change-email/request')
  @HttpCode(200)
  requestEmailChange(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: ChangeEmailRequestDto,
    @Req() req: Request,
  ) {
    return this.auth.requestEmailChange(user, dto, req);
  }

  @Public()
  @ApiDoc(
    API_TAGS.accountSecurity,
    'Confirm an email address change',
    'Consumes the token sent to the new address, signs out every session and notifies both the old and the new address.',
  )
  @Post('change-email/confirm')
  @HttpCode(200)
  confirmEmailChange(@Body() dto: ChangeEmailConfirmDto, @Req() req: Request) {
    return this.auth.confirmEmailChange(dto, req);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.sessions, 'List active sessions')
  @Get('sessions')
  listSessions(@CurrentUser() user: AuthRequestUser) {
    return this.auth.listSessions(user);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.sessions, 'Revoke one of your sessions')
  @Delete('sessions/:id')
  revokeSession(
    @CurrentUser() user: AuthRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.auth.revokeSessionOwned(user, id, req);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.sessions, 'Sign out everywhere', 'Revokes every session, including this one, and clears the refresh cookie.')
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentUser() user: AuthRequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.logoutAll(user, req);
    this.cookies.clearRefreshCookie(res);
    return result;
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.sessions, 'Sign out other sessions', 'Requires the current password. Keeps this session active.')
  @Delete('sessions')
  revokeOtherSessions(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: StepUpPasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.revokeOtherSessions(user, dto, req);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.mfa, 'Start authenticator enrollment', 'Requires reauthentication. Returns the secret and an `otpauth://` URI for the authenticator app.')
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: StepUpPasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.mfaSetup(user, dto, req);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.mfa, 'Enable two-step verification', 'Confirms enrollment with a code and returns one-time recovery codes.')
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: MfaEnableDto,
    @Req() req: Request,
  ) {
    return this.auth.mfaEnable(user, dto, req);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.mfa, 'Disable two-step verification', 'Requires the current password and an authenticator or recovery code.')
  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: MfaDisableDto,
    @Req() req: Request,
  ) {
    return this.auth.mfaDisable(user, dto, req);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.mfa, 'Regenerate recovery codes', 'Requires reauthentication. Previous recovery codes stop working. Sends a notice email; codes are never emailed.')
  @Post('mfa/recovery-codes/regenerate')
  @HttpCode(200)
  mfaRegenerate(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: StepUpPasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.mfaRegenerateRecovery(user, dto, req);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.mfa, 'Get two-step verification status')
  @Get('mfa/status')
  mfaStatus(@CurrentUser() user: AuthRequestUser) {
    return this.auth.mfaStatus(user);
  }

  @ApiBearerAuth()
  @ApiDoc(API_TAGS.userManagement, 'Deactivate the account', 'Requires reauthentication. Signs out every session.')
  @Post('me/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: DeactivateAccountDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Only clear the cookie once reauthentication succeeded and sessions were revoked.
    const result = await this.auth.deactivate(user, dto, req);
    this.cookies.clearRefreshCookie(res);
    return result;
  }

  @ApiBearerAuth()
  @ApiDoc(
    API_TAGS.userManagement,
    'Request account deletion',
    'Requires reauthentication. Signs out every session; the account is scheduled for deletion.',
  )
  @Delete('me')
  async deleteMe(
    @CurrentUser() user: AuthRequestUser,
    @Body() dto: DeleteAccountDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.deleteAccount(user, dto, req);
    this.cookies.clearRefreshCookie(res);
    return result;
  }
}
