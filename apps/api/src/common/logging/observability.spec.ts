import { EventEmitter } from 'events';
import { CorrelationIdMiddleware } from '../middleware/correlation-id.middleware';
import { currentCorrelationId } from '../request-context';
import { JsonLogger } from './json-logger';

function fakeReqRes(headers: Record<string, string>) {
  const req = { header: (name: string) => headers[name.toLowerCase()] } as never;
  const res = Object.assign(new EventEmitter(), { setHeader: jest.fn() });
  return { req, res };
}

describe('CorrelationIdMiddleware', () => {
  it('keeps a well-formed inbound ID and exposes it through the request context', () => {
    const { req, res } = fakeReqRes({ 'x-correlation-id': 'abc-123:x.y_z' });
    let seen: string | undefined;
    new CorrelationIdMiddleware().use(req, res as never, () => {
      seen = currentCorrelationId();
    });
    expect(seen).toBe('abc-123:x.y_z');
    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'abc-123:x.y_z');
  });

  it('replaces IDs carrying log-injection characters', () => {
    const { req, res } = fakeReqRes({ 'x-correlation-id': 'evil\nlevel=error' });
    let seen: string | undefined;
    new CorrelationIdMiddleware().use(req, res as never, () => {
      seen = currentCorrelationId();
    });
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('JsonLogger', () => {
  it('writes one JSON object per line with level, context and correlation ID', () => {
    const out: string[] = [];
    const err: string[] = [];
    const logger = new JsonLogger(
      (l) => out.push(l),
      (l) => err.push(l),
    );
    const { req, res } = fakeReqRes({ 'x-correlation-id': 'req-1' });
    new CorrelationIdMiddleware().use(req, res as never, () => {
      logger.log('hello', 'AuthService');
      logger.error('boom', 'stack-trace', 'AdminService');
    });
    expect(JSON.parse(out[0])).toMatchObject({
      level: 'info',
      context: 'AuthService',
      correlationId: 'req-1',
      message: 'hello',
    });
    expect(JSON.parse(err[0])).toMatchObject({ level: 'error', context: 'AdminService', stack: 'stack-trace' });
  });
});
