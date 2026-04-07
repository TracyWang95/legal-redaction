import { test, expect } from '@playwright/test';

test('settings: verify Regex tab visible', async ({ page }) => {
  await page.goto('/settings');

  // Verify the "Regex" tab is visible on the settings page
  await expect(page.getByText(/regex/i).first()).toBeVisible({ timeout: 10_000 });
});
