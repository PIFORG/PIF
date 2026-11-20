import { test, expect } from '../fixtures/auth';
import { setTheme, captureRoute } from '../fixtures/page';
import { loadCredentials } from '../fixtures/credentials';

test.describe('Parcours ADMIN', () => {
  test('Supervision plateforme visible', async ({ asAdmin: page }) => {
    await page.goto('/admin/platform');
    await expect(page).not.toHaveURL(/\/login/);
    await setTheme(page, 'light');
    await expect(page.getByText(/supervision|instruments|missions|actualit/i).first()).toBeVisible({ timeout: 15_000 });
    await captureRoute(page, 'journey-admin-platform');
  });

  test('Publication et retrait actualité pédagogique', async ({ asAdmin: page }) => {
    await page.goto('/admin/platform');
    await expect(page).not.toHaveURL(/\/login/);
    const title = page.locator('#news-title, input[name="title"], [formcontrolname="title"]').first();
    const publish = page.getByRole('button', { name: /publier|ajouter.*actualité|créer.*actualité/i }).first();
    if ((await title.count()) && (await publish.count())) {
      const stamp = `E2E actualite ${Date.now()}`;
      await title.fill(stamp);
      const summary = page.locator('#news-summary, textarea[name="summary"], [formcontrolname="summary"]').first();
      if (await summary.count()) await summary.fill('Resume pedagogique genere pour parcours E2E.');
      await publish.click();
      await page.waitForTimeout(1200);
      await expect(page.getByText(stamp).first()).toBeVisible({ timeout: 10_000 });
      const remove = page.getByRole('button', { name: /retirer|supprimer/i }).first();
      if (await remove.count()) {
        await remove.click();
        await page.waitForTimeout(800);
      }
    }
  });

  test('Suspension instrument puis réactivation (UI)', async ({ asAdmin: page }) => {
    await page.goto('/admin/platform');
    await expect(page).not.toHaveURL(/\/login/);
    const halt = page.getByRole('button', { name: /suspendre|halt/i }).first();
    if (await halt.count()) {
      await halt.click();
      await page.waitForTimeout(800);
      const resume = page.getByRole('button', { name: /réactiver|reprendre|activer|resume/i }).first();
      if (await resume.count()) {
        await resume.click();
        await page.waitForTimeout(800);
      }
    }
  });
});

test.describe('ADMIN vs INVESTOR séparation', () => {
  test('INVESTOR ne peut pas ouvrir /admin', async ({ asInvestor: page }) => {
    await page.goto('/admin');
    await page.waitForTimeout(1200);
    const url = page.url();
    const onAdminConsole = /\/admin(\/|$)/.test(url) && (await page.getByText(/Supervision|Utilisateurs|Journal d/i).count()) > 0;
    expect(onAdminConsole, `investor must not see admin console, url=${url}`).toBeFalsy();
  });
});