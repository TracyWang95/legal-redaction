import { expect, test } from '@playwright/test';
import { openPage, stubBackendOffline } from './helpers';

test.describe('Jobs', () => {
  test('page controls stay visible', async ({ page }) => {
    await openPage(page, '/jobs');

    await expect(page.getByTestId('jobs-page')).toBeVisible();
    await expect(page.getByTestId('jobs-tab-list')).toBeVisible();
    await expect(page.getByTestId('jobs-refresh-btn')).toBeVisible();
    await expect(page.getByTestId('jobs-cleanup-btn')).toBeVisible();
  });

  test('offline state shows a real error and no fake rows', async ({ page }) => {
    await stubBackendOffline(page);
    await openPage(page, '/jobs');

    await expect(page.getByTestId('jobs-error')).toBeVisible();
    await expect(page.locator('[data-testid^="job-row-"]')).toHaveCount(0);
  });
});
