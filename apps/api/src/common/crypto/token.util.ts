import { createHmac, randomBytes } from 'crypto';

/** 32 cryptographically random bytes as 64 hex characters. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/** HMAC-SHA-256(pepper, token) hex digest — never store raw tokens. */
export function hashOpaqueToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}

export function digestIp(ip: string | undefined, pepper: string): string | null {
  if (!ip) return null;
  const normalized = ip.trim().slice(0, 64);
  if (!normalized) return null;
  return createHmac('sha256', pepper).update(normalized, 'utf8').digest('hex');
}

export function sanitizeUserAgent(ua: string | undefined): string | null {
  if (!ua) return null;
  return ua.replace(/[\r\n\0]/g, '').trim().slice(0, 512) || null;
}

const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses `<positive integer><s|m|h|d>` (e.g. `15m`, `7d`) into milliseconds; throws otherwise. */
export function parseDurationMs(duration: string): number {
  const match = /^([1-9]\d{0,5})([smhd])$/i.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration format: ${duration} (expected e.g. 15m, 12h, 7d)`);
  }
  return parseInt(match[1], 10) * DURATION_UNIT_MS[match[2].toLowerCase()];
}

export function addDuration(from: Date, duration: string): Date {
  return new Date(from.getTime() + parseDurationMs(duration));
}

export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60_000);
}
