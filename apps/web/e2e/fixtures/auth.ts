import { test as base, expect, type Page } from '@playwright/test';
import { loadCredentials, type E2ECredentials } from './credentials';
import { installPrepared } from './auth-install';

type Fixtures = {
  creds: E2ECredentials;
  asInvestor: Page;
  asAdmin: Page;
};

export const test = base.extend<Fixtures>({
  creds: async ({}, use) => {
    await use(loadCredentials());
  },
  asInvestor: async ({ page, creds }, use) => {
    expect(creds.investor.accessToken, 'missing investor accessToken').toBeTruthy();
    expect((creds.investor as { user?: unknown }).user, 'missing investor user cache — re-run e2e:provision').toBeTruthy();
    await installPrepared(page, creds.investor.accessToken!, (creds.investor as { user: unknown }).user);
    await use(page);
  },
  asAdmin: async ({ page, creds }, use) => {
    expect(creds.admin.accessToken, 'missing admin accessToken').toBeTruthy();
    expect((creds.admin as { user?: unknown }).user, 'missing admin user cache — re-run e2e:provision').toBeTruthy();
    await installPrepared(page, creds.admin.accessToken!, (creds.admin as { user: unknown }).user);
    await use(page);
  },
});

export { expect };
