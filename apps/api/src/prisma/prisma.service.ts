import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Production fails fast when the database is unreachable. Elsewhere the API still boots
   * (docs, health, diagnostics); Prisma reconnects lazily on the next query, and requests that
   * need the database get 503 DATABASE_UNAVAILABLE until it is reachable.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (err) {
      if (process.env.NODE_ENV === 'production') throw err;
      this.logger.warn(
        `Database unavailable at startup; database-backed requests will return 503 until it is reachable. ${firstLine(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.trim().split('\n')[0];
}
