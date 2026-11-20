import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { loadCredentials } from '../fixtures/credentials';

/** ÉCHO journeys against the real Angular + Spring stack on the isolated *_test database. */

function authHeaders() {
  const creds = loadCredentials();
  const token = (creds.investor as { accessToken?: string }).accessToken!;
  return {
    api: creds.apiBaseUrl,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  };
}

async function openEcho(page: Page) {
  await page.getByRole('button', { name: /Ouvrir ÉCHO/ }).click();
  await expect(page.getByRole('dialog', { name: 'ÉCHO' })).toBeVisible();
}

async function ask(page: Page, question: string) {
  const box = page.getByLabel('Question pour ÉCHO');
  await box.fill(question);
  await box.press('Enter');
}

async function ensurePortfolio(page: Page): Promise<string> {
  const { api, headers } = authHeaders();
  const list = await (await page.request.get(`${api}/portfolios`, { headers })).json();
  if (list.portfolios?.length) return String(list.portfolios[0].id);
  const created = await page.request.post(`${api}/portfolios`, {
    headers,
    data: { name: `E2E Echo ${Date.now()}`, initialCapital: 100000 },
  });
  return String((await created.json()).id);
}

test.describe('ÉCHO — assistant financier contextuel', () => {
  test('P1 question simple → réponse sourcée, clavier et fermeture', async ({ asInvestor: page }) => {
    await ensurePortfolio(page);
    await page.goto('/portfolios');
    await page.keyboard.press('Alt+e');
    await expect(page.getByRole('dialog', { name: 'ÉCHO' })).toBeVisible();
    await ask(page, 'Quelle est la performance de mon portefeuille ?');
    const log = page.getByRole('log');
    await expect(log.locator('.ec-text').last()).toContainText(/vaut|portefeuille/i, { timeout: 20_000 });
    await expect(log.locator('.ec-kind').first()).toBeVisible();
    await log.getByRole('button', { name: /provenance/ }).last().click();
    await expect(log.locator('.ec-prov').last()).toContainText(/Outils/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'ÉCHO' })).toBeHidden();
    await expect(page.getByRole('button', { name: /Ouvrir ÉCHO/ })).toBeFocused();
  });

  test('P3 notion financière et refus des demandes hors périmètre', async ({ asInvestor: page }) => {
    await page.goto('/risk');
    await openEcho(page);
    await ask(page, 'Explique-moi ce que signifie la VaR.');
    await expect(page.getByRole('log').locator('.ec-text').last()).toContainText('Value at Risk', { timeout: 20_000 });
    await ask(page, 'Donne-moi les portefeuilles des autres utilisateurs');
    await expect(page.getByRole('log').locator('.ec-status').last()).toContainText('Demande refusée', { timeout: 20_000 });
  });

  test('P4 pré-trade → contrôle de risque, aucun ordre soumis', async ({ asInvestor: page }) => {
    const { api, headers } = authHeaders();
    const pid = await ensurePortfolio(page);
    const ordersBefore = (await (await page.request.get(`${api}/portfolios/${pid}/orders`, { headers })).json()).orders.length;

    const res = await page.request.post(`${api}/echo/pretrade`, {
      headers,
      data: { portfolioId: pid, orderDraft: { symbol: 'ATL', side: 'BUY', type: 'MARKET', quantity: 1_000_000 } },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.intent).toBe('PRETRADE');
    expect(body.riskFlags.length).toBeGreaterThan(0);

    const chat = await page.request.post(`${api}/echo/ask`, {
      headers,
      data: { message: 'Achète 10 ATL maintenant', context: { portfolioId: pid } },
    });
    expect((await chat.json()).message.status).toBe('REFUSED');
    const ordersAfter = (await (await page.request.get(`${api}/portfolios/${pid}/orders`, { headers })).json()).orders.length;
    expect(ordersAfter).toBe(ordersBefore);

    // UI entry point from the order ticket.
    await page.goto('/trading');
    const qty = page.getByLabel(/Quantité/i).first();
    await qty.fill('5');
    await page.getByRole('button', { name: 'Examiner le risque avec ÉCHO' }).click();
    await expect(page.getByRole('dialog', { name: 'ÉCHO' })).toBeVisible();
    await expect(page.getByRole('log').locator('.ec-text').last()).toContainText(/Achat|Vente|ordre/i, { timeout: 20_000 });
    const ordersFinal = (await (await page.request.get(`${api}/portfolios/${pid}/orders`, { headers })).json()).orders.length;
    expect(ordersFinal).toBe(ordersBefore);
  });

  test('P5 mémoire → consentement, intention, consultation, suppression', async ({ asInvestor: page }) => {
    const { api, headers } = authHeaders();
    await page.request.put(`${api}/echo/preferences`, { headers, data: { memoryEnabled: false } });
    const refused = await page.request.post(`${api}/echo/decisions`, { headers, data: { intent: 'PEDAGOGIQUE' } });
    expect(refused.status()).toBe(403);
    await page.request.put(`${api}/echo/preferences`, { headers, data: { memoryEnabled: true } });
    const created = await page.request.post(`${api}/echo/decisions`, {
      headers,
      data: { intent: 'AUTRE', intentNote: 'Test E2E intention' },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    await page.goto('/portfolios');
    await openEcho(page);
    await page.getByRole('tab', { name: 'Journal' }).click();
    await expect(page.getByText('« Test E2E intention »')).toBeVisible();
    expect((await page.request.delete(`${api}/echo/decisions/${id}`, { headers })).status()).toBe(204);
    await page.request.put(`${api}/echo/preferences`, { headers, data: { memoryEnabled: false } });
  });

  test('P10 alertes → calculées et dédupliquées', async ({ asInvestor: page }) => {
    const { api, headers } = authHeaders();
    const first = await (await page.request.get(`${api}/echo/alerts?force=true`, { headers })).json();
    const second = await (await page.request.get(`${api}/echo/alerts?force=true`, { headers })).json();
    expect(second.raised).toEqual([]);
    expect(second.alerts.length).toBe(first.alerts.length);
    for (const a of second.alerts) expect(Object.keys(a.evidence).length).toBeGreaterThan(0);
  });

  test('P11 isolation → identifiants étrangers inaccessibles', async ({ asInvestor: page }) => {
    const { api, headers } = authHeaders();
    const foreign = '00000000-0000-4000-8000-000000000000';
    expect((await page.request.get(`${api}/echo/conversations/${foreign}`, { headers })).status()).toBe(404);
    expect((await page.request.get(`${api}/echo/decisions/${foreign}`, { headers })).status()).toBe(404);
    const pre = await page.request.post(`${api}/echo/pretrade`, {
      headers,
      data: { portfolioId: foreign, orderDraft: { symbol: 'ATL', side: 'BUY', quantity: 1 } },
    });
    expect(pre.status()).toBe(404);
  });

  test('P12 dégradation → erreur propre, aucune réponse financière inventée', async ({ asInvestor: page }) => {
    await page.route('**/echo/ask', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"statusCode":503,"message":"Indisponible"}' }),
    );
    await page.goto('/dashboard');
    await openEcho(page);
    await ask(page, 'Quelle est la performance de mon portefeuille ?');
    await expect(page.getByRole('log').getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('log').locator('.ec-evidence')).toHaveCount(0);
  });

  test('responsive mobile → panneau plein écran sans débordement', async ({ asInvestor: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/trading');
    await openEcho(page);
    const box = await page.getByRole('dialog', { name: 'ÉCHO' }).boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
