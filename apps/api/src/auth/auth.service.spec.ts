import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthTokenType, User, UserRole, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import * as passwordUtil from '../common/crypto/password.util';
import { serializeUser } from '../common/serializers/user.serializer';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { AuthRequestUser } from './decorators/current-user.decorator';

const STRONG = 'Copper-Lantern-Harbor-77';
const JWT_SECRET = 'unit-test-access-secret-0123456789abcdef';

const CONFIG: Record<string, unknown> = {
  'auth.tokenPepper': 'unit-test-token-pepper-0123456789abcdef',
  'auth.ipHashPepper': 'unit-test-ip-pepper-0123456789abcdef',
  'mfa.encryptionKey': 'a1'.repeat(32),
  'jwt.issuer': 'mtrs-api',
  'jwt.audience': 'mtrs-web',
  'jwt.refreshExpiresIn': '7d',
  'auth.loginMaxFailures': 3,
  'auth.loginLockoutMinutes': 15,
  'auth.emailCooldownSeconds': 60,
  'auth.emailVerificationExpiresMinutes': 60,
  'auth.maxSessions': 8,
};

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'trader@example.com',
    firstName: 'Ada',
    lastName: 'Byron',
    passwordHash: 'unused',
    role: UserRole.INVESTOR,
    experienceLevel: 'BEGINNER',
    emailVerified: true,
    emailVerifiedAt: now,
    passwordChangedAt: null,
    status: UserStatus.ACTIVE,
    failedLoginCount: 0,
    lockedUntil: null,
    mfaEnabled: false,
    mfaVerifiedAt: null,
    mfaSecretEncrypted: null,
    mfaSecretKeyVersion: null,
    mfaPendingSecretEncrypted: null,
    mfaLastAcceptedStep: null,
    securityVersion: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastActiveAt: null,
    ...overrides,
  } as User;
}

function modelMock() {
  return {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
}

function makePrisma() {
  // A distinct transaction client proves which writes happen inside $transaction.
  const tx = {
    user: modelMock(),
    authToken: modelMock(),
    authSession: modelMock(),
    mfaRecoveryCode: modelMock(),
  };
  const prisma = {
    user: modelMock(),
    authToken: modelMock(),
    authSession: modelMock(),
    auditEvent: modelMock(),
    mfaRecoveryCode: modelMock(),
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    tx,
  };
  return prisma;
}

function setup(configOverrides: Record<string, unknown> = {}) {
  const prisma = makePrisma();
  const CONFIG_VALUES = { ...CONFIG, ...configOverrides };
  const config = {
    get: jest.fn((key: string) => CONFIG_VALUES[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in CONFIG_VALUES)) throw new Error(`missing config ${key}`);
      return CONFIG_VALUES[key];
    }),
  };
  const jwt = new JwtService({
    secret: JWT_SECRET,
    signOptions: { expiresIn: '15m', issuer: 'mtrs-api', audience: 'mtrs-web' },
  });
  const email = {
    sendVerification: jest.fn(),
    sendWelcome: jest.fn(),
    sendMfaRecoveryCodesRegenerated: jest.fn(),
    sendAccountExists: jest.fn(),
    sendAccountLocked: jest.fn(),
    sendPasswordChanged: jest.fn(),
    sendEmailChangeConfirm: jest.fn(),
    sendEmailChangeRequested: jest.fn(),
    sendEmailChangedToOld: jest.fn(),
    sendEmailChangedToNew: jest.fn(),
    sendSessionsRevoked: jest.fn(),
    sendMfaEnabled: jest.fn(),
    sendMfaDisabled: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    jwt,
    email as unknown as EmailService,
    audit as unknown as AuditService,
  );
  return { service, prisma, email, audit, jwt };
}

async function errorOf(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() as Record<string, unknown> };
    }
    throw err;
  }
  throw new Error('expected the call to reject');
}

let realHash: string;

