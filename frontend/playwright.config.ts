import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

function envFlag(value: string | undefined): boolean | null {
  if (value == null || value === '') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function shouldUseAuthStorage(): boolean {
  const explicit = envFlag(process.env.PLAYWRIGHT_AUTH);
  if (explicit != null) return explicit;
  if (process.env.PLAYWRIGHT_AUTH_STORAGE || process.env.PLAYWRIGHT_AUTH_STORAGE_STATE) return true;
  const hasCredential = Boolean(
    process.env.DATAINFRA_PASSWORD ||
    process.env.DATAINFRA_TOKEN ||
    process.env.DATAINFRA_TOKEN_FILE,
  );
  return Boolean(process.env.PLAYWRIGHT_BASE_URL && hasCredential);
}

function authStorageStatePath(): string | undefined {
  if (!shouldUseAuthStorage()) return undefined;
  return path.resolve(
    process.env.PLAYWRIGHT_AUTH_STORAGE ||
      process.env.PLAYWRIGHT_AUTH_STORAGE_STATE ||
      path.join('e2e', '.auth', 'storage-state.json'),
  );
}

const defaultBaseURL = 'http://127.0.0.1:3000';

// Local E2E tests start the Vite dev server automatically on port 3000.
// To test an already-running app, set PLAYWRIGHT_SKIP_WEBSERVER=1 and
// PLAYWRIGHT_BASE_URL=http://127.0.0.1:<port>.
const storageState = authStorageStatePath();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/support/auth-global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || defaultBaseURL,
    storageState,
    trace: 'on-first-retry',
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 3000 --strictPort',
        url: defaultBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
