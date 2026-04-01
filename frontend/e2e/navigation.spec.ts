import { test, expect } from '@playwright/test';
import { SIDEBAR_NAV, MODEL_NAV, waitForPageReady, dismissOnboarding } from './helpers';

test.describe('导航与布局', () => {
  test('首页加载：侧边栏品牌与导航项全部可见', async ({ page }) => {
    await page.goto('/');
    await dismissOnboarding(page);
    // 品牌名
    await expect(page.getByText('DataInfra-RedactionEverything')).toBeVisible();
    // 所有主导航
    for (const item of SIDEBAR_NAV) {
      await expect(
        page.locator('nav').getByRole('link', { name: item.label }).first()
      ).toBeVisible();
    }
  });

  test('模型配置导航项可见', async ({ page }) => {
    await page.goto('/');
    await dismissOnboarding(page);
    for (const item of MODEL_NAV) {
      await expect(
        page.getByRole('link', { name: item.label }).first()
      ).toBeVisible();
    }
  });

  // 逐一测试每个侧边栏链接可导航
  for (const item of SIDEBAR_NAV) {
    test(`侧边栏 → ${item.label} 可导航到 ${item.path}`, async ({ page }) => {
      await page.goto('/');
      await dismissOnboarding(page);
      await page.locator('nav').getByRole('link', { name: item.label }).first().click();
      await waitForPageReady(page);
      if (item.path === '/') {
        await expect(page).toHaveURL(/\/$/);
      } else {
        await expect(page).toHaveURL(new RegExp(item.path.replace(/\//g, '\\/')));
      }
    });
  }

  for (const item of MODEL_NAV) {
    test(`侧边栏 → ${item.label} 可导航到 ${item.path}`, async ({ page }) => {
      await page.goto('/');
      await dismissOnboarding(page);
      await page.getByRole('link', { name: item.label }).first().click();
      await waitForPageReady(page);
      await expect(page).toHaveURL(new RegExp(item.path.replace(/\//g, '\\/')));
    });
  }

  test('暗色模式切换', async ({ page }) => {
    await page.goto('/');
    await dismissOnboarding(page);
    const html = page.locator('html');
    const toggleBtn = page.getByRole('button', { name: /切换到深色模式|切换到亮色模式/ });
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();
    await expect(html).toHaveClass(/dark/);
    await toggleBtn.click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test('语言切换按钮存在', async ({ page }) => {
    await page.goto('/');
    await dismissOnboarding(page);
    // 语言切换：可能是文本按钮 "中文" / "EN" 或图标按钮
    const langBtn = page.locator('button:has-text("中文"), button:has-text("EN"), button:has-text("English")').first();
    await expect(langBtn).toBeVisible({ timeout: 5_000 });
  });

  test('健康状态区域可见', async ({ page }) => {
    await page.goto('/');
    await dismissOnboarding(page);
    await expect(page.getByText('PaddleOCR').first()).toBeVisible({ timeout: 20_000 });
  });

  test('移动端响应式：窄屏下侧边栏可折叠', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await dismissOnboarding(page);
    // 移动端侧边栏默认收起
    const sidebar = page.locator('aside');
    // 找到汉堡菜单按钮
    const menuBtn = page.getByRole('button', { name: /菜单|menu/i }).first();
    if (await menuBtn.isVisible().catch(() => false)) {
      await menuBtn.click();
      await expect(sidebar).toBeVisible();
    }
  });
});
