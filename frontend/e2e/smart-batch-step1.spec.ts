import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

test('Smart batch step1 → step2 transition', async ({ page }) => {
  const errors: string[] = [];
  const apiErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', res => { if (res.status() >= 400) apiErrors.push(`${res.status()} ${res.url()}`); });

  await page.goto(`${BASE}/batch/smart`);
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // Check confirm checkbox
  const confirm = page.locator('[data-testid="confirm-step1"]');
  await confirm.click();
  await page.waitForTimeout(500);

  // Click advance button
  const advBtn = page.locator('[data-testid="advance-upload"]');
  await expect(advBtn).toBeEnabled({ timeout: 3000 });
  await advBtn.click();
  await page.waitForTimeout(3000);

  console.log('Console errors:', errors);
  console.log('API errors:', apiErrors);
  
  await page.screenshot({ path: 'output/verify/smart-step1-result.png', fullPage: false });
});
