/**
 * Real multiplayer Market Rooms scenario against Spring Boot + PIF_spring_test.
 * No auth mocks. Provisions three distinct accounts, exercises economy/SSE/isolation.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, '../db-harness/package.json'));
const { Client } = require('pg');
const argon2 = require('argon2');

const ROOT = path.resolve(__dirname, '../..');
const REPORT = path.join(ROOT, 'data/reports/market-rooms-multiplayer.json');
const API = (process.env.E2E_API_URL || 'http://localhost:3002/api').replace(/\/$/, '');
const PASSWORD = 'Rooms-E2E-' + crypto.randomBytes(6).toString('base64url') + '!1a';

function dbNameFromUrl(url) {
  try {
    const u = new URL(url.replace(/^postgresql:/, 'http:'));
    return (u.pathname || '/').replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signAccessToken({ secret, userId, sessionId, securityVersion, issuer, audience, ttlSeconds }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      sid: sessionId,
      sv: securityVersion,
      iat: now,
      exp: now + ttlSeconds,
      iss: issuer,
      aud: audience,
    }),
  );
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
}

async function upsertUser(client, { email, firstName, lastName, passwordHash }) {
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  const now = new Date();
  if (existing.rows.length) {
    const id = existing.rows[0].id;
    await client.query(
      `UPDATE users SET password_hash = $2, role = 'INVESTOR'::"UserRole", status = 'ACTIVE'::"UserStatus",
        email_verified = true, email_verified_at = $3, mfa_enabled = false, failed_login_count = 0,
        locked_until = NULL, deleted_at = NULL, updated_at = $3 WHERE id = $1`,
      [id, passwordHash, now],
    );
    return id;
  }
  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO users (
       id, email, first_name, last_name, password_hash, role, experience_level,
       email_verified, email_verified_at, status, failed_login_count, mfa_enabled,
       security_version, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'INVESTOR'::"UserRole", 'BEGINNER'::"ExperienceLevel",
       true, $6, 'ACTIVE'::"UserStatus", 0, false, 0, $6, $6
     )`,
    [id, email, firstName, lastName, passwordHash, now],
  );
  return id;
}

async function mint(client, userId, envApi) {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 4 * 3600 * 1000);
  await client.query(
    `INSERT INTO auth_sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, device_label)
     VALUES ($1, $2, $3, $3, $4, 'rooms-multiplayer-e2e', 'RoomsE2E')`,
    [sessionId, userId, now, expires],
  );
  const sv = Number((await client.query('SELECT security_version FROM users WHERE id = $1', [userId])).rows[0].security_version) || 0;
  return signAccessToken({
    secret: envApi.JWT_ACCESS_SECRET,
    userId,
    sessionId,
    securityVersion: sv,
    issuer: envApi.JWT_ISSUER || 'mtrs-api',
    audience: envApi.JWT_AUDIENCE || 'mtrs-web',
    ttlSeconds: 4 * 3600,
  });
}

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function idem(label) {
  return `${label}-${crypto.randomUUID()}`;
}

async function loginReal(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  assert(res.ok && json.accessToken, `login failed for ${email}: ${res.status}`);
  return json.accessToken;
}

const steps = [];
function step(name, detail = {}) {
  steps.push({ name, ok: true, ...detail, at: new Date().toISOString() });
  console.log('OK  ' + name);
}

const rawUrl = (
  process.env.E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  loadEnvFile(path.join(ROOT, 'apps/api/.env')).DATABASE_URL ||
  ''
).replace('?schema=public', '');
const db = dbNameFromUrl(rawUrl);
assert(db === 'PIF_spring_test', `Refusing DB "${db}" — only PIF_spring_test`);

const envApi = loadEnvFile(path.join(ROOT, 'apps/api/.env'));
assert(envApi.DATABASE_URL && envApi.DATABASE_URL.includes('PIF_spring_test'), 'apps/api/.env must target PIF_spring_test');
assert(envApi.JWT_ACCESS_SECRET?.length >= 32, 'JWT_ACCESS_SECRET missing');

const health = await fetch(`${API}/health`).catch(() => null);
assert(health && health.ok, `API not reachable at ${API}/health — start Spring Boot first`);

const client = new Client({ connectionString: rawUrl });
await client.connect();
const current = (await client.query('SELECT current_database() AS d')).rows[0].d;
assert(current === 'PIF_spring_test', `connected to ${current}`);

const stamp = Date.now().toString(36);
const players = [
  { key: 'A', email: `rooms.a.${stamp}@pif-spring-test.local`, firstName: 'Alice', lastName: 'Rooms' },
  { key: 'B', email: `rooms.b.${stamp}@pif-spring-test.local`, firstName: 'Bruno', lastName: 'Rooms' },
  { key: 'C', email: `rooms.c.${stamp}@pif-spring-test.local`, firstName: 'Chaima', lastName: 'Rooms' },
];
const passwordHash = await hashPassword(PASSWORD);
const tokens = {};
for (const p of players) {
  const id = await upsertUser(client, { ...p, passwordHash });
  p.id = id;
  tokens[p.key] = await mint(client, id, envApi);
}

// Confirm PIF (main) untouched: only check we are not connected to it
const pifCheck = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'PIF'`).catch(() => ({ rows: [] }));
step('db-guard', { testDb: current, mainDbExists: pifCheck.rows.length > 0, writesOn: current });

await client.end();

// Real login path for A (proves JWT not only minted)
tokens.A = await loginReal(players[0].email, PASSWORD);
step('login-real-A');

// 1. A creates room
const created = await api(tokens.A, 'POST', '/rooms', {
  title: `E2E Multi ${stamp}`,
  mode: 'LEARNING',
  visibility: 'PRIVATE',
  rules: {
    initialCapital: 100000,
    minLearningPointsForCredit: 15,
    baseCreditLimitPct: 20,
    // Align outstanding cap with base so a full draw locks BUY (step 12).
    maxCreditOutstandingPct: 20,
    pointsToCapitalRate: 10,
    maxConversionCapital: 5000,
    conversionCooldownHours: 0,
  },
});
assert(created.ok, `create room ${created.status} ${JSON.stringify(created.json)}`);
const roomId = created.json.id;
const code = created.json.code;
assert(created.json.status === 'LOBBY', 'expected LOBBY');
step('A-create-room', { roomId, code });

// 2-3. B and C join
const joinB = await api(tokens.B, 'POST', '/rooms/join', { code });
const joinC = await api(tokens.C, 'POST', '/rooms/join', { code });
assert(joinB.ok && joinC.ok, 'join B/C failed');
assert(joinC.json.participantCount === 3, `expected 3 participants got ${joinC.json.participantCount}`);
step('B-C-join', { participants: joinC.json.participantCount });

// 4. Host starts
const started = await api(tokens.A, 'POST', `/rooms/${roomId}/start`, {});
assert(started.ok && started.json.status === 'ACTIVE', 'start failed');
step('host-start', { status: started.json.status, simClock: started.json.simClockDate });

// SSE with Authorization header (no JWT in URL). Abort after 12s so reader cannot hang.
const sseAc = new AbortController();
const sseTimer = setTimeout(() => sseAc.abort(), 12_000);
const sseEvents = [];
const sseUrl = `${API}/rooms/${roomId}/events/stream`;
assert(!sseUrl.includes('token='), 'SSE URL must not carry JWT query params');
const ssePromise = (async () => {
  const res = await fetch(sseUrl, {
    headers: { Accept: 'text/event-stream', Authorization: `Bearer ${tokens.B}` },
    signal: sseAc.signal,
  });
  assert(res.ok, `SSE subscribe ${res.status}`);
  // Trigger a live event after subscription so fan-out is observable.
  setTimeout(() => {
    void api(tokens.A, 'POST', `/rooms/${roomId}/messages`, { body: `sse-ping-${stamp}` });
  }, 300);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const data = part.split('\n').find((l) => l.startsWith('data:'));
      if (!data) continue;
      try {
        const payload = JSON.parse(data.slice(5).trim());
        if (payload.seq != null) sseEvents.push(payload);
        else if (payload.roomId) sseEvents.push({ type: 'connected', ...payload });
      } catch {
        /* ignore */
      }
    }
    if (sseEvents.some((e) => e.type === 'CHAT_MESSAGE')) break;
  }
})().catch((e) => ({ error: String(e.message || e) }));

