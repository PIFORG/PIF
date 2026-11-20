import { test, expect } from '../fixtures/auth';
import { assertPageHealthy, setTheme, captureRoute } from '../fixtures/page';
import { loadCredentials } from '../fixtures/credentials';

test.describe('Routes ADMIN', () => {
  for (const route of ['/admin', '/admin/platform', '/admin/users', '/admin/audit']) {
    test(`ADMIN ${route}`, async ({ asAdmin: page }) => {
      await assertPageHealthy(page, route);
      await expect(page).toHaveURL(new RegExp(route.replace(/\//g, '\\/')));
      await setTheme(page, 'light');
      await captureRoute(page, `admin-light${route.replace(/\//g, '-') || '-root'}`);
    });
  }

  test('ADMIN user detail dynamique', async ({ asAdmin: page }) => {
    const creds = loadCredentials();
    await assertPageHealthy(page, `/admin/users/${creds.investor.id}`);
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });
});