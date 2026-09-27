import { defineConfig, devices } from '@playwright/test';
import { BASE_URL as baseURL } from './e2e/helpers';
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

/**
 * End-to-end tests run against production builds (`pnpm build` first) of both the API and
 * the web app, with Postgres and Redis running. They use a small Android-sized screen
 * (360px wide) because that is what most of our users have.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'ar',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'android-360',
      use: {
        ...devices['Galaxy S9+'],
        viewport: { width: 360, height: 740 },
        browserName: 'chromium',
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @souqna/api start',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      cwd: '../..',
    },
    {
      command: 'pnpm start',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
