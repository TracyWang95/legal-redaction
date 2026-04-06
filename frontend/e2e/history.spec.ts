import { expect, test } from '@playwright/test';
import { openPage, stubBackendOffline } from './helpers';

test.describe('History', () => {
  test('filters and table shell stay visible', async ({ page }) => {
    await openPage(page, '/history');

    await expect(page.getByTestId('history-page')).toBeVisible();
    await expect(page.getByTestId('history-source-tabs')).toBeVisible();
    await expect(page.getByTestId('history-refresh')).toBeVisible();
    await expect(page.getByTestId('history-cleanup')).toBeVisible();
  });

  test('source tab changes sync back to the url', async ({ page }) => {
    await openPage(page, '/history?source=batch');

    await expect(page.getByTestId('source-tab-batch')).toHaveAttribute('data-state', 'active');

    await page.getByTestId('source-tab-playground').click();
    await expect(page).toHaveURL(/source=playground/);
  });

  test('offline state shows a real error and no fake rows', async ({ page }) => {
    await stubBackendOffline(page);
    await openPage(page, '/history');

    await expect(page.getByTestId('history-page').getByRole('alert')).toBeVisible();
    await expect(page.locator('[data-testid^="history-row-"]')).toHaveCount(0);
  });
});