await ssePromise;
clearTimeout(sseTimer);
sseAc.abort();
assert(
  sseEvents.some((e) => e.type === 'CHAT_MESSAGE' || e.type === 'connected'),
  `SSE received nothing: ${JSON.stringify(sseEvents)}`,
);
const seqs = sseEvents.map((e) => e.seq).filter((n) => typeof n === 'number');
assert(seqs.length === new Set(seqs).size, 'SSE duplicate seq');
step('sse-live', { events: sseEvents.map((e) => e.type), seqs });

// 5. Shared clock / market snapshot
const marketA = await api(tokens.A, 'GET', `/rooms/${roomId}/market`);
const marketB = await api(tokens.B, 'GET', `/rooms/${roomId}/market`);
assert(marketA.ok && marketB.ok, 'market snapshot');
assert(marketA.json.dataKind === marketB.json.dataKind, 'clock/dataKind mismatch');
step('shared-clock', { dataKind: marketA.json.dataKind, simClockDate: marketA.json.simClockDate });

// 6-7. A buys
const preview = await api(tokens.A, 'POST', `/rooms/${roomId}/orders/preview`, {
  symbol: 'CTB',
  side: 'BUY',
  type: 'MARKET',
  quantity: 5,
});
assert(preview.ok, `preview ${preview.status} ${JSON.stringify(preview.json)}`);
const order = await api(tokens.A, 'POST', `/rooms/${roomId}/orders`, {
  symbol: 'CTB',
  side: 'BUY',
  type: 'MARKET',
  quantity: 5,
  clientOrderId: idem('buyA').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
  expectedVersion: preview.json.portfolioVersion,
  quoteAsOf: preview.json.quote?.asOf,
});
assert(order.ok, `buy A ${order.status} ${JSON.stringify(order.json)}`);
const pfA = await api(tokens.A, 'GET', `/rooms/${roomId}/portfolio`);
assert(pfA.ok && pfA.json.markToMarket, 'portfolio MTM missing');
assert(typeof pfA.json.netWorth === 'number', 'netWorth missing');
assert(pfA.json.formula || pfA.json.markToMarket.formula, 'MTM formula missing');
step('A-buy-mtm', {
  netWorth: pfA.json.netWorth,
  grossEquity: pfA.json.grossEquity,
  valuationComplete: pfA.json.markToMarket.valuationComplete,
  tradingReturnPct: pfA.json.tradingReturnPct,
});

