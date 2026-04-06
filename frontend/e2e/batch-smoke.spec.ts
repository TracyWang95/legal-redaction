import { expect, test } from '@playwright/test';
import { openPage, stubBackendOffline } from './helpers';

test.describe('Batch Smoke', () => {
  test('step 1 controls stay visible on preview route', async ({ page }) => {
    await stubBackendOffline(page);
    await openPage(page, '/batch/text?preview=1');

    await expect(page.getByTestId('text-preset-select')).toBeVisible();
    await expect(page.getByTestId('text-redaction-mode-select')).toBeVisible();
    await expect(page.getByTestId('confirm-step1')).toBeVisible();
    await expect(page.getByTestId('advance-upload')).toBeVisible();
  });
});
