import {
  ApiError,
  type ApiErrorBody,
  type User,
} from './types';
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '@/lib/auth/tokenStore';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
  'http://localhost:3001/api';

const AUTH_CHANNEL = 'mtrs-auth';

export type AuthChannelMessage = { type: 'logout' } | { type: 'login' };

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  auth?: boolean;
  /** Skip 401 → refresh → retry (used by refresh itself). */
  skipRefresh?: boolean;
  credentialsMode?: RequestCredentials;
};

let refreshPromise: Promise<string | null> | null = null;
let sessionUserListener: ((user: User) => void) | null = null;

/** Receives the user returned by every successful refresh (role/status may have changed). */
export function onSessionUser(listener: ((user: User) => void) | null): void {
  sessionUserListener = listener;
}

function postAuthMessage(message: AuthChannelMessage): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
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

export function subscribeAuthChannel(
  handler: (message: AuthChannelMessage) => void,
): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return () => undefined;
  }
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
  const source = Array.isArray(body?.details)
    ? body.details
    : Array.isArray(body?.message)
      ? body.message
      : undefined;
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

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const doRefresh = () =>
        fetch(`${API_URL}/auth/refresh`, {
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
        clearAccessToken();
        return null;
      }

      const data = (await parseJsonSafe(res)) as {
        accessToken?: string;
        user?: User;
      } | null;

      if (!data?.accessToken) {
        clearAccessToken();
        return null;
      }

      setAccessToken(data.accessToken);
      if (data.user) sessionUserListener?.(data.user);
      return data.accessToken;
    } catch {
      clearAccessToken();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    body,
    auth = true,
    skipRefresh = false,
    credentialsMode,
    headers: initHeaders,
    ...rest
  } = options;

  const headers = new Headers(initHeaders);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (auth) {
    const token = getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const useCredentials =
    credentialsMode ?? (auth || path.startsWith('/auth/') ? 'include' : 'same-origin');

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers,
    credentials: useCredentials,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && auth && !skipRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
    clearAccessToken();
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

export { API_URL, refreshAccessToken };
