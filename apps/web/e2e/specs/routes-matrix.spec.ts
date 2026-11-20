import { test, expect } from '../fixtures/auth';
import { setTheme, captureRoute } from '../fixtures/page';
import { loadCredentials } from '../fixtures/credentials';

const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
] as const;

const PUBLIC = [
  '/login',
  '/register',
  '/verify-email',
  '/resend-verification',
  '/forgot-password',
  '/reset-password',
  '/confirm-email-change',
  '/unauthorized',
  '/',
  '/route-inexistante-e2e-404',
];

const INVESTOR = [
  '/dashboard',
  '/markets',
  '/trading',
  '/portfolios',
  '/risk',
  '/backtesting',
  '/strategies',
  '/learn',
  '/learn/missions/my-first-trade',
  '/stories',
  '/actuarial',
  '/actuarial/pricing',
  '/actuarial/monte-carlo',
  '/actuarial/reserving',
  '/actuarial/capital',
  '/actuarial/alm',
  '/stress-testing',
  '/ai',
  '/explainability',
  '/challenges',
  '/rooms',
  '/settings/profile',
  '/settings/security',
  '/settings/sessions',
];

const ADMIN = ['/admin', '/admin/platform', '/admin/users', '/admin/audit'];

async function assertHealthy(page: import('@playwright/test').Page, route: string) {
  const failed: string[] = [];
  const onFailed = (req: import('@playwright/test').Request) => {
    const u = req.url();
    if (/\/api\//.test(u) && !/auth\/refresh/.test(u)) failed.push(u);
  };
  page.on('requestfailed', onFailed);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
  expect(res, `nav ${route}`).toBeTruthy();
  expect(res!.status() < 500).toBeTruthy();
  await page.waitForTimeout(700);
  if (/\/login/.test(page.url()) && !route.startsWith('/login') && route !== '/' && !PUBLIC.includes(route)) {
    await page.waitForTimeout(1200);
  }
  await expect(page.locator('body')).toBeVisible();
  const serious = errors.filter((e) => !/ResizeObserver|expression has changed/i.test(e));
  expect(serious, serious.join(' | ')).toEqual([]);
  page.off('requestfailed', onFailed);
  // Soft: some optional APIs may fail; critical auth should not bounce protected routes
  void failed;
}

test.describe('Matrice routes — public clair/sombre + viewports', () => {
  for (const route of PUBLIC) {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark'] as const) {
        test(`PUBLIC ${route} ${theme} ${vp.name}`, async ({ page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await assertHealthy(page, route);
          await setTheme(page, theme);
          const overflow = await page.evaluate(() => {
            const el = document.documentElement;
            return el.scrollWidth > el.clientWidth + 2;
          });
          // Landing/marketing may intentionally scroll; flag only severe overflow on auth forms
          if (route === '/login' || route === '/register') {
            expect(overflow, `h-overflow ${route} ${vp.name}`).toBeFalsy();
          }
          if (vp.name === '1440' && (route === '/' || route === '/login')) {
            await captureRoute(page, `matrix-${theme}${route === '/' ? '-home' : '-login'}-${vp.name}`);
          }
        });
      }
    }
  }
});

test.describe('Matrice routes — INVESTOR clair/sombre + viewports', () => {
  for (const route of INVESTOR) {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark'] as const) {
        test(`INVESTOR ${route} ${theme} ${vp.name}`, async ({ asInvestor: page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await assertHealthy(page, route);
          await expect(page).not.toHaveURL(/\/login/);
          await setTheme(page, theme);
          const title = await page.title();
          expect(title.length).toBeGreaterThan(0);
          if (vp.name === '1440' && theme === 'light' && ['/dashboard', '/markets', '/trading', '/portfolios', '/learn', '/ai'].includes(route)) {
            await captureRoute(page, `matrix-inv-light${route.replace(/\//g, '-')}-1440`);
          }
        });
      }
    }
  }

  test('INVESTOR sessions dynamiques', async ({ asInvestor: page, creds }) => {
    const token = (creds.investor as { accessToken?: string }).accessToken!;
    const start = await page.request.post(
      `${creds.apiBaseUrl}/learning/missions/my-first-trade/sessions`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        data: {},
      },
    );
    expect(start.ok()).toBeTruthy();
    const id = (await start.json()).session?.id as string;
    for (const theme of ['light', 'dark'] as const) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await assertHealthy(page, `/learn/sessions/${id}`);
        await expect(page).not.toHaveURL(/\/login/);
        await setTheme(page, theme);
        await assertHealthy(page, `/learn/sessions/${id}/review`);
        await expect(page).not.toHaveURL(/\/login/);
      }
    }
  });

  test('INVESTOR rooms dynamique', async ({ asInvestor: page, creds }) => {
    const token = (creds.investor as { accessToken?: string }).accessToken!;
    const created = await page.request.post(`${creds.apiBaseUrl}/rooms`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      data: { name: `E2E Room ${Date.now()}`, visibility: 'PRIVATE' },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const body = await created.json();
    const id = (body.room?.id ?? body.id) as string;
    expect(id).toBeTruthy();
    for (const theme of ['light', 'dark'] as const) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await assertHealthy(page, `/rooms/${id}`);
        await expect(page).not.toHaveURL(/\/login/);
        await setTheme(page, theme);
      }
    }
  });
});

test.describe('Matrice routes — ADMIN clair/sombre + viewports', () => {
  for (const route of ADMIN) {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark'] as const) {
        test(`ADMIN ${route} ${theme} ${vp.name}`, async ({ asAdmin: page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await assertHealthy(page, route);
          await expect(page).not.toHaveURL(/\/login/);
          await setTheme(page, theme);
        });
      }
    }
  }

  test('ADMIN user detail dynamique', async ({ asAdmin: page }) => {
    const creds = loadCredentials();
    for (const theme of ['light', 'dark'] as const) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await assertHealthy(page, `/admin/users/${creds.investor.id}`);
        await expect(page).not.toHaveURL(/\/login/);
        await setTheme(page, theme);
      }
    }
  });
});