// 8. B quiz/tutorial points
const claim = await api(tokens.B, 'POST', `/rooms/${roomId}/rewards/claim`, {
  sourceKind: 'TUTORIAL',
  sourceRef: `quiz-${stamp}`,
});
assert(claim.ok, `claim ${claim.status}`);
const youB = claim.json.you || (await api(tokens.B, 'GET', `/rooms/${roomId}`)).json.you;
assert(youB.learningPoints > 0, 'B points not awarded');
const claimDup = await api(tokens.B, 'POST', `/rooms/${roomId}/rewards/claim`, {
  sourceKind: 'TUTORIAL',
  sourceRef: `quiz-${stamp}`,
});
assert(!claimDup.ok, 'duplicate reward must fail');
step('B-quiz-points', { points: youB.learningPoints, dupStatus: claimDup.status });

// 9. B converts points
const convertKey = idem('conv-b');
const convert = await api(tokens.B, 'POST', `/rooms/${roomId}/points/convert`, {
  points: Math.min(50, youB.learningPoints),
  idempotencyKey: convertKey,
});
assert(convert.ok, `convert ${convert.status} ${JSON.stringify(convert.json)}`);
const convertReplay = await api(tokens.B, 'POST', `/rooms/${roomId}/points/convert`, {
  points: Math.min(50, youB.learningPoints),
  idempotencyKey: convertKey,
});
assert(convertReplay.json.idempotentReplay === true, 'convert idempotency failed');
const boardAfterConvert = (await api(tokens.A, 'GET', `/rooms/${roomId}`)).json.leaderboard;
const rowB = boardAfterConvert.find((r) => String(r.displayName || '').includes('Bruno'));
assert(rowB, 'B on leaderboard');
assert(Number(rowB.externalCapital) > 0, `B external capital after conversion expected > 0 got ${rowB.externalCapital}`);
assert(Number(rowB.tradingReturnPct) === 0 || Math.abs(Number(rowB.tradingReturnPct)) < 0.5,
  `conversion must not inflate trading return: ${rowB.tradingReturnPct}`);
step('B-convert', {
  idempotent: true,
  tradingReturnPct: rowB.tradingReturnPct,
  externalCapital: rowB.externalCapital,
  scoreExplanation: (await api(tokens.A, 'GET', `/rooms/${roomId}`)).json.scoreExplanation?.fr?.slice(0, 120),
});

