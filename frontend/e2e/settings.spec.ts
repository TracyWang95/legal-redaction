import { expect, test } from '@playwright/test';
import { openPage, stubBackendOffline, stubRecognitionConfig } from './helpers';

test.describe('Settings', () => {
  test('main settings tabs stay visible', async ({ page }) => {
    await openPage(page, '/settings');

    await expect(page.getByTestId('settings-tabs')).toBeVisible();
    await expect(page.getByTestId('tab-text')).toBeVisible();
    await expect(page.getByTestId('tab-vision')).toBeVisible();
  });

  test('offline state stays honest', async ({ page }) => {
    await stubBackendOffline(page);
    await openPage(page, '/settings');

    await expect(page.getByTestId('settings-load-error')).toBeVisible();
  });
});

test.describe('Redaction Lists', () => {
  test('preset controls load from one config source', async ({ page }) => {
    await stubRecognitionConfig(page);
    await openPage(page, '/settings/redaction');

    await expect(page.getByTestId('new-text-preset')).toBeVisible();
    await expect(page.getByTestId('new-vision-preset')).toBeVisible();
    await expect(page.getByTestId('bridge-text-select')).toBeVisible();
    await expect(page.getByTestId('bridge-vision-select')).toBeVisible();
  });

  test('create preset dialog opens with stable controls', async ({ page }) => {
    await stubRecognitionConfig(page);
    await openPage(page, '/settings/redaction');

    await page.getByTestId('new-text-preset').click();
    await expect(page.getByTestId('preset-name')).toBeVisible();
    await expect(page.getByTestId('preset-save')).toBeVisible();
    await expect(page.getByTestId('preset-cancel')).toBeVisible();
  });
});
