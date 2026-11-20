import { test, expect } from '../fixtures/auth';
import { setTheme } from '../fixtures/page';
import path from 'node:path';
import fs from 'node:fs';

const OUT = path.join('test-results', 'cloture-visual');
const SCREENS = [
  '/dashboard',
  '/trading',
  '/portfolios',
  '/learn',
  '/stories',
  '/actuarial',
  '/admin',
];

test.describe('Clôture visuelle ciblée', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
  });

  for (const route of SCREENS.filter((r) => r !== '/admin')) {
    for (const theme of ['light', 'dark'] as const) {
      for (const vp of [
        { w: 1440, h: 900, tag: 'desktop' },
        { w: 390, h: 844, tag: 'mobile' },
      ]) {
        test(`${route} ${theme} ${vp.tag}`, async ({ asInvestor: page }) => {
          await page.setViewportSize({ width: vp.w, height: vp.h });
          await page.goto(route);
          await setTheme(page, theme);
          await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
          const name = `${route.replace(/\//g, '_').slice(1) || 'root'}-${theme}-${vp.tag}.png`;
          await page.screenshot({ path: path.join(OUT, name), fullPage: false });
        });
      }
    }
  }

  test('admin light desktop', async ({ asAdmin: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin');
    await setTheme(page, 'light');
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, 'admin-light-desktop.png'), fullPage: false });
  });
});