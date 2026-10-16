import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { EmailModule } from './email/email.module';
import { AccessLogMiddleware } from './common/middleware/access-log.middleware';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { NoStoreMiddleware } from './common/middleware/no-store.middleware';
import { accountThrottlerOptions } from './common/throttling/account-throttle';
import { HealthModule } from './health/health.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: (config.get<number>('auth.rateLimitTtl') ?? 60) * 1000,
          limit: config.get<number>('auth.rateLimitLimit') ?? 20,
        },
        accountThrottlerOptions(),
      ],
    }),
    PrismaModule,
    AuditModule,
    EmailModule,
    AuthModule,
    UsersModule,
    AdminModule,
    MaintenanceModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware, AccessLogMiddleware, NoStoreMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
