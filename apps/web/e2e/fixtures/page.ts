import { expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export async function assertPageHealthy(page: Page, route: string) {
  const errors: string[] = [];
  const onError = (e: Error) => errors.push(String(e));
  page.on('pageerror', onError);
  const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
  expect(res, `navigation ${route}`).toBeTruthy();
  expect(res!.status() < 500, `HTTP ${res!.status()} for ${route}`).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
  // Allow auth restore + shell paint (guard may briefly land on /login then bounce)
  await page.waitForTimeout(900);
  if (/\/login/.test(page.url())) {
    await page.waitForTimeout(1200);
  }
  page.off('pageerror', onError);
  const serious = errors.filter((e) => !/ResizeObserver|expression has changed/i.test(e));
  expect(serious, `pageerror on ${route}: ${serious.join(' | ')}`).toEqual([]);
}

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  if (!page.url().startsWith('http')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  }
  await page.evaluate((t) => {
    document.documentElement.dataset['theme'] = t;
    try {
      localStorage.setItem('mtrs-theme', t);
    } catch {
      /* ignore */
    }
  }, theme);
}

export async function captureRoute(page: Page, name: string) {
  const dir = path.join(process.cwd(), 'e2e/.auth/captures');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}