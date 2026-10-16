import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/** Prisma connection-level failures: credentials, unreachable server, timeouts, closed connection. */
const DATABASE_UNAVAILABLE_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

function isDatabaseUnavailable(exception: unknown): boolean {
  if (exception instanceof Prisma.PrismaClientInitializationError) return true;
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    return DATABASE_UNAVAILABLE_CODES.has(exception.code);
  }
  return false;
}

function defaultErrorCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'RESOURCE_NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred';
    let errorCode = 'INTERNAL_ERROR';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      errorCode = defaultErrorCode(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = status === HttpStatus.TOO_MANY_REQUESTS ? 'Too many requests. Please try again later.' : body;
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        message = (obj.message as string) || message;
        // Nest's default `error` field is a human phrase ("Not Found"), not a stable code.
        errorCode = (obj.errorCode as string) || errorCode;
        details = obj.details;
        if (Array.isArray(obj.message)) {
          message = 'Validation failed';
          errorCode = 'VALIDATION_ERROR';
          details = obj.message;
        }
      }
    } else if (isDatabaseUnavailable(exception)) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'The service is temporarily unavailable. Please try again later.';
      errorCode = 'DATABASE_UNAVAILABLE';
      this.logger.warn(
        `Database unavailable on ${request.method} ${(request.originalUrl ?? request.url).split('?')[0]}`,
      );
    } else {
      this.logger.error(
        `Unhandled error on ${request.method} ${(request.originalUrl ?? request.url).split('?')[0]}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({
      statusCode: status,
      message,
      errorCode,
      details: details ?? undefined,
      correlationId: (request as Request & { correlationId?: string }).correlationId,
    });
  }
}
