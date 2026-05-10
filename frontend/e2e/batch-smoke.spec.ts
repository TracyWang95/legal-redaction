import { test, expect } from '@playwright/test';
import { mockApi } from './support/mock-api';

async function dismissOnboardingIfPresent(page: import('@playwright/test').Page) {
  const dismissButton = page.getByRole('button', {
    name: /dismiss|skip|close|got it|start|begin|ok|跳过|关闭|开始|知道了/i,
  });
  if (await dismissButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dismissButton.click();
  }
}

test('batch: navigate to batch page and verify page loads', async ({ page }) => {
  await mockApi(page);
  await page.goto('/batch');
  await dismissOnboardingIfPresent(page);

  await expect(page.getByTestId('recent-jobs-card')).toBeVisible({ timeout: 10_000 });
});

test('batch: root route exposes the current start page batch entry', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await dismissOnboardingIfPresent(page);

  await expect(page.getByTestId('start-title')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('start-demo-batch')).toHaveAttribute(
    'href',
    /\/batch\/smart\?.*preview=1/,
  );
});

test('batch: verify create job button exists', async ({ page }) => {
  await mockApi(page);
  await page.goto('/batch');
  await dismissOnboardingIfPresent(page);

  await expect(page.getByTestId('batch-launch-smart')).toBeVisible({ timeout: 10_000 });
});

test('batch: upload step accepts the same file families as the backend', async ({ page }) => {
  await mockApi(page);
  await page.goto('/batch/text?preview=1&step=2');

  await expect(page.getByTestId('batch-step2-upload')).toBeVisible({ timeout: 10_000 });
  const accept = await page
    .locator('[data-testid="drop-zone"] input[type="file"]')
    .getAttribute('accept');
  expect(accept).toContain('.txt');
  expect(accept).toContain('.md');
  expect(accept).toContain('.webp');
  expect(accept).toContain('.tif');
});
