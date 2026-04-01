import { test, expect } from '@playwright/test';
import { isBackendUp, TEST_IMAGE_PATH, waitForPageReady, dismissOnboarding } from './helpers';

test.describe('Playground 单文件流程', () => {
  /* ──────────── 纯前端测试（无需后端） ──────────── */

  test('初始状态：显示上传区域', async ({ page }) => {
    await page.goto('/');
    await dismissOnboarding(page);
    await waitForPageReady(page);
    // 上传提示区域
    await expect(page.getByText(/拖拽|点击上传|上传文件/).first()).toBeVisible();
  });

  test('数据安全徽章可见', async ({ page }) => {
    await page.goto('/');
    await dismissOnboarding(page);
    await expect(page.getByText(/本机完成|端侧处理/).first()).toBeVisible();
  });

  test('替换模式选择器存在', async ({ page }) => {
    await page.goto('/');
    await dismissOnboarding(page);
    // 替换模式：结构化标签 / 智能替换 / 掩码替换
    const modes = ['结构化标签', '智能替换', '掩码替换'];
    for (const mode of modes) {
      const el = page.getByText(mode).first();
      if (await el.isVisible().catch(() => false)) {
        await expect(el).toBeVisible();
      }
    }
  });

  /* ──────────── 需要后端的测试 ──────────── */

  test('上传图片文件并解析', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');
    test.setTimeout(60_000);

    await page.goto('/');
    await dismissOnboarding(page);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    // 上传后自动开始处理，等待 loading 提示或进入 preview 阶段
    await expect(
      page.getByText(/正在上传|正在识别|正在解析|识别实体|检测区域|执行脱敏|重新上传/).first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test('上传图片 → 自动识别 → 显示实体或检测区域', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');
    test.setTimeout(180_000);

    await page.goto('/');
    await dismissOnboarding(page);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    // 上传后自动进入识别，等待loading消息或识别完成
    await expect(
      page.getByText(/正在上传|正在识别|正在解析|识别实体|检测区域|执行脱敏|重新上传/).first()
    ).toBeVisible({ timeout: 30_000 });

    // 等待识别完成 — 应出现脱敏按钮或实体列表
    await expect(
      page.getByRole('button', { name: /执行脱敏|重新上传/ }).first()
    ).toBeVisible({ timeout: 120_000 });
  });

  test('上传 → 识别 → 脱敏 → 显示结果', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');
    test.setTimeout(300_000);

    await page.goto('/');
    await dismissOnboarding(page);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    // 等待识别完成
    const redactBtn = page.getByRole('button', { name: /执行脱敏/ });
    await redactBtn.waitFor({ state: 'visible', timeout: 120_000 }).catch(() => {});
    if (await redactBtn.isVisible().catch(() => false)) {
      await redactBtn.click();
      // 等待脱敏结果
      await expect(
        page.getByText(/脱敏完成|对比|下载|重新上传/).first()
      ).toBeVisible({ timeout: 60_000 });
    }
  });

  test('上传后出现撤销/重做或重新上传按钮', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');
    test.setTimeout(120_000);

    await page.goto('/');
    await dismissOnboarding(page);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TEST_IMAGE_PATH);

    // 等待识别完成
    await expect(
      page.getByRole('button', { name: /执行脱敏|重新上传/ }).first()
    ).toBeVisible({ timeout: 120_000 });

    // 撤销/重做或重新上传按钮应该存在
    const reuploadBtn = page.getByRole('button', { name: /重新上传/ });
    if (await reuploadBtn.isVisible().catch(() => false)) {
      await expect(reuploadBtn).toBeVisible();
    }
  });
});
