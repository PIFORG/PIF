import { Injectable, Logger } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { currentCorrelationId } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const SECRET_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'secret',
  'mfaSecret',
  'code',
  'recoveryCode',
  'authorization',
  'cookie',
  'pepper',
  'encryptionKey',
]);

export interface AuditAppendInput {
  actorUserId?: string | null;
  subjectUserId?: string | null;
  eventType: string;
  outcome: AuditOutcome;
  correlationId?: string | null;
  context?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(input: AuditAppendInput): Promise<void> {
    const context = this.sanitizeContext(input.context ?? null);
    try {
      await this.prisma.auditEvent.create({
        data: {
          actorUserId: input.actorUserId ?? null,
          subjectUserId: input.subjectUserId ?? null,
          eventType: input.eventType,
          outcome: input.outcome,
          correlationId: input.correlationId ?? currentCorrelationId() ?? null,
          context: context === null ? Prisma.JsonNull : (context as Prisma.InputJsonValue),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to append audit event ${input.eventType}`, err as Error);
    }
  }

  /** Alias used by AuthService / AdminService. */
  async record(input: AuditAppendInput): Promise<void> {
    return this.append(input);
  }

  /** Recursively strip secret-looking keys from audit context. */
  sanitizeContext(
    context: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!context) {
      return null;
    }
    return this.sanitizeValue(context) as Record<string, unknown>;
  }

  private sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.sanitizeValue(v));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const lower = k.toLowerCase();
        if (
          SECRET_KEYS.has(k) ||
          SECRET_KEYS.has(lower) ||
          lower.includes('password') ||
          lower.includes('secret') ||
          lower.includes('token') ||
          lower.includes('hash')
        ) {
          continue;
        }
        out[k] = this.sanitizeValue(v);
      }
      return out;
    }
    return value;
  }
}
