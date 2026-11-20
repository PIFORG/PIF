import type { Page } from '@playwright/test';

/** Prepared-session auth for navigation suites (not for auth-real.spec). */
export async function installPrepared(page: Page, accessToken: string, user: unknown) {
  const refreshBody = JSON.stringify({ accessToken, user });
  const meBody = JSON.stringify(user);

  await page.addInitScript(
    ({ token, cachedUser }) => {
      (window as Window & { __E2E_ACCESS_TOKEN__?: string; __E2E_USER__?: unknown }).__E2E_ACCESS_TOKEN__ =
        token;
      (window as Window & { __E2E_ACCESS_TOKEN__?: string; __E2E_USER__?: unknown }).__E2E_USER__ =
        cachedUser;
    },
    { token: accessToken, cachedUser: user },
  );

  await page.route('**/auth/refresh', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: refreshBody,
    });
  });

  await page.route('**/auth/me', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: meBody,
    });
  });
}
