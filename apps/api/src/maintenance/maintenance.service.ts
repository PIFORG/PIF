import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditOutcome, AuthTokenType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export type MaintenanceReport = {
  applied: boolean;
  cutoffs: { tokens: string; audit: string };
  sessions: number;
  tokens: number;
  recoveryCodes: number;
  auditEvents: number;
  /** Anonymised accounts past the pending-deletion window. Reported only, never deleted. */
  anonymisedAccountsPastWindow: number;
};

/**
 * Retention clean-up for expired security artefacts. Dry-run unless `apply` is set.
 *
 * Used refresh tokens are kept until they expire so a replay is still recognised as reuse
 * (and revokes the session) rather than being treated as an unknown token.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private days(key: string, fallback: number): number {
    const value = this.config.get<number>(key);
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : fallback;
  }

  wheres(now = new Date()) {
    const tokenCutoff = new Date(now.getTime() - this.days('auth.tokenRetentionDays', 30) * DAY_MS);
    const auditCutoff = new Date(now.getTime() - this.days('auth.auditRetentionDays', 365) * DAY_MS);
    const deletionCutoff = new Date(now.getTime() - this.days('auth.pendingDeletionDays', 30) * DAY_MS);

    const sessions: Prisma.AuthSessionWhereInput = {
      OR: [{ expiresAt: { lt: tokenCutoff } }, { revokedAt: { lt: tokenCutoff } }],
    };
    const tokens: Prisma.AuthTokenWhereInput = {
      OR: [
        { expiresAt: { lt: tokenCutoff } },
        { revokedAt: { lt: tokenCutoff } },
        { usedAt: { lt: tokenCutoff }, type: { not: AuthTokenType.REFRESH_TOKEN } },
      ],
    };
    const recoveryCodes: Prisma.MfaRecoveryCodeWhereInput = { usedAt: { lt: tokenCutoff } };
    const auditEvents: Prisma.AuditEventWhereInput = { createdAt: { lt: auditCutoff } };
    const anonymised: Prisma.UserWhereInput = { deletedAt: { lt: deletionCutoff } };
    return { tokenCutoff, auditCutoff, sessions, tokens, recoveryCodes, auditEvents, anonymised };
  }

  async run(options: { apply: boolean; now?: Date }): Promise<MaintenanceReport> {
    const w = this.wheres(options.now);
    const anonymisedAccountsPastWindow = await this.prisma.user.count({ where: w.anonymised });
    const cutoffs = { tokens: w.tokenCutoff.toISOString(), audit: w.auditCutoff.toISOString() };

    if (!options.apply) {
      const [sessions, tokens, recoveryCodes, auditEvents] = await Promise.all([
        this.prisma.authSession.count({ where: w.sessions }),
        this.prisma.authToken.count({ where: w.tokens }),
        this.prisma.mfaRecoveryCode.count({ where: w.recoveryCodes }),
        this.prisma.auditEvent.count({ where: w.auditEvents }),
      ]);
      return { applied: false, cutoffs, sessions, tokens, recoveryCodes, auditEvents, anonymisedAccountsPastWindow };
    }

    // Tokens first so the count excludes rows that would only disappear via session cascade.
    const tokens = await this.prisma.authToken.deleteMany({ where: w.tokens });
    const sessions = await this.prisma.authSession.deleteMany({ where: w.sessions });
    const recoveryCodes = await this.prisma.mfaRecoveryCode.deleteMany({ where: w.recoveryCodes });
    const auditEvents = await this.prisma.auditEvent.deleteMany({ where: w.auditEvents });

    const report: MaintenanceReport = {
      applied: true,
      cutoffs,
      sessions: sessions.count,
      tokens: tokens.count,
      recoveryCodes: recoveryCodes.count,
      auditEvents: auditEvents.count,
      anonymisedAccountsPastWindow,
    };
    await this.audit.record({
      eventType: 'MAINTENANCE_PURGE',
      outcome: AuditOutcome.SUCCESS,
      // The audit sanitizer drops any key containing "token", hence "credentialRecords".
      context: {
        sessions: report.sessions,
        credentialRecords: report.tokens,
        recoveryCodes: report.recoveryCodes,
        auditEvents: report.auditEvents,
      },
    });
    this.logger.log(`Maintenance purge applied: ${JSON.stringify(report)}`);
    return report;
  }
}
