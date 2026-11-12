// Verifies, with the NestJS API's own code, artifacts produced by the Spring implementation
// (written by NestCryptoCompatibilityTest to apps/api-spring/target/java-crypto-artifacts.json):
// an Argon2id hash, an AES-256-GCM MFA envelope and an HS256 access token.
//
// Usage (from the repository root): node apps/api-spring/contract/verify-java-artifacts.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '../../api');
const require = createRequire(join(apiDir, 'package.json'));
const { verifyPassword } = require(join(apiDir, 'dist/common/crypto/password.util.js'));
const { decryptMfaSecret } = require(join(apiDir, 'dist/common/crypto/mfa-crypto.util.js'));
const jwt = require('jsonwebtoken');

const artifacts = JSON.parse(readFileSync(resolve(here, '../target/java-crypto-artifacts.json'), 'utf8'));
const results = [];
const check = (name, ok) => results.push({ name, ok });

check('argon2: NestJS verifies the Java hash', await verifyPassword(artifacts.argon2.hash, artifacts.argon2.password));
check('argon2: NestJS rejects a wrong password', !(await verifyPassword(artifacts.argon2.hash, artifacts.argon2.password + 'x')));
check('mfa: NestJS decrypts the Java envelope', decryptMfaSecret(artifacts.mfa.ciphertext, artifacts.mfa.key) === artifacts.mfa.plaintext);

let payload = null;
try {
  payload = jwt.verify(artifacts.jwt.token, artifacts.jwt.secret, {
    algorithms: ['HS256'],
    issuer: 'mtrs-api',
    audience: 'mtrs-web',
  });
} catch (err) {
  payload = null;
}
check('jwt: passport-jwt options accept the Java token', payload !== null);
check('jwt: claims sub/sid/sv/iat/exp/iss/aud present', !!payload && ['sub', 'sid', 'sv', 'iat', 'exp', 'iss', 'aud'].every((k) => k in payload));
check('jwt: lifetime is 15 minutes', !!payload && payload.exp - payload.iat === 900);
const header = JSON.parse(Buffer.from(artifacts.jwt.token.split('.')[0], 'base64url').toString());
check('jwt: header is {alg:HS256, typ:JWT}', header.alg === 'HS256' && header.typ === 'JWT');

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
