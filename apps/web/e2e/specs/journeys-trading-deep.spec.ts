import { test, expect } from '../fixtures/auth';
import { loadCredentials } from '../fixtures/credentials';

function portfoliosOf(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.portfolios)) return o.portfolios as Array<Record<string, unknown>>;
  if (Array.isArray(o.items)) return o.items as Array<Record<string, unknown>>;
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  return [];
}

async function placeMarket(
  page: import('@playwright/test').Page,
  apiBase: string,
  auth: Record<string, string>,
  portfolioId: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  symbol = 'ATL',
) {
  const terms = { symbol, side, type: 'MARKET', quantity };
  const preview = await page.request.post(`${apiBase}/portfolios/${portfolioId}/orders/preview`, {
    headers: auth,
    data: terms,
  });
  expect(preview.ok(), `preview ${preview.status()} ${(await preview.text()).slice(0, 250)}`).toBeTruthy();
  const p = await preview.json();
  const quoteAsOf = String(p.quote?.asOf ?? p.quoteAsOf ?? p.asOf);
  const expectedVersion = Number(p.portfolioVersion ?? p.expectedVersion ?? p.portfolio?.version ?? 0);
  const clientOrderId = `e2eord_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const submit = await page.request.post(`${apiBase}/portfolios/${portfolioId}/orders`, {
    headers: auth,
    data: { ...terms, clientOrderId, expectedVersion, quoteAsOf },
  });
  return submit;
}

test.describe('Parcours trading métier (profond)', () => {
  test('créer portefeuille → achat → position → vente → historique', async ({ asInvestor: page }) => {
    const creds = loadCredentials();
    const token = (creds.investor as { accessToken?: string }).accessToken!;
    const auth = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const stamp = `E2E Desk ${Date.now()}`;

    await page.goto('/markets');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Univers négociable|Instruments|Marchés/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.goto('/trading');
    await expect(page.getByText(/portefeuille|ticket|Négociation/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Create when under limit; otherwise reuse an existing book (max 5 portefeuilles)
    const listedBefore = await page.request.get(`${creds.apiBaseUrl}/portfolios`, { headers: auth });
    expect(listedBefore.ok()).toBeTruthy();
    let books = portfoliosOf(await listedBefore.json());
    let portfolioId = '';
    let usedName = stamp;
    if (books.length < 5) {
      const created = await page.request.post(`${creds.apiBaseUrl}/portfolios`, {
        headers: auth,
        data: { name: stamp, initialCapital: 100000 },
      });
      expect(created.ok(), `create ${created.status()} ${(await created.text()).slice(0, 200)}`).toBeTruthy();
      const createdBody = await created.json();
      portfolioId = String(createdBody.id ?? createdBody.portfolio?.id);
    } else {
      portfolioId = String(books[0].id);
      usedName = String(books[0].name ?? 'portefeuille');
    }
    expect(portfolioId).toBeTruthy();

    await page.goto('/portfolios');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/Portefeuille|Capitaux|Créer|Négocier/i);

    const beforeDetail = await page.request.get(`${creds.apiBaseUrl}/portfolios/${portfolioId}`, {
      headers: auth,
    });
    expect(beforeDetail.ok()).toBeTruthy();
    const beforeBook = await beforeDetail.json();
    const cashBefore = Number(beforeBook.cash ?? beforeBook.portfolio?.cash);
    const qtyBefore = Number(
      ((beforeBook.positions ?? beforeBook.portfolio?.positions ?? []) as Array<{ symbol: string; quantity: number }>)
        .find((p) => p.symbol === 'ATL')?.quantity ?? 0,
    );

    const buy = await placeMarket(page, creds.apiBaseUrl, auth, portfolioId, 'BUY', 2);
    expect(buy.ok(), `buy ${buy.status()} ${(await buy.text()).slice(0, 300)}`).toBeTruthy();
    const buyOrder = await buy.json();
    expect(['FILLED', 'PARTIALLY_FILLED', 'OPEN'].includes(String(buyOrder.status ?? buyOrder.order?.status))).toBeTruthy();

    const detail = await page.request.get(`${creds.apiBaseUrl}/portfolios/${portfolioId}`, { headers: auth });
    expect(detail.ok()).toBeTruthy();
    const book = await detail.json();
    const cash = Number(book.cash ?? book.portfolio?.cash);
    expect(cash).toBeLessThan(cashBefore);
    const positions = (book.positions ?? book.portfolio?.positions ?? []) as Array<{
      symbol: string;
      quantity: number;
    }>;
    const held = positions.find((p) => p.symbol === 'ATL' && Number(p.quantity) > qtyBefore);
    expect(held, 'ATL position increased').toBeTruthy();

    const sell = await placeMarket(page, creds.apiBaseUrl, auth, portfolioId, 'SELL', 1);
    expect(sell.ok(), `sell ${sell.status()} ${(await sell.text()).slice(0, 300)}`).toBeTruthy();

    const ordersRes = await page.request.get(`${creds.apiBaseUrl}/portfolios/${portfolioId}/orders`, {
      headers: auth,
    });
    expect(ordersRes.ok()).toBeTruthy();
    const ordersBody = await ordersRes.json();
    const orders = (ordersBody.orders ?? ordersBody.items ?? ordersBody) as Array<{ side: string }>;
    const list = Array.isArray(orders) ? orders : [];
    expect(list.some((o) => o.side === 'BUY')).toBeTruthy();
    expect(list.some((o) => o.side === 'SELL')).toBeTruthy();

    // UI observes blotter / books
    await page.goto('/trading');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).toContainText(/ATL|position|ordre|Portefeuille|Négociation/i);

    await page.goto('/portfolios');
    await expect(page.getByText(/Capitaux|Profit|historique|ordres|Portefeuilles/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const listed = await page.request.get(`${creds.apiBaseUrl}/portfolios`, { headers: auth });
    expect(portfoliosOf(await listed.json()).some((p) => String(p.id) === portfolioId)).toBeTruthy();
  });
});
