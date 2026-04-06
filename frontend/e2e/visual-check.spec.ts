import { test } from '@playwright/test';

const BASE = 'http://localhost:3000';

async function dismissOnboarding(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  const dialog = page.locator('[role="dialog"]').first();
  if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    const btn = dialog.locator('button').last();
    if (await btn.isVisible()) await btn.click();
    await page.waitForTimeout(300);
  }
}

test.describe('Visual check', () => {
  test('Settings - Regex tab (3x4 grid)', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await dismissOnboarding(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'output/verify/settings-regex-3x4.png', fullPage: false });
  });

  test('Settings - Semantic tab', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await dismissOnboarding(page);
    await page.locator('[data-testid="subtab-llm"]').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'output/verify/settings-semantic-3x4.png', fullPage: false });
  });

  test('Settings - Vision OCR tab', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await dismissOnboarding(page);
    await page.locator('[data-testid="tab-vision"]').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'output/verify/settings-vision-ocr-3x4.png', fullPage: false });
  });

  test('Settings - Vision Image tab', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await dismissOnboarding(page);
    await page.locator('[data-testid="tab-vision"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="pipeline-tab-image"]').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'output/verify/settings-vision-image-3x4.png', fullPage: false });
  });

  test('Playground sidebar', async ({ page }) => {
    await page.goto(BASE);
    await dismissOnboarding(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'output/verify/playground-sidebar.png', fullPage: false });
  });

  test('Batch Step2 config', async ({ page }) => {
    await page.goto(`${BASE}/batch/text`);
    await dismissOnboarding(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'output/verify/batch-step2-config.png', fullPage: false });
  });
});
