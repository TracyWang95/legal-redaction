import { expect, test } from '@playwright/test';
import {
  expectNoOverlap,
  expectVisibleNav,
  openPage,
  stubRecognitionConfig,
  stubBackendOffline,
  waitForPageReady,
} from './helpers';

const PRIMARY_NAV = [
  { testId: 'nav-', path: '/' },
  { testId: 'nav-batch', path: '/batch' },
  { testId: 'nav-history', path: '/history' },
  { testId: 'nav-jobs', path: '/jobs' },
  { testId: 'nav-settings-redaction', path: '/settings/redaction' },
  { testId: 'nav-settings', path: '/settings' },
] as const;

const MODEL_NAV = [
  { testId: 'nav-model-settings-text', path: '/model-settings/text' },
  { testId: 'nav-model-settings-vision', path: '/model-settings/vision' },
] as const;

test.describe('Navigation and Stability', () => {
  test('sidebar and top controls stay visible', async ({ page }) => {
    await openPage(page, '/');

    for (const item of PRIMARY_NAV) {
      await expectVisibleNav(page, item.testId);
    }

    for (const item of MODEL_NAV) {
      await expectVisibleNav(page, item.testId);
    }

    await expect(page.getByTestId('health-indicator')).toBeVisible();
    await expect(page.getByTestId('lang-toggle')).toBeVisible();
    await expect(page.getByTestId('playground-upload')).toBeVisible();
  });

  for (const item of [...PRIMARY_NAV, ...MODEL_NAV]) {
    test(`navigates to ${item.path}`, async ({ page }) => {
      await openPage(page, '/');
      await page.getByTestId(item.testId).click();
      await waitForPageReady(page);
      if (item.path === '/') {
        await expect(page).toHaveURL(/\/$/);
      } else {
        await expect(page).toHaveURL(new RegExp(item.path.replace(/\//g, '\\/')));
      }
    });
  }

  test('language toggle can switch state', async ({ page }) => {
    await openPage(page, '/');
    const toggle = page.getByTestId('lang-toggle');
    const initialLabel = (await toggle.textContent())?.trim() ?? '';
    await toggle.click();
    await expect(toggle).not.toHaveText(initialLabel);
  });

  test('offline state stays honest across pages', async ({ page }) => {
    await stubBackendOffline(page);

    await openPage(page, '/');
    await expect(page.getByTestId('health-indicator')).toBeVisible();
    await expect(page.getByTestId('playground-offline-hint')).toBeVisible();
    await expect(page.getByTestId('playground-config-empty').first()).toBeVisible();

    await page.goto('/settings');
    await waitForPageReady(page);
    await expect(page.getByTestId('settings-load-error')).toBeVisible();

    await page.goto('/jobs');
    await waitForPageReady(page);
    await expect(page.getByTestId('jobs-error')).toBeVisible();
    await expect(page.locator('[data-testid^="job-row-"]')).toHaveCount(0);

    await page.goto('/history');
    await waitForPageReady(page);
    await expect(page.getByTestId('history-page').getByRole('alert')).toBeVisible();
    await expect(page.locator('[data-testid^="history-row-"]')).toHaveCount(0);

    await page.goto('/batch/text?preview=1');
    await waitForPageReady(page);
    await expect(page.getByTestId('batch-wizard')).toBeVisible();
    await expect(page.getByTestId('batch-preview-alert')).toBeVisible();
  });

  test('playground chips do not overlap in text and vision panels', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 780 });
    await stubRecognitionConfig(page);
    await openPage(page, '/');

    const textGroup = page.locator('[data-testid^="playground-text-group-"]').first();
    await expect(textGroup).toBeVisible();
    await expectNoOverlap(textGroup.locator('label'), textGroup.locator('.border-t'));

    await page.getByTestId('playground-tab-vision').click();
    const visionGroup = page.locator('[data-testid^="playground-pipeline-"]').first();
    await expect(visionGroup).toBeVisible();
    await expectNoOverlap(visionGroup.locator('label'), visionGroup.locator('.border-t'));
  });
});
