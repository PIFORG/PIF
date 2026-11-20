import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * 3 isolated browser contexts — real login, no auth mocks.
 * Prerequisite: node tools/e2e/market-rooms-multiplayer.mjs (writes data/reports/...).
 */
const REPORT = path.resolve(process.cwd(), '../../data/reports/market-rooms-multiplayer.json');
const API = process.env.E2E_API_URL || 'http://localhost:3002/api';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const loginResponse = page.waitForResponse(
    (res) => res.url().includes('/auth/login') && res.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator('form').filter({ has: page.locator('#email') }).locator('button[type="submit"]').click();
  const res = await loginResponse;
  expect(res.ok(), `login ${email} ${res.status()}`).toBeTruthy();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('Market Rooms — 3 contextes navigateur isolés', () => {
  test('créer / rejoindre / démarrer / soldes / chat', async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!fs.existsSync(REPORT), 'Run tools/e2e/market-rooms-multiplayer.mjs first');

    const report = JSON.parse(fs.readFileSync(REPORT, 'utf8')) as {
      password?: string;
      players: { key: string; email: string }[];
    };
    test.skip(!report.password || report.players.length < 3, 'Report missing password/players');

    const health = await fetch(`${API}/health`);
    expect(health.ok, 'API health').toBeTruthy();

    const [pA, pB, pC] = report.players;
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const pageC = await ctxC.newPage();

    await login(pageA, pA.email, report.password!);
    await login(pageB, pB.email, report.password!);
    await login(pageC, pC.email, report.password!);

    await pageA.goto('/rooms');
    await expect(pageA.getByRole('heading', { name: /Salles de marché/i })).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText(/Capital fictif/i).first()).toBeVisible();

    const title = `UI3-${Date.now().toString(36)}`;
    await pageA.getByLabel(/Titre/i).fill(title);
    await pageA.getByRole('button', { name: /Créer et entrer/i }).click();
    await expect(pageA).toHaveURL(/\/rooms\/[0-9a-f-]+/i, { timeout: 20_000 });
    const codeText = await pageA.locator('.tr-pageLede').innerText();
    const code = codeText.match(/Code\s+([A-Z0-9]+)/i)?.[1];
    expect(code, 'code invitation').toBeTruthy();

    for (const page of [pageB, pageC]) {
      await page.goto('/rooms');
      await page.getByPlaceholder(/ABC123/i).fill(code!);
      await page.getByRole('button', { name: /Rejoindre/i }).click();
      await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]+/i, { timeout: 20_000 });
    }

    await pageA.getByRole('button', { name: /^Démarrer$/i }).click();
    await expect(pageA.getByText(/ACTIVE|Simulation démarrée/i).first()).toBeVisible({ timeout: 15_000 });

    await pageB.reload();
    await expect(pageB.getByText(/Valeur nette|Points d’apprentissage|Dette/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageB.getByText(/Score = 30%/i)).toBeVisible({ timeout: 15_000 });

    await pageA.getByPlaceholder(/Écrire un message/i).fill('Ping UI 3 joueurs');
    await pageA.getByRole('button', { name: /Envoyer/i }).click();
    await pageC.waitForTimeout(4500);
    await expect(pageC.getByText('Ping UI 3 joueurs')).toBeVisible({ timeout: 20_000 });

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  });
});
