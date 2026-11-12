// Differential contract test of the 14 learning endpoints and the 3 FinStories endpoints: NestJS (3001) vs Spring Boot
// (3002), both on the isolated *_test database. Each API gets its OWN disposable user, so every mission session,
// command, assessment, competency observation, mentor interaction and story-progress row is written by exactly one
// backend; nothing is shared or mutated by both. The same request sequence is replayed on both sides (mission
// scenarios are seeded and step-based, so the market path is identical), then every response and the resulting
// learning rows are compared.
//
//   DATABASE_URL=<…/PIF_spring_test> node contract/differential-learning.mjs
import { NEST, SPRING, prisma, PASSWORD, RUN, email, call, record, compare, createUser, finish, run, normalize, diff } from './differential-lib.mjs';

const SIDES = ['nest', 'spring'];
const BASE = { nest: NEST, spring: SPRING };
const token = {};
const user = {};
const auth = (side) => ({ authorization: `Bearer ${token[side]}` });

/** Sends the same request to both backends; path and opts may depend on the side (own session ids, own quotes). */
async function pair(name, method, path, opts = () => ({}), cmp = {}) {
  const nest = await call(NEST, method, typeof path === 'function' ? path('nest') : path, opts('nest'));
  const spring = await call(SPRING, method, typeof path === 'function' ? path('spring') : path, opts('spring'));
  return compare(name, nest, spring, cmp);
}
/**
 * Percentage metrics can differ by one ULP between V8 and HotSpot while every ledger millime matches.
 * Snap both sides to 15 significant digits so the differential fails only on real economic differences.
 */
function snapPctMetrics(body) {
  if (!body || typeof body !== 'object' || !body.metrics || typeof body.metrics !== 'object') return body;
  const metrics = { ...body.metrics };
  for (const [k, v] of Object.entries(metrics)) {
    if (typeof v === 'number' && (k.endsWith('Pct') || k === 'hhi' || k === 'turnover')) {
      metrics[k] = Number(v.toPrecision(15));
    }
  }
  return { ...body, metrics };
}
const get = (name, path, cmp = {}) => pair(name, 'GET', path, (s) => ({ headers: auth(s) }), cmp);
const send = (name, method, path, body) => pair(name, method, path, (s) => ({ headers: auth(s), body: typeof body === 'function' ? body(s) : body }));
const getAssessment = (name, path) => get(name, path, { bodyNormalizer: snapPctMetrics });

// ---------------------------------------------------------------- session bookkeeping

/** Own session id per scenario and side. */
const sid = {};
const lastSeq = { nest: 0, spring: 0 };
/** Latest session view returned by a command, used to derive prices from each side's own quotes. */
const view = { nest: null, spring: null };
let keyCounter = 0;
const nextKey = () => `cmd-${RUN}-${String(++keyCounter).padStart(4, '0')}`;

const L = (suffix = '') => (s) => `/api/learning/sessions/${sid[s]}${suffix}`;

/** Submits a command at each side's current sequence number (override with seq / key / a raw body). */
async function command(name, cmd, { seq, key, body } = {}) {
  const k = key ?? nextKey();
  const res = await send(name, 'POST', L('/commands'), (s) => body ?? { idempotencyKey: k, expectedSeq: seq ?? lastSeq[s], command: cmd });
  for (const s of SIDES) {
    if (res[s].status === 200 && res[s].json?.session) {
      lastSeq[s] = res[s].json.session.lastSeq;
      view[s] = res[s].json.session;
    }
  }
  return res;
}
const quote = (s, symbol) => view[s].state.quotes.find((q) => q.symbol === symbol);
const round3 = (x) => Math.round(x * 1000) / 1000;

function startOn(slug) {
  return async (name, body = {}) => {
    const res = await send(name, 'POST', `/api/learning/missions/${slug}/sessions`, body);
    return res;
  };
}

// ---------------------------------------------------------------- persisted learning state

