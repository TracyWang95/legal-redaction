import { test, expect } from '@playwright/test';
import { isBackendUp, TEST_IMAGE_PATH, waitForPageReady, dismissOnboarding } from './helpers';

test.describe('批量任务 Hub', () => {
  test('页面加载：标题与新建按钮', async ({ page }) => {
    await page.goto('/batch');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(page.getByRole('heading', { name: '开始或恢复批量任务' })).toBeVisible();
  });

  test('新建任务按钮可见', async ({ page }) => {
    await page.goto('/batch');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(
      page.getByRole('button', { name: /新建|批量/ }).first()
    ).toBeVisible();
  });

  test('底部链接：任务中心与处理历史', async ({ page }) => {
    await page.goto('/batch');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    await expect(page.getByRole('link', { name: '任务中心' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: '处理历史' }).first()).toBeVisible();
  });

  test('Hub → 处理历史链接跳转', async ({ page }) => {
    await page.goto('/batch');
    await dismissOnboarding(page);
    await page.getByRole('link', { name: '处理历史' }).first().click();
    await expect(page).toHaveURL(/\/history/);
  });
});

test.describe('批量任务创建流程', () => {
  test('后端可用时：创建智能批量任务 → 进入向导', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    await page.goto('/batch');
    await dismissOnboarding(page);
    await waitForPageReady(page);

    const createBtn = page.getByRole('button', { name: /新建|批量/ }).first();
    await createBtn.click();

    await expect(page).toHaveURL(/\/batch\/smart\?/, { timeout: 15_000 });
    await expect(page).toHaveURL(/jobId=/);
    await expect(page).toHaveURL(/step=1/);
  });

  test('后端可用时：向导第 1 步 — 任务配置', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');
    test.setTimeout(30_000);

    await page.goto('/batch');
    await dismissOnboarding(page);
    const createBtn = page.getByRole('button', { name: /新建|批量/ }).first();
    await createBtn.click();
    await expect(page).toHaveURL(/step=1/, { timeout: 15_000 });

    await expect(
      page.getByText(/任务与配置|配置/).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('批量任务 API', () => {
  test('后端可用时：POST /api/v1/jobs 创建任务', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.post('http://127.0.0.1:8000/api/v1/jobs', {
      data: {
        job_type: 'smart_batch',
        title: `E2E 测试任务 ${Date.now()}`,
        config: {},
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('status');

    if (body.id) {
      await request.delete(`http://127.0.0.1:8000/api/v1/jobs/${body.id}`);
    }
  });
});