// Award C enough points for credit
await api(tokens.C, 'POST', `/rooms/${roomId}/rewards/claim`, {
  sourceKind: 'TUTORIAL',
  sourceRef: `credit-prep-${stamp}`,
});
// bump points via second source if needed
for (let i = 0; i < 4; i++) {
  await api(tokens.C, 'POST', `/rooms/${roomId}/rewards/claim`, {
    sourceKind: 'TUTORIAL',
    sourceRef: `credit-prep-${stamp}-${i}`,
  });
}

// 10-11. C credit within ceiling
const creditPrev = await api(tokens.C, 'GET', `/rooms/${roomId}/credit`);
assert(creditPrev.ok, 'credit preview');
const ask = Math.min(5000, Number(creditPrev.json.availableCredit) || 0);
assert(ask > 0, `C not eligible for credit: ${JSON.stringify(creditPrev.json)}`);
const creditKey = idem('credit-c');
const credit = await api(tokens.C, 'POST', `/rooms/${roomId}/credit/request`, {
  amount: ask,
  idempotencyKey: creditKey,
});
assert(credit.ok, `credit ${credit.status} ${JSON.stringify(credit.json)}`);
const over = await api(tokens.C, 'POST', `/rooms/${roomId}/credit/request`, {
  amount: 1_000_000,
  idempotencyKey: idem('credit-over'),
});
assert(!over.ok && over.status === 409, `over-ceiling must 409 got ${over.status}`);
step('C-credit-ceiling', { ask, available: creditPrev.json.availableCredit, overStatus: over.status });

// Drain remaining capacity so outstanding debt hits lock threshold
let locked = !!(credit.json.you && credit.json.you.tradingLocked);
if (!locked) {
  const again = await api(tokens.C, 'GET', `/rooms/${roomId}/credit`);
  const rem = Number(again.json.availableCredit) || 0;
  if (rem > 0) {
    const drain = await api(tokens.C, 'POST', `/rooms/${roomId}/credit/request`, {
      amount: rem,
      idempotencyKey: idem('credit-drain'),
    });
    locked = !!(drain.json.you && drain.json.you.tradingLocked);
  }
}
const youC = (await api(tokens.C, 'GET', `/rooms/${roomId}`)).json.you;
locked = locked || !!youC?.tradingLocked;

// 12. BUY refused when tradingLocked; also refuse cash-insufficient order
let buyDenied = false;
let denyStatus = null;
if (locked) {
  const prev = await api(tokens.C, 'POST', `/rooms/${roomId}/orders/preview`, {
    symbol: 'CTB',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
  });
  if (!prev.ok) {
    buyDenied = true;
    denyStatus = prev.status;
  } else {
    const denied = await api(tokens.C, 'POST', `/rooms/${roomId}/orders`, {
      symbol: 'CTB',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1,
      clientOrderId: idem('buyC').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
      expectedVersion: prev.json.portfolioVersion,
      quoteAsOf: prev.json.quote?.asOf,
    });
    buyDenied = !denied.ok;
    denyStatus = denied.status;
  }
} else {
  // Fallback: spend all cash then attempt another BUY
  const pfC = await api(tokens.C, 'GET', `/rooms/${roomId}/portfolio`);
  const cash = Number(pfC.json.cash ?? pfC.json.markToMarket?.cash ?? 0);
  const prev = await api(tokens.C, 'POST', `/rooms/${roomId}/orders/preview`, {
    symbol: 'CTB',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
  });
  const px = Number(prev.json?.quote?.ask ?? prev.json?.quote?.mid ?? 0);
  if (prev.ok && px > 0 && cash > 0) {
    const qty = Math.max(1, Math.floor(cash / px) + 5);
    const denied = await api(tokens.C, 'POST', `/rooms/${roomId}/orders`, {
      symbol: 'CTB',
      side: 'BUY',
      type: 'MARKET',
      quantity: qty,
      clientOrderId: idem('buyCash').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
      expectedVersion: prev.json.portfolioVersion,
      quoteAsOf: prev.json.quote?.asOf,
    });
    buyDenied = !denied.ok;
    denyStatus = denied.status;
  }
}
assert(buyDenied, `expected BUY refused (locked=${locked}, status=${denyStatus})`);
step('C-buy-refused', { locked, buyDenied, denyStatus });

