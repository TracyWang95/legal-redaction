import { test, expect } from '@playwright/test';
import { mockApi } from './support/mock-api';

test('settings: verify Regex tab visible', async ({ page }) => {
  await mockApi(page);
  await page.goto('/settings');

  await expect(page.getByTestId('subtab-regex')).toBeVisible({ timeout: 10_000 });
});

test('settings: redaction presets use the current /presets API contract', async ({ page }) => {
  await mockApi(page);
  const requestedPaths: string[] = [];
  page.on('request', (request) => {
    requestedPaths.push(new URL(request.url()).pathname);
  });

  const presetsResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/presets' && response.status() === 200,
  );
  await page.goto('/settings/redaction');
  await presetsResponse;

  await expect(page.getByTestId('new-text-preset')).toBeVisible({ timeout: 10_000 });
  expect(requestedPaths).toContain('/api/v1/presets');
  expect(requestedPaths).not.toContain('/api/v1/recognition-presets');
});
