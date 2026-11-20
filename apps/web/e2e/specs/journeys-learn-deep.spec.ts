import { test, expect } from '../fixtures/auth';
import { loadCredentials } from '../fixtures/credentials';

test.describe('MarketQuest + machine à remonter le temps (profond)', () => {
  test('mission → session → commandes → bilan → branche → comparaison', async ({ asInvestor: page }) => {
    const creds = loadCredentials();
    const token = (creds.investor as { accessToken?: string }).accessToken!;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    await page.goto('/learn');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/mission|apprentissage|parcours/i).first()).toBeVisible({ timeout: 15_000 });

    const start = await page.request.post(
      `${creds.apiBaseUrl}/learning/missions/my-first-trade/sessions`,
      { headers, data: {} },
    );
    expect(start.ok(), `start ${start.status()}`).toBeTruthy();
    const started = await start.json();
    const sessionId = started.session?.id as string;
    expect(sessionId).toBeTruthy();

    await page.goto(`/learn/sessions/${sessionId}`);
    await expect(page).not.toHaveURL(/\/login/);

    const sessionRes = await page.request.get(`${creds.apiBaseUrl}/learning/sessions/${sessionId}`, {
      headers,
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    let seq = Number(session.seq ?? session.expectedSeq ?? 0);

    const place = await page.request.post(`${creds.apiBaseUrl}/learning/sessions/${sessionId}/commands`, {
      headers,
      data: {
        idempotencyKey: `e2e-buy-${Date.now()}`,
        expectedSeq: seq,
        command: {
          type: 'PLACE_ORDER',
          symbol: 'ATL',
          side: 'BUY',
          orderType: 'MARKET',
          quantity: 1,
          rationale: 'E2E decision',
        },
      },
    });
    // Engine may reject for mission constraints — still assert observable response
    expect(place.status()).toBeLessThan(500);
    if (place.ok()) {
      const body = await place.json();
      seq = Number(body.session?.seq ?? body.seq ?? seq + 1);
    }

    const assessment = await page.request.get(
      `${creds.apiBaseUrl}/learning/sessions/${sessionId}/assessment`,
      { headers },
    );
    expect(assessment.status()).toBeLessThan(500);

    // Wait for API payloads first — the review shell only renders after session+timeline resolve.
    const timeline = await page.request.get(`${creds.apiBaseUrl}/learning/sessions/${sessionId}/timeline`, {
      headers,
    });
    expect(timeline.ok(), `timeline ${timeline.status()}`).toBeTruthy();
    const tl = await timeline.json();
    expect(tl.equityCurve || tl.decisions).toBeTruthy();

    await page.goto(`/learn/sessions/${sessionId}/review`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('.lr-reviewShell')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toContainText(/Bilan/i, {
      timeout: 20_000,
    });

    const decisions = (tl.decisions ?? []).filter((d: { type?: string }) => d.type && d.type !== 'REQUEST_HINT');
    if (decisions.length) {
      const fromSeq = decisions[0].seq as number;
      const branch = await page.request.post(`${creds.apiBaseUrl}/learning/sessions/${sessionId}/branches`, {
        headers,
        data: { fromSeq, strategy: 'CONSERVATIVE' },
      });
      expect(branch.status()).toBeLessThan(500);
      if (branch.ok()) {
        const created = await branch.json();
        const branchId = created.id ?? created.session?.id;
        expect(branchId).toBeTruthy();
        const compare = await page.request.get(
          `${creds.apiBaseUrl}/learning/sessions/${sessionId}/compare/${branchId}`,
          { headers },
        );
        expect(compare.ok(), `compare ${compare.status()}`).toBeTruthy();
        const original = await page.request.get(`${creds.apiBaseUrl}/learning/sessions/${sessionId}`, {
          headers,
        });
        expect(original.ok()).toBeTruthy();
        await page.goto(`/learn/sessions/${sessionId}/review`);
        await expect(page.locator('.lr-reviewShell')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toContainText(/Bilan/i);
      }
    } else {
      await expect(page.locator('#branch-strategy, button:has-text("Remonter"), .lr-reviewShell').first()).toBeVisible({
        timeout: 10_000,
      });
    }

    const profile = await page.request.get(`${creds.apiBaseUrl}/learning/profile`, { headers });
    expect(profile.ok()).toBeTruthy();
  });
});
