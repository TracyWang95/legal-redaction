import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const LIVE_LOCALHOST_ORIGIN = 'http://127.0.0.1:3000';
const AUTH_STORAGE_STATE = path.resolve('e2e', '.auth', 'storage-state.json');
const ONBOARDING_COMPLETED_KEY = 'onboarding_completed';
const SCREENSHOT_PATH = path.resolve(
  process.cwd(),
  '..',
  'output',
  'playwright',
  'live-localhost-start.png',
);

if (existsSync(AUTH_STORAGE_STATE)) {
  test.use({ storageState: AUTH_STORAGE_STATE });
}

function isLiveLocalhost(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    return new URL(baseURL).origin === LIVE_LOCALHOST_ORIGIN;
  } catch {
    return false;
  }
}

async function prepareStableLocalState(page: Page) {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, 'true');
  }, ONBOARDING_COMPLETED_KEY);
}

async function expectOnboardingNotBlocking(page: Page) {
  await expect
    .poll(
      () => page.evaluate((key) => window.localStorage.getItem(key), ONBOARDING_COMPLETED_KEY),
      {
        message:
          'Onboarding state was not pre-seeded. Check frontend/e2e/.auth/storage-state.json or DATAINFRA_TOKEN_FILE path resolution.',
      },
    )
    .toBe('true');
  await expect(
    page.locator('#onboarding-title'),
    'Onboarding dialog is blocking the live localhost gate; storage state should mark onboarding_completed=true.',
  ).toHaveCount(0);
}

async function expectNavigationShell(page: Page, activeNavId?: string) {
  await expect(page.getByTestId('nav-single')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('nav-batch')).toBeVisible();
  if (activeNavId) {
    await expect(page.getByTestId(activeNavId)).toHaveAttribute('aria-current', 'page');
  }
}

async function expectNotLegacyPlaygroundSurface(page: Page) {
  await expect(page.getByTestId('playground')).toHaveCount(0);
  await expect(page.getByTestId('playground-upload')).toHaveCount(0);
  await expect(page.getByTestId('playground-dropzone')).toHaveCount(0);
}

async function expectConsumerFirstCopy(page: Page) {
  await expect(page.getByText('DataInfra-RedactionEverything 工作台')).toHaveCount(0);
  await expect(page.getByText(/本地验证|三通道|PowerShell|D:\\ceshi|eval:ceshi/)).toHaveCount(0);
}

test('live localhost: root, playground, batch entry, and screenshot gate', async ({
  page,
  baseURL,
}) => {
  test.skip(
    !isLiveLocalhost(baseURL),
    'Set PLAYWRIGHT_SKIP_WEBSERVER=1 and PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 to run this live localhost gate.',
  );

  await prepareStableLocalState(page);

  await page.goto('/');
  await expectNavigationShell(page);
  await expectOnboardingNotBlocking(page);
  await expect(page.getByTestId('start-title')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('start-playground')).toBeVisible();
  await expect(page.getByTestId('start-live-batch')).toBeVisible();
  await expect(page.getByTestId('start-history')).toBeVisible();
  await expect(page.getByTestId('start-jobs')).toBeVisible();
  await expectConsumerFirstCopy(page);
  await expectNotLegacyPlaygroundSurface(page);
  await mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

  await page.goto('/single');
  await expectNavigationShell(page, 'nav-single');
  await expectOnboardingNotBlocking(page);
  await expect(page.getByTestId('start-title')).toHaveCount(0);
  await expect(page.getByTestId('batch-hub-title')).toHaveCount(0);
  await expect(page.getByTestId('playground-upload')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('playground-dropzone')).toBeVisible();
  await expectConsumerFirstCopy(page);

  await page.goto('/batch');
  await expectNavigationShell(page, 'nav-batch');
  await expectOnboardingNotBlocking(page);
  await expect(page.getByTestId('batch-hub-title')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('recent-jobs-card')).toBeVisible();
  await expect(page.getByTestId('batch-launch-smart')).toBeVisible();
  await expectConsumerFirstCopy(page);
  await expectNotLegacyPlaygroundSurface(page);
});
