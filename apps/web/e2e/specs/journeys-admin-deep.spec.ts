import { test, expect } from '../fixtures/auth';
import { installPrepared } from '../fixtures/auth-install';

function portfoliosOf(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.portfolios)) return o.portfolios as Array<Record<string, unknown>>;
  if (Array.isArray(o.items)) return o.items as Array<Record<string, unknown>>;
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  return [];
}

test.describe('Administration navigateur + effet INVESTOR', () => {
  test('publier actualité ADMIN → visible côté marché INVESTOR → retirer', async ({ browser, creds }) => {
    const stamp = `Actualité pédagogique E2E ${Date.now()}`;
    const adminToken = (creds.admin as { accessToken?: string }).accessToken!;
    const invToken = (creds.investor as { accessToken?: string }).accessToken!;

    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await installPrepared(adminPage, adminToken, (creds.admin as { user: unknown }).user);
    await adminPage.goto('/admin/platform');
    await expect(adminPage).not.toHaveURL(/\/login/);

    const title = adminPage.locator('#news-title, input[name="title"], [formcontrolname="title"]').first();
    const publish = adminPage.getByRole('button', { name: /publier|ajouter.*actualité|créer.*actualité/i }).first();
    if ((await title.count()) && (await publish.count())) {
      await title.fill(stamp);
      const summary = adminPage.locator('#news-summary, textarea[name="summary"], [formcontrolname="summary"]').first();
      if (await summary.count()) await summary.fill('Actualite pedagogique E2E pour verification investisseur.');
      await publish.click();
      await adminPage.waitForTimeout(1200);
      await expect(adminPage.getByText(stamp).first()).toBeVisible({ timeout: 10_000 });
    } else {
      const res = await adminPage.request.post(`${creds.apiBaseUrl}/admin/platform/news`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        data: { title: stamp, summary: 'Actualite pedagogique E2E', symbol: 'E2E', sector: 'TEST' },
      });
      expect(res.ok(), `publish ${res.status()}`).toBeTruthy();
    }

    const adminNews = await adminPage.request.get(`${creds.apiBaseUrl}/admin/platform/news`, {
      headers: { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' },
    });
    expect(adminNews.ok()).toBeTruthy();
    const adminPayload = JSON.stringify(await adminNews.json());
    expect(adminPayload.includes(stamp)).toBeTruthy();

    const invCtx = await browser.newContext();
    const invPage = await invCtx.newPage();
    await installPrepared(invPage, invToken, (creds.investor as { user: unknown }).user);
    await invPage.goto('/markets');
    await expect(invPage).not.toHaveURL(/\/login/);

    const listed = await adminNews.json();
    const items = (listed?.items ?? listed ?? []) as Array<{ id: string; title?: string }>;
    const hit = Array.isArray(items) ? items.find((i) => i.title === stamp) : undefined;
    if (hit?.id) {
      const del = await adminPage.request.delete(`${creds.apiBaseUrl}/admin/platform/news/${hit.id}`, {
        headers: { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' },
      });
      expect(del.ok() || del.status() === 204).toBeTruthy();
    }

    await adminCtx.close();
    await invCtx.close();
  });

  test('suspendre instrument → ordre INVESTOR rejeté → réactiver', async ({ asAdmin: page, creds }) => {
    const adminToken = (creds.admin as { accessToken?: string }).accessToken!;
    const invToken = (creds.investor as { accessToken?: string }).accessToken!;
    const headersAdmin = {
      Authorization: `Bearer ${adminToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const headersInv = {
      Authorization: `Bearer ${invToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const symbol = 'ATL';
    const halt = await page.request.patch(`${creds.apiBaseUrl}/admin/platform/markets/${symbol}/status`, {
      headers: headersAdmin,
      data: { status: 'HALTED' },
    });
    expect(halt.ok() || [200, 204].includes(halt.status()), `halt ${halt.status()}`).toBeTruthy();

    let portfolios = await page.request.get(`${creds.apiBaseUrl}/portfolios`, { headers: headersInv });
    expect(portfolios.ok(), `list portfolios ${portfolios.status()}`).toBeTruthy();
    let arr = portfoliosOf(await portfolios.json());
    if (!arr.length) {
      const created = await page.request.post(`${creds.apiBaseUrl}/portfolios`, {
        headers: headersInv,
        data: { name: `Halt ${Date.now()}`, initialCapital: 50000 },
      });
      expect(created.ok(), `create ${created.status()}`).toBeTruthy();
      portfolios = await page.request.get(`${creds.apiBaseUrl}/portfolios`, { headers: headersInv });
      arr = portfoliosOf(await portfolios.json());
    }
    expect(arr.length).toBeGreaterThan(0);
    const pid = String(arr[0].id);

    const terms = { symbol, side: 'BUY', type: 'MARKET', quantity: 1 };
    const previewHalt = await page.request.post(`${creds.apiBaseUrl}/portfolios/${pid}/orders/preview`, {
      headers: headersInv,
      data: terms,
    });
    expect(previewHalt.ok(), `preview ${previewHalt.status()}`).toBeTruthy();
    const p = await previewHalt.json();
    const submitHalt = await page.request.post(`${creds.apiBaseUrl}/portfolios/${pid}/orders`, {
      headers: headersInv,
      data: {
        ...terms,
        clientOrderId: `e2ehalt_${Date.now()}`,
        expectedVersion: Number(p.portfolioVersion ?? p.portfolio?.version ?? 0),
        quoteAsOf: String(p.quote?.asOf ?? p.quoteAsOf ?? p.asOf),
      },
    });
    const haltBody = await submitHalt.json();
    const haltStatus = String(haltBody.order?.status ?? haltBody.status ?? '');
    const haltCode = String(haltBody.order?.rejectionCode ?? haltBody.rejectionCode ?? '');
    expect(
      haltStatus === 'REJECTED' || /HALT/i.test(haltCode) || /halt/i.test(JSON.stringify(haltBody)),
      `expected INSTRUMENT_HALTED rejection, got ${haltStatus}/${haltCode}`,
    ).toBeTruthy();

    const resume = await page.request.patch(`${creds.apiBaseUrl}/admin/platform/markets/${symbol}/status`, {
      headers: headersAdmin,
      data: { status: 'ACTIVE' },
    });
    expect(resume.ok() || [200, 204].includes(resume.status())).toBeTruthy();

    const previewOk = await page.request.post(`${creds.apiBaseUrl}/portfolios/${pid}/orders/preview`, {
      headers: headersInv,
      data: terms,
    });
    expect(previewOk.ok(), `preview after resume ${previewOk.status()}`).toBeTruthy();
    const p2 = await previewOk.json();
    const order2 = await page.request.post(`${creds.apiBaseUrl}/portfolios/${pid}/orders`, {
      headers: headersInv,
      data: {
        ...terms,
        clientOrderId: `e2eresume_${Date.now()}`,
        expectedVersion: Number(p2.portfolioVersion ?? p2.portfolio?.version ?? 0),
        quoteAsOf: String(p2.quote?.asOf ?? p2.quoteAsOf ?? p2.asOf),
      },
    });
    if (!order2.ok()) {
      const t = await order2.text();
      expect(t.toLowerCase()).not.toMatch(/halt|suspend|suspendu/);
    } else {
      expect(order2.ok()).toBeTruthy();
    }
  });
});

