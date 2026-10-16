import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { JsonLogger } from './common/logging/json-logger';
import { API_TAG_DESCRIPTIONS } from './common/swagger/api-tags';
import { withStandardErrorResponses } from './common/swagger/openapi';

const SWAGGER_DESCRIPTION =
  'An interactive financial simulation platform designed to help users understand financial markets, ' +
  'practice virtual trading, manage portfolios, and make informed investment decisions.';

function trustProxySetting(value: string): boolean | number | string {
  if (value === 'false') return false;
  return /^\d+$/.test(value) ? parseInt(value, 10) : value;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: false,
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  if (config.get<string>('logFormat') === 'json') {
    app.useLogger(new JsonLogger());
  } else {
    app.flushLogs();
  }
  const prefix = config.get<string>('app.apiPrefix') ?? 'api';
  app.setGlobalPrefix(prefix);
  // Only honour X-Forwarded-For from configured proxies; req.ip is then safe to digest.
  app.set('trust proxy', trustProxySetting(config.get<string>('app.trustProxy') ?? 'false'));

  const isProduction = config.get<string>('nodeEnv') === 'production';
  // Helmet's default CSP is compatible with Swagger UI (external scripts, inline styles,
  // data: images). Upgrading to https would break plain-http local development.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: isProduction ? [] : null },
      },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: config.get<string[]>('app.corsOrigins') ?? [],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const docsPath = `${prefix}/docs`;
  const swaggerEnabled = config.get<boolean>('swaggerEnabled') === true;
  if (swaggerEnabled) {
    const swagger = new DocumentBuilder()
      .setTitle('Market Trading Room Simulator API')
      .setDescription(SWAGGER_DESCRIPTION)
      .setVersion('1.0.0')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Paste the short-lived `accessToken` returned by sign-in, MFA verification or token refresh.',
      });
    for (const [name, description] of API_TAG_DESCRIPTIONS) swagger.addTag(name, description);
    const document = withStandardErrorResponses(
      SwaggerModule.createDocument(app, swagger.build(), { autoTagControllers: false }),
    );
    SwaggerModule.setup(docsPath, app, document, {
      jsonDocumentUrl: `${docsPath}-json`,
      customSiteTitle: 'Market Trading Room Simulator API',
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}/${prefix}`);
  if (swaggerEnabled) {
    logger.log(`Swagger UI: http://localhost:${port}/${docsPath} (OpenAPI JSON: /${docsPath}-json)`);
  }
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal: API failed to start', err instanceof Error ? err.message : err);
  process.exit(1);
});
