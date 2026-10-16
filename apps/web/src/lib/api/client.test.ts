import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, getAccessToken, setAccessToken } from '@/lib/auth/tokenStore';
import { apiRequest, extractDetails, onSessionUser, refreshAccessToken } from './client';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API client auth handling', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    clearAccessToken();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares one in-flight refresh between concurrent callers', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));

    const a = refreshAccessToken();
    const b = refreshAccessToken();
    resolve(json(200, { accessToken: 'new-token' }));

    await expect(Promise.all([a, b])).resolves.toEqual(['new-token', 'new-token']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('new-token');
  });

  it('sends refresh with credentials and never a token in the body', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 't' }));
    await refreshAccessToken();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/refresh$/);
    expect(init?.credentials).toBe('include');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
  });

  it('retries once when another tab superseded the refresh token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { errorCode: 'REFRESH_SUPERSEDED' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'winner-token' }));

    await expect(refreshAccessToken()).resolves.toBe('winner-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on other refresh failures and clears the token', async () => {
    setAccessToken('stale');
    fetchMock.mockResolvedValueOnce(json(401, { errorCode: 'REFRESH_REUSE_DETECTED' }));

    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('refreshes on 401 and retries the original request exactly once with the new token', async () => {
    setAccessToken('expired');
    fetchMock
      .mockResolvedValueOnce(json(401, { errorCode: 'INVALID_TOKEN' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'fresh' }))
      .mockResolvedValueOnce(json(200, { id: 'u1' }));

    await expect(apiRequest('/auth/me')).resolves.toEqual({ id: 'u1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh');
  });

  it('surfaces the server errorCode when refresh cannot recover', async () => {
    setAccessToken('expired');
    fetchMock
      .mockResolvedValueOnce(json(401, { errorCode: 'SESSION_REVOKED', message: 'Session revoked' }))
      .mockResolvedValueOnce(json(401, { errorCode: 'REFRESH_INVALID' }));

    await expect(apiRequest('/auth/me')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_REVOKED',
    });
    expect(getAccessToken()).toBeNull();
  });

  it('hands the refreshed user to the session listener so role/status changes apply', async () => {
    const seen: unknown[] = [];
    onSessionUser((u) => seen.push(u));
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 't', user: { id: 'u1', role: 'INVESTOR' } }));
    await refreshAccessToken();
    onSessionUser(null);
    expect(seen).toEqual([{ id: 'u1', role: 'INVESTOR' }]);
  });

  it('exposes server validation details on ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        message: 'Validation failed',
        errorCode: 'VALIDATION_ERROR',
        details: ['email must be an email', 'firstName should not be empty'],
      }),
    );
    await expect(apiRequest('/auth/register', { method: 'POST', auth: false, body: {} })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: ['email must be an email', 'firstName should not be empty'],
    });
  });

  it('does not refresh on 403 step-up failures', async () => {
    setAccessToken('valid');
    fetchMock.mockResolvedValueOnce(json(403, { errorCode: 'MFA_REQUIRED', message: 'Authenticator code required' }));
    await expect(apiRequest('/auth/sessions', { method: 'DELETE', body: {} })).rejects.toMatchObject({
      status: 403,
      code: 'MFA_REQUIRED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('valid');
  });
});

describe('extractDetails', () => {
  it('prefers details, falls back to message arrays and drops non-strings', () => {
    expect(extractDetails({ details: ['a', 3, ''] as unknown as string[] })).toEqual(['a']);
    expect(extractDetails({ message: ['x', 'y'] })).toEqual(['x', 'y']);
    expect(extractDetails({ message: 'single' })).toBeUndefined();
    expect(extractDetails(null)).toBeUndefined();
  });
});
