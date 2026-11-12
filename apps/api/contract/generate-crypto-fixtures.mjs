// Generates cross-implementation crypto fixtures with the NestJS API's own code and libraries.
// All keys and secrets below are random test-only values created on each run; no value is read
// from any .env file.
//
// Usage (from the repository root, after `npm run build` in apps/api):
//   node apps/api-spring/contract/generate-crypto-fixtures.mjs
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../api');
const require = createRequire(join(apiDir, 'package.json'));

const { hashPassword } = require(join(apiDir, 'dist/common/crypto/password.util.js'));
const tokenUtil = require(join(apiDir, 'dist/common/crypto/token.util.js'));
const { encryptMfaSecret } = require(join(apiDir, 'dist/common/crypto/mfa-crypto.util.js'));
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');

const passwords = ['Correct-Horse-1', 'Pässwörd-✓-2024', 'a1!' + 'x'.repeat(125)];
const argon2 = [];
for (const password of passwords) argon2.push({ password, hash: await hashPassword(password) });

const pepper = randomBytes(24).toString('base64url');
const tokens = Array.from({ length: 3 }, () => tokenUtil.generateOpaqueToken());
const hmac = {
  pepper,
  tokens: tokens.map((token) => ({ token, hash: tokenUtil.hashOpaqueToken(token, pepper) })),
  ips: ['::ffff:127.0.0.1', '::1', ' 10.0.0.1 ', 'x'.repeat(80)].map((ip) => ({
    ip,
    digest: tokenUtil.digestIp(ip, pepper),
  })),
  userAgents: ['Mozilla/5.0 (Windows NT 10.0)', 'evil\r\nheader\0 ', ' '.repeat(3), 'u'.repeat(600)].map((ua) => ({
    ua,
    sanitized: tokenUtil.sanitizeUserAgent(ua),
  })),
};

const mfaKey = randomBytes(32).toString('hex');
const totpSecret = authenticator.generateSecret();
const mfa = { key: mfaKey, plaintext: totpSecret, ciphertext: encryptMfaSecret(totpSecret, mfaKey).ciphertext };

const epochs = [0, 59_000, 1_111_111_109_000, 1_234_567_890_000, Date.UTC(2026, 10, 10, 12, 0, 0)];
const totp = {
  secret: totpSecret,
  vectors: epochs.map((epoch) => {
    authenticator.options = { epoch, window: 1 };
    return { epochMs: epoch, code: authenticator.generate(totpSecret) };
  }),
};
authenticator.resetOptions();

const jwtSecret = randomBytes(32).toString('base64url');
const issuer = 'mtrs-api';
const audience = 'mtrs-web';
const claims = { sub: '3f1c1a52-6d1e-4b8e-9a51-0e6f2d6e4c11', sid: '9a7d3b0c-2c44-4f0a-8d9e-5b1f0c7a2e33', sv: 3 };
const jwtFixture = {
  secret: jwtSecret,
  issuer,
  audience,
  claims,
  valid: jwt.sign(claims, jwtSecret, { algorithm: 'HS256', expiresIn: '3650d', issuer, audience }),
  expired: jwt.sign({ ...claims, iat: 1_000_000_000 }, jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '15m',
    issuer,
    audience,
  }),
  wrongAudience: jwt.sign(claims, jwtSecret, { algorithm: 'HS256', expiresIn: '1d', issuer, audience: 'other' }),
  wrongIssuer: jwt.sign(claims, jwtSecret, { algorithm: 'HS256', expiresIn: '1d', issuer: 'other', audience }),
  wrongSecret: jwt.sign(claims, randomBytes(32).toString('base64url'), {
    algorithm: 'HS256',
    expiresIn: '1d',
    issuer,
    audience,
  }),
};

const out = {
  generatedBy: 'apps/api-spring/contract/generate-crypto-fixtures.mjs (NestJS dist utilities, node ' + process.version + ')',
  note: 'Test-only random keys. Not related to any environment secret.',
  argon2,
  hmac,
  mfa,
  totp,
  jwt: jwtFixture,
};
const target = resolve(here, '../src/test/resources/fixtures/nest-crypto-fixtures.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log('Wrote', target);
