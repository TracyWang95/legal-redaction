import { test } from '@playwright/test';
test('Upload hero layout', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'output/verify/hero-apple.png', fullPage: false });
});
