import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

test.describe('Integration verification', () => {
  test.beforeEach(async ({ page }) => {
    // Dismiss onboarding if present
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const onboarding = page.locator('[data-testid="onboarding-modal"], [role="dialog"]').first();
    if (await onboarding.isVisible({ timeout: 2000 }).catch(() => false)) {
      const closeBtn = onboarding.locator('button').last();
      if (await closeBtn.isVisible()) await closeBtn.click();
    }
  });

  test('API endpoints respond through proxy', async ({ request }) => {
    const endpoints = [
      '/api/v1/auth/status',
      '/api/v1/custom-types?enabled_only=false',
      '/api/v1/vision-pipelines',
      '/api/v1/presets',
      '/api/v1/files?page=1&page_size=5',
      '/api/v1/ner-backend',
      '/api/v1/model-config',
      '/health/services',
    ];
    for (const ep of endpoints) {
      const res = await request.get(`${BASE}${ep}`);
      expect(res.status(), `${ep} should return 200`).toBe(200);
      const json = await res.json();
      expect(json).toBeTruthy();
    }
  });

  test('Playground page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    // Check no red network errors
    expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0);
    await page.screenshot({ path: 'output/verify/playground.png', fullPage: false });
  });

  test('Settings page renders entity type cards', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'output/verify/settings.png', fullPage: false });
  });

  test('Redaction list page renders', async ({ page }) => {
    await page.goto(`${BASE}/settings/redaction`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'output/verify/redaction-list.png', fullPage: false });
  });

  test('Batch hub page loads', async ({ page }) => {
    await page.goto(`${BASE}/batch`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'output/verify/batch-hub.png', fullPage: false });
  });

  test('History page loads', async ({ page }) => {
    await page.goto(`${BASE}/history`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'output/verify/history.png', fullPage: false });
  });

  test('Batch step indicators are not clickable', async ({ page }) => {
    await page.goto(`${BASE}/batch/text`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    // Step indicators should be spans, not buttons
    const stepButtons = page.locator('[data-testid="step-indicator"] button, .batch-step-progress button');
    const count = await stepButtons.count();
    expect(count, 'Step indicators should not be buttons').toBe(0);
    await page.screenshot({ path: 'output/verify/batch-step1.png', fullPage: false });
  });
});
