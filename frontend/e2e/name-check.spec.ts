import { test } from '@playwright/test';
test('Sidebar product name', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');
  const dialog = page.locator('[role="dialog"]').first();
  if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    const btn = dialog.locator('button').last();
    if (await btn.isVisible()) await btn.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: 'output/verify/sidebar-name.png', fullPage: false });
});
