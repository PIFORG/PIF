import {
  ArgumentsHost,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './http-exception.filter';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status, setHeader: jest.fn() };
  const request = { method: 'GET', url: '/api/x', correlationId: 'cid-1' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { code: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('keeps explicit errorCode values', () => {
    const { code, body } = run(
      new ForbiddenException({ message: 'no', errorCode: 'SELF_DEMOTION_FORBIDDEN' }),
    );
    expect(code).toBe(403);
    expect(body.errorCode).toBe('SELF_DEMOTION_FORBIDDEN');
    expect(body.correlationId).toBe('cid-1');
  });

  it('maps throttling (string body) to RATE_LIMITED', () => {
    const { code, body } = run(
      new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
    );
    expect(code).toBe(429);
    expect(body.errorCode).toBe('RATE_LIMITED');
  });

  it('uses a stable code instead of Nest default phrases', () => {
    const { body } = run(new NotFoundException());
    expect(body.errorCode).toBe('RESOURCE_NOT_FOUND');
  });

  it('maps database connection failures to 503 without leaking details', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const init = new Prisma.PrismaClientInitializationError(
      'Authentication failed against database server at `localhost`',
      '6.5.0',
      'P1000',
    );
    const { code, body } = run(init);
    expect(code).toBe(503);
    expect(body.errorCode).toBe('DATABASE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('localhost');

    const unreachable = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
      code: 'P1001',
      clientVersion: '6.5.0',
    });
    expect(run(unreachable).code).toBe(503);
  });

  it('keeps other Prisma errors as 500', () => {
    const { code } = run(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.5.0',
      }),
    );
    expect(code).toBe(500);
  });

  it('hides internals of unknown errors', () => {
    const { code, body } = run(new Error('db password=secret'));
    expect(code).toBe(500);
    expect(body.errorCode).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
