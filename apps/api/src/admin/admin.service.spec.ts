import { ForbiddenException, HttpException } from '@nestjs/common';
import { AuditOutcome, Prisma, UserRole, UserStatus } from '@prisma/client';
import { AdminService, filterAuditContext } from './admin.service';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const TARGET_ID = '22222222-2222-2222-2222-222222222222';

const admin = {
  id: ADMIN_ID,
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
  passwordHash: 'hash',
} as never;

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    email: 'target@example.com',
    firstName: 'Tess',
    lastName: 'Target',
    role: UserRole.INVESTOR,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    lockedUntil: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function build(opts: { target?: ReturnType<typeof target> | null; otherActiveAdmins?: number } = {}) {
  const tx = {
    user: {
      findFirst: jest.fn().mockResolvedValue(opts.target === undefined ? target() : opts.target),
      count: jest.fn().mockResolvedValue(opts.otherActiveAdmins ?? 3),
      update: jest.fn().mockResolvedValue({}),
    },
    authSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    authToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
  const prisma = {
    $transaction: jest.fn<Promise<unknown>, [(t: typeof tx) => Promise<unknown>, unknown?]>((fn) => fn(tx)),
    user: {
      findFirst: jest.fn().mockResolvedValue(opts.target === undefined ? target() : opts.target),
      count: jest.fn().mockResolvedValue(0),
    },
    authSession: { count: jest.fn().mockResolvedValue(1) },
    auditEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const audit = { record: jest.fn() };
  const email = {
    sendAccountSuspended: jest.fn().mockResolvedValue(true),
    sendAccountDeactivated: jest.fn().mockResolvedValue(true),
    sendAccountReactivated: jest.fn().mockResolvedValue(true),
  };
  const auth = { assertStepUp: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminService(prisma as never, audit as never, email as never, auth as never);
  return { service, prisma, tx, audit, email, auth };
}

async function errorOf(p: Promise<unknown>): Promise<{ status: number; errorCode?: string }> {
  try {
    await p;
  } catch (err) {
    const e = err as HttpException;
    return { status: e.getStatus(), errorCode: (e.getResponse() as { errorCode?: string }).errorCode };
  }
  throw new Error('expected rejection');
}

describe('AdminService — self-lockout and last-admin protection', () => {
  it('forbids an admin changing their own role or status', async () => {
    const { service, tx, auth } = build();
    expect(await errorOf(service.updateRole(admin, ADMIN_ID, { role: UserRole.INVESTOR, password: 'x' }))).toEqual({
      status: 403,
      errorCode: 'SELF_DEMOTION_FORBIDDEN',
    });
    expect(auth.assertStepUp).not.toHaveBeenCalled();
    expect(
      await errorOf(service.updateStatus(admin, ADMIN_ID, { status: UserStatus.SUSPENDED, reason: 'test' })),
    ).toEqual({ status: 403, errorCode: 'SELF_STATUS_CHANGE_FORBIDDEN' });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('forbids suspending or demoting the last other active admin, inside a serializable transaction', async () => {
    const lastAdmin = target({ role: UserRole.ADMIN });
    const { service, prisma, tx } = build({ target: lastAdmin, otherActiveAdmins: 0 });
    expect(
      await errorOf(service.updateStatus(admin, TARGET_ID, { status: UserStatus.DEACTIVATED, reason: 'cleanup' })),
    ).toEqual({ status: 403, errorCode: 'LAST_ADMIN_PROTECTION' });
    expect(
      await errorOf(service.updateRole(admin, TARGET_ID, { role: UserRole.INVESTOR, password: 'x' })),
    ).toEqual({ status: 403, errorCode: 'LAST_ADMIN_PROTECTION' });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.user.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { not: TARGET_ID }, role: UserRole.ADMIN, status: UserStatus.ACTIVE }),
    });
  });

  it('allows demoting an already-suspended admin without a last-admin check', async () => {
    const { service, tx } = build({ target: target({ role: UserRole.ADMIN, status: UserStatus.SUSPENDED }) });
    await service.updateRole(admin, TARGET_ID, { role: UserRole.INVESTOR, password: 'x' });
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('maps serialization failures to 409 CONCURRENT_UPDATE', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }),
    );
    expect(
      await errorOf(service.updateStatus(admin, TARGET_ID, { status: UserStatus.SUSPENDED, reason: 'abuse' })),
    ).toEqual({ status: 409, errorCode: 'CONCURRENT_UPDATE' });
  });

  it('rejects non-admin actors', async () => {
    const { service } = build();
    const investor = { ...(admin as object), role: UserRole.INVESTOR } as never;
    await expect(service.overview(investor)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AdminService — status changes', () => {
  it('suspension revokes every session and outstanding token, audits the reason and emails the user', async () => {
    const { service, tx, audit, email } = build();
    await service.updateStatus(admin, TARGET_ID, { status: UserStatus.SUSPENDED, reason: '  abuse report  ' });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      data: { status: UserStatus.SUSPENDED, securityVersion: { increment: 1 } },
    });
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID, revokedAt: null },
      data: expect.objectContaining({ revokedReason: 'ADMIN_SUSPEND' }),
    });
    expect(tx.authToken.updateMany).toHaveBeenCalledWith({
      where: { userId: TARGET_ID, usedAt: null, revokedAt: null },
      data: expect.any(Object),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ADMIN_STATUS_CHANGE',
        outcome: AuditOutcome.SUCCESS,
        context: { from: UserStatus.ACTIVE, to: UserStatus.SUSPENDED, reason: 'abuse report' },
      }),
    );
    expect(email.sendAccountSuspended).toHaveBeenCalledWith('target@example.com', 'Tess');
  });

  it('deactivation emails the user that an administrator acted', async () => {
    const { service, email } = build();
    await service.updateStatus(admin, TARGET_ID, { status: UserStatus.DEACTIVATED, reason: 'requested' });
    expect(email.sendAccountDeactivated).toHaveBeenCalledWith('target@example.com', 'Tess', true);
  });

  it('reactivating an unverified account returns it to PENDING_VERIFICATION without revoking anything', async () => {
    const { service, tx, email } = build({
      target: target({ status: UserStatus.SUSPENDED, emailVerified: false }),
    });
    await service.updateStatus(admin, TARGET_ID, { status: UserStatus.ACTIVE, reason: 'appeal accepted' });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      data: { status: UserStatus.PENDING_VERIFICATION },
    });
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
    expect(email.sendAccountReactivated).toHaveBeenCalled();
  });

  it('rejects no-op transitions and unknown accounts', async () => {
    const same = build();
    expect(
      await errorOf(same.service.updateStatus(admin, TARGET_ID, { status: UserStatus.ACTIVE, reason: 'noop' })),
    ).toEqual({ status: 400, errorCode: 'STATUS_UNCHANGED' });
    const missing = build({ target: null });
    expect(
      await errorOf(missing.service.updateStatus(admin, TARGET_ID, { status: UserStatus.SUSPENDED, reason: 'x y z' })),
    ).toEqual({ status: 404, errorCode: 'RESOURCE_NOT_FOUND' });
  });

  it('refuses statuses an administrator may not set directly', async () => {
    const { service } = build();
    expect(
      await errorOf(
        service.updateStatus(admin, TARGET_ID, { status: UserStatus.PENDING_DELETION, reason: 'not allowed' }),
      ),
    ).toEqual({ status: 400, errorCode: 'VALIDATION_ERROR' });
  });
});

