// Differential contract test: NestJS (reference) vs Spring Boot for the authentication slice.
//
// Both APIs must already run against the SAME isolated database whose name ends with _test
// (see apps/api-spring/README.md). The script refuses any other database. It creates disposable
// accounts under @spring-contract.test, never sends email (no registration, no lockout), runs every
// scenario sequentially against both APIs and compares status, error codes, normalized bodies,
// headers and database side effects. It also checks that tokens issued by one implementation are
// honoured by the other.
//
// Usage (repository root):
//   $env:DATABASE_URL = '<url of the *_test database>'   # the same one both APIs use
//   node apps/api-spring/contract/differential-auth.mjs
import { randomUUID } from 'node:crypto';
import {
  NEST, SPRING, ORIGIN, prisma, MFA_KEY, RUN, email, PASSWORD, hashSecret, encryptMfaSecret, authenticator,
  call, cookieValue, record, compare, both, sleep, cleanup, createUser, resetUser, latestAudit, finish, run,
} from './differential-lib.mjs';

const TOTP_SECRET = authenticator.generateSecret();
const RECOVERY_CODES = ['ALPHA1234', 'BRAVO5678', 'CHARL9012'];
// ---------------------------------------------------------------- scenarios

async function main() {
  await cleanup();
  const alice = await createUser('alice');
  const mfaUser = await createUser('mfa', {
    mfaEnabled: true,
    mfaVerifiedAt: new Date(),
    mfaSecretEncrypted: encryptMfaSecret(TOTP_SECRET, MFA_KEY).ciphertext,
    mfaSecretKeyVersion: 1,
  });
  for (const code of RECOVERY_CODES) {
    await prisma.mfaRecoveryCode.create({ data: { id: randomUUID(), userId: mfaUser.id, codeHash: await hashSecret(code) } });
  }
  await createUser('pending', { emailVerified: false, emailVerifiedAt: null, status: 'PENDING_VERIFICATION' });
  await createUser('suspended', { status: 'SUSPENDED' });
  await createUser('deactivated', { status: 'DEACTIVATED' });
  await prisma.userPreferences.create({ data: { id: randomUUID(), userId: alice.id, timezone: 'Africa/Tunis', updatedAt: new Date() } });

  const json = { headers: { Origin: ORIGIN } };

  // Group 1: public routes, validation and error codes (≤ 9 login calls per minute per API).
  await both('GET /health', 'GET', '/api/health');
  await both('GET unknown route → 404', 'GET', '/api/does-not-exist');
  await both('DELETE /health → 404', 'DELETE', '/api/health');
  await both('OPTIONS preflight', 'OPTIONS', '/api/auth/login', {
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  await both('login: validation errors', 'POST', '/api/auth/login', { ...json, body: { email: 'x' + RUN, password: '', extra: 1 } });
  await both('login: empty body', 'POST', '/api/auth/login', { ...json, body: {} });
  await both('login: unknown account', 'POST', '/api/auth/login', { ...json, body: { email: email('nobody'), password: PASSWORD } });
  await both('login: wrong password', 'POST', '/api/auth/login', { ...json, body: { email: email('alice'), password: 'Wrong-Pass-1!' } });
  const failureAudit = await latestAudit(alice.id, 2);
  record('audit: LOGIN_FAILURE rows identical', JSON.stringify(failureAudit[0]) === JSON.stringify(failureAudit[1]), failureAudit);
  const failedCount = (await prisma.user.findUnique({ where: { id: alice.id } })).failedLoginCount;
  record('db: failed_login_count incremented once per API', failedCount === 2, { failedCount });
  await both('login: email not verified', 'POST', '/api/auth/login', { ...json, body: { email: email('pending'), password: PASSWORD } });
  await both('login: suspended', 'POST', '/api/auth/login', { ...json, body: { email: email('suspended'), password: PASSWORD } });
  await both('login: deactivated', 'POST', '/api/auth/login', { ...json, body: { email: email('deactivated'), password: PASSWORD } });
  await both('login: CSRF foreign origin', 'POST', '/api/auth/login', { headers: { Origin: 'http://evil.example' }, body: { email: email('alice'), password: PASSWORD } });
  await both('login: Sec-Fetch-Site cross-site', 'POST', '/api/auth/login', { headers: { 'Sec-Fetch-Site': 'cross-site' }, body: { email: email('alice'), password: PASSWORD } });
  await both('refresh: missing cookie', 'POST', '/api/auth/refresh', json);
  await both('refresh: unknown cookie', 'POST', '/api/auth/refresh', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + 'ab'.repeat(32) } });
  await both('logout: nothing to revoke', 'POST', '/api/auth/logout', json);
  await both('me: no token', 'GET', '/api/auth/me');
  await both('me: garbage token', 'GET', '/api/auth/me', { headers: { Authorization: 'Bearer abc.def.ghi' } });
  await both('verify-login: validation', 'POST', '/api/auth/mfa/verify-login', { ...json, body: { mfaChallengeToken: 'short', totpCode: '12a' } });
  await both('verify-login: no code', 'POST', '/api/auth/mfa/verify-login', { ...json, body: { mfaChallengeToken: 'a'.repeat(64) } });
  await both('verify-login: unknown challenge', 'POST', '/api/auth/mfa/verify-login', { ...json, body: { mfaChallengeToken: 'a'.repeat(64), totpCode: '123456' } });

  console.log('… waiting 61 s for the per-minute login and MFA limits to reset on both APIs');
  await sleep(61_000);
  await resetUser(alice.id);

  // Group 2: successful sign-in on each API, then cross-implementation token continuity.
  const loginN = await call(NEST, 'POST', '/api/auth/login', { ...json, body: { email: email('alice'), password: PASSWORD } });
  const loginS = await call(SPRING, 'POST', '/api/auth/login', { ...json, body: { email: email('alice'), password: PASSWORD } });
  compare('login: success (body, cookie, headers)', loginN, loginS);
  const sessions = await prisma.authSession.findMany({ where: { userId: alice.id }, orderBy: { createdAt: 'asc' } });
  const [sN, sS] = sessions.slice(-2);
  record('db: session metadata identical (user agent, device label, IP digest)',
    sN && sS && sN.userAgent === sS.userAgent && sN.deviceLabel === sS.deviceLabel && sN.ipDigest === sS.ipDigest,
    { nest: sN && { ua: sN.userAgent, label: sN.deviceLabel, ip: !!sN.ipDigest }, spring: sS && { ua: sS.userAgent, label: sS.deviceLabel, ipEqual: sN?.ipDigest === sS?.ipDigest } });
  const expiryDeltaMs = Math.abs(sN.expiresAt - sS.expiresAt);
  record('db: session expiry identical and stored as UTC', expiryDeltaMs < 120_000 &&
    Math.abs(sS.createdAt.getTime() - Date.now()) < 120_000 && Math.abs(sN.createdAt.getTime() - Date.now()) < 120_000,
    { expiryDeltaMs, springCreatedAt: sS.createdAt, nestCreatedAt: sN.createdAt, now: new Date() });
  const successAudit = await latestAudit(alice.id, 2);
  record('audit: LOGIN_SUCCESS rows identical', JSON.stringify(successAudit[0]) === JSON.stringify(successAudit[1]), successAudit);
  const userRow = await prisma.user.findUnique({ where: { id: alice.id } });
  record('db: sign-in resets counters and stamps last_login_at in UTC',
    userRow.failedLoginCount === 0 && userRow.lockedUntil === null && Math.abs(userRow.lastLoginAt.getTime() - Date.now()) < 120_000,
    { failed: userRow.failedLoginCount, lastLoginAt: userRow.lastLoginAt });

  const tokenN = loginN.json.accessToken;
  const tokenS = loginS.json.accessToken;
  await both('me: own token', 'GET', '/api/auth/me', (side) => ({ headers: { Authorization: 'Bearer ' + (side === 'nest' ? tokenN : tokenS) } }));
  await both('me: token issued by the other API', 'GET', '/api/auth/me', (side) => ({ headers: { Authorization: 'Bearer ' + (side === 'nest' ? tokenS : tokenN) } }));
  await both('preferences: GET /auth/me/preferences', 'GET', '/api/auth/me/preferences', { headers: { Authorization: 'Bearer ' + tokenN } });
  await both('preferences: PATCH invalid', 'PATCH', '/api/users/me/preferences', { headers: { Authorization: 'Bearer ' + tokenN }, body: { preferredCurrency: 'XXX', timezone: 'Mars/Base', chartTheme: 'neon', reduceMotion: 'false', trainingDifficulty: 'expert', extra: true } });
  await both('preferences: PATCH valid', 'PATCH', '/api/users/me/preferences', { headers: { Authorization: 'Bearer ' + tokenN }, body: { preferredCurrency: ' eur ', reduceMotion: true } });
  await both('preferences: GET /users/me/preferences', 'GET', '/api/users/me/preferences', { headers: { Authorization: 'Bearer ' + tokenS } });
  await both('preferences: PATCH /auth/me/preferences invalid', 'PATCH', '/api/auth/me/preferences', { headers: { Authorization: 'Bearer ' + tokenS }, body: { chartTheme: 'neon', trainingDifficulty: 'expert', notifyMarketDigest: 'yes' } });
  await both('preferences: PATCH /auth/me/preferences valid', 'PATCH', '/api/auth/me/preferences', { headers: { Authorization: 'Bearer ' + tokenS }, body: { chartTheme: 'dark', trainingDifficulty: 'advanced', timezone: 'Europe/Paris', highContrast: true } });
  await both('preferences: no token', 'GET', '/api/users/me/preferences');
  await both('profile: PATCH invalid', 'PATCH', '/api/auth/me', { headers: { Authorization: 'Bearer ' + tokenS }, body: { firstName: '   ', experienceLevel: 'GURU' } });
  await both('profile: PATCH valid', 'PATCH', '/api/auth/me', { headers: { Authorization: 'Bearer ' + tokenS }, body: { firstName: '\u00a0Alice ', experienceLevel: 'INTERMEDIATE' } });

  // Refresh: the cookie issued by NestJS is rotated by Spring, then reuse is detected by NestJS.
  const cookieN = cookieValue(loginN.rawCookie);
  const cookieS = cookieValue(loginS.rawCookie);
  const refreshS = await call(SPRING, 'POST', '/api/auth/refresh', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + cookieN } });
  const refreshN = await call(NEST, 'POST', '/api/auth/refresh', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + cookieS } });
  compare('refresh: rotation (each API rotates the other API\'s cookie)', refreshN, refreshS);
  const supersededN = await call(NEST, 'POST', '/api/auth/refresh', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + cookieN } });
  const supersededS = await call(SPRING, 'POST', '/api/auth/refresh', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + cookieS } });
  compare('refresh: concurrent-tab grace → REFRESH_SUPERSEDED, cookie kept', supersededN, supersededS);
  console.log('… waiting 16 s to leave the 15 s refresh grace window');
  await sleep(16_000);
  const reuseN = await call(NEST, 'POST', '/api/auth/refresh', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + cookieN } });
  const reuseS = await call(SPRING, 'POST', '/api/auth/refresh', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + cookieS } });
  compare('refresh: reuse after grace → REFRESH_REUSE_DETECTED', reuseN, reuseS);
  const revoked = await prisma.authSession.findMany({ where: { id: { in: [sN.id, sS.id] } } });
  record('db: reuse revokes both sessions with reason REFRESH_REUSE_DETECTED',
    revoked.length === 2 && revoked.every((s) => s.revokedAt && s.revokedReason === 'REFRESH_REUSE_DETECTED'),
    revoked.map((s) => ({ reason: s.revokedReason, revoked: !!s.revokedAt })));
  await both('me: token of a revoked session → SESSION_REVOKED', 'GET', '/api/auth/me', (side) => ({ headers: { Authorization: 'Bearer ' + (side === 'nest' ? tokenN : tokenS) } }));

  // Logout: a session created by one API is signed out by the other.
  const l2N = await call(NEST, 'POST', '/api/auth/login', { ...json, body: { email: email('alice'), password: PASSWORD } });
  const l2S = await call(SPRING, 'POST', '/api/auth/login', { ...json, body: { email: email('alice'), password: PASSWORD } });
  const outS = await call(SPRING, 'POST', '/api/auth/logout', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + cookieValue(l2N.rawCookie), Authorization: 'Bearer ' + l2N.json.accessToken } });
  const outN = await call(NEST, 'POST', '/api/auth/logout', { headers: { Origin: ORIGIN, Cookie: 'mtrs_refresh=' + cookieValue(l2S.rawCookie), Authorization: 'Bearer ' + l2S.json.accessToken } });
  compare('logout: sign out the other API\'s session', outN, outS);
  const logoutAudit = await latestAudit(alice.id, 2);
  record('audit: LOGOUT rows identical', JSON.stringify(logoutAudit[0]) === JSON.stringify(logoutAudit[1]), logoutAudit);
  await both('me: after logout → SESSION_REVOKED', 'GET', '/api/auth/me', (side) => ({ headers: { Authorization: 'Bearer ' + (side === 'nest' ? l2S.json.accessToken : l2N.json.accessToken) } }));

  // Two-step verification. Issuing a challenge revokes the user's previous unused challenge, so each
  // API runs its own challenge → verify sequence before the other API issues one.
  const challenge = (base) => call(base, 'POST', '/api/auth/login', { ...json, body: { email: email('mfa'), password: PASSWORD } });
  const verify = (base, body) => call(base, 'POST', '/api/auth/mfa/verify-login', { ...json, body });

  const oldN = await challenge(NEST);
  const freshN = await challenge(NEST);
  const supersededChN = await verify(NEST, { mfaChallengeToken: oldN.json.mfaChallengeToken, totpCode: '123456' });
  const rcN = await verify(NEST, { mfaChallengeToken: freshN.json.mfaChallengeToken, recoveryCode: 'alpha 1234' });
  const oldS = await challenge(SPRING);
  const freshS = await challenge(SPRING);
  const supersededChS = await verify(SPRING, { mfaChallengeToken: oldS.json.mfaChallengeToken, totpCode: '123456' });
  const rcS = await verify(SPRING, { mfaChallengeToken: freshS.json.mfaChallengeToken, recoveryCode: 'bravo 5678' });
  compare('login: MFA challenge', freshN, freshS);
  compare('mfa: superseded challenge → TOKEN_INVALID', supersededChN, supersededChS);
  compare('mfa: recovery code sign-in (normalized input)', rcN, rcS);
  const used = await prisma.mfaRecoveryCode.count({ where: { userId: mfaUser.id, usedAt: { not: null } } });
  record('db: exactly one recovery code consumed per sign-in', used === 2, { used });

  await resetUser(mfaUser.id);
  const chN = await challenge(NEST);
  const code = authenticator.generate(TOTP_SECRET);
  const vN = await verify(NEST, { mfaChallengeToken: chN.json.mfaChallengeToken, totpCode: code });
  const chS = await challenge(SPRING);
  const replayS = await verify(SPRING, { mfaChallengeToken: chS.json.mfaChallengeToken, totpCode: code });
  record('mfa: Spring rejects a TOTP step already accepted by NestJS (replay protection)',
    vN.status === 200 && replayS.status === 401 && replayS.json?.errorCode === 'MFA_INVALID',
    { nest: vN.status, spring: replayS.status, code: replayS.json?.errorCode });
  const consumedN = await verify(NEST, { mfaChallengeToken: chN.json.mfaChallengeToken, totpCode: code });
  const consumedS = await verify(SPRING, { mfaChallengeToken: chS.json.mfaChallengeToken, totpCode: code });
  record('mfa: a consumed challenge is rejected by both APIs',
    consumedN.status === consumedS.status && consumedN.json?.errorCode === consumedS.json?.errorCode && consumedN.status === 400,
    { nest: [consumedN.status, consumedN.json?.errorCode], spring: [consumedS.status, consumedS.json?.errorCode] });

  console.log('… waiting 61 s for the per-minute MFA limit');
  await sleep(61_000);
  await resetUser(mfaUser.id);
  const ch3N = await challenge(NEST);
  const badN = await verify(NEST, { mfaChallengeToken: ch3N.json.mfaChallengeToken, totpCode: '000000' });
  const ch3S = await challenge(SPRING);
  const badS = await verify(SPRING, { mfaChallengeToken: ch3S.json.mfaChallengeToken, totpCode: '000000' });
  compare('mfa: wrong code → MFA_INVALID', badN, badS);
  const mfaAudit = await latestAudit(mfaUser.id, 2, 'MFA_LOGIN_FAILURE');
  record('audit: MFA_LOGIN_FAILURE rows identical', mfaAudit.length === 2 && JSON.stringify(mfaAudit[0]) === JSON.stringify(mfaAudit[1]), mfaAudit);
  const afterBad = (await prisma.user.findUnique({ where: { id: mfaUser.id } })).failedLoginCount;
  record('db: an MFA failure counts toward lockout on both APIs', afterBad === 2, { afterBad });

  await resetUser(mfaUser.id);
  const ch4N = await challenge(NEST);
  const okN = await verify(NEST, { mfaChallengeToken: ch4N.json.mfaChallengeToken, totpCode: authenticator.generate(TOTP_SECRET) });
  await resetUser(mfaUser.id);
  const ch4S = await challenge(SPRING);
  const okS = await verify(SPRING, { mfaChallengeToken: ch4S.json.mfaChallengeToken, totpCode: authenticator.generate(TOTP_SECRET) });
  compare('mfa: TOTP sign-in success', okN, okS);
  const mfaOkAudit = await latestAudit(mfaUser.id, 2, 'LOGIN_SUCCESS');
  record('audit: LOGIN_SUCCESS {mfa:true} rows identical', JSON.stringify(mfaOkAudit[0]) === JSON.stringify(mfaOkAudit[1]), mfaOkAudit);

  await finish('differential-auth-report');
}

run(main);
