// Differential contract test of the 20 market and portfolio endpoints: NestJS (3001) vs Spring Boot (3002), both on
// the isolated *_test database. Each API gets its OWN disposable user, so every portfolio, order, execution, cash
// entry and snapshot is written by exactly one backend; nothing financial is shared or mutated by both. The same
// request sequence is replayed on both sides inside one 5-minute quote period, then every response and the resulting
// ledger rows (orders, executions, cash entries, positions, snapshots, balances, versions) are compared.
//
//   DATABASE_URL=<…/PIF_spring_test> node contract/differential-trading.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { NEST, SPRING, apiDir, prisma, PASSWORD, RUN, email, call, record, compare, sleep, createUser, finish, run, normalize, diff } from './differential-lib.mjs';

const { modifiedDietz } = createRequire(join(apiDir, 'package.json'))(join(apiDir, 'dist/trading/analytics.js'));

const SIDES = ['nest', 'spring'];
const BASE = { nest: NEST, spring: SPRING };
const BUCKET_MS = 300_000;

/** Waits for the next quote period when fewer than minLeft ms remain, so a pair never straddles a price change. */
async function period(minLeft = 4000) {
  const left = BUCKET_MS - (Date.now() % BUCKET_MS);
  if (left < minLeft) await sleep(left + 750);
}

const token = {};
const user = {};
const auth = (side) => ({ authorization: `Bearer ${token[side]}` });

async function pair(name, method, path, opts = () => ({}), minLeft = 4000, cmp = {}) {
  await period(minLeft);
  const nest = await call(NEST, method, typeof path === 'function' ? path('nest') : path, opts('nest'));
  const spring = await call(SPRING, method, typeof path === 'function' ? path('spring') : path, opts('spring'));
  return compare(name, nest, spring, cmp);
}

const get = (name, path, minLeft) => pair(name, 'GET', path, (s) => ({ headers: auth(s) }), minLeft);
const send = (name, method, path, body, minLeft) => pair(name, method, path, (s) => ({ headers: auth(s), body: typeof body === 'function' ? body(s) : body }), minLeft);

const pid = { nest: null, spring: null };
const P = (suffix = '') => (s) => `/api/portfolios/${pid[s]}${suffix}`;

/** Preview on both sides, then submit with each side's own version and quote time (same quote period). */
async function order(name, terms, clientOrderId) {
  const preview = await send(`preview: ${name}`, 'POST', P('/orders/preview'), terms, 20_000);
  const submitted = await send(`submit: ${name}`, 'POST', P('/orders'), (s) => ({
    ...terms,
    clientOrderId,
    expectedVersion: preview[s].json.portfolioVersion,
    quoteAsOf: preview[s].json.quote.asOf,
  }));
  return { preview, submitted };
}

const round3 = (x) => Math.round(x * 1000) / 1000;

