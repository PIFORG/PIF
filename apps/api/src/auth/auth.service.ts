import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AuditOutcome,
  AuthTokenType,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { authenticator } from 'otplib';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { normalizeEmail } from '../common/crypto/email.util';
import { decryptMfaSecret, encryptMfaSecret } from '../common/crypto/mfa-crypto.util';
import {
  hashPassword,
  hashSecret,
  validatePasswordPolicy,
  verifyPassword,
  verifyPasswordOrDummy,
} from '../common/crypto/password.util';
import {
  addDuration,
  addMinutes,
  digestIp,
  generateOpaqueToken,
  hashOpaqueToken,
  sanitizeUserAgent,
} from '../common/crypto/token.util';
import { serializeUser } from '../common/serializers/user.serializer';
import { EmailService } from '../email/email.service';
import { maskEmail } from '../email/email.templates';
import { PrismaService } from '../prisma/prisma.service';
import { AuthRequestUser } from './decorators/current-user.decorator';
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

authenticator.options = { step: 30, window: 1 };

/**
 * DESIGN DECISION: window during which presenting a just-rotated refresh token is
 * treated as a benign concurrent-tab duplicate (no token issued, no session revoke)
 * rather than theft. Outside this window, reuse revokes the stable session.
 */
const REFRESH_REUSE_GRACE_MS = 15_000;

/**
 * Tokens that grant account access or ownership changes. All are revoked whenever the
 * password changes or is reset, so a recovered account cannot be re-taken via a pending
 * email-change link, MFA challenge or live refresh token.
 */
const CREDENTIAL_SENSITIVE_TOKEN_TYPES: AuthTokenType[] = [
  AuthTokenType.PASSWORD_RESET,
  AuthTokenType.EMAIL_CHANGE,
  AuthTokenType.MFA_LOGIN_CHALLENGE,
  AuthTokenType.REFRESH_TOKEN,
];

/** DESIGN DECISION: at most one "account already exists" notice per address per 15 minutes. */
const ACCOUNT_EXISTS_NOTICE_COOLDOWN_MS = 15 * 60_000;

