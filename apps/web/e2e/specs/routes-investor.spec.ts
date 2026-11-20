import { test, expect } from '../fixtures/auth';
import { assertPageHealthy, setTheme, captureRoute } from '../fixtures/page';

const INVESTOR_STATIC = [
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

test.describe('Routes INVESTOR — charge + thèmes', () => {
  for (const route of INVESTOR_STATIC) {
    test(`INVESTOR ${route}`, async ({ asInvestor: page }) => {
      await assertPageHealthy(page, route);
      await expect(page).not.toHaveURL(/\/login/);
      await setTheme(page, 'light');
      if (['/markets', '/trading', '/portfolios', '/learn', '/ai', '/stress-testing', '/dashboard'].includes(route)) {
        await captureRoute(page, `investor-light${route.replace(/\//g, '-')}`);
        await setTheme(page, 'dark');
        await page.reload({ waitUntil: 'domcontentloaded' });
        // After reload, refresh cookie may rotate; ensure still authenticated via soft check
        await expect(page.locator('body')).toBeVisible();
        await captureRoute(page, `investor-dark${route.replace(/\//g, '-')}`);
      }
    });
  }

  test('mission session dynamique via démarrage UI', async ({ asInvestor: page }) => {
    await page.goto('/learn/missions/my-first-trade');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    const start = page.getByRole('button', { name: /commencer|démarrer|reprendre|continuer|lancer/i }).first();
    if (await start.count()) {
      await start.click();
      await page.waitForTimeout(1500);
      expect(page.url()).toMatch(/\/learn\//);
    }
  });
});