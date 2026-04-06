import { expect, test } from '@playwright/test';
import { openPage, stubBackendOffline } from './helpers';

test.describe('Batch Hub', () => {
  test('preview entry stays visible when backend is offline', async ({ page }) => {
    await stubBackendOffline(page);
    await openPage(page, '/batch');

    await expect(page.getByTestId('batch-hub-title')).toBeVisible();
    await expect(page.getByTestId('batch-hub-preview-alert')).toBeVisible();
    await expect(page.getByTestId('batch-launch-smart')).toBeVisible();
  });
});

test.describe('Batch Wizard', () => {
  test('explicit preview route stays usable offline', async ({ page }) => {
    await stubBackendOffline(page);
    await openPage(page, '/batch/text?preview=1');

    await expect(page.getByTestId('batch-wizard')).toBeVisible();
    await expect(page.getByTestId('batch-preview-alert')).toBeVisible();
    await expect(page.getByTestId('batch-step-progress')).toBeVisible();
    await expect(page.getByTestId('batch-step1-config')).toBeVisible();
  });
});
