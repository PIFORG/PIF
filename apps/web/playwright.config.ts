import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against local Angular + Spring on isolated *_test DB.
 * Provision: npm run e2e:provision
 * - prepared session fixtures: auth intercept for fast nav suites
 * - project `auth-real`: true login/refresh/me/logout (no intercepts)
 */
export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.03 },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'fr-FR',
  },
  projects: [
    {
      name: 'auth-real',
      testMatch: /auth-real\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'rooms-real',
      testMatch: /rooms-multiplayer\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'public',
      testMatch: /public-routes\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'investor',
      testMatch:
        /journeys-investor\.spec\.ts|journeys-trading-deep\.spec\.ts|journeys-learn-deep\.spec\.ts|journeys-stories-deep\.spec\.ts|journeys-marketquest-outcomes\.spec\.ts|routes-investor\.spec\.ts|journeys-echo\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'admin',
      testMatch: /journeys-admin\.spec\.ts|journeys-admin-deep\.spec\.ts|routes-admin\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'responsive',
      testMatch: /routes-responsive\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'matrix',
      testMatch: /routes-matrix\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'a11y',
      testMatch: /a11y-smoke\.spec\.ts|finstories-tts-chain\.spec\.ts|cloture-visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'visual',
      testMatch: /visual-regression\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
