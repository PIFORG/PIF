import { AuthTokenType } from '@prisma/client';
import { MaintenanceService } from './maintenance.service';

const NOW = new Date('2026-10-15T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function build() {
  const prisma = {
    user: { count: jest.fn().mockResolvedValue(2) },
    authSession: { count: jest.fn().mockResolvedValue(4), deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    authToken: { count: jest.fn().mockResolvedValue(9), deleteMany: jest.fn().mockResolvedValue({ count: 9 }) },
    mfaRecoveryCode: { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { count: jest.fn().mockResolvedValue(7), deleteMany: jest.fn().mockResolvedValue({ count: 7 }) },
  };
  const values: Record<string, number> = {
    'auth.tokenRetentionDays': 30,
    'auth.auditRetentionDays': 365,
    'auth.pendingDeletionDays': 30,
  };
  const config = { get: (k: string) => values[k] };
  const audit = { record: jest.fn() };
  return { service: new MaintenanceService(prisma as never, config as never, audit as never), prisma, audit };
}

describe('MaintenanceService', () => {
  it('dry run counts but never deletes', async () => {
    const { service, prisma, audit } = build();
    const report = await service.run({ apply: false, now: NOW });
    expect(report).toMatchObject({
      applied: false,
      sessions: 4,
      tokens: 9,
      recoveryCodes: 1,
      auditEvents: 7,
      anonymisedAccountsPastWindow: 2,
    });
    expect(prisma.authToken.deleteMany).not.toHaveBeenCalled();
    expect(prisma.authSession.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('apply deletes with retention cutoffs and records an audit event', async () => {
    const { service, prisma, audit } = build();
    const report = await service.run({ apply: true, now: NOW });
    expect(report.applied).toBe(true);
    const tokenCutoff = new Date(NOW.getTime() - 30 * DAY);
    expect(prisma.auditEvent.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(NOW.getTime() - 365 * DAY) } },
    });
    expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: { lt: tokenCutoff } }, { revokedAt: { lt: tokenCutoff } }] },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'MAINTENANCE_PURGE', context: expect.objectContaining({ credentialRecords: 9 }) }),
    );
  });

  it('keeps used refresh tokens until they expire so replays are still detected as reuse', () => {
    const { service } = build();
    const w = service.wheres(NOW);
    expect(w.tokens.OR).toContainEqual({
      usedAt: { lt: new Date(NOW.getTime() - 30 * DAY) },
      type: { not: AuthTokenType.REFRESH_TOKEN },
    });
  });

  it('never deletes user accounts', async () => {
    const { service, prisma } = build();
    await service.run({ apply: true, now: NOW });
    expect(prisma.user).not.toHaveProperty('deleteMany');
  });
});
