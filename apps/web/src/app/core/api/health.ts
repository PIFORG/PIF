import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';
import { ApiError } from './types';

export type ServiceHealth = 'online' | 'degraded' | 'offline';

const CACHE_MS = 60_000;

/**
 * Public `GET /health`: 200 when the API and database are up, 503 when the database is down.
 * Returns null when the status is unknown (e.g. rate limited), so callers show nothing rather than a false alarm.
 * Cached across page navigations because every request counts against the caller's rate limit.
 */
@Injectable({ providedIn: 'root' })
export class HealthApi {
  private readonly api = inject(ApiClient);
  private cached: { value: ServiceHealth | null; at: number } | null = null;
  private inflight: Promise<ServiceHealth | null> | null = null;

  fetchServiceHealth(): Promise<ServiceHealth | null> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return Promise.resolve(this.cached.value);
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      let value: ServiceHealth | null;
      try {
        await this.api.request<{ status: string; database: string }>('/health', { method: 'GET', auth: false });
        value = 'online';
      } catch (err) {
        if (err instanceof ApiError) value = err.status === 503 ? 'degraded' : err.status === 429 ? null : 'offline';
        else value = 'offline';
      }
      this.cached = { value, at: Date.now() };
      return value;
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }
}
