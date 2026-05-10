import { test, expect } from '@playwright/test';

test('playground: dismiss onboarding and verify Upload text visible', async ({ page }) => {
  await page.goto('/');

  // Dismiss onboarding dialog if present
  const dismissButton = page.getByRole('button', { name: /dismiss|skip|close|got it|start|begin|ok/i });
  if (await dismissButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dismissButton.click();
  }

  // Verify "Upload" text is visible on the playground page
  await expect(page.getByText(/upload/i).first()).toBeVisible({ timeout: 10_000 });
});