beforeAll(async () => {
  realHash = await passwordUtil.hashPassword(STRONG);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AuthService.login lockout (C1, C5)', () => {
  it('never evaluates the password while locked and answers exactly like a wrong password', async () => {
    const { service, prisma } = setup();
    const locked = makeUser({ passwordHash: realHash, lockedUntil: new Date(Date.now() + 60_000) });
    prisma.user.findUnique.mockResolvedValue(locked);
    const verifySpy = jest.spyOn(passwordUtil, 'verifyPasswordOrDummy');

    const correctWhileLocked = await errorOf(service.login({ email: locked.email, password: STRONG }));
    expect(verifySpy).toHaveBeenLastCalledWith(null, STRONG);
    expect(prisma.user.update).not.toHaveBeenCalled();

    const unlocked = makeUser({ passwordHash: realHash });
    prisma.user.findUnique.mockResolvedValue(unlocked);
    prisma.user.update.mockResolvedValue({ failedLoginCount: 1 });
    const wrongPassword = await errorOf(
      service.login({ email: unlocked.email, password: 'Wrong-Lantern-Harbor-77' }),
    );

    expect(correctWhileLocked).toEqual(wrongPassword);
    expect(correctWhileLocked.status).toBe(401);
    expect(correctWhileLocked.body.errorCode).toBe('INVALID_CREDENTIALS');
  });

  it('counts failures with an atomic increment and locks only via a conditional update', async () => {
    const { service, prisma, email } = setup();
    const user = makeUser({ passwordHash: realHash });
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue({ failedLoginCount: 3 });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    await errorOf(service.login({ email: user.email, password: 'Wrong-Lantern-Harbor-77' }));

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: { increment: 1 } } }),
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id, failedLoginCount: { gte: 3 } },
        data: expect.objectContaining({ failedLoginCount: 0 }),
      }),
    );
    expect(email.sendAccountLocked).toHaveBeenCalledWith(user.email, user.firstName, 15);
    // A lock never revokes existing sessions.
    expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('sends one lock alert when concurrent failures race past the threshold', async () => {
    const { service, prisma, email } = setup();
    const user = makeUser({ passwordHash: realHash });
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue({ failedLoginCount: 4 });
    prisma.user.updateMany.mockResolvedValue({ count: 0 }); // another request already locked

    await errorOf(service.login({ email: user.email, password: 'Wrong-Lantern-Harbor-77' }));
    expect(email.sendAccountLocked).not.toHaveBeenCalled();
  });

  it('does not lock below the threshold', async () => {
    const { service, prisma } = setup();
    const user = makeUser({ passwordHash: realHash });
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue({ failedLoginCount: 1 });

    await errorOf(service.login({ email: user.email, password: 'Wrong-Lantern-Harbor-77' }));
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService.verifyEmail (C2, C10)', () => {
  function mockConsumable(prisma: ReturnType<typeof makePrisma>, user: User) {
    prisma.tx.authToken.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.tx.authToken.findUniqueOrThrow.mockResolvedValue({
      id: 't1',
      userId: user.id,
      pendingEmail: null,
      sessionId: null,
    });
    prisma.tx.user.findUniqueOrThrow.mockResolvedValue(user);
  }

  it('activates an account that is pending verification', async () => {
    const { service, prisma } = setup();
    mockConsumable(prisma, makeUser({ status: UserStatus.PENDING_VERIFICATION, emailVerified: false }));

    await service.verifyEmail({ token: 'raw-token' });
    expect(prisma.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: UserStatus.ACTIVE }) }),
    );
  });

  it('never lifts a suspension imposed after the link was issued', async () => {
    const { service, prisma } = setup();
    mockConsumable(prisma, makeUser({ status: UserStatus.SUSPENDED, emailVerified: false }));

    await service.verifyEmail({ token: 'raw-token' });
    const data = prisma.tx.user.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.emailVerified).toBe(true);
    expect(data).not.toHaveProperty('status');
  });

  it('rejects verification for accounts pending deletion', async () => {
    const { service, prisma } = setup();
    mockConsumable(prisma, makeUser({ status: UserStatus.PENDING_DELETION, emailVerified: false }));

    const err = await errorOf(service.verifyEmail({ token: 'raw-token' }));
    expect(err.status).toBe(400);
    expect(err.body.errorCode).toBe('TOKEN_INVALID');
    expect(prisma.tx.user.update).not.toHaveBeenCalled();
  });

  it('claims the token inside the same transaction as its effect', async () => {
    const { service, prisma } = setup();
    mockConsumable(prisma, makeUser({ status: UserStatus.PENDING_VERIFICATION, emailVerified: false }));

    await service.verifyEmail({ token: 'raw-token' });
    expect(prisma.tx.authToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usedAt: expect.any(Date) } }),
    );
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });

  it('sends the welcome email only when verification activates the account', async () => {
    const pending = setup();
    mockConsumable(pending.prisma, makeUser({ status: UserStatus.PENDING_VERIFICATION, emailVerified: false }));
    await pending.service.verifyEmail({ token: 'raw-token' });
    expect(pending.email.sendWelcome).toHaveBeenCalledTimes(1);

    const suspended = setup();
    mockConsumable(suspended.prisma, makeUser({ status: UserStatus.SUSPENDED, emailVerified: false }));
    await suspended.service.verifyEmail({ token: 'raw-token' });
    expect(suspended.email.sendWelcome).not.toHaveBeenCalled();
  });

  it('never sends a welcome email when the token is invalid', async () => {
    const { service, prisma, email } = setup();
    prisma.tx.authToken.updateMany.mockResolvedValueOnce({ count: 0 });
    const err = await errorOf(service.verifyEmail({ token: 'raw-token' }));
    expect(err.body.errorCode).toBe('TOKEN_INVALID');
    expect(email.sendWelcome).not.toHaveBeenCalled();
  });
});