async function ledgerState(side) {
  const portfolios = await prisma.tradingPortfolio.findMany({
    where: { userId: user[side].id },
    orderBy: { createdAt: 'asc' },
    include: {
      positions: { include: { instrument: { select: { symbol: true } } } },
      orders: { include: { instrument: { select: { symbol: true } } }, orderBy: { sequence: 'asc' } },
      executions: { include: { instrument: { select: { symbol: true } } }, orderBy: { sequence: 'asc' } },
      cashEntries: { orderBy: { sequence: 'asc' } },
      snapshots: { orderBy: [{ asOf: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  const n = (v) => (typeof v === 'bigint' ? v.toString() : v);
  return portfolios.map((p) => ({
    name: p.name,
    baseCurrency: p.baseCurrency,
    status: p.status,
    balances: [p.initialCapitalMillimes, p.cashMillimes, p.netContributionsMillimes, p.realizedPnlMillimes, p.feesPaidMillimes, p.spreadCostMillimes].map(n),
    maxPositionWeightPct: p.maxPositionWeightPct,
    version: p.version,
    positions: p.positions
      .map((x) => ({ symbol: x.instrument.symbol, quantity: x.quantity, costBasis: n(x.costBasisMillimes) }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    orders: p.orders.map((o) => ({
      sequence: o.sequence, symbol: o.instrument.symbol, clientOrderId: o.clientOrderId, requestHash: o.requestHash,
      side: o.side, type: o.type, quantity: o.quantity, limit: n(o.limitPriceMillimes), stop: n(o.stopPriceMillimes),
      triggered: o.triggered, status: o.status, filled: o.filledQuantity, average: n(o.averagePriceMillimes),
      rejectionCode: o.rejectionCode, statusReason: o.statusReason,
      quote: [o.quoteMidMillimes, o.quoteBidMillimes, o.quoteAskMillimes].map(n), providerId: o.providerId,
      expiresAfterMs: o.expiresAt ? o.expiresAt.getTime() - o.submittedAt.getTime() : null,
      closedAtSubmission: o.closedAt ? o.closedAt.getTime() === o.submittedAt.getTime() : null,
    })),
    executions: p.executions.map((e) => ({
      sequence: e.sequence, symbol: e.instrument.symbol, side: e.side, quantity: e.quantity,
      amounts: [e.priceMillimes, e.notionalMillimes, e.feeMillimes, e.spreadCostMillimes, e.realizedPnlMillimes, e.quoteMidMillimes, e.quoteBidMillimes, e.quoteAskMillimes].map(n),
      providerId: e.providerId,
    })),
    cashEntries: p.cashEntries.map((c) => ({
      sequence: c.sequence, type: c.type, amount: n(c.amountMillimes), balanceAfter: n(c.balanceAfterMillimes),
      linkedToExecution: c.executionId !== null, description: c.description,
    })),
    snapshots: p.snapshots.map((s) => ({
      kind: s.kind,
      amounts: [s.equityMillimes, s.cashMillimes, s.positionsValueMillimes, s.netContributionsMillimes, s.externalFlowMillimes].map(n),
    })),
  }));
}

run(async () => {
  for (const side of SIDES) {
    user[side] = await createUser(`trader-${side}`);
    const res = await call(BASE[side], 'POST', '/api/auth/login', { body: { email: email(`trader-${side}`), password: PASSWORD } });
    if (res.status !== 200 || !res.json?.accessToken) throw new Error(`login failed on ${side}: ${res.status}`);
    token[side] = res.json.accessToken;
  }

  // ------------------------------------------------------------ market data
  await pair('market: status without a token', 'GET', '/api/market/status');
  await get('market: status', '/api/market/status');
  await get('market: instruments', '/api/market/instruments');
  await get('market: instruments q=bank', '/api/market/instruments?q=bank');
  await get('market: instruments q is trimmed', '/api/market/instruments?q=%20%20tek%20');
  await get('market: instruments q empty', '/api/market/instruments?q=');
  await get('market: instruments q=% (unescaped wildcard)', '/api/market/instruments?q=%25');
  await get('market: instruments assetClass=FUND', '/api/market/instruments?assetClass=FUND');
  await get('market: instruments q + assetClass', '/api/market/instruments?q=a&assetClass=EQUITY');
  await get('market: instruments bad assetClass', '/api/market/instruments?assetClass=BOND');
  await get('market: instruments q too long', `/api/market/instruments?q=${'x'.repeat(41)}`);
  await get('market: instruments repeated q', '/api/market/instruments?q=a&q=b');
  await get('market: instruments unknown parameter', '/api/market/instruments?sort=name');
  await get('market: instrument CTB', '/api/market/instruments/CTB');
  await get('market: instrument lower case', '/api/market/instruments/gov');
  await get('market: unknown instrument', '/api/market/instruments/ZZZ');
  for (const range of ['1D', '5D', '1M', '3M', '6M', 'ALL']) {
    await get(`market: history ${range}`, `/api/market/instruments/TEK/history?range=${range}`, 10_000);
  }
  await get('market: history default range', '/api/market/instruments/OLV/history');
  await get('market: history bad range', '/api/market/instruments/OLV/history?range=2Y');
  await get('market: history bad range on unknown symbol', '/api/market/instruments/ZZZ/history?range=2Y');
  await get('market: history unknown symbol', '/api/market/instruments/ZZZ/history');
  await get('watchlist: empty', '/api/market/watchlist');
  await send('watchlist: add CTB', 'PUT', '/api/market/watchlist/CTB');
  await send('watchlist: add ctb again (idempotent)', 'PUT', '/api/market/watchlist/ctb');
  await send('watchlist: add GOV', 'PUT', '/api/market/watchlist/GOV');
  await send('watchlist: add unknown', 'PUT', '/api/market/watchlist/ZZZ');
  await send('watchlist: remove CTB', 'DELETE', '/api/market/watchlist/CTB');
  await send('watchlist: remove unknown', 'DELETE', '/api/market/watchlist/NOPE');
  await get('watchlist: after changes', '/api/market/watchlist');

  // ------------------------------------------------------------ portfolio creation
  await pair('portfolios: list without a token', 'GET', '/api/portfolios');
  await get('portfolios: empty list', '/api/portfolios');
  for (const [label, body] of [
    ['empty body', {}],
    ['wrong types', { name: '', initialCapital: 'abc' }],
    ['bad name and too little capital', { name: 'Growth <script>', initialCapital: 999 }],
    ['too many decimals', { name: 'Decimals', initialCapital: 1000.0001 }],
    ['weight out of range', { name: 'Weights', initialCapital: 5000, maxPositionWeightPct: 9 }],
    ['fractional weight', { name: 'Weights', initialCapital: 5000, maxPositionWeightPct: 10.5 }],
    ['unknown property', { name: 'Extra', initialCapital: 5000, extra: true }],
    ['null values', { name: null, initialCapital: null, maxPositionWeightPct: null }],
    ['array name', { name: ['a'], initialCapital: [5000] }],
  ]) {
    await send(`create: ${label}`, 'POST', '/api/portfolios', body);
  }
  const created = await send('create: growth portfolio', 'POST', '/api/portfolios', { name: '  Growth & Income (TN)  ', initialCapital: 100000, maxPositionWeightPct: 60 });
  for (const side of SIDES) pid[side] = created[side].json?.id;
  if (!pid.nest || !pid.spring) throw new Error('portfolio creation failed; cannot continue');
  await send('create: duplicate name', 'POST', '/api/portfolios', { name: 'Growth & Income (TN)', initialCapital: 5000 });
  await get('portfolio: get', P());
  await get('portfolio: malformed id', '/api/portfolios/not-a-uuid');
  await get('portfolio: unknown id', '/api/portfolios/00000000-0000-4000-8000-000000000000');
  await pair("portfolio: another user's portfolio is not found", 'GET', (s) => `/api/portfolios/${pid[s === 'nest' ? 'spring' : 'nest']}`, (s) => ({ headers: auth(s) }));

  // ------------------------------------------------------------ order validation and pre-trade checks
  for (const [label, body] of [
    ['empty body', {}],
    ['limit without price', { symbol: 'CTB', side: 'BUY', type: 'LIMIT', quantity: 10 }],
    ['limit price on a market order', { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 10, limitPrice: 40 }],
    ['null limit price on a market order', { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 10, limitPrice: null }],
    ['stop price on a limit order', { symbol: 'CTB', side: 'SELL', type: 'LIMIT', quantity: 10, limitPrice: 40, stopPrice: 30 }],
    ['lower-case terms and fractional quantity', { symbol: 'ctb', side: 'buy', type: 'MARKET', quantity: 1.5 }],
    ['unknown property', { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: '10', extra: true }],
    ['too many decimals on a stop', { symbol: 'CTB', side: 'SELL', type: 'STOP', quantity: 10, stopPrice: 1.2345 }],
    ['quantity out of range', { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 1_000_001 }],
    ['unknown instrument', { symbol: 'ZZZ', side: 'BUY', type: 'MARKET', quantity: 10 }],
    ['buy stop is refused', { symbol: 'CTB', side: 'BUY', type: 'STOP', quantity: 10, stopPrice: 30 }],
    ['limit out of band', { symbol: 'CTB', side: 'BUY', type: 'LIMIT', quantity: 10, limitPrice: 1 }],
    ['position limit', { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 1500 }],
    ['sell without a position', { symbol: 'MDX', side: 'SELL', type: 'MARKET', quantity: 10 }],
    ['stop at or above the bid', { symbol: 'CTB', side: 'SELL', type: 'STOP', quantity: 10, stopPrice: 999 }],
  ]) {
    await send(`preview: ${label}`, 'POST', P('/orders/preview'), body);
  }
  // Which error wins when the DTO and the route UUID are both invalid.
  await send('preview: malformed id and invalid body', 'POST', '/api/portfolios/xyz/orders/preview', { symbol: 'CTB' });
  await send('preview: malformed id, valid body', 'POST', '/api/portfolios/xyz/orders/preview', { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 1 });
  await send('cash-flow: malformed id and empty body', 'POST', '/api/portfolios/xyz/cash-flows', {});
  await get('orders: malformed id and invalid query', '/api/portfolios/xyz/orders?limit=0');
  await get('orders: malformed id, valid query', '/api/portfolios/xyz/orders?limit=5');
  await get('cash-entries: malformed id and invalid query', '/api/portfolios/xyz/cash-entries?limit=x');

  // ------------------------------------------------------------ order lifecycle
  const buy = await order('market buy CTB 100 (fills)', { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 100 }, `co-${RUN}-buy-ctb`);
  await send('submit: same clientOrderId replays the order', 'POST', P('/orders'), (s) => ({
    symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 100, clientOrderId: `co-${RUN}-buy-ctb`, expectedVersion: 0, quoteAsOf: buy.preview[s].json.quote.asOf,
  }));
  await send('submit: same clientOrderId, different terms', 'POST', P('/orders'), (s) => ({
    symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 101, clientOrderId: `co-${RUN}-buy-ctb`, expectedVersion: 0, quoteAsOf: buy.preview[s].json.quote.asOf,
  }));
  await send('submit: stale portfolio version', 'POST', P('/orders'), { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 5, clientOrderId: `co-${RUN}-stale-v`, expectedVersion: 0, quoteAsOf: '2026-01-01T00:00:00.000Z' });
  const current = await get('portfolio: after the buy', P());
  await send('submit: stale quote', 'POST', P('/orders'), (s) => ({ symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 5, clientOrderId: `co-${RUN}-stale-q`, expectedVersion: current[s].json.version, quoteAsOf: '2026-01-01T00:00:00.000Z' }));
  await send('submit: year-only quote time', 'POST', P('/orders'), (s) => ({ symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 5, clientOrderId: `co-${RUN}-year-q`, expectedVersion: current[s].json.version, quoteAsOf: '2026' }));
  await send('submit: invalid quote time and key', 'POST', P('/orders'), { symbol: 'CTB', side: 'BUY', type: 'MARKET', quantity: 5, clientOrderId: 'short', expectedVersion: -1, quoteAsOf: 'yesterday' });

  await order('sell without a position (recorded as REJECTED)', { symbol: 'MDX', side: 'SELL', type: 'MARKET', quantity: 10 }, `co-${RUN}-rej-mdx`);
  await order('market buy OLV 3000 (partial fill, rest cancelled)', { symbol: 'OLV', side: 'BUY', type: 'MARKET', quantity: 3000 }, `co-${RUN}-buy-olv`);
  await send('preview: no liquidity left in this period', 'POST', P('/orders/preview'), { symbol: 'OLV', side: 'BUY', type: 'MARKET', quantity: 10 });

  const gov = await get('market: GOV quote', '/api/market/instruments/GOV');
  const restingLimit = round3(gov.nest.json.quote.mid * 0.6);
  const limitOrder = await order('resting limit buy GOV', { symbol: 'GOV', side: 'BUY', type: 'LIMIT', quantity: 10, limitPrice: restingLimit }, `co-${RUN}-lim-gov`);
  const ctb = await get('market: CTB quote', '/api/market/instruments/CTB');
  const stopOrder = await order('protective stop sell CTB', { symbol: 'CTB', side: 'SELL', type: 'STOP', quantity: 50, stopPrice: round3(ctb.nest.json.quote.bid * 0.7) }, `co-${RUN}-stop-ctb`);
  const tek = await get('market: TEK quote', '/api/market/instruments/TEK');
  await order('marketable limit buy TEK', { symbol: 'TEK', side: 'BUY', type: 'LIMIT', quantity: 5, limitPrice: round3(tek.nest.json.quote.ask * 1.02) }, `co-${RUN}-lim-tek`);
  await order('sell part of CTB', { symbol: 'CTB', side: 'SELL', type: 'MARKET', quantity: 30 }, `co-${RUN}-sell-ctb`);

  await get('orders: open', P('/orders?status=open'));
  await get('orders: closed, limit 3', P('/orders?status=closed&limit=3'));
  await get('orders: all', P('/orders'));
  await get('orders: limit 0', P('/orders?limit=0'));
  await get('orders: bad status and limit', P('/orders?status=done&limit=abc'));
  const limitId = (s) => limitOrder.submitted[s].json.order.id;
  const stopId = (s) => stopOrder.submitted[s].json.order.id;
  await get('order: resting stop', (s) => `/api/portfolios/${pid[s]}/orders/${stopId(s)}`);
  await get('order: filled buy with its execution', (s) => `/api/portfolios/${pid[s]}/orders/${buy.submitted[s].json.order.id}`);
  await get('order: unknown id', P('/orders/00000000-0000-4000-8000-000000000000'));
  await get('order: malformed order id', P('/orders/123'));
  await send('cancel: resting limit', 'POST', (s) => `/api/portfolios/${pid[s]}/orders/${limitId(s)}/cancel`);
  await send('cancel: already cancelled', 'POST', (s) => `/api/portfolios/${pid[s]}/orders/${limitId(s)}/cancel`);
  await send('cancel: filled order', 'POST', (s) => `/api/portfolios/${pid[s]}/orders/${buy.submitted[s].json.order.id}/cancel`);
  await send('cancel: unknown order', 'POST', P('/orders/00000000-0000-4000-8000-000000000000/cancel'));
  await send('cancel: malformed ids', 'POST', '/api/portfolios/abc/orders/def/cancel');

  // ------------------------------------------------------------ cash flows
  const before = await get('portfolio: before cash flows', P());
  await send('cash-flow: deposit', 'POST', P('/cash-flows'), (s) => ({ type: 'DEPOSIT', amount: 5000.5, expectedVersion: before[s].json.version }));
  await send('cash-flow: stale version', 'POST', P('/cash-flows'), (s) => ({ type: 'WITHDRAWAL', amount: 10, expectedVersion: before[s].json.version }));
  const afterDeposit = await get('portfolio: after the deposit', P());
  await send('cash-flow: withdraw more than available', 'POST', P('/cash-flows'), (s) => ({ type: 'WITHDRAWAL', amount: 999999, expectedVersion: afterDeposit[s].json.version }));
  await send('cash-flow: withdraw', 'POST', P('/cash-flows'), (s) => ({ type: 'WITHDRAWAL', amount: '1000', expectedVersion: String(afterDeposit[s].json.version) }));
  for (const [label, body] of [
    ['empty body', {}],
    ['too small and too precise', { type: 'DEPOSIT', amount: 0.0001, expectedVersion: 0 }],
    ['too large', { type: 'DEPOSIT', amount: 10_000_000, expectedVersion: 0 }],
    ['bad type and version', { type: 'deposit', amount: 10, expectedVersion: 1.5 }],
  ]) {
    await send(`cash-flow: ${label}`, 'POST', P('/cash-flows'), body);
  }

  // ------------------------------------------------------------ ledgers, analytics, history
  await get('cash-entries', P('/cash-entries'));
  await get('cash-entries: limit 2', P('/cash-entries?limit=2'));
  await get('cash-entries: limit 201', P('/cash-entries?limit=201'));
  await get('executions', P('/executions'));
  await get('executions: limit 1', P('/executions?limit=1'));
  await get('executions: unknown parameter', P('/executions?offset=1'));
  // Modified Dietz weights each flow by its distance to "now", so it depends on each portfolio's own creation, flow
  // and request instants (milliseconds apart between the two runs). Each side's value is checked exactly against the
  // TypeScript function on that side's stored flows and timestamps; every other field is compared across sides.
  await period(15_000);
  const analytics = {};
  for (const side of SIDES) analytics[side] = await call(BASE[side], 'GET', P('/analytics')(side), { headers: auth(side) });
  for (const side of SIDES) {
    const row = await prisma.tradingPortfolio.findUniqueOrThrow({ where: { id: pid[side] } });
    const snaps = await prisma.portfolioValuationSnapshot.findMany({ where: { portfolioId: pid[side], kind: { in: ['OPENING', 'CASH_FLOW'] } }, orderBy: [{ asOf: 'asc' }, { createdAt: 'asc' }] });
    const body = analytics[side].json;
    const expected = modifiedDietz(snaps.map((s) => ({ amount: Number(s.externalFlowMillimes), at: s.asOf })), row.createdAt, new Date(body.asOf), Math.round(body.valuation.equity * 1000));
    record(`analytics (${side}): money-weighted return equals the TypeScript Modified Dietz on its own flows`, body.performance.moneyWeightedReturn.value === expected, { reported: body.performance.moneyWeightedReturn.value, expected });
  }
  compare('analytics', analytics.nest, analytics.spring, {
    bodyNormalizer: (b) => ({ ...b, performance: { ...b.performance, moneyWeightedReturn: { ...b.performance.moneyWeightedReturn, value: '<checked per side>' } } }),
  });
  await get('history', P('/history'));
  await get('portfolios: list', '/api/portfolios');

  // ------------------------------------------------------------ portfolio limit
  for (let i = 2; i <= 5; i++) await send(`create: portfolio ${i}`, 'POST', '/api/portfolios', { name: `Fund ${i}`, initialCapital: 1000 + i });
  await send('create: sixth portfolio is refused', 'POST', '/api/portfolios', { name: 'Fund 6', initialCapital: 2000 });
  await get('portfolios: list of five', '/api/portfolios', 10_000);

  // ------------------------------------------------------------ documented divergence
  const exp = { nest: await call(NEST, 'POST', '/api/portfolios', { headers: auth('nest'), body: { name: 'Exponent', initialCapital: 1e-7 } }), spring: await call(SPRING, 'POST', '/api/portfolios', { headers: auth('spring'), body: { name: 'Exponent', initialCapital: 1e-7 } }) };
  record('divergence (documented): 1e-7 crashes class-validator (500) and is a 400 in Spring', exp.nest.status === 500 && exp.spring.status === 400 && exp.spring.json?.errorCode === 'VALIDATION_ERROR', { nest: exp.nest.status, spring: [exp.spring.status, exp.spring.json] });

  // ------------------------------------------------------------ persisted ledger state
  const [nestState, springState] = await Promise.all(SIDES.map(ledgerState));
  const differences = diff(normalize(nestState), normalize(springState), 'db');
  record('db: portfolios, orders, executions, cash ledger, positions and snapshots are identical', differences.length === 0, differences.slice(0, 20));
  const first = nestState[0];
  record('db: cash ledger balances chain (each balance = previous + amount)', first.cashEntries.every((c, i) => i === 0 || BigInt(c.balanceAfter) === BigInt(first.cashEntries[i - 1].balanceAfter) + BigInt(c.amount)), first.cashEntries);
  record('db: sequences are 1..n per portfolio', [...nestState, ...springState].every((p) => ['orders', 'executions', 'cashEntries'].every((k) => p[k].every((x, i) => x.sequence === i + 1))), null);

  await finish('differential-trading');
});
