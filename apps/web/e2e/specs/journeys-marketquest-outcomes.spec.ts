import { test, expect } from '../fixtures/auth';
import { loadCredentials } from '../fixtures/credentials';

/**
 * Deterministic MarketQuest outcomes against Spring learning engine.
 * Success: my-first-trade with enough investment → FINISH → assessment.passed=true
 * Failure: protect-your-capital without protective stop → FINISH → assessment.passed=false
 */
async function lastSeq(
  page: import('@playwright/test').Page,
  api: string,
  token: string,
  id: string,
): Promise<number> {
  const res = await page.request.get(`${api}/learning/sessions/${id}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return Number(body.lastSeq ?? 0);
}

async function command(
  page: import('@playwright/test').Page,
  api: string,
  token: string,
  id: string,
  seq: number,
  commandBody: Record<string, unknown>,
) {
  const res = await page.request.post(`${api}/learning/sessions/${id}/commands`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    data: {
      idempotencyKey: `mq-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      expectedSeq: seq,
      command: commandBody,
    },
  });
  const json = await res.json();
  return { status: res.status(), json };
}

async function startFresh(
  page: import('@playwright/test').Page,
  api: string,
  token: string,
  slug: string,
) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  let start = await page.request.post(`${api}/learning/missions/${slug}/sessions`, {
    headers,
    data: {},
  });
  expect(start.ok(), `start ${slug} ${start.status()}`).toBeTruthy();
  let body = await start.json();
  let id = body.session.id as string;
  let seq = await lastSeq(page, api, token, id);
  if (body.resumed || seq > 0) {
    await page.request.post(`${api}/learning/sessions/${id}/abandon`, { headers });
    start = await page.request.post(`${api}/learning/missions/${slug}/sessions`, {
      headers,
      data: {},
    });
    expect(start.ok()).toBeTruthy();
    body = await start.json();
    id = body.session.id as string;
    seq = await lastSeq(page, api, token, id);
  }
  return { id, seq };
}

async function advanceToEnd(
  page: import('@playwright/test').Page,
  api: string,
  token: string,
  id: string,
  seq: number,
) {
  let current = seq;
  for (let i = 0; i < 20; i++) {
    const r = await command(page, api, token, id, current, { type: 'ADVANCE' });
    if (r.status === 422) break;
    expect(r.status).toBeLessThan(500);
    current = Number(r.json.session?.lastSeq ?? (await lastSeq(page, api, token, id)));
    if (r.json.session?.state?.status === 'FAILED') break;
  }
  return current;
}

test.describe('MarketQuest — réussites et échecs déterministes', () => {
  test('mission réussie: Mon premier ordre → passed=true + bilan FR', async ({ asInvestor: page }) => {
    const creds = loadCredentials();
    const token = (creds.investor as { accessToken?: string }).accessToken!;
    const api = creds.apiBaseUrl;

    const { id, seq } = await startFresh(page, api, token, 'my-first-trade');
    const buy = await command(page, api, token, id, seq, {
      type: 'PLACE_ORDER',
      symbol: 'OLV',
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 350,
      rationale: 'LONG_TERM_VIEW',
    });
    expect(buy.status).toBe(200);
    expect(buy.json.outcome).toBe('ACCEPTED');
    let next = Number(buy.json.session?.lastSeq ?? (await lastSeq(page, api, token, id)));
    next = await advanceToEnd(page, api, token, id, next);
    const finish = await command(page, api, token, id, next, { type: 'FINISH' });
    expect(finish.status).toBe(200);
    expect(finish.json.session?.status || finish.json.session?.state?.status).toMatch(/COMPLETED/i);

    const assessRes = await page.request.get(`${api}/learning/sessions/${id}/assessment`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect(assessRes.ok()).toBeTruthy();
    const assess = await assessRes.json();
    expect(assess.passed, `expected pass, total=${assess.total}`).toBe(true);
    expect(Number(assess.total)).toBeGreaterThanOrEqual(55);

    await page.goto(`/learn/sessions/${id}/review`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/bilan|note|réussi|réussite|objectifs|mission/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('mission échouée: Protégez votre capital sans stop → passed=false + bilan FR', async ({
    asInvestor: page,
  }) => {
    const creds = loadCredentials();
    const token = (creds.investor as { accessToken?: string }).accessToken!;
    const api = creds.apiBaseUrl;

    const { id, seq } = await startFresh(page, api, token, 'protect-your-capital');
    const next = await advanceToEnd(page, api, token, id, seq);
    const finish = await command(page, api, token, id, next, { type: 'FINISH' });
    expect(finish.status).toBe(200);

    const assessRes = await page.request.get(`${api}/learning/sessions/${id}/assessment`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect(assessRes.ok()).toBeTruthy();
    const assess = await assessRes.json();
    expect(assess.passed, `expected fail, total=${assess.total}`).toBe(false);

    await page.goto(`/learn/sessions/${id}/review`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/bilan|note|objectif|mission|échec|non atteint|non rempli|protéger/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