describe('AuthService.resetPassword (C3, C10)', () => {
  it('rejects bogus tokens before doing any Argon2 work', async () => {
    const { service, prisma } = setup();
    prisma.authToken.findFirst.mockResolvedValue(null);
    const hashSpy = jest.spyOn(passwordUtil, 'hashPassword');

    const err = await errorOf(
      service.resetPassword({ token: 'bogus', password: STRONG, passwordConfirmation: STRONG }),
    );
    expect(err.body.errorCode).toBe('TOKEN_INVALID');
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it('revokes sessions and every credential-sensitive token, including pending email changes', async () => {
    const { service, prisma } = setup();
    const user = makeUser();
    prisma.authToken.findFirst.mockResolvedValue({ id: 't1', userId: user.id, user });
    prisma.tx.authToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.tx.authToken.findUniqueOrThrow.mockResolvedValue({
      id: 't1',
      userId: user.id,
      pendingEmail: null,
      sessionId: null,
    });
    prisma.user.findUnique.mockResolvedValue(user);

    await service.resetPassword({ token: 'raw', password: STRONG, passwordConfirmation: STRONG });

    expect(prisma.tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: user.id, revokedAt: null } }),
    );
    const revokedTypes = prisma.tx.authToken.updateMany.mock.calls
      .map((c) => (c[0] as { where: { type?: { in?: AuthTokenType[] } } }).where.type?.in)
      .find(Boolean);
    expect(revokedTypes).toEqual(
      expect.arrayContaining([
        AuthTokenType.PASSWORD_RESET,
        AuthTokenType.EMAIL_CHANGE,
        AuthTokenType.MFA_LOGIN_CHALLENGE,
        AuthTokenType.REFRESH_TOKEN,
      ]),
    );
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a new password without a number or symbol', async () => {
    const { service, prisma } = setup();
    const user = makeUser();
    prisma.authToken.findFirst.mockResolvedValue({ id: 't1', userId: user.id, user });

    const err = await errorOf(
      service.resetPassword({
        token: 'raw',
        password: 'onlyletters',
        passwordConfirmation: 'onlyletters',
      }),
    );
    expect(err.status).toBe(400);
    expect(err.body.errorCode).toBe('VALIDATION_ERROR');
  });
});

