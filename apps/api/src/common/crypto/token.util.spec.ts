import {
  addDuration,
  addMinutes,
  digestIp,
  generateOpaqueToken,
  hashOpaqueToken,
  parseDurationMs,
} from './token.util';

describe('token.util', () => {
  const pepper = 'test-pepper-secret-at-least-32-characters!!';

  it('generates opaque hex tokens', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toEqual(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it('hashes with HMAC-SHA-256 pepper deterministically', () => {
    const token = generateOpaqueToken();
    const h1 = hashOpaqueToken(token, pepper);
    const h2 = hashOpaqueToken(token, pepper);
    expect(h1).toEqual(h2);
    expect(h1).toHaveLength(64);
    expect(hashOpaqueToken(token, pepper + 'x')).not.toEqual(h1);
    expect(h1).not.toContain(token);
  });

  it('digests IPs with pepper', () => {
    expect(digestIp('127.0.0.1', pepper)).toHaveLength(64);
    expect(digestIp(undefined, pepper)).toBeNull();
  });

  it('adds durations', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(addDuration(from, '15m').toISOString()).toBe('2026-01-01T00:15:00.000Z');
    expect(addDuration(from, '7d').toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(addMinutes(from, 30).toISOString()).toBe('2026-01-01T00:30:00.000Z');
  });

  it.each(['', '15', 'm15', '0m', '-5m', '1.5h', '15 minutes', '10w', '9999999d'])(
    'rejects unknown TTL format %p',
    (value) => {
      expect(() => parseDurationMs(value)).toThrow(/Invalid duration/);
    },
  );
});
