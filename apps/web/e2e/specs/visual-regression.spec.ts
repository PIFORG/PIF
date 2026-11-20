import { test, expect } from '../fixtures/auth';
import { setTheme } from '../fixtures/page';

/**
 * Visual baselines for critical shells. Mask tickers/timestamps to reduce flake.
 * Review diffs manually — do not auto-accept wholesale.
 */
const MASK = ['.tr-ticker', '.tr-tape', '[data-ticker]', 'time', '.tr-newsTicker'];

test.describe('Régression visuelle (références stables)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const route of ['/dashboard', '/markets', '/trading', '/portfolios', '/learn'] as const) {
    test(`clair ${route}`, async ({ asInvestor: page }) => {
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/login/);
      await setTheme(page, 'light');
      await page.waitForTimeout(800);
      await expect(page).toHaveScreenshot(`visual-light${route.replace(/\//g, '-')}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.03,
        mask: MASK.map((s) => page.locator(s)),
      });
    });
  }
});
