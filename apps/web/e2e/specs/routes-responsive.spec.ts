import { test, expect } from '../fixtures/auth';
import { assertPageHealthy, setTheme } from '../fixtures/page';

const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
];

const SAMPLE = ['/dashboard', '/markets', '/trading', '/portfolios', '/learn', '/ai'];

test.describe('Responsive INVESTOR (échantillon)', () => {
  for (const vp of VIEWPORTS) {
    for (const route of SAMPLE) {
      test(`${vp.name}px ${route}`, async ({ asInvestor: page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await assertPageHealthy(page, route);
        await expect(page).not.toHaveURL(/\/login/);
        await setTheme(page, 'light');
      });
    }
  }
});