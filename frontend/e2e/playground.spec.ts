import { expect, test } from '@playwright/test';
import { openPage, stubBackendOffline, stubRecognitionConfig } from './helpers';

test.describe('Playground', () => {
  test('upload shell stays visible', async ({ page }) => {
    await openPage(page, '/');
    await expect(page.getByTestId('playground')).toBeVisible();
    await expect(page.getByTestId('playground-upload')).toBeVisible();
    await expect(page.getByTestId('playground-dropzone')).toBeVisible();
    await expect(page.getByTestId('playground-type-panel')).toBeVisible();
  });

  test('text and vision config panels render with stable data', async ({ page }) => {
    await stubRecognitionConfig(page);
    await openPage(page, '/');

    await expect(page.locator('[data-testid^="playground-text-group-"]').first()).toBeVisible();

    await page.getByTestId('playground-tab-vision').click();
    await expect(page.locator('[data-testid^="playground-pipeline-"]').first()).toBeVisible();
  });

  test('offline state is explicit', async ({ page }) => {
    await stubBackendOffline(page);
    await openPage(page, '/');

    await expect(page.getByTestId('playground-offline-hint')).toBeVisible();
    await expect(page.getByTestId('playground-config-empty').first()).toBeVisible();
  });
});
