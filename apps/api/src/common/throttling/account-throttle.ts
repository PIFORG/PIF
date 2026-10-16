import { applyDecorators, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Throttle, type ThrottlerOptions } from '@nestjs/throttler';
import { normalizeEmail } from '../crypto/email.util';

export const ACCOUNT_THROTTLER = 'account';
const ACCOUNT_THROTTLE_KEY = 'mtrs:account-throttle';

/**
 * Per-account limit on top of the per-IP default, keyed on the normalized email in the
 * request body. Counts the same whether or not the account exists, so a 429 reveals nothing
 * about registration; it bounds distributed guessing and email flooding of one mailbox.
 */
export function AccountThrottle(limit: number, ttlMs: number) {
  return applyDecorators(
    SetMetadata(ACCOUNT_THROTTLE_KEY, true),
    Throttle({ [ACCOUNT_THROTTLER]: { limit, ttl: ttlMs } }),
  );
}

export function accountTrackerFromBody(req: Record<string, unknown>): string | null {
  const body = req.body as { email?: unknown } | undefined;
  if (!body || typeof body.email !== 'string') return null;
  const email = normalizeEmail(body.email);
  return email.length > 0 && email.length <= 254 ? `acct:${email}` : null;
}

export function accountThrottlerOptions(): ThrottlerOptions {
  return {
    name: ACCOUNT_THROTTLER,
    // Defaults only; every opted-in route sets its own limit through AccountThrottle().
    limit: 10,
    ttl: 15 * 60_000,
    skipIf: (context: ExecutionContext) => {
      const optedIn = Reflect.getMetadata(ACCOUNT_THROTTLE_KEY, context.getHandler()) === true;
      if (!optedIn) return true;
      const req = context.switchToHttp().getRequest<Record<string, unknown>>();
      return accountTrackerFromBody(req) === null;
    },
    getTracker: (req) => accountTrackerFromBody(req) ?? 'acct:none',
  };
}
