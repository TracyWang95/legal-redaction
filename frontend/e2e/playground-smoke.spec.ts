import { test, expect } from '@playwright/test';
import { mockApi } from './support/mock-api';

test('playground: dismiss onboarding and verify Upload text visible', async ({ page }) => {
  await mockApi(page);
  await page.goto('/playground');

  // Dismiss onboarding dialog if present
  const dismissButton = page.getByRole('button', {
    name: /dismiss|skip|close|got it|start|begin|ok|跳过|关闭|开始|知道了/i,
  });
  if (await dismissButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dismissButton.click();
  }

  await expect(page.getByTestId('playground-upload')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('playground-dropzone')).toBeVisible();
});