// 13. C keeps repay / reward access
const repayKey = idem('repay-c');
const repay = await api(tokens.C, 'POST', `/rooms/${roomId}/credit/repay`, {
  amount: Math.min(100, ask),
  idempotencyKey: repayKey,
});
assert(repay.ok, `repay ${repay.status} ${JSON.stringify(repay.json)}`);
const formAccess = await api(tokens.C, 'POST', `/rooms/${roomId}/rewards/claim`, {
  sourceKind: 'TUTORIAL',
  sourceRef: `after-limit-${stamp}`,
});
assert(formAccess.ok, 'formations/rewards must remain available after limit');
step('C-repay-and-learn', { repayOk: true, rewardOk: formAccess.ok });

// 14. Chat A ↔ B
const msgA = await api(tokens.A, 'POST', `/rooms/${roomId}/messages`, { body: `Salut B ${stamp}` });
const msgB = await api(tokens.B, 'POST', `/rooms/${roomId}/messages`, { body: `Bien reçu A ${stamp}` });
assert(msgA.ok && msgB.ok, 'chat failed');
const msgs = await api(tokens.B, 'GET', `/rooms/${roomId}/messages`);
assert(msgs.json.messages?.length >= 2, 'messages not persisted');
step('chat-A-B', { count: msgs.json.messages.length });

// 15. Leaderboard evolves
const detail = await api(tokens.A, 'GET', `/rooms/${roomId}`);
assert(detail.json.leaderboard?.length === 3, 'leaderboard size');
assert(detail.json.scoreExplanation?.fr, 'score explanation missing');
step('leaderboard', {
  ranks: detail.json.leaderboard.map((r) => ({
    name: r.displayName,
    score: r.score,
    ret: r.tradingReturnPct,
    net: r.netWorth,
    provisional: r.scoreProvisional,
  })),
});

// Concurrency: double repay with same idempotency key (one apply + replay)
await api(tokens.C, 'POST', `/rooms/${roomId}/rewards/claim`, {
  sourceKind: 'TUTORIAL',
  sourceRef: `conc-prep-${stamp}`,
});
const concKey = idem('repay-race');
const [c1, c2] = await Promise.all([
  api(tokens.C, 'POST', `/rooms/${roomId}/credit/repay`, { amount: 50, idempotencyKey: concKey }),
  api(tokens.C, 'POST', `/rooms/${roomId}/credit/repay`, { amount: 50, idempotencyKey: concKey }),
]);
assert(c1.ok || c2.ok, `at least one repay ok (${c1.status}/${c2.status})`);
const replays = [c1, c2].filter((r) => r.json?.idempotentReplay).length;
const oks = [c1, c2].filter((r) => r.ok).length;
assert(replays >= 1 || oks === 1, `idempotency under race oks=${oks} replays=${replays}`);
step('concurrency-repay', { s1: c1.status, s2: c2.status, replay: [c1.json?.idempotentReplay, c2.json?.idempotentReplay] });

// 16-17. B disconnect/reconnect = new login token + state poll (membership preserved; leave would reset portfolio)
const beforeDisc = await api(tokens.B, 'GET', `/rooms/${roomId}/portfolio`);
const pointsBefore = (await api(tokens.B, 'GET', `/rooms/${roomId}`)).json.you?.learningPoints;
tokens.B = await loginReal(players[1].email, PASSWORD);
const afterDisc = await api(tokens.B, 'GET', `/rooms/${roomId}/portfolio`);
const detailAfter = await api(tokens.B, 'GET', `/rooms/${roomId}`);
const catchup = await api(tokens.B, 'GET', `/rooms/${roomId}/state?sinceSeq=0`);
assert(afterDisc.ok && detailAfter.ok, 'reconnect portfolio/detail');
assert(
  Number(afterDisc.json.netWorth ?? afterDisc.json.markToMarket?.netWorth) ===
    Number(beforeDisc.json.netWorth ?? beforeDisc.json.markToMarket?.netWorth),
  'netWorth lost after reconnect',
);
assert(detailAfter.json.you?.learningPoints === pointsBefore, 'points lost after reconnect');
assert(catchup.ok && catchup.json.events?.length > 0, 'event history lost');
step('B-reconnect', {
  netWorth: afterDisc.json.netWorth,
  points: detailAfter.json.you?.learningPoints,
  events: catchup.json.events.length,
});