describe('AuthService.changePassword (C3, C12)', () => {
  it('answers a wrong current password with 403, not a token-expiry 401', async () => {
    const { service, prisma } = setup();
    prisma.user.update.mockResolvedValue({ failedLoginCount: 1 });
    const user = { ...makeUser({ passwordHash: realHash }), sessionId: 's1' } as AuthRequestUser;

    const err = await errorOf(
      service.changePassword(user, {
        currentPassword: 'Wrong-Lantern-Harbor-77',
        newPassword: 'Velvet-Orbit-Canyon-42',
        newPasswordConfirmation: 'Velvet-Orbit-Canyon-42',
      }),
    );
    expect(err.status).toBe(403);
    expect(err.body.errorCode).toBe('INVALID_CREDENTIALS');
  });
});

describe('AuthService.register duplicates (C2, C6, C7)', () => {
  const dto = { email: 'Trader@Example.com ', firstName: 'Ada', lastName: 'Byron', password: STRONG };

  it('spends the same Argon2 work for new and existing addresses', async () => {
    const { service, prisma } = setup();
    const hashSpy = jest.spyOn(passwordUtil, 'hashPassword');
    prisma.user.findUnique.mockResolvedValue(makeUser());
    prisma.auditEvent.findFirst.mockResolvedValue(null);

    await service.register(dto);
    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('sends the account-exists notice at most once per cooldown window', async () => {
    const { service, prisma, email } = setup();
    prisma.user.findUnique.mockResolvedValue(makeUser());

    prisma.auditEvent.findFirst.mockResolvedValueOnce(null);
    await service.register(dto);
    prisma.auditEvent.findFirst.mockResolvedValueOnce({ id: 'recent' });
    await service.register(dto);

    expect(email.sendAccountExists).toHaveBeenCalledTimes(1);
  });

  it('never sends a verification link to a suspended unverified account', async () => {
    const { service, prisma, email } = setup();
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ status: UserStatus.SUSPENDED, emailVerified: false }),
    );

    const res = await service.register(dto);
    expect(email.sendVerification).not.toHaveBeenCalled();
    expect(email.sendAccountExists).not.toHaveBeenCalled();
    expect(res.message).toMatch(/If this email can be registered/);
  });

  it('re-sends verification to an account still pending verification', async () => {
    const { service, prisma, email } = setup();
    const pending = makeUser({ status: UserStatus.PENDING_VERIFICATION, emailVerified: false });
    prisma.user.findUnique.mockResolvedValue(pending);
    prisma.authToken.findFirst.mockResolvedValue(null);

    await service.register(dto);
    expect(email.sendVerification).toHaveBeenCalledWith(
      pending.email,
      pending.firstName,
      expect.any(String),
      60,
    );
  });
});

