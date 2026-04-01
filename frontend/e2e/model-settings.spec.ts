import { test, expect } from '@playwright/test';
import { isBackendUp, waitForPageReady, dismissOnboarding } from './helpers';

test.describe('文本模型配置', () => {
  test('页面加载：标题', async ({ page }) => {
    await page.goto('/model-settings/text');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(page.getByText('文本模型配置').first()).toBeVisible();
  });

  test('后端可用时：NER 服务状态显示', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/model-settings/text');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    await expect(
      page.getByText(/HaS|NER|llama|在线|离线/).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('视觉服务配置', () => {
  test('页面加载：标题', async ({ page }) => {
    await page.goto('/model-settings/vision');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(page.getByText('视觉服务配置').first()).toBeVisible();
  });

  test('后端可用时：服务状态显示', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/model-settings/vision');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    await expect(
      page.getByText(/PaddleOCR|HaS Image|在线|离线/).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
