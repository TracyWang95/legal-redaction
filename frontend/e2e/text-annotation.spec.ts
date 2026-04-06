import { test } from '@playwright/test';
import path from 'path';

const BASE = 'http://localhost:3000';

test('Text annotation preview', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Upload text file
  const dropzone = page.locator('[data-testid="playground-dropzone"]');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    dropzone.click(),
  ]);
  await fileChooser.setFiles(path.resolve('D:/ceshi/数据提供合同_成品-499464daa5.docx'));
  
  // Wait for preview with entities
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'output/verify/text-annotation.png', fullPage: false });
});
