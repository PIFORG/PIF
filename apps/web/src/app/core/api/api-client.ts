import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { TokenStore } from '../auth/token-store';
import { ApiError, type ApiErrorBody, type User } from './types';

const AUTH_CHANNEL = 'mtrs-auth';

export type AuthChannelMessage = { type: 'logout' } | { type: 'login' };

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  auth?: boolean;
  /** Skip 401 → refresh → retry (used by refresh itself). */
  skipRefresh?: boolean;
  credentialsMode?: RequestCredentials;
}

function postAuthMessage(message: AuthChannelMessage): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // Cross-tab sync is best effort.
  }
}

export function broadcastLogout(): void {
  postAuthMessage({ type: 'logout' });
}

export function broadcastLogin(): void {
  postAuthMessage({ type: 'login' });
}

export function subscribeAuthChannel(handler: (message: AuthChannelMessage) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(AUTH_CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as Partial<AuthChannelMessage> | null;
    if (data?.type === 'logout' || data?.type === 'login') handler(data as AuthChannelMessage);
  };
  return () => channel.close();
}

function formatErrorMessage(body: ApiErrorBody | null, status: number): string {
  if (!body) return `Request failed (${status})`;
  if (Array.isArray(body.message)) {
    return body.message.join('. ') || `Request failed (${status})`;
  }
  if (typeof body.message === 'string' && body.message.trim()) {
    return body.message;
  }
  return body.error || `Request failed (${status})`;
}

/** Server validation messages arrive in `details` (or, from older handlers, `message[]`). */
export function extractDetails(body: ApiErrorBody | null): string[] | undefined {
  const source = Array.isArray(body?.details) ? body.details : Array.isArray(body?.message) ? body.message : undefined;
  const messages = source?.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
  return messages && messages.length ? messages : undefined;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * fetch-based client with the same contract as apps/web/src/lib/api/client.ts: bearer access token from
 * memory, HttpOnly refresh cookie, a single in-flight refresh shared by concurrent 401s, and one retry
 * when another tab rotated the refresh cookie first (REFRESH_SUPERSEDED).
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  readonly baseUrl = environment.apiUrl.replace(/\/$/, '');
  private readonly tokens = inject(TokenStore);
  private refreshPromise: Promise<string | null> | null = null;
  private sessionUserListener: ((user: User) => void) | null = null;

  /** Receives the user returned by every successful refresh (role/status may have changed). */
  onSessionUser(listener: ((user: User) => void) | null): void {
    this.sessionUserListener = listener;
  }

  refreshAccessToken(): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const doRefresh = () =>
          fetch(`${this.baseUrl}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });

        let res = await doRefresh();

        // Another tab rotated the shared cookie first; the browser now holds the
        // replacement, so retry exactly once after a short pause.
        if (res.status === 401) {
          const body = (await parseJsonSafe(res.clone())) as { errorCode?: string } | null;
          if (body?.errorCode === 'REFRESH_SUPERSEDED') {
            await new Promise((resolve) => setTimeout(resolve, 250));
            res = await doRefresh();
          }
        }

        if (!res.ok) {
          this.tokens.clear();
          return null;
        }

        const data = (await parseJsonSafe(res)) as { accessToken?: string; user?: User } | null;
        if (!data?.accessToken) {
          this.tokens.clear();
          return null;
        }

        this.tokens.set(data.accessToken);
        if (data.user) this.sessionUserListener?.(data.user);
        return data.accessToken;
      } catch {
        this.tokens.clear();
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, auth = true, skipRefresh = false, credentialsMode, headers: initHeaders, ...rest } = options;

    const headers = new Headers(initHeaders);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    if (auth) {
      const token = this.tokens.get();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    const useCredentials = credentialsMode ?? (auth || path.startsWith('/auth/') ? 'include' : 'same-origin');

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...rest,
      headers,
      credentials: useCredentials,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && auth && !skipRefresh) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        return this.request<T>(path, { ...options, skipRefresh: true });
      }
      this.tokens.clear();
      broadcastLogout();
    }

    const payload = await parseJsonSafe(res);

    if (!res.ok) {
      const errBody = (payload ?? null) as ApiErrorBody | null;
      throw new ApiError(
        res.status,
        formatErrorMessage(errBody, res.status),
        errBody?.errorCode ?? errBody?.code,
        extractDetails(errBody),
      );
    }

    return payload as T;
  }
}