/** Everything the learning module wrote for one user, with ids replaced by creation order. */
async function learningState(side) {
  const userId = user[side].id;
  const sessions = await prisma.learningSession.findMany({
    where: { userId },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    include: {
      commands: { orderBy: { seq: 'asc' } },
      events: { orderBy: { ordinal: 'asc' } },
      assessment: true,
      observations: { orderBy: { competency: 'asc' } },
      mentorInteractions: { orderBy: [{ createdAt: 'asc' }, { step: 'asc' }] },
    },
  });
  const index = new Map(sessions.map((s, i) => [s.id, i]));
  const n = (v) => (typeof v === 'bigint' ? v.toString() : v);
  const learning = sessions.map((s, i) => ({
    ordinal: i,
    missionSlug: s.missionSlug,
    missionVersion: s.missionVersion,
    kind: s.kind,
    status: s.status,
    parent: s.parentSessionId ? index.get(s.parentSessionId) ?? 'unknown' : null,
    branchFromSeq: s.branchFromSeq,
    lastSeq: s.lastSeq,
    currentStep: s.currentStep,
    equityMillimes: n(s.equityMillimes),
    mentorMode: s.mentorMode,
    assisted: s.assisted,
    ended: s.endedAt !== null,
    commands: s.commands.map((c) => ({
      seq: c.seq,
      type: c.type,
      payload: c.payload,
      outcome: c.outcome,
      step: c.step,
      // Mentor interactions mint a fresh UUID per side; scenario keys share RUN.
      idempotencyKey: c.idempotencyKey.replace(RUN, '<run>').replace(/^mentor-[0-9a-f-]{36}$/i, 'mentor-<uuid>'),
    })),
    events: s.events.map((e) => ({ ordinal: e.ordinal, commandSeq: e.commandSeq, type: e.type, step: e.step, data: e.data })),
    assessment: s.assessment
      ? { missionSlug: s.assessment.missionSlug, missionVersion: s.assessment.missionVersion, engineVersion: s.assessment.engineVersion, total: s.assessment.total, passed: s.assessment.passed, assisted: s.assessment.assisted, result: snapPctMetrics(s.assessment.result) }
      : null,
    observations: s.observations.map((o) => ({ competency: o.competency, score: o.score, weight: o.weight, assisted: o.assisted })),
    mentorInteractions: s.mentorInteractions.map((m) => ({ mode: m.mode, source: m.source, ruleId: m.ruleId, step: m.step, response: m.response })),
  }));
  const stories = (await prisma.storyProgress.findMany({ where: { userId }, orderBy: { storySlug: 'asc' } })).map((p) => ({
    storySlug: p.storySlug,
    storyVersion: p.storyVersion,
    positionMs: p.positionMs,
    sceneId: p.sceneId,
    completed: p.completed,
    completedAt: p.completedAt !== null,
    completedVersion: p.completedVersion,
    reflection: p.reflection,
  }));
  const observationsTotal = await prisma.competencyObservation.count({ where: { userId } });
  return { learning, stories, observationsTotal };
}

