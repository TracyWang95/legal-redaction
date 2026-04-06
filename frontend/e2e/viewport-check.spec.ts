import { test, expect } from '@playwright/test';
import path from 'path';

const BASE = 'http://localhost:3000';

test.describe('Viewport containment at 100% zoom', () => {
  test('Playground preview stays within viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Upload a file
    const dropzone = page.locator('[data-testid="playground-dropzone"]');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      dropzone.click(),
    ]);
    await fileChooser.setFiles(path.resolve('D:/ceshi/数据提供合同_成品-499464daa5.docx'));
    
    // Wait for preview stage
    await page.waitForTimeout(6000);
    
    // Check page doesn't scroll - body scrollHeight should equal viewport height
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    console.log(`Body: ${bodyHeight}px, Viewport: ${viewportHeight}px`);
    
    // Body should not be significantly taller than viewport
    expect(bodyHeight).toBeLessThanOrEqual(viewportHeight + 5);
    
    await page.screenshot({ path: 'output/verify/preview-viewport.png', fullPage: false });
  });

  test('Playground image upload stays within viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const dropzone = page.locator('[data-testid="playground-dropzone"]');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      dropzone.click(),
    ]);
    await fileChooser.setFiles(path.resolve('D:/ceshi/图片_20260131115035_543_3.png'));
    
    await page.waitForTimeout(6000);
    
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    console.log(`Body: ${bodyHeight}px, Viewport: ${viewportHeight}px`);
    expect(bodyHeight).toBeLessThanOrEqual(viewportHeight + 5);
    
    await page.screenshot({ path: 'output/verify/image-viewport.png', fullPage: false });
  });
});
