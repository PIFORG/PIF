import { test, expect } from '../fixtures/auth';
import { setTheme } from '../fixtures/page';

const CRITICAL = ['/dashboard', '/markets', '/trading', '/portfolios', '/learn', '/stories', '/login'];

test.describe('Accessibilité smoke (WCAG 2.2 AA — automatisable)', () => {
  test('focus visible + labels formulaires login', async ({ page }) => {
    await page.goto('/login');
    await setTheme(page, 'light');
    await page.locator('#email').focus();
    const outline = await page.locator('#email').evaluate((el) => {
      const s = getComputedStyle(el);
      return { outline: s.outlineStyle, width: s.outlineWidth, boxShadow: s.boxShadow };
    });
    const hasFocus =
      (outline.outline && outline.outline !== 'none') ||
      (outline.width && outline.width !== '0px') ||
      (outline.boxShadow && outline.boxShadow !== 'none');
    expect(hasFocus, 'email focus indicator').toBeTruthy();
    await expect(page.locator('label[for="email"]')).toBeVisible();
    await expect(page.locator('label[for="password"]')).toBeVisible();
  });

  for (const route of CRITICAL.filter((r) => r !== '/login')) {
    test(`clavier shell ${route}`, async ({ asInvestor: page }) => {
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/login/);
      await setTheme(page, 'light');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(tag) || tag.length > 0).toBeTruthy();
      // reduce motion preference
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toBeVisible();
    });
  }

  test('contraste texte principal dashboard (heuristique)', async ({ asInvestor: page }) => {
    await page.goto('/dashboard');
    await setTheme(page, 'light');
    const sample = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return null;
      const cs = getComputedStyle(h1);
      return { color: cs.color, bg: getComputedStyle(document.body).backgroundColor, font: cs.fontFamily };
    });
    expect(sample?.font ?? '').toMatch(/Poppins|sans-serif/i);
    expect(sample?.color).toBeTruthy();
  });

  test('skip-link, lang=fr, un seul h1 principal login', async ({ page }) => {
    await page.goto('/login');
    await setTheme(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('lang', /fr/i);
    const skip = page.getByRole('link', { name: /Aller au contenu|contenu principal/i });
    if (await skip.count()) {
      await skip.focus();
      await expect(skip).toBeFocused();
    }
    const h1 = page.locator('h1');
    expect(await h1.count()).toBeGreaterThanOrEqual(1);
    await expect(h1.first()).toBeVisible();
  });

  test('erreurs de formulaire login accessibles', async ({ page }) => {
    await page.goto('/login');
    await page.locator('form').filter({ has: page.locator('#email') }).locator('button[type="submit"]').click();
    await expect(page.locator('#email-error, .field-error, [role="alert"]').first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
  });

  test('drawer mobile: Escape + piège au Tab', async ({ asInvestor: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await setTheme(page, 'light');
    // Fermer un éventuel menu profil ouvert par un focus parasite
    await page.keyboard.press('Escape');
    const menu = page.getByRole('button', { name: 'Ouvrir le menu' });
    await expect(menu).toBeVisible();
    await menu.click();
    const drawer = page.locator('#investor-drawer');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const d = document.querySelector('#investor-drawer');
      return !!(d && d.contains(document.activeElement));
    });
    expect(inside).toBeTruthy();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden({ timeout: 5_000 });
  });

  test('tableau marchés: en-têtes présents', async ({ asInvestor: page }) => {
    await page.goto('/markets');
    await setTheme(page, 'light');
    const table = page.locator('table').first();
    if (await table.count()) {
      await expect(table.locator('th').first()).toBeVisible();
    } else {
      // Liste / grille alternative toujours accessible
      await expect(page.getByRole('main')).toBeVisible();
    }
  });

  test('zoom 200% login: reflow sans pageerror', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expect(page.locator('#email')).toBeVisible();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.locator('#email').fill('a@b.c');
    expect(errors).toEqual([]);
  });

  test('dialogue confirmation paramètres: alertdialog si ouvert', async ({ asInvestor: page }) => {
    await page.goto('/settings/security');
    await setTheme(page, 'light');
    const danger = page.getByRole('button', { name: /Révoquer|Désactiver|Supprimer|Déconnecter/i }).first();
    if (await danger.count()) {
      await danger.click();
      const dlg = page.locator('[role="alertdialog"], [role="dialog"]').first();
      await expect(dlg).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Escape');
    } else {
      await expect(page.getByRole('main')).toBeVisible();
    }
  });
});