/** DESIGN DECISION: an unconfirmed authenticator enrollment is discarded after 10 minutes. */
const MFA_PENDING_SETUP_TTL_MINUTES = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  private pepper(): string {
    return this.config.getOrThrow<string>('auth.tokenPepper');
  }

  private mfaKey(): string {
    return this.config.getOrThrow<string>('mfa.encryptionKey');
  }

  private correlationId(req?: Request): string | undefined {
    return (req as Request & { correlationId?: string })?.correlationId;
  }

  private clientMeta(req?: Request) {
    // req.ip honours X-Forwarded-For only for proxies trusted via TRUST_PROXY.
    const ip = req?.ip || req?.socket?.remoteAddress;
    return {
      userAgent: sanitizeUserAgent(req?.headers['user-agent']),
      ipDigest: digestIp(ip, this.config.getOrThrow<string>('auth.ipHashPepper')),
    };
  }

  private genericMessage(message: string) {
    return { message, errorCode: null as string | null };
  }

  private signAccessToken(user: User, sessionId: string): string {
    return this.jwt.sign({
      sub: user.id,
      sid: sessionId,
      sv: user.securityVersion,
    });
  }

  private async createSessionWithRefresh(user: User, req?: Request) {
    const refreshExpires = addDuration(
      new Date(),
      this.config.get<string>('jwt.refreshExpiresIn') ?? '7d',
    );
    const meta = this.clientMeta(req);
    const rawRefresh = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(rawRefresh, this.pepper());

    const maxSessions = this.config.get<number>('auth.maxSessions') ?? 8;

    const { session: result, evicted } = await this.prisma.$transaction(async (tx) => {
      // Oldest first, id as tie-break, so eviction is deterministic.
      const active = await tx.authSession.findMany({
        where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      let evictedIds: string[] = [];
      if (active.length >= maxSessions) {
        evictedIds = active.slice(0, active.length - maxSessions + 1).map((s) => s.id);
        await tx.authSession.updateMany({
          where: { id: { in: evictedIds } },
          data: { revokedAt: new Date(), revokedReason: 'SESSION_LIMIT' },
        });
        await tx.authToken.updateMany({
          where: {
            sessionId: { in: evictedIds },
            type: AuthTokenType.REFRESH_TOKEN,
            revokedAt: null,
            usedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }

      const session = await tx.authSession.create({
        data: {
          userId: user.id,
          expiresAt: refreshExpires,
          userAgent: meta.userAgent,
          ipDigest: meta.ipDigest,
          deviceLabel: meta.userAgent?.slice(0, 80) ?? null,
        },
      });

      await tx.authToken.create({
        data: {
          userId: user.id,
          sessionId: session.id,
          type: AuthTokenType.REFRESH_TOKEN,
          tokenHash,
          expiresAt: refreshExpires,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), lastActiveAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });

      return { session, evicted: evictedIds };
    });

    if (evicted.length > 0) {
      await this.audit.record({
        eventType: 'SESSION_LIMIT_REVOKED',
        outcome: AuditOutcome.SUCCESS,
        subjectUserId: user.id,
        correlationId: this.correlationId(req),
        context: { revokedSessionIds: evicted, maxSessions },
      });
    }

    const accessToken = this.signAccessToken(user, result.id);
    const full = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { preferences: true },
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      refreshExpiresAt: refreshExpires,
      user: serializeUser(full),
      sessionId: result.id,
    };
  }

  private async issueSingleUseToken(
    userId: string,
    type: AuthTokenType,
    expiresAt: Date,
    extra?: { pendingEmail?: string; sessionId?: string },
  ) {
    const raw = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(raw, this.pepper());
    await this.prisma.$transaction(async (tx) => {
      await tx.authToken.updateMany({
        where: { userId, type, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.authToken.create({
        data: {
          userId,
          type,
          tokenHash,
          expiresAt,
          pendingEmail: extra?.pendingEmail,
          sessionId: extra?.sessionId,
        },
      });
    });
    return raw;
  }

  private invalidTokenError() {
    return new BadRequestException({
      message: 'This link is invalid, has expired or was already used',
      errorCode: 'TOKEN_INVALID',
    });
  }

  /** Read-only validity check, used to avoid expensive work (Argon2) for bogus tokens. */
  private async peekToken(raw: string, type: AuthTokenType) {
    const token = await this.prisma.authToken.findFirst({
      where: {
        tokenHash: hashOpaqueToken(raw, this.pepper()),
        type,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (!token) throw this.invalidTokenError();
    return token;
  }

  /**
   * Atomically claims a single-use token (conditional update + affected-row check).
   * Pass `tx` so the claim commits or rolls back together with its effects.
   */
  private async consumeToken(
    raw: string,
    type: AuthTokenType,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<{ id: string; userId: string; pendingEmail: string | null; sessionId: string | null }> {
    const tokenHash = hashOpaqueToken(raw, this.pepper());
    const now = new Date();
    const updated = await tx.authToken.updateMany({
      where: {
        tokenHash,
        type,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (updated.count !== 1) {
      throw this.invalidTokenError();
    }
    const token = await tx.authToken.findUniqueOrThrow({ where: { tokenHash } });
    return {
      id: token.id,
      userId: token.userId,
      pendingEmail: token.pendingEmail,
      sessionId: token.sessionId,
    };
  }

  /** Revokes every outstanding credential-bearing token after a credential/ownership change. */
  private async revokeOutstandingTokens(
    tx: Prisma.TransactionClient,
    userId: string,
    types: AuthTokenType[] = CREDENTIAL_SENSITIVE_TOKEN_TYPES,
  ) {
    await tx.authToken.updateMany({
      where: { userId, type: { in: types }, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async register(dto: RegisterDto, req?: Request) {
    if (dto.passwordConfirmation != null && dto.passwordConfirmation !== dto.password) {
      throw new BadRequestException({
        message: 'Password confirmation does not match',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    const email = normalizeEmail(dto.email);
    const policy = validatePasswordPolicy(dto.password);
    if (!policy.valid) {
      throw new BadRequestException({
        message: policy.errors.join('; '),
        errorCode: 'VALIDATION_ERROR',
      });
    }

    // Hash before the lookup so new and already-registered addresses cost the same
    // Argon2 work and response timing does not reveal account existence.
    const passwordHash = await hashPassword(dto.password);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    const generic = this.genericMessage(
      'If this email can be registered, you will receive a verification message shortly.',
    );

    if (existing) {
      if (existing.emailVerified && existing.status === UserStatus.ACTIVE && !existing.deletedAt) {
        await this.maybeSendAccountExistsNotice(existing, req);
      } else if (existing.status === UserStatus.PENDING_VERIFICATION) {
        await this.maybeSendVerification(existing);
      }
      await this.audit.record({
        eventType: 'REGISTER_DUPLICATE',
        outcome: AuditOutcome.SUCCESS,
        subjectUserId: existing.id,
        correlationId: this.correlationId(req),
      });
      return generic;
    }

    const expiresMinutes =
      this.config.get<number>('auth.emailVerificationExpiresMinutes') ?? 60;

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          passwordHash,
          role: UserRole.INVESTOR,
          status: UserStatus.PENDING_VERIFICATION,
          preferences: { create: {} },
        },
      });

      const raw = await this.issueSingleUseToken(
        user.id,
        AuthTokenType.EMAIL_VERIFICATION,
        addMinutes(new Date(), expiresMinutes),
      );
      void this.email.sendVerification(user.email, user.firstName, raw, expiresMinutes);

      await this.audit.record({
        eventType: 'REGISTER',
        outcome: AuditOutcome.SUCCESS,
        subjectUserId: user.id,
        correlationId: this.correlationId(req),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return generic;
      }
      throw err;
    }

    return generic;
  }

  private async maybeSendAccountExistsNotice(user: User, req?: Request): Promise<void> {
    const recent = await this.prisma.auditEvent.findFirst({
      where: {
        eventType: 'ACCOUNT_EXISTS_NOTICE',
        subjectUserId: user.id,
        createdAt: { gt: new Date(Date.now() - ACCOUNT_EXISTS_NOTICE_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) return;
    await this.audit.record({
      eventType: 'ACCOUNT_EXISTS_NOTICE',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
    });
    void this.email.sendAccountExists(user.email, user.firstName);
  }

  /** Verification links are only ever issued to accounts still awaiting verification. */
  private async maybeSendVerification(user: User): Promise<void> {
    if (user.status !== UserStatus.PENDING_VERIFICATION || user.emailVerified || user.deletedAt) {
      return;
    }
    const cooldown = this.config.get<number>('auth.emailCooldownSeconds') ?? 60;
    const recent = await this.prisma.authToken.findFirst({
      where: {
        userId: user.id,
        type: AuthTokenType.EMAIL_VERIFICATION,
        createdAt: { gt: new Date(Date.now() - cooldown * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return;
    const expiresMinutes =
      this.config.get<number>('auth.emailVerificationExpiresMinutes') ?? 60;
    const raw = await this.issueSingleUseToken(
      user.id,
      AuthTokenType.EMAIL_VERIFICATION,
      addMinutes(new Date(), expiresMinutes),
    );
    void this.email.sendVerification(user.email, user.firstName, raw, expiresMinutes);
  }

  async verifyEmail(dto: VerifyEmailDto, req?: Request) {
    const consumed = await this.prisma.$transaction(async (tx) => {
      const token = await this.consumeToken(dto.token, AuthTokenType.EMAIL_VERIFICATION, tx);
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (user.deletedAt || user.status === UserStatus.PENDING_DELETION) {
        throw this.invalidTokenError();
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          // Verification only completes registration; it never lifts a suspension or
          // deactivation imposed after the link was issued.
          ...(user.status === UserStatus.PENDING_VERIFICATION ? { status: UserStatus.ACTIVE } : {}),
        },
      });
      await this.revokeOutstandingTokens(tx, user.id, [AuthTokenType.EMAIL_VERIFICATION]);
      return {
        userId: token.userId,
        email: user.email,
        firstName: user.firstName,
        activated: user.status === UserStatus.PENDING_VERIFICATION,
      };
    });
    if (consumed.activated) void this.email.sendWelcome(consumed.email, consumed.firstName);
    await this.audit.record({
      eventType: 'EMAIL_VERIFIED',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: consumed.userId,
      correlationId: this.correlationId(req),
    });
    return this.genericMessage('Email verified successfully. You can now sign in.');
  }

  async resendVerification(dto: ResendVerificationDto, req?: Request) {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified && user.status === UserStatus.PENDING_VERIFICATION) {
      await this.maybeSendVerification(user);
    }
    await this.audit.record({
      eventType: 'RESEND_VERIFICATION',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: user?.id,
      correlationId: this.correlationId(req),
    });
    return this.genericMessage(
      'If an unverified account exists for this email, a new verification message has been sent when allowed.',
    );
  }

  async login(dto: LoginDto, req?: Request) {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { preferences: true },
    });

    // While locked, the password is never evaluated (dummy hash keeps timing comparable),
    // so a correct guess during lockout is indistinguishable from a wrong one.
    const locked = this.isLocked(user);
    const passwordOk = await verifyPasswordOrDummy(locked ? null : user?.passwordHash, dto.password);

    if (!user || locked || !passwordOk) {
      if (user && !locked) {
        await this.registerFailedLogin(user, req);
      }
      await this.audit.record({
        eventType: 'LOGIN_FAILURE',
        outcome: locked ? AuditOutcome.DENIED : AuditOutcome.FAILURE,
        subjectUserId: user?.id,
        correlationId: this.correlationId(req),
        context: { reason: !user ? 'UNKNOWN_ACCOUNT' : locked ? 'LOCKED' : 'BAD_PASSWORD' },
      });
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        errorCode: 'INVALID_CREDENTIALS',
      });
    }

    if (!user.emailVerified || user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException({
        message: 'Email address is not verified',
        errorCode: 'EMAIL_NOT_VERIFIED',
      });
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException({
        message: 'Account is suspended',
        errorCode: 'ACCOUNT_SUSPENDED',
      });
    }

    if (
      user.status === UserStatus.DEACTIVATED ||
      user.status === UserStatus.PENDING_DELETION ||
      user.deletedAt
    ) {
      throw new ForbiddenException({
        message: 'Account is not available for sign-in',
        errorCode: 'ACCOUNT_UNAVAILABLE',
      });
    }

    if (user.mfaEnabled) {
      const challengeExpires =
        this.config.get<number>('auth.mfaChallengeExpiresMinutes') ?? 5;
      const raw = await this.issueSingleUseToken(
        user.id,
        AuthTokenType.MFA_LOGIN_CHALLENGE,
        addMinutes(new Date(), challengeExpires),
      );
      await this.audit.record({
        eventType: 'LOGIN_MFA_CHALLENGE',
        outcome: AuditOutcome.SUCCESS,
        subjectUserId: user.id,
        correlationId: this.correlationId(req),
      });
      return {
        mfaRequired: true as const,
        mfaChallengeToken: raw,
        errorCode: null,
      };
    }

    const session = await this.createSessionWithRefresh(user, req);
    await this.audit.record({
      eventType: 'LOGIN_SUCCESS',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
      context: { sessionId: session.sessionId },
    });
    return {
      mfaRequired: false as const,
      accessToken: session.accessToken,
      user: session.user,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.refreshExpiresAt,
    };
  }

  private isLocked(user: Pick<User, 'lockedUntil'> | null | undefined): boolean {
    return !!user?.lockedUntil && user.lockedUntil.getTime() > Date.now();
  }

  /**
   * Atomic failure counting: the increment is done in SQL and only the request that
   * crosses the threshold (conditional update) applies the lock and sends the alert.
   * A lock only pauses new sign-ins; it never revokes existing sessions, so failed
   * attempts by a third party cannot sign the real owner out.
   */
  private async registerFailedLogin(user: User, req?: Request) {
    const max = this.config.get<number>('auth.loginMaxFailures') ?? 8;
    const lockMinutes = this.config.get<number>('auth.loginLockoutMinutes') ?? 15;
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedLoginCount < max) return;

    const lockedUntil = addMinutes(new Date(), lockMinutes);
    const applied = await this.prisma.user.updateMany({
      where: { id: user.id, failedLoginCount: { gte: max } },
      data: { lockedUntil, failedLoginCount: 0 },
    });
    if (applied.count !== 1) return;
    await this.audit.record({
      eventType: 'ACCOUNT_LOCKED',
      outcome: AuditOutcome.DENIED,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
      context: { lockMinutes },
    });
    void this.email.sendAccountLocked(user.email, user.firstName, lockMinutes);
  }

  async verifyMfaLogin(dto: MfaVerifyLoginDto, req?: Request) {
    if (!dto.totpCode && !dto.recoveryCode) {
      throw new BadRequestException({
        message: 'Provide a TOTP code or recovery code',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    const consumed = await this.consumeToken(
      dto.mfaChallengeToken,
      AuthTokenType.MFA_LOGIN_CHALLENGE,
    );
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: consumed.userId } });

    const mfaInvalid = () =>
      new UnauthorizedException({ message: 'Invalid MFA code', errorCode: 'MFA_INVALID' });

    // Account state may have changed during the challenge window (suspension, lockout, deletion).
    if (
      user.status !== UserStatus.ACTIVE ||
      !user.emailVerified ||
      user.deletedAt ||
      this.isLocked(user)
    ) {
      throw mfaInvalid();
    }

    if (!user.mfaEnabled) {
      throw new BadRequestException({
        message: 'MFA is not enabled for this account',
        errorCode: 'MFA_NOT_ENABLED',
      });
    }

    let ok = false;
    if (dto.totpCode && user.mfaSecretEncrypted) {
      const secret = decryptMfaSecret(user.mfaSecretEncrypted, this.mfaKey());
      ok = await this.consumeTotp(user.id, secret, dto.totpCode);
    }

    if (!ok && dto.recoveryCode) {
      ok = await this.consumeRecoveryCode(user.id, dto.recoveryCode);
    }

    if (!ok) {
      // MFA failures count toward the same account lockout as password failures.
      await this.registerFailedLogin(user, req);
      await this.audit.record({
        eventType: 'MFA_LOGIN_FAILURE',
        outcome: AuditOutcome.FAILURE,
        subjectUserId: user.id,
        correlationId: this.correlationId(req),
      });
      throw mfaInvalid();
    }

    const session = await this.createSessionWithRefresh(user, req);
    await this.audit.record({
      eventType: 'LOGIN_SUCCESS',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
      context: { mfa: true, sessionId: session.sessionId },
    });
    return {
      accessToken: session.accessToken,
      user: session.user,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.refreshExpiresAt,
    };
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codes = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
    });
    for (const row of codes) {
      const match = await verifyPassword(row.codeHash, code.replace(/\s+/g, '').toUpperCase());
      if (match) {
        const updated = await this.prisma.mfaRecoveryCode.updateMany({
          where: { id: row.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return updated.count === 1;
      }
    }
    return false;
  }

  async refresh(rawRefresh: string | undefined, req?: Request) {
    if (!rawRefresh) {
      throw new UnauthorizedException({
        message: 'Refresh token missing',
        errorCode: 'REFRESH_MISSING',
      });
    }
    const tokenHash = hashOpaqueToken(rawRefresh, this.pepper());
    const existing = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      include: { session: true, user: true },
    });

    if (!existing || existing.type !== AuthTokenType.REFRESH_TOKEN) {
      throw new UnauthorizedException({
        message: 'Refresh token invalid',
        errorCode: 'REFRESH_INVALID',
      });
    }

    // Token revoked by logout/password reset (never rotated): not a theft signal.
    if (!existing.replacedById && existing.revokedAt) {
      throw new UnauthorizedException({
        message: 'Refresh token invalid',
        errorCode: 'REFRESH_INVALID',
      });
    }

    // Benign concurrent-tab race: the token was rotated moments ago, the session is
    // still active and its replacement is still live. Issue nothing to this request;
    // the browser cookie jar already holds the winner's replacement.
    if (existing.replacedById && existing.usedAt) {
      const rotatedAgoMs = Date.now() - existing.usedAt.getTime();
      if (rotatedAgoMs <= REFRESH_REUSE_GRACE_MS && existing.session && !existing.session.revokedAt) {
        const replacement = await this.prisma.authToken.findUnique({
          where: { id: existing.replacedById },
        });
        if (replacement && !replacement.usedAt && !replacement.revokedAt) {
          throw new UnauthorizedException({
            message: 'Refresh token was already rotated by a concurrent request',
            errorCode: 'REFRESH_SUPERSEDED',
          });
        }
      }
    }

    // Confirmed reuse of a rotated token → revoke the stable session family
    if (existing.usedAt || existing.revokedAt || existing.replacedById) {
      if (existing.sessionId) {
        const sessionId = existing.sessionId;
        await this.prisma.$transaction(async (tx) => {
          await tx.authSession.updateMany({
            where: { id: sessionId, revokedAt: null },
            data: { revokedAt: new Date(), revokedReason: 'REFRESH_REUSE_DETECTED' },
          });
          await tx.authToken.updateMany({
            where: { sessionId, type: AuthTokenType.REFRESH_TOKEN, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        });
      }
      await this.audit.record({
        eventType: 'REFRESH_REUSE_DETECTED',
        outcome: AuditOutcome.DENIED,
        subjectUserId: existing.userId,
        correlationId: this.correlationId(req),
        context: { sessionId: existing.sessionId },
      });
      throw new UnauthorizedException({
        message: 'Refresh token reuse detected',
        errorCode: 'REFRESH_REUSE_DETECTED',
      });
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        message: 'Refresh token expired',
        errorCode: 'REFRESH_EXPIRED',
      });
    }

    if (
      !existing.session ||
      existing.session.revokedAt ||
      existing.session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException({
        message: 'Session is no longer active',
        errorCode: 'SESSION_REVOKED',
      });
    }

    const user = existing.user;
    // A password-guessing lockout does not end existing sessions (see registerFailedLogin).
    if (user.status !== UserStatus.ACTIVE || !user.emailVerified || user.deletedAt) {
      throw new UnauthorizedException({
        message: 'Account is not eligible for refresh',
        errorCode: 'ACCOUNT_NOT_ELIGIBLE',
      });
    }

    const newRaw = generateOpaqueToken();
    const newHash = hashOpaqueToken(newRaw, this.pepper());
    const refreshExpires = addDuration(
      new Date(),
      this.config.get<string>('jwt.refreshExpiresIn') ?? '7d',
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.authToken.updateMany({
          where: {
            id: existing.id,
            usedAt: null,
            revokedAt: null,
            replacedById: null,
          },
          data: { usedAt: new Date(), revokedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new HttpException(
            { message: 'Refresh race', errorCode: 'REFRESH_RACE' },
            HttpStatus.CONFLICT,
          );
        }

        const created = await tx.authToken.create({
          data: {
            userId: user.id,
            sessionId: existing.sessionId!,
            type: AuthTokenType.REFRESH_TOKEN,
            tokenHash: newHash,
            expiresAt: refreshExpires,
          },
        });

        await tx.authToken.update({
          where: { id: existing.id },
          data: { replacedById: created.id },
        });

        await tx.authSession.update({
          where: { id: existing.sessionId! },
          data: { lastSeenAt: new Date(), expiresAt: refreshExpires },
        });
      });
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.CONFLICT) {
        // Another tab won the race — do not issue a token to the loser
        throw new UnauthorizedException({
          message: 'Refresh token was already rotated by a concurrent request',
          errorCode: 'REFRESH_SUPERSEDED',
        });
      }
      throw err;
    }

    const full = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { preferences: true },
    });

    return {
      accessToken: this.signAccessToken(user, existing.sessionId!),
      user: serializeUser(full),
      refreshToken: newRaw,
      refreshExpiresAt: refreshExpires,
    };
  }

  /**
   * Idempotent: revokes the session identified by the refresh cookie and/or a valid
   * Bearer access token. Never reveals whether either credential was still live.
   */
  async logout(rawRefresh: string | undefined, bearer: string | undefined, req?: Request) {
    const revoked = new Map<string, string>(); // sessionId -> userId

    if (rawRefresh) {
      const tokenHash = hashOpaqueToken(rawRefresh, this.pepper());
      const token = await this.prisma.authToken.findUnique({ where: { tokenHash } });
      if (token?.sessionId && token.type === AuthTokenType.REFRESH_TOKEN) {
        revoked.set(token.sessionId, token.userId);
      }
    }

    if (bearer) {
      try {
        const payload = this.jwt.verify<{ sub?: string; sid?: string }>(bearer, {
          algorithms: ['HS256'],
          issuer: this.config.getOrThrow<string>('jwt.issuer'),
          audience: this.config.getOrThrow<string>('jwt.audience'),
        });
        if (payload.sid && payload.sub) revoked.set(payload.sid, payload.sub);
      } catch {
        // Expired or invalid access token: nothing to revoke from it.
      }
    }

    for (const [sessionId, userId] of revoked) {
      await this.revokeSession(sessionId, 'LOGOUT', userId);
      await this.audit.record({
        eventType: 'LOGOUT',
        outcome: AuditOutcome.SUCCESS,
        actorUserId: userId,
        subjectUserId: userId,
        correlationId: this.correlationId(req),
        context: { sessionId },
      });
    }
    return this.genericMessage('Signed out');
  }

  private async revokeSession(sessionId: string, reason: string, userId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.updateMany({
        where: { id: sessionId, revokedAt: null, ...(userId ? { userId } : {}) },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      await tx.authToken.updateMany({
        where: {
          sessionId,
          type: AuthTokenType.REFRESH_TOKEN,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });
  }

  async forgotPassword(dto: ForgotPasswordDto, req?: Request) {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const generic = this.genericMessage(
      'If an account exists for this email, password reset instructions have been sent when allowed.',
    );
    if (
      user &&
      user.emailVerified &&
      user.status === UserStatus.ACTIVE &&
      !user.deletedAt
    ) {
      const cooldown = this.config.get<number>('auth.emailCooldownSeconds') ?? 60;
      const recent = await this.prisma.authToken.findFirst({
        where: {
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          createdAt: { gt: new Date(Date.now() - cooldown * 1000) },
        },
      });
      if (!recent) {
        const minutes =
          this.config.get<number>('auth.passwordResetExpiresMinutes') ?? 30;
        const raw = await this.issueSingleUseToken(
          user.id,
          AuthTokenType.PASSWORD_RESET,
          addMinutes(new Date(), minutes),
        );
        void this.email.sendPasswordReset(user.email, user.firstName, raw, minutes);
      }
    }
    await this.audit.record({
      eventType: 'FORGOT_PASSWORD',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: user?.id,
      correlationId: this.correlationId(req),
    });
    return generic;
  }

  async resetPassword(dto: ResetPasswordDto, req?: Request) {
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException({
        message: 'Password confirmation does not match',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    // Cheap read-only check first so bogus tokens never trigger Argon2 work.
    await this.peekToken(dto.token, AuthTokenType.PASSWORD_RESET);
    const policy = validatePasswordPolicy(dto.password);
    if (!policy.valid) {
      throw new BadRequestException({
        message: policy.errors.join('; '),
        errorCode: 'VALIDATION_ERROR',
      });
    }
    const passwordHash = await hashPassword(dto.password);
    const consumed = await this.prisma.$transaction(async (tx) => {
      const token = await this.consumeToken(dto.token, AuthTokenType.PASSWORD_RESET, tx);
      await tx.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          securityVersion: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.authSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      });
      await this.revokeOutstandingTokens(tx, token.userId);
      return token;
    });
    const user = await this.prisma.user.findUnique({ where: { id: consumed.userId } });
    if (user) void this.email.sendPasswordChanged(user.email, user.firstName, 'reset');
    await this.audit.record({
      eventType: 'PASSWORD_RESET',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: consumed.userId,
      correlationId: this.correlationId(req),
    });
    return this.genericMessage('Password updated. Please sign in with your new password.');
  }

  async changePassword(user: AuthRequestUser, dto: ChangePasswordDto, req?: Request) {
    if (dto.newPassword !== dto.newPasswordConfirmation) {
      throw new BadRequestException({
        message: 'Password confirmation does not match',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException({
        message: 'New password must differ from the current password',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    const policy = validatePasswordPolicy(dto.newPassword);
    if (!policy.valid) {
      throw new BadRequestException({
        message: policy.errors.join('; '),
        errorCode: 'VALIDATION_ERROR',
      });
    }
    // DESIGN DECISION: MFA users also confirm with a TOTP code (§5.8 "consider step-up MFA").
    await this.assertStepUp(user, dto.currentPassword, dto.totpCode, {
      passwordMessage: 'Current password is incorrect',
      req,
    });
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          securityVersion: { increment: 1 },
        },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGE' },
      });
      await this.revokeOutstandingTokens(tx, user.id);
    });

    // The caller continues on a NEW stable session; every previous session is revoked.
    const fresh = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const session = await this.createSessionWithRefresh(fresh, req);
    void this.email.sendPasswordChanged(fresh.email, fresh.firstName, 'change');
    await this.audit.record({
      eventType: 'PASSWORD_CHANGE',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
    });
    return session;
  }

  async me(user: AuthRequestUser) {
    const full = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { preferences: true },
    });
    return serializeUser(full);
  }

  async updateProfile(user: AuthRequestUser, dto: UpdateProfileDto) {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        experienceLevel: dto.experienceLevel,
      },
      include: { preferences: true },
    });
    return serializeUser(updated);
  }

  async getPreferences(user: AuthRequestUser) {
    const prefs = await this.prisma.userPreferences.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
    return prefs;
  }

  async updatePreferences(user: AuthRequestUser, dto: UpdatePreferencesDto) {
    // Explicit field list: never spread request objects into persistence calls.
    const data = {
      preferredCurrency: dto.preferredCurrency,
      timezone: dto.timezone,
      chartTheme: dto.chartTheme,
      notifyEmailSecurity: dto.notifyEmailSecurity,
      notifyMarketDigest: dto.notifyMarketDigest,
      trainingDifficulty: dto.trainingDifficulty,
      reduceMotion: dto.reduceMotion,
      highContrast: dto.highContrast,
    };
    return this.prisma.userPreferences.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
  }

  /**
   * Identity context only — no invented portfolio or performance figures.
   * `permitted` = the role may use the module (own data only); `available` = the module is
   * actually implemented in this deployment. A capability is true only when both hold.
   */
  async dashboardContext(user: AuthRequestUser) {
    const isAdmin = user.role === UserRole.ADMIN;
    const adminMfaEnrollmentRequired =
      isAdmin && !user.mfaEnabled && this.config.get<boolean>('auth.adminMfaRequired') === true;
    const modules = [
      { id: 'portfolio', label: 'Virtual portfolio', permitted: true, available: false },
      { id: 'orders', label: 'Order desk', permitted: true, available: false },
      { id: 'learning', label: 'Learning path', permitted: true, available: false },
      { id: 'ai', label: 'AI analysis', permitted: true, available: false },
      { id: 'stress', label: 'Bank stress testing', permitted: true, available: false },
      { id: 'actuarial', label: 'Actuarial tools', permitted: true, available: false },
      {
        id: 'admin',
        label: 'User administration',
        permitted: isAdmin && !adminMfaEnrollmentRequired,
        available: true,
      },
    ];
    const usable = (id: string) => modules.some((m) => m.id === id && m.permitted && m.available);
    return {
      user: serializeUser(user),
      role: user.role,
      experienceLevel: user.experienceLevel,
      experienceLevelNotice:
        'Experience level tailors learning content only. It is not an investment suitability assessment or a trading certification.',
      capabilities: {
        trading: usable('orders'),
        portfolio: usable('portfolio'),
        learning: usable('learning'),
        aiAnalysis: usable('ai'),
        stressTesting: usable('stress'),
        actuarial: usable('actuarial'),
        admin: usable('admin'),
      },
      requiredActions: adminMfaEnrollmentRequired ? ['ENROLL_MFA_FOR_ADMIN'] : [],
      modules,
    };
  }

  async requestEmailChange(user: AuthRequestUser, dto: ChangeEmailRequestDto, req?: Request) {
    await this.assertStepUp(user, dto.password, dto.totpCode, { req });
    const newEmail = normalizeEmail(dto.newEmail);
    if (newEmail === user.email) {
      throw new BadRequestException({
        message: 'New email must differ from the current email',
        errorCode: 'VALIDATION_ERROR',
      });
    }
    // Cooldown keyed on the request audit trail, not on issued tokens, so it behaves the same
    // whether or not the target address is already registered (no enumeration oracle).
    const cooldownSeconds = this.config.get<number>('auth.emailCooldownSeconds') ?? 60;
    const recent = await this.prisma.auditEvent.findFirst({
      where: {
        eventType: 'EMAIL_CHANGE_REQUESTED',
        actorUserId: user.id,
        createdAt: { gt: new Date(Date.now() - cooldownSeconds * 1000) },
      },
      select: { id: true },
    });
    if (recent) {
      throw new HttpException(
        {
          message: `Please wait ${cooldownSeconds} seconds before requesting another email change.`,
          errorCode: 'EMAIL_CHANGE_COOLDOWN',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const targetInUse = await this.prisma.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    const minutes = this.config.get<number>('auth.emailChangeExpiresMinutes') ?? 60;
    if (targetInUse) {
      // Same outward behaviour, but no link: an address owned by someone else never receives
      // a token that could move it. Any earlier pending change is cancelled either way.
      await this.prisma.authToken.updateMany({
        where: { userId: user.id, type: AuthTokenType.EMAIL_CHANGE, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      const raw = await this.issueSingleUseToken(
        user.id,
        AuthTokenType.EMAIL_CHANGE,
        addMinutes(new Date(), minutes),
        { pendingEmail: newEmail },
      );
      void this.email.sendEmailChangeConfirm(newEmail, user.firstName, raw, minutes);
    }
    void this.email.sendEmailChangeRequested(user.email, user.firstName, newEmail);
    await this.audit.record({
      eventType: 'EMAIL_CHANGE_REQUESTED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
      context: { target: maskEmail(newEmail), targetInUse: !!targetInUse },
    });
    return this.genericMessage(
      'If the new address can be used, a confirmation link has been sent to it. Your current address stays active until you confirm.',
    );
  }

  async confirmEmailChange(dto: ChangeEmailConfirmDto, req?: Request) {
    let outcome: { userId: string; firstName: string; oldEmail: string; newEmail: string };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const token = await this.consumeToken(dto.token, AuthTokenType.EMAIL_CHANGE, tx);
        if (!token.pendingEmail) throw this.invalidTokenError();
        const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
        if (user.deletedAt || user.status !== UserStatus.ACTIVE) throw this.invalidTokenError();

        const owner = await tx.user.findUnique({
          where: { email: token.pendingEmail },
          select: { id: true },
        });
        if (owner) throw this.emailChangeFailed();

        await tx.user.update({
          where: { id: user.id },
          data: {
            email: token.pendingEmail,
            emailVerified: true,
            emailVerifiedAt: new Date(),
            securityVersion: { increment: 1 },
          },
        });
        await tx.authSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'EMAIL_CHANGE' },
        });
        await this.revokeOutstandingTokens(tx, user.id, [
          ...CREDENTIAL_SENSITIVE_TOKEN_TYPES,
          AuthTokenType.EMAIL_VERIFICATION,
        ]);
        return {
          userId: user.id,
          firstName: user.firstName,
          oldEmail: user.email,
          newEmail: token.pendingEmail,
        };
      });
    } catch (err) {
      // Unique-constraint race with a concurrent registration: the whole transaction,
      // including the token claim, rolled back, so ownership never moved.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.emailChangeFailed();
      }
      throw err;
    }

    void this.email.sendEmailChangedToOld(outcome.oldEmail, outcome.firstName, outcome.newEmail);
    void this.email.sendEmailChangedToNew(outcome.newEmail, outcome.firstName);
    await this.audit.record({
      eventType: 'EMAIL_CHANGED',
      outcome: AuditOutcome.SUCCESS,
      subjectUserId: outcome.userId,
      correlationId: this.correlationId(req),
      context: { previousAddress: maskEmail(outcome.oldEmail), newAddress: maskEmail(outcome.newEmail) },
    });
    return this.genericMessage('Email address updated. Sign in again with your new address.');
  }

  private emailChangeFailed() {
    return new BadRequestException({
      message: 'This email change can no longer be completed. Request a new one from your account settings.',
      errorCode: 'EMAIL_CHANGE_FAILED',
    });
  }

  async listSessions(user: AuthRequestUser) {
    const sessions = await this.prisma.authSession.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      deviceLabel: s.deviceLabel,
      userAgent: s.userAgent,
      current: s.id === user.sessionId,
    }));
  }

  async revokeSessionOwned(user: AuthRequestUser, sessionId: string, req?: Request) {
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId: user.id },
    });
    if (!session) {
      throw new NotFoundException({
        message: 'Resource not found',
        errorCode: 'RESOURCE_NOT_FOUND',
      });
    }
    await this.revokeSession(sessionId, 'USER_REVOKE', user.id);
    await this.audit.record({
      eventType: 'SESSION_REVOKED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
      context: { sessionId, current: sessionId === user.sessionId },
    });
    return this.genericMessage('Session revoked');
  }

  /** Signs out every device, including the caller's. The caller must sign in again. */
  async logoutAll(user: AuthRequestUser, req?: Request) {
    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
      });
      await this.revokeOutstandingTokens(tx, user.id, [
        AuthTokenType.REFRESH_TOKEN,
        AuthTokenType.MFA_LOGIN_CHALLENGE,
      ]);
    });
    void this.email.sendSessionsRevoked(user.email, user.firstName, 'all');
    await this.audit.record({
      eventType: 'SESSIONS_REVOKE_ALL',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
    });
    return this.genericMessage('Signed out on every device');
  }

  async revokeOtherSessions(user: AuthRequestUser, dto: StepUpPasswordDto, req?: Request) {
    await this.assertStepUp(user, dto.password, dto.totpCode, { req });
    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { id: user.sessionId } },
        data: { revokedAt: new Date(), revokedReason: 'REVOKE_OTHERS' },
      });
      await tx.authToken.updateMany({
        where: {
          userId: user.id,
          type: AuthTokenType.REFRESH_TOKEN,
          revokedAt: null,
          NOT: { sessionId: user.sessionId },
        },
        data: { revokedAt: new Date() },
      });
    });
    void this.email.sendSessionsRevoked(user.email, user.firstName, 'others');
    await this.audit.record({
      eventType: 'SESSIONS_REVOKE_OTHERS',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      correlationId: this.correlationId(req),
    });
    return this.genericMessage('Other sessions signed out');
  }

  async mfaSetup(user: AuthRequestUser, dto: StepUpPasswordDto, req?: Request) {
    await this.assertStepUp(user, dto.password, dto.totpCode, { req });
    const secret = authenticator.generateSecret();
    const encrypted = encryptMfaSecret(secret, this.mfaKey());
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        mfaPendingSecretEncrypted: encrypted.ciphertext,
        mfaPendingCreatedAt: new Date(),
        mfaSecretKeyVersion: encrypted.keyVersion,
      },
    });
    const otpauth = authenticator.keyuri(
      user.email,
      this.config.get<string>('app.name') ?? 'MTRS',
      secret,
    );
    await this.audit.record({
      eventType: 'MFA_SETUP_STARTED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
    });
    return { secret, otpauth, expiresInMinutes: MFA_PENDING_SETUP_TTL_MINUTES };
  }

  async mfaEnable(user: AuthRequestUser, dto: MfaEnableDto, req?: Request) {
    const fresh = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!fresh.mfaPendingSecretEncrypted) {
      throw new BadRequestException({
        message: 'No MFA setup in progress',
        errorCode: 'MFA_SETUP_REQUIRED',
      });
    }
    const startedAt = fresh.mfaPendingCreatedAt?.getTime() ?? 0;
    if (Date.now() - startedAt > MFA_PENDING_SETUP_TTL_MINUTES * 60_000) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mfaPendingSecretEncrypted: null, mfaPendingCreatedAt: null },
      });
      throw new BadRequestException({
        message: 'This setup expired. Start two-step verification setup again.',
        errorCode: 'MFA_SETUP_EXPIRED',
      });
    }
    const secret = decryptMfaSecret(fresh.mfaPendingSecretEncrypted, this.mfaKey());
    if (!(await this.consumeTotp(user.id, secret, dto.totpCode))) {
      throw new BadRequestException({
        message: 'Invalid authenticator code',
        errorCode: 'MFA_INVALID',
      });
    }
    const recoveryCodes = Array.from({ length: 10 }, () =>
      generateOpaqueToken().slice(0, 10).toUpperCase(),
    );
    const hashes = await Promise.all(recoveryCodes.map((c) => hashSecret(c)));

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          mfaVerifiedAt: new Date(),
          mfaSecretEncrypted: fresh.mfaPendingSecretEncrypted,
          mfaPendingSecretEncrypted: null,
          mfaPendingCreatedAt: null,
        },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
    });

    void this.email.sendMfaEnabled(fresh.email, fresh.firstName);
    await this.audit.record({
      eventType: 'MFA_ENABLED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      correlationId: this.correlationId(req),
    });
    return { recoveryCodes };
  }

  async mfaDisable(user: AuthRequestUser, dto: MfaDisableDto, req?: Request) {
    if (!user.mfaEnabled) throw this.mfaNotEnabled();
    await this.assertStepUp(user, dto.password, dto.totpCode, {
      recoveryCode: dto.recoveryCode,
      req,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          mfaPendingSecretEncrypted: null,
          mfaPendingCreatedAt: null,
          mfaVerifiedAt: null,
          mfaLastAcceptedStep: null,
          securityVersion: { increment: 1 },
        },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      // The caller's session survives (it refreshes onto the new security version);
      // every other device must sign in again.
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { id: user.sessionId } },
        data: { revokedAt: new Date(), revokedReason: 'MFA_DISABLED' },
      });
      await this.revokeOutstandingTokens(tx, user.id, [AuthTokenType.MFA_LOGIN_CHALLENGE]);
    });
    void this.email.sendMfaDisabled(user.email, user.firstName);
    await this.audit.record({
      eventType: 'MFA_DISABLED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      subjectUserId: user.id,
      correlationId: this.correlationId(req),
      context: { via: dto.totpCode ? 'TOTP' : 'RECOVERY_CODE' },
    });
    return this.genericMessage('Two-step verification turned off');
  }

  private mfaNotEnabled() {
    return new BadRequestException({
      message: 'Two-step verification is not enabled',
      errorCode: 'MFA_NOT_ENABLED',
    });
  }

  async mfaRegenerateRecovery(user: AuthRequestUser, dto: StepUpPasswordDto, req?: Request) {
    if (!user.mfaEnabled) throw this.mfaNotEnabled();
    await this.assertStepUp(user, dto.password, dto.totpCode, { req });
    const recoveryCodes = Array.from({ length: 10 }, () =>
      generateOpaqueToken().slice(0, 10).toUpperCase(),
    );
    const hashes = await Promise.all(recoveryCodes.map((c) => hashSecret(c)));
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
    });
    void this.email.sendMfaRecoveryCodesRegenerated(user.email, user.firstName);
    await this.audit.record({
      eventType: 'MFA_RECOVERY_REGENERATED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      correlationId: this.correlationId(req),
    });
    return { recoveryCodes };
  }

  async mfaStatus(user: AuthRequestUser) {
    const remaining = await this.prisma.mfaRecoveryCode.count({
      where: { userId: user.id, usedAt: null },
    });
    return {
      mfaEnabled: user.mfaEnabled,
      mfaVerifiedAt: user.mfaVerifiedAt?.toISOString() ?? null,
      remainingRecoveryCodes: remaining,
    };
  }

  async deactivate(user: AuthRequestUser, dto: DeactivateAccountDto, req?: Request) {
    await this.assertStepUp(user, dto.password, dto.totpCode, { req });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: UserStatus.DEACTIVATED,
          securityVersion: { increment: 1 },
        },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'DEACTIVATED' },
      });
      await tx.authToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    void this.email.sendAccountDeactivated(user.email, user.firstName, false);
    await this.audit.record({
      eventType: 'ACCOUNT_DEACTIVATED',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      correlationId: this.correlationId(req),
    });
    return this.genericMessage('Account deactivated');
  }

  async deleteAccount(user: AuthRequestUser, dto: DeleteAccountDto, req?: Request) {
    await this.assertStepUp(user, dto.password, dto.totpCode, { req });
    // DESIGN DECISION / NEEDS CLARIFICATION: soft pending-deletion; no cascade wipe of future trading rows
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: UserStatus.PENDING_DELETION,
          deletedAt: new Date(),
          email: `deleted:${user.id}@invalid.local`,
          firstName: 'Deleted',
          lastName: 'User',
          securityVersion: { increment: 1 },
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          mfaPendingSecretEncrypted: null,
        },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PENDING_DELETION' },
      });
      await tx.authToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    });
    // `user` still holds the pre-anonymisation address loaded for this request.
    void this.email.sendAccountDeletionScheduled(user.email, user.firstName);
    await this.audit.record({
      eventType: 'ACCOUNT_PENDING_DELETION',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      correlationId: this.correlationId(req),
    });
    return this.genericMessage(
      'Account scheduled for deletion. Sign-in is disabled. Retention of simulation records requires product/legal approval.',
    );
  }

  /**
   * Step-up failures are 403, not 401: the caller's access token is valid, they just
   * failed reauthentication. A 401 would make clients refresh and silently retry.
   */
  private stepUpFailed(message: string, errorCode = 'INVALID_CREDENTIALS') {
    return new ForbiddenException({ message, errorCode });
  }

  /**
   * Password plus, when MFA is enabled, a fresh (non-replayed) TOTP code — or, only where the
   * caller allows it, an unused recovery code. Wrong passwords count toward the sign-in
   * lockout so a stolen access token cannot be used to guess the password without limit.
   */
  async assertStepUp(
    user: User,
    password: string,
    totpCode?: string,
    opts: { recoveryCode?: string; passwordMessage?: string; req?: Request } = {},
  ) {
    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.registerFailedLogin(user, opts.req);
      throw this.stepUpFailed(opts.passwordMessage ?? 'Reauthentication failed');
    }
    if (!user.mfaEnabled) return;
    if (totpCode && user.mfaSecretEncrypted) {
      const secret = decryptMfaSecret(user.mfaSecretEncrypted, this.mfaKey());
      if (await this.consumeTotp(user.id, secret, totpCode)) return;
      throw this.stepUpFailed('Invalid authenticator code', 'MFA_INVALID');
    }
    if (opts.recoveryCode) {
      if (await this.consumeRecoveryCode(user.id, opts.recoveryCode)) return;
      throw this.stepUpFailed('Invalid recovery code', 'MFA_INVALID');
    }
    throw this.stepUpFailed('Authenticator code required', 'MFA_REQUIRED');
  }

  /**
   * Verifies a TOTP code and atomically records its time step so the same code
   * (or an older one) can never be accepted twice, even under concurrent requests.
   */
  private async consumeTotp(userId: string, secret: string, code: string): Promise<boolean> {
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null || delta === undefined) return false;
    const step = BigInt(Math.floor(Date.now() / 1000 / 30) + delta);
    const claimed = await this.prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ mfaLastAcceptedStep: null }, { mfaLastAcceptedStep: { lt: step } }],
      },
      data: { mfaLastAcceptedStep: step },
    });
    return claimed.count === 1;
  }
}