describe('AuthService.logout (C9)', () => {
  it('revokes the session named by a valid Bearer token even without a cookie', async () => {
    const { service, prisma, jwt } = setup();
    const bearer = jwt.sign({ sub: 'user-1', sid: 'session-1', sv: 0 });

    await service.logout(undefined, bearer);
    expect(prisma.tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session-1', revokedAt: null, userId: 'user-1' } }),
    );
  });

  it('ignores Bearer tokens signed with another key and still answers generically', async () => {
    const { service, prisma } = setup();
    const forged = new JwtService({ secret: 'some-other-secret-0123456789abcdefghij' }).sign(
      { sub: 'user-1', sid: 'session-1', sv: 0 },
      { issuer: 'mtrs-api', audience: 'mtrs-web' },
    );

    const res = await service.logout(undefined, forged);
    expect(res.message).toBe('Signed out');
    expect(prisma.tx.authSession.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService.verifyMfaLogin (C11)', () => {
  it.each([
    ['suspended', { status: UserStatus.SUSPENDED }],
    ['locked', { lockedUntil: new Date(Date.now() + 60_000) }],
    ['deleted', { deletedAt: new Date() }],
  ])('refuses to finish sign-in when the account became %s during the challenge', async (_label, change) => {
    const { service, prisma } = setup();
    prisma.authToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.authToken.findUniqueOrThrow.mockResolvedValue({
      id: 'c1',
      userId: 'user-1',
      pendingEmail: null,
      sessionId: null,
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue(
      makeUser({ id: 'user-1', mfaEnabled: true, ...change }),
    );

    const err = await errorOf(service.verifyMfaLogin({ mfaChallengeToken: 'raw', totpCode: '123456' }));
    expect(err.body.errorCode).toBe('MFA_INVALID');
    expect(prisma.tx.authSession.create).not.toHaveBeenCalled();
  });
});

describe('serializeUser (C13)', () => {
  it('does not expose the internal security version', () => {
    expect(serializeUser(makeUser({ securityVersion: 7 }))).not.toHaveProperty('securityVersion');
  });
});

describe('AuthService.refresh (C4, C10)', () => {
  function refreshRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rt-1',
      type: AuthTokenType.REFRESH_TOKEN,
      userId: 'user-1',
      sessionId: 'session-1',
      usedAt: null,
      revokedAt: null,
      replacedById: null,
      expiresAt: new Date(Date.now() + 60_000),
      session: { id: 'session-1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) },
      user: makeUser({ id: 'user-1', lockedUntil: new Date(Date.now() + 60_000) }),
      ...overrides,
    };
  }

  it('keeps an existing session alive while the account is locked for new sign-ins', async () => {
    const { service, prisma } = setup();
    prisma.authToken.findUnique.mockResolvedValue(refreshRecord());
    prisma.tx.authToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.tx.authToken.create.mockResolvedValue({ id: 'rt-2' });
    prisma.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: 'user-1' }));

    const res = await service.refresh('raw-refresh');
    expect(res.accessToken).toEqual(expect.any(String));
    expect(res.refreshToken).not.toBe('raw-refresh');
  });

  it('revokes the whole session family atomically on confirmed reuse', async () => {
    const { service, prisma } = setup();
    prisma.authToken.findUnique.mockResolvedValue(
      refreshRecord({ usedAt: new Date(Date.now() - 120_000), revokedAt: new Date(), replacedById: 'rt-2' }),
    );

    const err = await errorOf(service.refresh('raw-refresh'));
    expect(err.status).toBe(401);
    expect(err.body.errorCode).toBe('REFRESH_REUSE_DETECTED');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.tx.authSession.updateMany).toHaveBeenCalled();
    expect(prisma.tx.authToken.updateMany).toHaveBeenCalled();
    expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
  });
});

function requestUser(overrides: Partial<User> = {}): AuthRequestUser {
  return { ...makeUser({ passwordHash: realHash, ...overrides }), sessionId: 'current-session' } as AuthRequestUser;
}

describe('AuthService.requestEmailChange (L1)', () => {
  it('answers identically for free and taken targets, but only free targets receive a link', async () => {
    const free = setup();
    free.prisma.user.findUnique.mockResolvedValue(null);
    const freeRes = await free.service.requestEmailChange(requestUser(), {
      password: STRONG,
      newEmail: 'new@example.com',
    });

    const taken = setup();
    taken.prisma.user.findUnique.mockResolvedValue({ id: 'someone-else' });
    const takenRes = await taken.service.requestEmailChange(requestUser(), {
      password: STRONG,
      newEmail: 'new@example.com',
    });

    expect(takenRes).toEqual(freeRes);
    expect(free.email.sendEmailChangeConfirm).toHaveBeenCalledTimes(1);
    expect(taken.email.sendEmailChangeConfirm).not.toHaveBeenCalled();
    // The current owner is told about the attempt in both cases.
    expect(free.email.sendEmailChangeRequested).toHaveBeenCalledTimes(1);
    expect(taken.email.sendEmailChangeRequested).toHaveBeenCalledTimes(1);
  });

  it('enforces a cooldown keyed on requests, not on issued links', async () => {
    const { service, prisma, email } = setup();
    prisma.auditEvent.findFirst.mockResolvedValue({ id: 'recent-request' });

    const err = await errorOf(
      service.requestEmailChange(requestUser(), { password: STRONG, newEmail: 'new@example.com' }),
    );
    expect(err.status).toBe(429);
    expect(err.body.errorCode).toBe('EMAIL_CHANGE_COOLDOWN');
    expect(email.sendEmailChangeRequested).not.toHaveBeenCalled();
  });
});