run(async () => {
  for (const side of SIDES) {
    user[side] = await createUser(`learner-${side}`);
    const res = await call(BASE[side], 'POST', '/api/auth/login', { body: { email: email(`learner-${side}`), password: PASSWORD } });
    if (res.status !== 200 || !res.json?.accessToken) throw new Error(`login failed on ${side}: ${res.status}`);
    token[side] = res.json.accessToken;
  }

  // ------------------------------------------------------------ authentication and catalog
  await pair('missions: without a token', 'GET', '/api/learning/missions');
  await pair('stories: feed without a token', 'GET', '/api/learning/stories');
  await pair('profile: without a token', 'GET', '/api/learning/profile');
  await pair('sessions: start without a token', 'POST', '/api/learning/missions/my-first-trade/sessions');
  await get('missions: catalog before any attempt', '/api/learning/missions');
  await get('mission: my-first-trade briefing', '/api/learning/missions/my-first-trade');
  await get('mission: survive-the-market-crash briefing (no future events)', '/api/learning/missions/survive-the-market-crash');
  await get('mission: overconfident-trader briefing', '/api/learning/missions/overconfident-trader');
  await get('mission: unknown slug', '/api/learning/missions/no-such-mission');
  await get('mission: malformed slug', '/api/learning/missions/Not%20A%20Slug');
  await get('profile: new learner', '/api/learning/profile');
  await get('sessions: none yet', '/api/learning/sessions');

  // ------------------------------------------------------------ start / resume / read
  await send('start: unknown mission', 'POST', '/api/learning/missions/no-such-mission/sessions', {});
  await send('start: invalid mentor mode', 'POST', '/api/learning/missions/my-first-trade/sessions', { mentorMode: 'WISE' });
  await send('start: DEBRIEF is not a session mentor mode', 'POST', '/api/learning/missions/my-first-trade/sessions', { mentorMode: 'DEBRIEF' });
  await send('start: unknown property', 'POST', '/api/learning/missions/my-first-trade/sessions', { extra: true });
  const started = await startOn('my-first-trade')('start: my-first-trade (SOCRATIC mentor)', { mentorMode: 'SOCRATIC' });
  for (const s of SIDES) {
    sid[s] = started[s].json?.session?.id;
    view[s] = started[s].json?.session;
  }
  if (!sid.nest || !sid.spring) throw new Error('mission start failed; cannot continue');
  await startOn('my-first-trade')('start: resume returns the active attempt', {});
  await get('missions: catalog with an active attempt', '/api/learning/missions');
  await get('sessions: list with one attempt', '/api/learning/sessions');
  await get('session: get', L());
  await get('session: malformed id', '/api/learning/sessions/not-a-uuid');
  await get('session: unknown id', '/api/learning/sessions/00000000-0000-4000-8000-000000000000');
  await pair("session: another user's session is not found", 'GET', (s) => `/api/learning/sessions/${sid[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));
  await get('timeline: active session cannot branch', L('/timeline'));
  await get('assessment: not available while the mission is active', L('/assessment'));

  // ------------------------------------------------------------ order preview (nothing recorded)
  const buyCtb = { type: 'PLACE_ORDER', symbol: 'CTB', side: 'BUY', orderType: 'MARKET', quantity: 20, rationale: 'DIVERSIFY' };
  await send('preview: affordable market buy', 'POST', L('/orders/preview'), { order: buyCtb });
  await send('preview: unaffordable quantity', 'POST', L('/orders/preview'), { order: { ...buyCtb, symbol: 'OLV', quantity: 5000 } });
  await send('preview: sell without a position', 'POST', L('/orders/preview'), { order: { ...buyCtb, side: 'SELL' } });
  await send('preview: order type not allowed by the mission', 'POST', L('/orders/preview'), { order: { ...buyCtb, orderType: 'STOP', stopPrice: 30 } });
  await send('preview: limit price far from the market', 'POST', L('/orders/preview'), { order: { ...buyCtb, orderType: 'LIMIT', limitPrice: 1 } });
  await send('preview: symbol outside the mission universe', 'POST', L('/orders/preview'), { order: { ...buyCtb, symbol: 'TEK' } });
  await send('preview: not an order', 'POST', L('/orders/preview'), { order: { type: 'ADVANCE' } });
  {
    // NestJS ValidationPipe throws when nested `order` is missing (500 INTERNAL_ERROR); Spring returns 400 VALIDATION_ERROR.
    const exp = {
      nest: await call(NEST, 'POST', `/api/learning/sessions/${sid.nest}/orders/preview`, { headers: auth('nest'), body: {} }),
      spring: await call(SPRING, 'POST', `/api/learning/sessions/${sid.spring}/orders/preview`, { headers: auth('spring'), body: {} }),
    };
    record(
      'divergence (documented): missing order body → NestJS 500, Spring 400',
      exp.nest.status === 500 && exp.nest.json?.errorCode === 'INTERNAL_ERROR'
        && exp.spring.status === 400 && exp.spring.json?.errorCode === 'VALIDATION_ERROR',
      { nest: exp.nest.status, spring: [exp.spring.status, exp.spring.json?.errorCode] },
    );
  }
  await send('preview: lower-case symbol and bad quantity', 'POST', L('/orders/preview'), { order: { ...buyCtb, symbol: 'ctb', quantity: 0 } });
  await send('preview: unknown property', 'POST', L('/orders/preview'), { order: buyCtb, extra: 1 });
  await send('preview: malformed session id', 'POST', '/api/learning/sessions/xyz/orders/preview', { order: buyCtb });
  await send('preview: unknown session', 'POST', '/api/learning/sessions/00000000-0000-4000-8000-000000000000/orders/preview', { order: buyCtb });
  await get('session: preview recorded nothing', L());

  // ------------------------------------------------------------ commands
  await command('command: resting limit buy OLV', { type: 'PLACE_ORDER', symbol: 'OLV', side: 'BUY', orderType: 'LIMIT', limitPrice: 9.7, quantity: 5, rationale: 'LONG_TERM_VIEW', confidence: 60 });
  await command('command: cancel the resting order', { type: 'CANCEL_ORDER', orderId: 'o1' });
  await command('command: cancel an unknown order', { type: 'CANCEL_ORDER', orderId: 'o99' });
  const filledKey = nextKey();
  const filledSeq = { ...lastSeq };
  const filled = await command('command: market buy CTB (fills)', buyCtb, { key: filledKey });
  await send('command: same key and sequence replays the original result', 'POST', L('/commands'), (s) => ({ idempotencyKey: filledKey, expectedSeq: filledSeq[s], command: buyCtb }));
  await send('command: same key, different command', 'POST', L('/commands'), (s) => ({ idempotencyKey: filledKey, expectedSeq: lastSeq[s], command: { ...buyCtb, quantity: 5 } }));
  await command('command: stale expected sequence', { type: 'ADVANCE' }, { seq: 0 });
  await command('command: market buy larger than the available cash (recorded as rejected)', { ...buyCtb, symbol: 'OLV', quantity: 1400, rationale: 'MOMENTUM', confidence: 90 });
  await command('command: invalid stop on a mission without stops', { ...buyCtb, orderType: 'STOP', stopPrice: 30 });
  await command('command: unknown field is refused', { ...buyCtb, leverage: 10 });
  await command('command: command type outside the client set', { type: 'REQUEST_HINT' });
  await command('command: market buy missing its rationale', { type: 'PLACE_ORDER', symbol: 'OLV', side: 'BUY', orderType: 'MARKET', quantity: 1 });
  await command('command: limit buy without a price', { type: 'PLACE_ORDER', symbol: 'OLV', side: 'BUY', orderType: 'LIMIT', quantity: 1, rationale: 'DIVERSIFY' });
  await command('command: stress test is not allowed in this mission', { type: 'RUN_STRESS_TEST', scenarioId: 'equity-crash' });
  await command('command: malformed idempotency key', { type: 'ADVANCE' }, { body: { idempotencyKey: 'x', expectedSeq: 0, command: { type: 'ADVANCE' } } });
  await command('command: negative expected sequence', { type: 'ADVANCE' }, { body: { idempotencyKey: nextKey(), expectedSeq: -1, command: { type: 'ADVANCE' } } });
  {
    // NestJS throws 500 when nested `command` is missing; Spring returns 400 VALIDATION_ERROR.
    const key = nextKey();
    const exp = {
      nest: await call(NEST, 'POST', `/api/learning/sessions/${sid.nest}/commands`, { headers: auth('nest'), body: { idempotencyKey: key, expectedSeq: lastSeq.nest } }),
      spring: await call(SPRING, 'POST', `/api/learning/sessions/${sid.spring}/commands`, { headers: auth('spring'), body: { idempotencyKey: key, expectedSeq: lastSeq.spring } }),
    };
    record(
      'divergence (documented): missing command body → NestJS 500, Spring 400',
      exp.nest.status === 500 && exp.nest.json?.errorCode === 'INTERNAL_ERROR'
        && exp.spring.status === 400 && exp.spring.json?.errorCode === 'VALIDATION_ERROR',
      { nest: exp.nest.status, spring: [exp.spring.status, exp.spring.json?.errorCode] },
    );
  }
  await command('command: FINISH before the market closes', { type: 'FINISH' });
  await send('command: unknown session', 'POST', '/api/learning/sessions/00000000-0000-4000-8000-000000000000/commands', { idempotencyKey: nextKey(), expectedSeq: 0, command: { type: 'ADVANCE' } });
  await send('command: malformed session id', 'POST', '/api/learning/sessions/xyz/commands', { idempotencyKey: nextKey(), expectedSeq: 0, command: { type: 'ADVANCE' } });
  if (!filled.nest.json?.session) throw new Error('the market buy was not accepted on NestJS; cannot continue');

  // ------------------------------------------------------------ mentor during the mission
  await send('mentor: invalid mode', 'POST', L('/mentor'), { mode: 'WIZARD' });
  await send('mentor: debrief is refused while the mission is active', 'POST', L('/mentor'), { mode: 'DEBRIEF' });
  const hint = await send('mentor: hint during the mission (counts as assistance)', 'POST', L('/mentor'), {});
  for (const s of SIDES) if (hint[s].status === 200 && hint[s].json?.session) lastSeq[s] = hint[s].json.session.lastSeq;
  const guided = await send('mentor: guided hint', 'POST', L('/mentor'), { mode: 'GUIDED' });
  for (const s of SIDES) if (guided[s].status === 200 && guided[s].json?.session) lastSeq[s] = guided[s].json.session.lastSeq;
  await send('mentor: unknown session', 'POST', '/api/learning/sessions/00000000-0000-4000-8000-000000000000/mentor', {});
  await get('session: assisted and advanced after commands and hints', L());

  // ------------------------------------------------------------ branches and abandon need an ended session
  await send('branch: an active mission cannot be rewound', 'POST', L('/branches'), { fromSeq: 1, strategy: 'HOLD' });

  // ------------------------------------------------------------ play the days
  await command('advance: day 1', { type: 'ADVANCE' });
  for (const s of SIDES) if (!view[s]) throw new Error(`no session view on ${s}`);
  // The limit price depends on each side's own quote, so this command is built per side.
  const limitCtb = await send('command: limit buy CTB just under the bid', 'POST', L('/commands'), (s) => ({
    idempotencyKey: nextKey(),
    expectedSeq: lastSeq[s],
    command: { type: 'PLACE_ORDER', symbol: 'CTB', side: 'BUY', orderType: 'LIMIT', limitPrice: round3(quote(s, 'CTB').bid * 0.99), quantity: 3, rationale: 'VALUATION', confidence: 55 },
  }));
  for (const s of SIDES) {
    if (limitCtb[s].status === 200) {
      lastSeq[s] = limitCtb[s].json.session.lastSeq;
      view[s] = limitCtb[s].json.session;
    }
  }
  await get('session: after the limit order', L());
  for (let day = 2; day <= 5; day++) await command(`advance: day ${day}`, { type: 'ADVANCE' });
  await command('advance: past the last day', { type: 'ADVANCE' });
  await command('command: order after the market closed', buyCtb);
  await get('session: market closed', L());
  await send('branch: still active, refused', 'POST', L('/branches'), { fromSeq: 1, strategy: 'HOLD' });
  await command('finish: mission', { type: 'FINISH' });
  await command('command: after the mission ended', { type: 'ADVANCE' });
  await send('preview: after the mission ended', 'POST', L('/orders/preview'), { order: buyCtb });

  // ------------------------------------------------------------ assessment, debrief, profile
  await getAssessment('assessment: ended session', L('/assessment'));
  await send('mentor: debrief (default mode after the end)', 'POST', L('/mentor'), {});
  await send('mentor: explicit debrief', 'POST', L('/mentor'), { mode: 'DEBRIEF' });
  await send('mentor: guided hint after the end', 'POST', L('/mentor'), { mode: 'GUIDED' });
  await get('assessment: unknown session', '/api/learning/sessions/00000000-0000-4000-8000-000000000000/assessment');
  await get('assessment: malformed id', '/api/learning/sessions/abc/assessment');
  await get('profile: after one assessed attempt', '/api/learning/profile');
  await get('missions: catalog after the attempt', '/api/learning/missions');

  // ------------------------------------------------------------ Time Machine
  const timeline = await get('timeline: ended session', L('/timeline'));
  await get('timeline: unknown session', '/api/learning/sessions/00000000-0000-4000-8000-000000000000/timeline');
  await get('timeline: malformed id', '/api/learning/sessions/abc/timeline');
  const firstTrade = timeline.nest.json?.decisions?.find((d) => d.type === 'PLACE_ORDER' && d.outcome === 'ACCEPTED');
  const fromSeq = firstTrade?.seq ?? 4;
  await send('branch: invalid strategy', 'POST', L('/branches'), { fromSeq, strategy: 'FORK' });
  await send('branch: fromSeq below the minimum', 'POST', L('/branches'), { fromSeq: 0, strategy: 'HOLD' });
  await send('branch: missing body', 'POST', L('/branches'), {});
  await send('branch: fromSeq beyond the last decision', 'POST', L('/branches'), { fromSeq: 9999, strategy: 'HOLD' });
  await send('branch: unknown session', 'POST', '/api/learning/sessions/00000000-0000-4000-8000-000000000000/branches', { fromSeq: 1, strategy: 'HOLD' });
  const hold = await send('branch: HOLD from the first accepted trade', 'POST', L('/branches'), { fromSeq, strategy: 'HOLD' });
  const manual = await send('branch: MANUAL replay', 'POST', L('/branches'), { fromSeq, strategy: 'MANUAL' });
  const holdId = (s) => hold[s].json?.id;
  const manualId = (s) => manual[s].json?.id;
  if (!holdId('nest') || !holdId('spring') || !manualId('nest') || !manualId('spring')) throw new Error('replay creation failed; cannot continue');
  await get('replay: HOLD session', (s) => `/api/learning/sessions/${holdId(s)}`);
  await get('replay: MANUAL session is rebuilt from its commands', (s) => `/api/learning/sessions/${manualId(s)}`);
  await getAssessment('replay: HOLD assessment (practice only)', (s) => `/api/learning/sessions/${holdId(s)}/assessment`);
  await get('replay: HOLD timeline', (s) => `/api/learning/sessions/${holdId(s)}/timeline`);
  await get('timeline: original lists its replays', L('/timeline'));
  await get('compare: original with the HOLD replay', (s) => `/api/learning/sessions/${sid[s]}/compare/${holdId(s)}`);
  await get('compare: HOLD replay with the original', (s) => `/api/learning/sessions/${holdId(s)}/compare/${sid[s]}`);
  await get('compare: a session with itself', (s) => `/api/learning/sessions/${sid[s]}/compare/${sid[s]}`);
  await get('compare: unknown other session', (s) => `/api/learning/sessions/${sid[s]}/compare/00000000-0000-4000-8000-000000000000`);
  await get('compare: malformed other id', (s) => `/api/learning/sessions/${sid[s]}/compare/xyz`);
  await pair("compare: another user's session is not found", 'GET', (s) => `/api/learning/sessions/${sid[s]}/compare/${sid[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));
  await send('abandon: ended session (idempotent or refused)', 'POST', L('/abandon'));

  // The manual replay is played on from the decision, with a different trade, then assessed as practice.
  const manualSeq = { nest: manual.nest.json.lastSeq, spring: manual.spring.json.lastSeq };
  // nextKey() must run once per request, not once per side (opts is invoked for nest and spring).
  const replayCommand = (name, cmd) => {
    const key = nextKey();
    return send(name, 'POST', (s) => `/api/learning/sessions/${manualId(s)}/commands`, (s) => ({
      idempotencyKey: key,
      expectedSeq: manualSeq[s],
      command: cmd,
    })).then((res) => {
      for (const s of SIDES) if (res[s].status === 200) manualSeq[s] = res[s].json.session.lastSeq;
      return res;
    });
  };
  await replayCommand('replay (manual): a different order', { type: 'PLACE_ORDER', symbol: 'OLV', side: 'BUY', orderType: 'MARKET', quantity: 200, rationale: 'LONG_TERM_VIEW', confidence: 70 });
  for (let day = 1; day <= 5; day++) await replayCommand(`replay (manual): advance day ${day}`, { type: 'ADVANCE' });
  await replayCommand('replay (manual): finish', { type: 'FINISH' });
  await getAssessment('replay (manual): assessment', (s) => `/api/learning/sessions/${manualId(s)}/assessment`);
  await get('compare: original with the manual replay', (s) => `/api/learning/sessions/${sid[s]}/compare/${manualId(s)}`);
  await get('profile: replays leave the competency profile unchanged', '/api/learning/profile');

  // ------------------------------------------------------------ a second mission: stop orders, abandon, branch from an abandoned attempt
  const second = await startOn('protect-your-capital')('start: protect-your-capital', {});
  const secondId = {};
  for (const s of SIDES) secondId[s] = second[s].json?.session?.id;
  if (!secondId.nest || !secondId.spring) throw new Error('second mission start failed');
  const secondSeq = { nest: 0, spring: 0 };
  const secondView = { nest: second.nest.json.session, spring: second.spring.json.session };
  const secondCommand = async (name, build) => {
    const key = nextKey();
    const res = await send(name, 'POST', (s) => `/api/learning/sessions/${secondId[s]}/commands`, (s) => ({
      idempotencyKey: key,
      expectedSeq: secondSeq[s],
      command: build(s),
    }));
    for (const s of SIDES) {
      if (res[s].status === 200) {
        secondSeq[s] = res[s].json.session.lastSeq;
        secondView[s] = res[s].json.session;
      }
    }
    return res;
  };
  const bid = (s, symbol) => secondView[s].state.quotes.find((q) => q.symbol === symbol).bid;
  await secondCommand('second: stop above the bid is refused', () => ({ type: 'PLACE_ORDER', symbol: 'TEK', side: 'SELL', orderType: 'STOP', quantity: 10, stopPrice: 30, rationale: 'LIMIT_DOWNSIDE' }));
  await secondCommand('second: oversized sell is recorded as rejected', () => ({ type: 'PLACE_ORDER', symbol: 'TEK', side: 'SELL', orderType: 'MARKET', quantity: 5000, rationale: 'LIMIT_DOWNSIDE' }));
  await secondCommand('second: protective stop', (s) => ({ type: 'PLACE_ORDER', symbol: 'TEK', side: 'SELL', orderType: 'STOP', quantity: 300, stopPrice: round3(bid(s, 'TEK') * 0.93), rationale: 'LIMIT_DOWNSIDE', confidence: 65 }));
  await secondCommand('second: stress test', () => ({ type: 'RUN_STRESS_TEST', scenarioId: 'equity-crash' }));
  await secondCommand('second: unknown stress scenario', () => ({ type: 'RUN_STRESS_TEST', scenarioId: 'nope' }));
  await secondCommand('second: advance', () => ({ type: 'ADVANCE' }));
  await get('compare: sessions of two different missions', (s) => `/api/learning/sessions/${sid[s]}/compare/${secondId[s]}`);
  await get('sessions: list with several attempts', '/api/learning/sessions');
  await send('abandon: second mission', 'POST', (s) => `/api/learning/sessions/${secondId[s]}/abandon`);
  await send('abandon: already abandoned', 'POST', (s) => `/api/learning/sessions/${secondId[s]}/abandon`);
  await send('abandon: unknown session', 'POST', '/api/learning/sessions/00000000-0000-4000-8000-000000000000/abandon');
  await send('abandon: malformed id', 'POST', '/api/learning/sessions/xyz/abandon');
  {
    const key = nextKey();
    await send('command: on an abandoned session', 'POST', (s) => `/api/learning/sessions/${secondId[s]}/commands`, (s) => ({
      idempotencyKey: key,
      expectedSeq: secondSeq[s],
      command: { type: 'ADVANCE' },
    }));
  }
  await get('timeline: abandoned session can branch', (s) => `/api/learning/sessions/${secondId[s]}/timeline`);
  await send('branch: MANUAL replay of an abandoned attempt', 'POST', (s) => `/api/learning/sessions/${secondId[s]}/branches`, { fromSeq: 3, strategy: 'MANUAL' });
  await get('assessment: abandoned session has none', (s) => `/api/learning/sessions/${secondId[s]}/assessment`);
  await startOn('protect-your-capital')('start: a new attempt after abandoning', {});
  await get('missions: catalog with several attempts', '/api/learning/missions');

  // ------------------------------------------------------------ calibration mission: confidence is required
  const calibration = await startOn('overconfident-trader')('start: overconfident-trader', {});
  const calId = {};
  for (const s of SIDES) calId[s] = calibration[s].json?.session?.id;
  if (!calId.nest || !calId.spring) throw new Error('calibration mission start failed');
  const unrated = { type: 'PLACE_ORDER', symbol: 'CTB', side: 'BUY', orderType: 'MARKET', quantity: 200, rationale: 'DIVERSIFY' };
  await send('calibration: preview without a confidence rating', 'POST', (s) => `/api/learning/sessions/${calId[s]}/orders/preview`, { order: unrated });
  await send('calibration: preview with a rating', 'POST', (s) => `/api/learning/sessions/${calId[s]}/orders/preview`, { order: { ...unrated, confidence: 90 } });
  await send('calibration: command without a rating is refused', 'POST', (s) => `/api/learning/sessions/${calId[s]}/commands`, { idempotencyKey: nextKey(), expectedSeq: 0, command: unrated });
  await send('calibration: rated order', 'POST', (s) => `/api/learning/sessions/${calId[s]}/commands`, { idempotencyKey: nextKey(), expectedSeq: 0, command: { ...unrated, confidence: 90 } });
  await send('calibration: Socratic mentor questions near-certain confidence', 'POST', (s) => `/api/learning/sessions/${calId[s]}/mentor`, { mode: 'SOCRATIC' });
  await send('calibration: abandon', 'POST', (s) => `/api/learning/sessions/${calId[s]}/abandon`);

  // ------------------------------------------------------------ FinStories
  await get('stories: feed', '/api/learning/stories');
  await get('story: sarah-and-the-market-crash', '/api/learning/stories/sarah-and-the-market-crash');
  await get('story: adam-first-order', '/api/learning/stories/adam-first-order');
  await get('story: unknown slug', '/api/learning/stories/unknown-story');
  await get('story: malformed slug', '/api/learning/stories/Not%20A%20Slug');
  await pair('story: progress without a token', 'PUT', '/api/learning/stories/sarah-and-the-market-crash/progress', () => ({ body: { positionMs: 1 } }));
  await send('progress: partial', 'PUT', '/api/learning/stories/sarah-and-the-market-crash/progress', { positionMs: 12_000 });
  await get('story: resumes at the saved position', '/api/learning/stories/sarah-and-the-market-crash');
  await send('progress: finished with a reflection', 'PUT', '/api/learning/stories/sarah-and-the-market-crash/progress', { positionMs: 3_600_000, reflection: 'WOULD_CHOOSE_B' });
  await send('progress: rewatching keeps the story completed', 'PUT', '/api/learning/stories/sarah-and-the-market-crash/progress', { positionMs: 0 });
  await send('progress: explicit completed flag', 'PUT', '/api/learning/stories/adam-first-order/progress', { positionMs: 30_000, completed: true, reflection: 'UNSURE' });
  await send('progress: unknown story', 'PUT', '/api/learning/stories/unknown-story/progress', { positionMs: 1 });
  for (const [label, body] of [
    ['empty body', {}],
    ['negative position', { positionMs: -1 }],
    ['position above the maximum', { positionMs: 3_600_001 }],
    ['fractional position', { positionMs: 1.5 }],
    ['bad reflection', { positionMs: 1, reflection: 'MAYBE' }],
    ['bad completed flag', { positionMs: 1, completed: 'yes' }],
    ['unknown property', { positionMs: 1, extra: true }],
    ['null values', { positionMs: null }],
  ]) {
    await send(`progress: ${label}`, 'PUT', '/api/learning/stories/sarah-and-the-market-crash/progress', body);
  }
  await get('stories: feed after watching', '/api/learning/stories');
  await get('profile: final', '/api/learning/profile');
  await get('sessions: final list', '/api/learning/sessions');

  // ------------------------------------------------------------ persisted state
  const [nestState, springState] = await Promise.all(SIDES.map(learningState));
  const differences = diff(normalize(nestState), normalize(springState), 'db');
  record('db: sessions, commands, events, assessments, observations, mentor interactions and story progress are identical', differences.length === 0, differences.slice(0, 20));
  record('db: both sides wrote sessions and an assessment', nestState.learning.length >= 6 && nestState.learning.some((s) => s.assessment) && springState.learning.some((s) => s.assessment), { nest: nestState.learning.length, spring: springState.learning.length });
  record('db: command sequences are 1..n per session', [...nestState.learning, ...springState.learning].every((s) => s.commands.every((c, i) => c.seq === i + 1)), null);
  record('db: replays never create competency observations', [...nestState.learning, ...springState.learning].filter((s) => s.kind === 'REPLAY').every((s) => s.observations.length === 0), null);

  await finish('differential-learning');
});
