import { TestBed } from '@angular/core/testing';
import { TokenStore } from '../auth/token-store';
import { ApiClient } from './api-client';
import { ApiError } from './types';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: ApiClient;
  let tokens: TokenStore;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({});
    client = TestBed.inject(ApiClient);
    tokens = TestBed.inject(TokenStore);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends the in-memory bearer token and includes credentials', async () => {
    tokens.set('access-1');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));

    await client.request('/auth/me');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3002/api/auth/me');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer access-1');
    expect(init.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries the original request', async () => {
    tokens.set('expired');
    fetchMock
      .mockResolvedValueOnce(json(401, { errorCode: 'INVALID_TOKEN' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(json(200, { id: 'u1' }));

    await expect(client.request('/auth/me')).resolves.toEqual({ id: 'u1' });

    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:3002/api/auth/refresh');
    expect((fetchMock.mock.calls[2][1].headers as Headers).get('Authorization')).toBe('Bearer access-2');
    expect(tokens.get()).toBe('access-2');
  });

  it('shares one in-flight refresh between concurrent callers', async () => {
    let resolveRefresh!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolveRefresh = r)));

    const a = client.refreshAccessToken();
    const b = client.refreshAccessToken();
    resolveRefresh(json(200, { accessToken: 'shared' }));

    await expect(Promise.all([a, b])).resolves.toEqual(['shared', 'shared']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once after REFRESH_SUPERSEDED (another tab rotated the cookie)', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(json(401, { errorCode: 'REFRESH_SUPERSEDED' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'after-retry' }));

    const pending = client.refreshAccessToken();
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBe('after-retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('turns error bodies into ApiError with the server code and validation details', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { message: 'Validation failed', errorCode: 'VALIDATION_ERROR', details: ['email must be an email'] }),
    );

    const error = await client.request('/auth/login', { method: 'POST', body: {}, auth: false }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: ['email must be an email'] });
  });
});
