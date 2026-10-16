import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CsrfGuard } from './csrf.guard';

type Req = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string>;
};

function guard(nodeEnv = 'production') {
  const values: Record<string, unknown> = {
    'cookie.name': 'mtrs_refresh',
    'app.corsOrigins': ['https://app.example.com'],
    'app.apiUrl': 'https://api.example.com/',
    nodeEnv,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new CsrfGuard(config);
}

function ctx(req: Partial<Req>): ExecutionContext {
  const full: Req = { method: 'POST', path: '/api/auth/login', headers: {}, ...req };
  return { switchToHttp: () => ({ getRequest: () => full }) } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  it('lets safe methods through', () => {
    expect(guard().canActivate(ctx({ method: 'GET', headers: { origin: 'https://evil.test' } }))).toBe(true);
  });

  it('accepts an allowlisted Origin and rejects any other Origin, including "null"', () => {
    expect(guard().canActivate(ctx({ headers: { origin: 'https://app.example.com' } }))).toBe(true);
    expect(() => guard().canActivate(ctx({ headers: { origin: 'https://evil.test' } }))).toThrow(ForbiddenException);
    expect(() => guard().canActivate(ctx({ headers: { origin: 'null' } }))).toThrow(ForbiddenException);
  });

  it("accepts the API's own origin (its Swagger UI) but not look-alikes", () => {
    expect(guard().canActivate(ctx({ headers: { origin: 'https://api.example.com' } }))).toBe(true);
    expect(() =>
      guard().canActivate(ctx({ headers: { origin: 'https://api.example.com.evil.test' } })),
    ).toThrow(ForbiddenException);
    expect(() => guard().canActivate(ctx({ headers: { origin: 'http://api.example.com' } }))).toThrow(
      ForbiddenException,
    );
  });

  it('does not let Sec-Fetch-Site override a foreign Origin', () => {
    expect(() =>
      guard().canActivate(ctx({ headers: { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' } })),
    ).toThrow(ForbiddenException);
  });

  it('does not trust same-site on its own (sibling subdomains)', () => {
    expect(() => guard().canActivate(ctx({ headers: { 'sec-fetch-site': 'same-site' } }))).toThrow(
      ForbiddenException,
    );
    expect(
      guard().canActivate(
        ctx({ headers: { 'sec-fetch-site': 'same-site', referer: 'https://app.example.com/login' } }),
      ),
    ).toBe(true);
  });

  it('accepts same-origin and user-initiated fetches without Origin; rejects cross-site', () => {
    expect(guard().canActivate(ctx({ headers: { 'sec-fetch-site': 'same-origin' } }))).toBe(true);
    expect(guard().canActivate(ctx({ headers: { 'sec-fetch-site': 'none' } }))).toBe(true);
    expect(() => guard().canActivate(ctx({ headers: { 'sec-fetch-site': 'cross-site' } }))).toThrow(
      ForbiddenException,
    );
  });

  it('falls back to the Referer origin', () => {
    expect(guard().canActivate(ctx({ headers: { referer: 'https://app.example.com/x?y=1' } }))).toBe(true);
    expect(() => guard().canActivate(ctx({ headers: { referer: 'https://evil.test/' } }))).toThrow(ForbiddenException);
    expect(() => guard().canActivate(ctx({ headers: { referer: 'not a url' } }))).toThrow(ForbiddenException);
  });

  it('rejects requests with no origin signal in production only', () => {
    expect(() => guard('production').canActivate(ctx({}))).toThrow(ForbiddenException);
    expect(guard('development').canActivate(ctx({}))).toBe(true);
  });

  it('skips Bearer-only requests unless they carry the refresh cookie or target cookie routes', () => {
    const bearer = { authorization: 'Bearer abc', origin: 'https://evil.test' };
    expect(guard().canActivate(ctx({ path: '/api/auth/mfa/setup', headers: bearer }))).toBe(true);
    expect(() =>
      guard().canActivate(ctx({ path: '/api/auth/mfa/setup', headers: bearer, cookies: { mtrs_refresh: 'r' } })),
    ).toThrow(ForbiddenException);
    expect(() => guard().canActivate(ctx({ path: '/api/auth/logout', headers: bearer }))).toThrow(ForbiddenException);
  });
});
