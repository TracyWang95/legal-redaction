import { expect, test } from '@playwright/test';
import { openPage } from './helpers';

test.describe('Model Settings', () => {
  test('text model controls stay visible', async ({ page }) => {
    await openPage(page, '/model-settings/text');

    await expect(page.getByTestId('endpoint-url')).toBeVisible();
    await expect(page.getByTestId('test-endpoint')).toBeVisible();
    await expect(page.getByTestId('save-endpoint')).toBeVisible();
    await expect(page.getByTestId('reset-ner-default')).toBeVisible();
  });

  test('vision model controls stay visible', async ({ page }) => {
    await openPage(page, '/model-settings/vision');

    await expect(page.getByTestId('add-vision-backend')).toBeVisible();
    await expect(page.getByTestId('reset-vision-models')).toBeVisible();
  });
});
