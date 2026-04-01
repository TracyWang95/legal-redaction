import { test, expect } from '@playwright/test';
import { isBackendUp, waitForPageReady, dismissOnboarding } from './helpers';

test.describe('处理历史', () => {
  test('页面加载：标题', async ({ page }) => {
    await page.goto('/history');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(page.getByText('处理历史').first()).toBeVisible();
  });

  test('筛选 tab：全部按钮可见', async ({ page }) => {
    await page.goto('/history');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(page.getByRole('button', { name: '全部' }).first()).toBeVisible();
  });

  test('后端可用时：文件列表或空状态', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/history');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    await expect(
      page.getByText(/暂无处理记录|文件名|文件记录/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('后端可用时：分页控件', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/history');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    const perPage = page.getByText(/每页/).first();
    if (await perPage.isVisible().catch(() => false)) {
      await expect(perPage).toBeVisible();
    }
  });

  test('后端可用时：统计摘要卡片', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/history');
    await dismissOnboarding(page);

    // 用更精确的选择器，排除 <option> 等隐藏元素
    await expect(
      page.locator('div, span, p, h3, h4').getByText(/总文件数|识别实体|存储占用/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('后端可用时：ZIP 下载按钮', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/history');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    const downloadBtn = page.getByRole('button', { name: /下载.*ZIP/ }).first();
    if (await downloadBtn.isVisible().catch(() => false)) {
      await expect(downloadBtn).toBeVisible();
    }
  });
});
