import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditOutcome, Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthRequestUser } from '../auth/decorators/current-user.decorator';
import { canManageUsers } from '../common/policies/ownership.policy';
import { correlationIdOf } from '../common/request-context';
import { serializeUser } from '../common/serializers/user.serializer';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Audit context keys an administrator may see. Everything else (masked addresses, IP
 * hashes, internal identifiers) stays in the database only.
 */
export const ADMIN_VISIBLE_AUDIT_CONTEXT_KEYS = [
  'status',
  'from',
  'to',
  'role',
  'reason',
  'scope',
  'via',
  'lockMinutes',
  'maxSessions',
  'targetInUse',
  'sessions',
  'credentialRecords',
  'recoveryCodes',
  'auditEvents',
] as const;

const ADMIN_MANAGEABLE_STATUSES: UserStatus[] = [
  UserStatus.ACTIVE,
  UserStatus.SUSPENDED,
  UserStatus.DEACTIVATED,
];

const OVERVIEW_WINDOW_DAYS = 7;

export type AdminStatusChange = { status: UserStatus; reason: string };
export type AdminRoleChange = { role: UserRole; password: string; totpCode?: string };
export type AdminUserQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: UserStatus;
  role?: UserRole;
  emailVerified?: 'true' | 'false';
};
export type AdminAuditQuery = {
  page?: number;
  pageSize?: number;
  eventType?: string;
  outcome?: AuditOutcome;
  actorUserId?: string;
  subjectUserId?: string;
  from?: string;
  to?: string;
};

function notFound() {
  return new NotFoundException({ message: 'Resource not found', errorCode: 'RESOURCE_NOT_FOUND' });
}

function lastAdminProtection() {
  return new ForbiddenException({
    message: 'At least one active administrator must remain',
    errorCode: 'LAST_ADMIN_PROTECTION',
  });
}

function isSerializationFailure(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
}

