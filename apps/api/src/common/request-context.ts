import { AsyncLocalStorage } from 'async_hooks';
import type { Request } from 'express';

export type RequestContext = { correlationId: string };

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** Accepted inbound correlation IDs; anything else is replaced so logs cannot be forged. */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function currentCorrelationId(): string | undefined {
  return requestContext.getStore()?.correlationId;
}

export function correlationIdOf(req?: Request): string | undefined {
  return (req as (Request & { correlationId?: string }) | undefined)?.correlationId ?? currentCorrelationId();
}