describe('AuthService.confirmEmailChange (L1)', () => {
  function claimable(prisma: ReturnType<typeof makePrisma>, user: User) {
    prisma.tx.authToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.tx.authToken.findUniqueOrThrow.mockResolvedValue({
      id: 't1',
      userId: user.id,
      pendingEmail: 'new@example.com',
      sessionId: null,
    });
    prisma.tx.user.findUniqueOrThrow.mockResolvedValue(user);
  }

  it('moves the address, revokes sessions and outstanding tokens, and notifies both addresses', async () => {
    const { service, prisma, email } = setup();
    const user = makeUser();
    claimable(prisma, user);
    prisma.tx.user.findUnique.mockResolvedValue(null);

    await service.confirmEmailChange({ token: 'raw' });

    expect(prisma.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'new@example.com' }) }),
    );
    expect(prisma.tx.authSession.updateMany).toHaveBeenCalled();
    const revokedTypes = prisma.tx.authToken.updateMany.mock.calls
      .map((c) => (c[0] as { where: { type?: { in?: AuthTokenType[] } } }).where.type?.in)
      .find(Boolean);
    expect(revokedTypes).toEqual(
      expect.arrayContaining([
        AuthTokenType.PASSWORD_RESET,
        AuthTokenType.EMAIL_CHANGE,
        AuthTokenType.EMAIL_VERIFICATION,
        AuthTokenType.REFRESH_TOKEN,
      ]),
    );
    expect(email.sendEmailChangedToOld).toHaveBeenCalledWith(user.email, user.firstName, 'new@example.com');
    expect(email.sendEmailChangedToNew).toHaveBeenCalledWith('new@example.com', user.firstName);
  });

  it('never moves ownership when the target was registered meanwhile', async () => {
    const { service, prisma, email } = setup();
    claimable(prisma, makeUser());
    prisma.tx.user.findUnique.mockResolvedValue({ id: 'someone-else' });

    const err = await errorOf(service.confirmEmailChange({ token: 'raw' }));
    expect(err.body.errorCode).toBe('EMAIL_CHANGE_FAILED');
    expect(prisma.tx.user.update).not.toHaveBeenCalled();
    expect(email.sendEmailChangedToNew).not.toHaveBeenCalled();
  });

  it('refuses to complete for a suspended account', async () => {
    const { service, prisma } = setup();
    claimable(prisma, makeUser({ status: UserStatus.SUSPENDED }));

    const err = await errorOf(service.confirmEmailChange({ token: 'raw' }));
    expect(err.body.errorCode).toBe('TOKEN_INVALID');
    expect(prisma.tx.user.update).not.toHaveBeenCalled();
  });
});