describe('AdminService — role changes', () => {
  it('requires step-up (password + TOTP when enrolled) before any change', async () => {
    const { service, auth, tx } = build();
    auth.assertStepUp.mockRejectedValueOnce(new ForbiddenException({ errorCode: 'MFA_REQUIRED' }));
    expect(
      await errorOf(service.updateRole(admin, TARGET_ID, { role: UserRole.ADMIN, password: 'pw' })),
    ).toEqual({ status: 403, errorCode: 'MFA_REQUIRED' });
    expect(auth.assertStepUp).toHaveBeenCalledWith(admin, 'pw', undefined, { req: undefined });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('promotes, bumps the security version and audits from/to', async () => {
    const { service, tx, audit } = build();
    await service.updateRole(admin, TARGET_ID, { role: UserRole.ADMIN, password: 'pw', totpCode: '123456' });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      data: { role: UserRole.ADMIN, securityVersion: { increment: 1 } },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ADMIN_ROLE_CHANGE',
        context: { from: UserRole.INVESTOR, to: UserRole.ADMIN },
      }),
    );
  });

  it('rejects no-op role changes', async () => {
    const { service } = build();
    expect(
      await errorOf(service.updateRole(admin, TARGET_ID, { role: UserRole.INVESTOR, password: 'pw' })),
    ).toEqual({ status: 400, errorCode: 'ROLE_UNCHANGED' });
  });
});

describe('AdminService — read models', () => {
  it('lists users with a stable sort and an emailVerified filter', async () => {
    const { service, prisma } = build();
    (prisma.user as unknown as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([]);
    await service.listUsers(admin, { emailVerified: 'false', q: '  ann ' });
    const args = (prisma.user as unknown as { findMany: jest.Mock }).findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.where.emailVerified).toBe(false);
    expect(JSON.stringify(args.where.OR)).toContain('"ann"');
  });

  it('returns a limited user view without preferences', async () => {
    const { service } = build();
    const result = await service.getUser(admin, TARGET_ID);
    expect(result.user).not.toHaveProperty('preferences');
    expect(result.security).toEqual({ locked: false, activeSessions: 1 });
  });

  it('filters audit events and exposes only allowlisted context keys', async () => {
    const { service, prisma } = build();
    prisma.auditEvent.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        eventType: 'EMAIL_CHANGED',
        outcome: AuditOutcome.SUCCESS,
        actorUserId: TARGET_ID,
        subjectUserId: TARGET_ID,
        correlationId: 'c1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        context: { previousAddress: 'a***@x.com', newAddress: 'b***@y.com', reason: 'kept' },
      },
    ]);
    const result = await service.listAuditEvents(admin, {
      outcome: AuditOutcome.FAILURE,
      subjectUserId: TARGET_ID,
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    const args = prisma.auditEvent.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      outcome: AuditOutcome.FAILURE,
      subjectUserId: TARGET_ID,
      createdAt: { gte: new Date('2026-01-01T00:00:00Z'), lte: new Date('2026-02-01T00:00:00Z') },
    });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(result.items[0].context).toEqual({ reason: 'kept' });
  });

  it('rejects inverted date ranges', async () => {
    const { service } = build();
    expect(
      await errorOf(service.listAuditEvents(admin, { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })),
    ).toEqual({ status: 400, errorCode: 'VALIDATION_ERROR' });
  });

  it('filterAuditContext drops non-objects and unknown keys', () => {
    expect(filterAuditContext(null)).toBeNull();
    expect(filterAuditContext(['x'])).toBeNull();
    expect(filterAuditContext({ ipDigest: 'abc' })).toBeNull();
    expect(filterAuditContext({ status: 'SUSPENDED', ipDigest: 'abc' })).toEqual({ status: 'SUSPENDED' });
  });
});
