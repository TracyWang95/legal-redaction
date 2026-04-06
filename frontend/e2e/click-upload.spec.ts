import { test, expect } from '@playwright/test';
import path from 'path';

const BASE = 'http://localhost:3000';
const TEST_FILE = path.resolve('D:/ceshi/数据提供合同_成品-499464daa5.docx');

test.describe('Click-to-upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('clicking dropzone opens file dialog and uploads', async ({ page }) => {
    const dropzone = page.locator('[data-testid="playground-dropzone"]');
    await expect(dropzone).toBeVisible();
    
    // Screenshot before click
    await page.screenshot({ path: 'output/verify/before-click.png', fullPage: false });

    // Intercept file dialog + click
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      dropzone.click(),
    ]);
    expect(fileChooser).toBeTruthy();
    console.log('File dialog opened successfully!');

    // Upload test file
    await fileChooser.setFiles(TEST_FILE);
    
    // Wait for upload + parse
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'output/verify/after-upload.png', fullPage: false });
    
    // Verify we left upload stage (page should show preview/entities)
    const uploadZone = page.locator('[data-testid="playground-dropzone"]');
    await expect(uploadZone).not.toBeVisible({ timeout: 10000 });
    console.log('Upload successful - moved to preview stage');
  });

  test('clicking "click to upload" button area works', async ({ page }) => {
    // Click specifically on the "点击上传" text/button area
    const clickArea = page.locator('text=点击上传').first();
    if (await clickArea.isVisible({ timeout: 2000 }).catch(() => false)) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        clickArea.click(),
      ]);
      expect(fileChooser).toBeTruthy();
      console.log('Click on text area also works!');
    }
  });
});
