import { test, expect } from '@playwright/test';
import { assertPageHealthy, setTheme, captureRoute } from '../fixtures/page';

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

test.describe('Routes publiques', () => {
  for (const route of PUBLIC) {
    test(`charge ${route}`, async ({ page }) => {
      await assertPageHealthy(page, route);
      await setTheme(page, 'light');
      if (route === '/' || route === '/login') {
        await captureRoute(page, `public-light${route === '/' ? '-home' : '-login'}`);
        await setTheme(page, 'dark');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('body')).toBeVisible();
        await captureRoute(page, `public-dark${route === '/' ? '-home' : '-login'}`);
      }
    });
  }
});