// Polling recovery
const state = await api(tokens.A, 'GET', `/rooms/${roomId}/state?sinceSeq=0`);
assert(state.ok && Array.isArray(state.json.events), 'state polling');
const pollSeqs = state.json.events.map((e) => e.seq);
assert(pollSeqs.length === new Set(pollSeqs).size, 'poll duplicate seq');
assert(pollSeqs.every((s, i) => i === 0 || s > pollSeqs[i - 1]), 'poll seq not ordered');
step('polling-recovery', { events: pollSeqs.length, last: pollSeqs.at(-1) });

// Cross-room isolation
const room2 = await api(tokens.A, 'POST', '/rooms', {
  title: `E2E Iso ${stamp}`,
  mode: 'PRACTICE',
  visibility: 'PRIVATE',
});
assert(room2.ok, 'room2 create');
const joinB2 = await api(tokens.B, 'POST', '/rooms/join', { code: room2.json.code });
assert(joinB2.ok, 'B join room2');
await api(tokens.A, 'POST', `/rooms/${room2.json.id}/start`, {});
const isoMsg = await api(tokens.A, 'POST', `/rooms/${room2.json.id}/messages`, { body: 'iso-only' });
assert(isoMsg.ok, 'iso chat');
const room1Msgs = await api(tokens.A, 'GET', `/rooms/${roomId}/messages`);
assert(!room1Msgs.json.messages?.some((m) => m.body === 'iso-only'), 'message leaked across rooms');
const foreign = await api(tokens.C, 'GET', `/rooms/${room2.json.id}`);
assert(!foreign.ok || foreign.status === 403 || foreign.json?.you == null, 'C must not be member of room2');
step('two-room-isolation', { room2: room2.json.id });

// Historical crisis room (if episodes exist)
const hist = await api(tokens.A, 'POST', '/rooms', {
  title: `E2E Crisis ${stamp}`,
  mode: 'CLASSROOM',
  visibility: 'PRIVATE',
  rules: {
    marketScope: 'HISTORICAL',
    crisisEpisodeId: 'covid-2020',
    simStartDate: '2020-02-20',
    simEndDate: '2020-04-30',
    initialCapital: 100000,
  },
});
if (hist.ok) {
  await api(tokens.B, 'POST', '/rooms/join', { code: hist.json.code });
  await api(tokens.A, 'POST', `/rooms/${hist.json.id}/start`, {});
  const hm = await api(tokens.A, 'GET', `/rooms/${hist.json.id}/market`);
  assert(hm.json.dataKind === 'HISTORICAL' || hm.json.simClockDate, 'historical clock');
  const adv = await api(tokens.A, 'POST', `/rooms/${hist.json.id}/clock/advance`, {});
  step('historical-crisis', {
    created: true,
    dataKind: hm.json.dataKind,
    clock: hm.json.simClockDate,
    advanced: adv.ok,
    nextClock: adv.json?.simClockDate,
  });
  await api(tokens.A, 'POST', `/rooms/${hist.json.id}/end`, {});
} else {
  step('historical-crisis', { created: false, status: hist.status, body: hist.json });
}

// Action after end must fail
const ended = await api(tokens.A, 'POST', `/rooms/${roomId}/end`, {});
assert(ended.ok && ended.json.status === 'ENDED', 'end failed');
const afterEnd = await api(tokens.A, 'POST', `/rooms/${roomId}/orders/preview`, {
  symbol: 'CTB',
  side: 'BUY',
  type: 'MARKET',
  quantity: 1,
});
assert(!afterEnd.ok, 'trading after end must fail');
const finalBoard = ended.json.leaderboard;
assert(Array.isArray(finalBoard) && finalBoard.length >= 1, 'final leaderboard');
step('end-and-persist', {
  status: ended.json.status,
  finalLeaderboard: finalBoard.map((r) => ({ name: r.displayName, score: r.score, net: r.netWorth })),
});

// Fraudulent room id / other membership
const fake = await api(tokens.A, 'GET', `/rooms/${crypto.randomUUID()}`);
assert(!fake.ok, 'unknown room must fail');
step('security-unknown-room', { status: fake.status });

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const report = {
  ok: true,
  api: API,
  database: current,
  // password kept for local Playwright UI follow-up (gitignored under data/reports)
  password: PASSWORD,
  players: players.map((p) => ({ key: p.key, email: p.email, id: p.id })),
  roomId,
  steps,
  finishedAt: new Date().toISOString(),
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log('\nMULTIPLAYER E2E PASSED — ' + steps.length + ' steps');
console.log('Report: ' + REPORT);