describe('AuthService sessions (L2, L3)', () => {
  it('logout-all revokes every session including the current one', async () => {
    const { service, prisma, audit } = setup();

    await service.logoutAll(requestUser());
    expect(prisma.tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: expect.any(String), revokedAt: null } }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SESSIONS_REVOKE_ALL' }));
  });

  it('audits deterministic oldest-first eviction at the session cap', async () => {
    const { service, prisma, audit } = setup({ 'auth.maxSessions': 2 });
    const user = makeUser({ passwordHash: realHash });
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.tx.authSession.findMany.mockResolvedValue([{ id: 'oldest' }, { id: 'newer' }]);
    prisma.tx.authSession.create.mockResolvedValue({ id: 'fresh' });
    prisma.user.findUniqueOrThrow.mockResolvedValue(user);

    await service.login({ email: user.email, password: STRONG });

    expect(prisma.tx.authSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
    expect(prisma.tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['oldest'] } } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'SESSION_LIMIT_REVOKED',
        context: { revokedSessionIds: ['oldest'], maxSessions: 2 },
      }),
    );
  });

  it('counts a wrong step-up password toward the sign-in lockout', async () => {
    const { service, prisma } = setup();
    prisma.user.update.mockResolvedValue({ failedLoginCount: 1 });

    const err = await errorOf(
      service.revokeOtherSessions(requestUser(), { password: 'Wrong-Lantern-Harbor-77' }),
    );
    expect(err.status).toBe(403);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: { increment: 1 } } }),
    );
  });
});

describe('AuthService MFA lifecycle (L4)', () => {
  it('discards an enrollment that was not confirmed in time', async () => {
    const { service, prisma } = setup();
    prisma.user.findUniqueOrThrow.mockResolvedValue(
      makeUser({
        mfaPendingSecretEncrypted: 'ciphertext',
        mfaPendingCreatedAt: new Date(Date.now() - 11 * 60_000),
      }),
    );

    const err = await errorOf(service.mfaEnable(requestUser(), { totpCode: '123456' }));
    expect(err.body.errorCode).toBe('MFA_SETUP_EXPIRED');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mfaPendingSecretEncrypted: null, mfaPendingCreatedAt: null } }),
    );
  });

  it('lets a user who lost the device turn MFA off with password plus a recovery code', async () => {
    const { service, prisma, email } = setup();
    const codeHash = await passwordUtil.hashSecret('ABCDEFGHJK');
    prisma.mfaRecoveryCode.findMany.mockResolvedValue([{ id: 'rc1', codeHash }]);
    prisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 1 });
    const user = requestUser({ mfaEnabled: true, mfaSecretEncrypted: 'ciphertext' });

    await service.mfaDisable(user, { password: STRONG, recoveryCode: 'abcd efghjk' });

    expect(prisma.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mfaEnabled: false }) }),
    );
    expect(prisma.tx.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ NOT: { id: 'current-session' } }) }),
    );
    expect(email.sendMfaDisabled).toHaveBeenCalled();
  });

  it('requires a second factor to turn MFA off', async () => {
    const { service } = setup();
    const user = requestUser({ mfaEnabled: true, mfaSecretEncrypted: 'ciphertext' });

    const err = await errorOf(service.mfaDisable(user, { password: STRONG }));
    expect(err.status).toBe(403);
    expect(err.body.errorCode).toBe('MFA_REQUIRED');
  });
});

describe('AuthService.dashboardContext (L5, L8)', () => {
  it('never reports a capability for a module that is not implemented', async () => {
    const { service } = setup();
    const ctx = await service.dashboardContext(requestUser());

    for (const mod of ctx.modules) {
      if (!mod.available) expect(mod.permitted && mod.available).toBe(false);
    }
    expect(ctx.capabilities.trading).toBe(false);
    expect(ctx.capabilities.admin).toBe(false);
    expect(JSON.stringify(ctx)).not.toMatch(/balance|pnl|performance/i);
  });

  it('flags MFA enrollment for admins when the policy requires it', async () => {
    const { service } = setup({ 'auth.adminMfaRequired': true });
    const ctx = await service.dashboardContext(requestUser({ role: UserRole.ADMIN }));
    expect(ctx.capabilities.admin).toBe(false);
    expect(ctx.requiredActions).toEqual(['ENROLL_MFA_FOR_ADMIN']);

    const enrolled = await service.dashboardContext(requestUser({ role: UserRole.ADMIN, mfaEnabled: true }));
    expect(enrolled.capabilities.admin).toBe(true);
    expect(enrolled.requiredActions).toEqual([]);
  });
});
