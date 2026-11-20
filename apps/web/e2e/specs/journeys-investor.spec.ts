import { test, expect } from '../fixtures/auth';
import { setTheme, captureRoute } from '../fixtures/page';

test.describe('Parcours INVESTOR', () => {
  test('Marchés → desk → portefeuilles', async ({ asInvestor: page }) => {
    await page.goto('/markets');
    await expect(page).not.toHaveURL(/\/login/);
    await setTheme(page, 'light');
    await expect(page.getByText(/marché|cotation|instrument|symbole|cours/i).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/trading');
    await expect(page.locator('body')).toBeVisible();
    const buy = page.getByRole('button', { name: /acheter|buy|passer.*ordre|soumettre/i }).first();
    const qty = page.locator('input[name="quantity"], input[name="qty"], #quantity, [formcontrolname="quantity"]').first();
    if ((await buy.count()) && (await qty.count())) {
      await qty.fill('1');
      await buy.click();
      await page.waitForTimeout(800);
    }
    await page.goto('/portfolios');
    await expect(page.locator('body')).toBeVisible();
    await captureRoute(page, 'journey-investor-portfolio');
  });

  test('MarketQuest hub mission', async ({ asInvestor: page }) => {
    await page.goto('/learn');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/mission|parcours|apprentissage|formation/i).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/learn/missions/my-first-trade');
    await expect(page.locator('body')).toBeVisible();
  });

  test('MarketQuest session + bilan (routes dynamiques)', async ({ asInvestor: page, creds }) => {
    const token = (creds.investor as { accessToken?: string }).accessToken;
    expect(token, 'investor accessToken').toBeTruthy();
    const start = await page.request.post(
      `${creds.apiBaseUrl}/learning/missions/my-first-trade/sessions`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        data: {},
      },
    );
    expect(start.ok(), `start session HTTP ${start.status()}`).toBeTruthy();
    const body = (await start.json()) as { session?: { id?: string } };
    const sessionId = body.session?.id;
    expect(sessionId, 'session id').toBeTruthy();
    await page.goto(`/learn/sessions/${sessionId}`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.url()).toMatch(new RegExp(`/learn/sessions/${sessionId}`));
    await page.goto(`/learn/sessions/${sessionId}/review`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('FinStories feed', async ({ asInvestor: page }) => {
    await page.goto('/stories');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/histoire|récit|épisode|FinStories|narration|story/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('IA + explainability', async ({ asInvestor: page }) => {
    await page.goto('/ai');
    await expect(page).not.toHaveURL(/\/login/);
    const run = page.getByRole('button', { name: /prédire|calculer|lancer|générer|analyser/i }).first();
    if (await run.count()) {
      await run.click();
      await page.waitForTimeout(1000);
    }
    await page.goto('/explainability');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Stress bancaire', async ({ asInvestor: page }) => {
    await page.goto('/stress-testing');
    await expect(page).not.toHaveURL(/\/login/);
    const run = page.getByRole('button', { name: /exécuter|lancer|simuler|calculer/i }).first();
    if (await run.count()) {
      await run.click();
      await page.waitForTimeout(1500);
    }
  });

  test('Actuariat pricing', async ({ asInvestor: page }) => {
    await page.goto('/actuarial/pricing');
    await expect(page).not.toHaveURL(/\/login/);
    const run = page.getByRole('button', { name: /calculer|simuler|lancer|estimer/i }).first();
    if (await run.count()) {
      await run.click();
      await page.waitForTimeout(1500);
    }
  });
});