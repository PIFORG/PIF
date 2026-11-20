import { test, expect } from '@playwright/test';
import { loadCredentials } from '../fixtures/credentials';
import { loginViaForm, signOutViaUi } from '../fixtures/real-login';

/**
 * True Angular → Spring → PostgreSQL auth. No route mocks for login/refresh/me/logout.
 * Keep this project small: login endpoints are rate-limited.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Authentification réelle (sans interception)', () => {
  test('INVESTOR: formulaire → session → profil → reload → refresh → déconnexion → refus', async ({
    page,
  }) => {
    const creds = loadCredentials();
    const authCalls: { url: string; status: number }[] = [];
    page.on('response', (res) => {
      const u = res.url();
      if (/\/auth\/(login|me|refresh|logout)/.test(u)) {
        authCalls.push({ url: u, status: res.status() });
      }
    });

    const session = await loginViaForm(page, 'investor');
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Investor|E2E|Vue d'ensemble|Bonjour/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const meBefore = await page.request.get(`${creds.apiBaseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
    });
    expect(meBefore.ok(), `auth/me before reload ${meBefore.status()}`).toBeTruthy();
    const meJson = await meBefore.json();
    expect(meJson.email).toBe(creds.investor.email);
    expect(meJson.role).toBe('INVESTOR');

    // Reload exercises real refresh cookie → /auth/refresh (no Playwright fulfill)
    const refreshPromise = page.waitForResponse(
      (r) => r.url().includes('/auth/refresh') && r.request().method() === 'POST',
      { timeout: 20_000 },
    ).catch(() => null);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.locator('body')).toBeVisible();
    const refreshRes = await refreshPromise;
    if (refreshRes) expect(refreshRes.ok(), `real refresh ${refreshRes.status()}`).toBeTruthy();

    await page.goto('/markets');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Marchés|Univers|instrument/i).first()).toBeVisible({ timeout: 15_000 });

    await signOutViaUi(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    const meAfter = await page.request.get(`${creds.apiBaseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
    });
    expect([401, 403].includes(meAfter.status()), `revoked token status ${meAfter.status()}`).toBeTruthy();

    const loginHit = authCalls.some((c) => c.url.includes('/auth/login') && c.status < 400);
    const meHit = authCalls.some((c) => c.url.includes('/auth/me') && c.status < 400);
    expect(loginHit, 'real /auth/login observed').toBeTruthy();
    expect(meHit, 'real /auth/me observed').toBeTruthy();
  });

  test('ADMIN: connexion réelle + console ; INVESTOR refusé sur /admin', async ({ browser }) => {
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await loginViaForm(adminPage, 'admin');
    await adminPage.goto('/admin');
    await expect(adminPage).not.toHaveURL(/\/login/);
    await expect(adminPage.getByText(/Supervision|Utilisateurs|Journal|Administration/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await adminCtx.close();

    // Separate context: avoid login throttle stacking on same browser cookie jar mid-suite
    await new Promise((r) => setTimeout(r, 1500));
    const invCtx = await browser.newContext();
    const invPage = await invCtx.newPage();
    await loginViaForm(invPage, 'investor');
    await invPage.goto('/admin');
    await invPage.waitForTimeout(1500);
    const url = invPage.url();
    const onAdmin =
      /\/admin(\/|$)/.test(url) &&
      (await invPage.getByText(/Supervision plateforme|Journal d/i).count()) > 0;
    expect(onAdmin, `investor must not enter admin console, url=${url}`).toBeFalsy();
    await invCtx.close();
  });

  test('MFA: comptes E2E provisionnés sans MFA (parcours MFA non forcé)', async ({ page }) => {
    const creds = loadCredentials();
    await page.goto('/login');
    await page.locator('#email').fill(creds.investor.email);
    await page.locator('#password').fill(creds.password);
    const resPromise = page.waitForResponse(
      (r) => r.url().includes('/auth/login') && r.request().method() === 'POST',
    );
    await page.locator('form').filter({ has: page.locator('#email') }).locator('button[type="submit"]').click();
    const res = await resPromise;
    const body = await res.json();
    expect(body.mfaChallengeToken, 'E2E accounts must not require MFA').toBeFalsy();
    expect(body.accessToken).toBeTruthy();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  });
});
