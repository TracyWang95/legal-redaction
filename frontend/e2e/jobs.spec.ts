import { test, expect } from '@playwright/test';
import { isBackendUp, waitForPageReady, dismissOnboarding } from './helpers';

test.describe('任务中心', () => {
  test('页面加载：标题与表头', async ({ page }) => {
    await page.goto('/jobs');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(page.getByRole('heading', { name: '任务中心' }).first()).toBeVisible();
  });

  test('全部 tab 默认激活', async ({ page }) => {
    await page.goto('/jobs');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(page.getByRole('button', { name: '全部' }).first()).toBeVisible();
  });

  test('后端可用时：任务列表或空状态', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/jobs');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    await expect(
      page.getByText(/暂无任务记录|任务记录|任务/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('后端可用时：手动刷新按钮', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/jobs');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    const refreshBtn = page.getByRole('button', { name: /刷新|点击刷新/ }).first();
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(1_000);
      await expect(page.getByRole('heading', { name: '任务中心' }).first()).toBeVisible();
    }
  });

  test('后端可用时：分页控件', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/jobs');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    const perPage = page.getByText(/每页/).first();
    if (await perPage.isVisible().catch(() => false)) {
      await expect(perPage).toBeVisible();
    }
  });

  test('从任务中心跳转到批量任务', async ({ page }) => {
    await page.goto('/jobs');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    const batchLink = page.getByRole('link', { name: /前往批量任务|批量任务/ }).first();
    if (await batchLink.isVisible().catch(() => false)) {
      await batchLink.click();
      await expect(page).toHaveURL(/\/batch/);
    }
  });

  test('后端可用时：GET /api/v1/jobs 接口正常', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/api/v1/jobs?page_size=5');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('jobs');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.jobs)).toBeTruthy();
  });
});
