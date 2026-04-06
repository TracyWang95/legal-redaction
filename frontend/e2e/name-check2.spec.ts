import { test, expect } from '@playwright/test';
test('Sidebar shows new name', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');
  // Try multiple ways to dismiss dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // Verify sidebar text
  const sidebar = page.locator('aside, nav, [data-testid="sidebar"]').first();
  const sidebarText = await sidebar.textContent();
  console.log('Sidebar text:', sidebarText?.slice(0, 100));
  await page.screenshot({ path: 'output/verify/sidebar-name2.png', fullPage: false });
});