export function filterAuditContext(context: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const out: Record<string, unknown> = {};
  for (const key of ADMIN_VISIBLE_AUDIT_CONTEXT_KEYS) {
    if (key in context) out[key] = (context as Record<string, unknown>)[key];
  }
  return Object.keys(out).length ? out : null;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
  ) {}

  private assertAdmin(actor: AuthRequestUser) {
    if (!canManageUsers(actor)) {
      throw new ForbiddenException({ message: 'Administrator access required', errorCode: 'FORBIDDEN' });
    }
  }

  /**
   * Runs an admin mutation under SERIALIZABLE isolation so "count active admins, then
   * demote/suspend one" cannot interleave with a concurrent request and leave zero admins.
   */
  private async serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (isSerializationFailure(err)) {
        throw new ConflictException({
          message: 'The account was changed by another request. Reload and try again.',
          errorCode: 'CONCURRENT_UPDATE',
        });
      }
      throw err;
    }
  }

  private async assertAnotherActiveAdminRemains(tx: Prisma.TransactionClient, target: User) {
    if (target.role !== UserRole.ADMIN || target.status !== UserStatus.ACTIVE) return;
    const others = await tx.user.count({
      where: {
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        id: { not: target.id },
      },
    });
    if (others < 1) throw lastAdminProtection();
  }

  async overview(actor: AuthRequestUser) {
    this.assertAdmin(actor);
    const since = new Date(Date.now() - OVERVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [total, active, pending, suspended, deactivated, verified, mfaEnabled, recentEvents, totals] =
      await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.user.count({ where: { status: UserStatus.ACTIVE, deletedAt: null } }),
        this.prisma.user.count({ where: { status: UserStatus.PENDING_VERIFICATION, deletedAt: null } }),
        this.prisma.user.count({ where: { status: UserStatus.SUSPENDED, deletedAt: null } }),
        this.prisma.user.count({ where: { status: UserStatus.DEACTIVATED, deletedAt: null } }),
        this.prisma.user.count({ where: { emailVerified: true, deletedAt: null } }),
        this.prisma.user.count({ where: { mfaEnabled: true, deletedAt: null } }),
        this.prisma.auditEvent.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 10,
          select: { id: true, eventType: true, outcome: true, createdAt: true },
        }),
        this.prisma.auditEvent.groupBy({
          by: ['eventType', 'outcome'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
      ]);
    return {
      users: { total, active, pending, suspended, deactivated, verified, mfaEnabled },
      recentEvents: recentEvents.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      eventTotals: {
        windowDays: OVERVIEW_WINDOW_DAYS,
        items: totals
          .map((t) => ({ eventType: t.eventType, outcome: t.outcome, count: t._count._all }))
          .sort((a, b) => b.count - a.count || a.eventType.localeCompare(b.eventType)),
      },
    };
  }

  async listUsers(actor: AuthRequestUser, query: AdminUserQuery) {
    this.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const q = query.q?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.emailVerified ? { emailVerified: query.emailVerified === 'true' } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { firstName: { contains: q, mode: 'insensitive' as const } },
              { lastName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          emailVerified: true,
          mfaEnabled: true,
          experienceLevel: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: rows.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
    };
  }

  /** Limited account view: no preferences, no secrets, audit summary without context. */
  async getUser(actor: AuthRequestUser, id: string) {
    this.assertAdmin(actor);
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw notFound();
    const now = new Date();
    const [activeSessions, recentAudit] = await Promise.all([
      this.prisma.authSession.count({
        where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
      }),
      this.prisma.auditEvent.findMany({
        where: { subjectUserId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, eventType: true, outcome: true, createdAt: true, actorUserId: true },
      }),
    ]);
    return {
      user: serializeUser(user, { includePreferences: false }),
      security: {
        locked: !!user.lockedUntil && user.lockedUntil > now,
        activeSessions,
      },
      auditSummary: recentAudit.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        outcome: e.outcome,
        createdAt: e.createdAt.toISOString(),
        byAdministrator: !!e.actorUserId && e.actorUserId !== id,
      })),
    };
  }

  async updateStatus(actor: AuthRequestUser, id: string, body: AdminStatusChange, req?: Request) {
    this.assertAdmin(actor);
    if (!ADMIN_MANAGEABLE_STATUSES.includes(body.status)) {
      throw new BadRequestException({ message: 'Unsupported status transition', errorCode: 'VALIDATION_ERROR' });
    }
    if (actor.id === id) {
      throw new ForbiddenException({
        message: 'Administrators cannot change their own account status',
        errorCode: 'SELF_STATUS_CHANGE_FORBIDDEN',
      });
    }
    const reason = body.reason.trim();
    const restricting = body.status !== UserStatus.ACTIVE;

    const change = await this.serializable(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!user) throw notFound();
      // Reactivating an unverified account must not skip email verification.
      const next =
        body.status === UserStatus.ACTIVE && !user.emailVerified ? UserStatus.PENDING_VERIFICATION : body.status;
      if (user.status === next) {
        throw new BadRequestException({
          message: 'The account already has this status',
          errorCode: 'STATUS_UNCHANGED',
        });
      }
      if (restricting) await this.assertAnotherActiveAdminRemains(tx, user);

      const now = new Date();
      await tx.user.update({
        where: { id },
        data: {
          status: next,
          ...(restricting ? { securityVersion: { increment: 1 } } : {}),
        },
      });
      if (restricting) {
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: {
            revokedAt: now,
            revokedReason: next === UserStatus.SUSPENDED ? 'ADMIN_SUSPEND' : 'ADMIN_DEACTIVATE',
          },
        });
        await tx.authToken.updateMany({
          where: { userId: id, usedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      return { user, from: user.status, to: next };
    });

    await this.audit.record({
      eventType: 'ADMIN_STATUS_CHANGE',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.id,
      subjectUserId: id,
      correlationId: correlationIdOf(req),
      context: { from: change.from, to: change.to, reason },
    });
    await this.notifyStatusChange(change.user, change.from, change.to);
    return this.getUser(actor, id);
  }

  private async notifyStatusChange(user: User, from: UserStatus, to: UserStatus) {
    try {
      if (to === UserStatus.SUSPENDED) {
        await this.email.sendAccountSuspended(user.email, user.firstName);
      } else if (to === UserStatus.DEACTIVATED) {
        await this.email.sendAccountDeactivated(user.email, user.firstName, true);
      } else if (from === UserStatus.SUSPENDED || from === UserStatus.DEACTIVATED) {
        await this.email.sendAccountReactivated(
          user.email,
          user.firstName,
          to === UserStatus.PENDING_VERIFICATION,
        );
      }
    } catch (err) {
      this.logger.warn(`Status-change notification failed: ${(err as Error).message}`);
    }
  }

  async updateRole(actor: AuthRequestUser, id: string, body: AdminRoleChange, req?: Request) {
    this.assertAdmin(actor);
    if (actor.id === id) {
      throw new ForbiddenException({
        message: 'Administrators cannot change their own role',
        errorCode: 'SELF_DEMOTION_FORBIDDEN',
      });
    }
    await this.auth.assertStepUp(actor, body.password, body.totpCode, { req });

    const change = await this.serializable(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!user) throw notFound();
      if (user.role === body.role) {
        throw new BadRequestException({ message: 'The account already has this role', errorCode: 'ROLE_UNCHANGED' });
      }
      if (body.role !== UserRole.ADMIN) await this.assertAnotherActiveAdminRemains(tx, user);
      await tx.user.update({
        where: { id },
        data: { role: body.role, securityVersion: { increment: 1 } },
      });
      return { from: user.role, to: body.role };
    });

    await this.audit.record({
      eventType: 'ADMIN_ROLE_CHANGE',
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.id,
      subjectUserId: id,
      correlationId: correlationIdOf(req),
      context: { from: change.from, to: change.to },
    });
    return this.getUser(actor, id);
  }

  async listAuditEvents(actor: AuthRequestUser, query: AdminAuditQuery) {
    this.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException({ message: '"from" must be before "to"', errorCode: 'VALIDATION_ERROR' });
    }
    const where: Prisma.AuditEventWhereInput = {
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.subjectUserId ? { subjectUserId: query.subjectUserId } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          eventType: true,
          outcome: true,
          actorUserId: true,
          subjectUserId: true,
          correlationId: true,
          createdAt: true,
          context: true,
        },
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: items.map((e) => ({
        ...e,
        context: filterAuditContext(e.context),
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}
