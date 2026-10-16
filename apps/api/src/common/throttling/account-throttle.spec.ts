import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { AccountThrottle, accountThrottlerOptions, accountTrackerFromBody } from './account-throttle';

class Routes {
  @AccountThrottle(3, 60_000)
  optedIn() {}

  notOptedIn() {}
}

function contextFor(handler: () => void, body: unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext;
}

describe('account throttler', () => {
  const options = accountThrottlerOptions();

  it('tracks by normalized email so case and whitespace variants share one bucket', () => {
    expect(accountTrackerFromBody({ body: { email: '  Trader@Example.COM ' } })).toBe(
      accountTrackerFromBody({ body: { email: 'trader@example.com' } }),
    );
  });

  it('applies only to opted-in routes that carry an email', () => {
    expect(options.skipIf!(contextFor(Routes.prototype.optedIn, { email: 'a@b.co' }))).toBe(false);
    expect(options.skipIf!(contextFor(Routes.prototype.notOptedIn, { email: 'a@b.co' }))).toBe(true);
    expect(options.skipIf!(contextFor(Routes.prototype.optedIn, {}))).toBe(true);
    expect(options.skipIf!(contextFor(Routes.prototype.optedIn, { email: 42 }))).toBe(true);
  });
});
