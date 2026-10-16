import { apiRequest } from './client';
import { ApiError } from './types';

export type ServiceHealth = 'online' | 'degraded' | 'offline';

const CACHE_MS = 60_000;
let cached: { value: ServiceHealth | null; at: number } | null = null;
let inflight: Promise<ServiceHealth | null> | null = null;

/**
 * Public `GET /health`: 200 when the API and database are up, 503 when the database is down.
 * Returns null when the status is unknown (e.g. rate limited), so callers show nothing rather than a false alarm.
 * Cached across page navigations because every request counts against the caller's rate limit.
 */
export async function fetchServiceHealth(): Promise<ServiceHealth | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (inflight) return inflight;
  inflight = (async () => {
    let value: ServiceHealth | null;
    try {
      await apiRequest<{ status: string; database: string }>('/health', { method: 'GET', auth: false });
      value = 'online';
    } catch (err) {
      if (err instanceof ApiError) value = err.status === 503 ? 'degraded' : err.status === 429 ? null : 'offline';
      else value = 'offline';
    }
    cached = { value, at: Date.now() };
    return value;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
