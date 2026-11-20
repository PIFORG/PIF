import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { loadCredentials } from './credentials';

/** Form login with zero auth route interception — hits Spring Boot for real. */
export async function loginViaForm(
  page: Page,
  role: 'investor' | 'admin',
): Promise<{ email: string; accessToken: string }> {
  const creds = loadCredentials();
  const account = role === 'investor' ? creds.investor : creds.admin;
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(creds.password);
  const loginResponse = page.waitForResponse(
    (res) => res.url().includes('/auth/login') && res.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator('form').filter({ has: page.locator('#email') }).locator('button[type="submit"]').click();
  const res = await loginResponse;
  expect(res.ok(), `login HTTP ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken?: string; mfaChallengeToken?: string };
  expect(body.accessToken || body.mfaChallengeToken, 'login body').toBeTruthy();
  if (body.mfaChallengeToken) {
    throw new Error('MFA required on E2E account — provision should keep mfa_enabled=false');
  }
  expect(body.accessToken, 'accessToken from real login').toBeTruthy();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  return { email: account.email, accessToken: body.accessToken! };
}

export async function signOutViaUi(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: /Menu du compte/i });
  await trigger.click();
  await page.getByRole('menuitem', { name: /Se déconnecter/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
}

/** API helper using cookies/token from a browser-authenticated context request. */
export async function apiJson(
  request: APIRequestContext,
  path: string,
  init?: { method?: string; data?: unknown; token?: string },
) {
  const creds = loadCredentials();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init?.token) headers.Authorization = `Bearer ${init.token}`;
  if (init?.data !== undefined) headers['Content-Type'] = 'application/json';
  const res = await request.fetch(`${creds.apiBaseUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers,
    data: init?.data,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { ok: res.ok(), status: res.status(), json };
}
