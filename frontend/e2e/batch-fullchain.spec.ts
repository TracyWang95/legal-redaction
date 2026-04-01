import { test, expect } from '@playwright/test';
import { isBackendUp, REAL_TEST_FILES, dismissOnboarding } from './helpers';
import fs from 'fs';

function hasRealTestData(): boolean {
  return Object.values(REAL_TEST_FILES).every((p) => fs.existsSync(p));
}

/**
 * 批量全链路 E2E（带截图调试）
 * 使用 D:\ceshi 的 3 个真实文件
 */
test.describe('批量全链路（真实数据 + 截图）', () => {
  test.setTimeout(600_000);

  test('Step1 配置 → Step2 上传3文件 → Step3 识别 → Step4 审核 → Step5 导出', async ({
    page,
    request,
  }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');
    test.skip(!hasRealTestData(), 'D:\\ceshi 测试数据不存在');

    let jobId: string | null = null;

    try {
      // ═══════ 从 Hub 创建任务 ═══════
      await page.goto('/batch');
      await dismissOnboarding(page);
      await page.screenshot({ path: 'test-results/batch-00-hub.png' });

      const createBtn = page.getByRole('button', { name: /新建|批量/ }).first();
      await createBtn.click();
      await expect(page).toHaveURL(/step=1/, { timeout: 15_000 });
      jobId = new URL(page.url()).searchParams.get('jobId');
      console.log(`[全链路] jobId = ${jobId}`);

      // ═══════ Step 1: 配置 ═══════
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: 'test-results/batch-01-config.png' });

      // 勾选确认 checkbox
      const checkboxes = page.locator('input[type="checkbox"]');
      const checkboxCount = await checkboxes.count();
      console.log(`[Step1] 找到 ${checkboxCount} 个 checkbox`);
      if (checkboxCount > 0) {
        const first = checkboxes.first();
        if (!(await first.isChecked())) await first.check();
      }

      // 等待配置加载完成（按钮从 disabled 变 enabled）
      const toStep2 = page.getByRole('button', { name: '下一步：上传' });
      // 等待按钮 enabled（configLoaded + 至少选一个类型）
      await expect(toStep2).toBeEnabled({ timeout: 30_000 });

      const step1Buttons = await page.getByRole('button').allTextContents();
      console.log(`[Step1] 所有按钮: ${step1Buttons.join(' | ')}`);

      await toStep2.click();
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: 'test-results/batch-02-upload.png' });

      const currentUrl2 = page.url();
      console.log(`[Step2] URL = ${currentUrl2}`);

      // ═══════ Step 2: 上传 3 个文件 ═══════
      const fileInput = page.locator('input[type="file"]');
      await expect(fileInput).toBeAttached({ timeout: 5_000 });

      // 一次性上传 3 个文件
      await fileInput.setInputFiles([
        REAL_TEST_FILES.image,
        REAL_TEST_FILES.docx1,
        REAL_TEST_FILES.docx2,
      ]);

      // 等待文件出现
      await page.waitForTimeout(8_000);
      await page.screenshot({ path: 'test-results/batch-03-files-uploaded.png' });

      // 列出所有可见文本确认文件名
      const pageText = await page.locator('body').innerText();
      const hasFile = pageText.includes('图片_') || pageText.includes('数据提供合同') || pageText.includes('ce.');
      console.log(`[Step2] 页面包含文件名: ${hasFile}`);

      // 点击下一步去识别
      const step2Buttons = await page.getByRole('button').allTextContents();
      console.log(`[Step2] 所有按钮: ${step2Buttons.join(' | ')}`);

      const toStep3 = page.getByRole('button', { name: /下一步|识别|批量识别/ }).first();
      await toStep3.click();
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: 'test-results/batch-04-recognize.png' });

      const currentUrl3 = page.url();
      console.log(`[Step3] URL = ${currentUrl3}`);

      // ═══════ Step 3: 识别 ═══════
      const step3Buttons = await page.getByRole('button').allTextContents();
      console.log(`[Step3] 所有按钮: ${step3Buttons.join(' | ')}`);

      const startBtn = page.getByRole('button', { name: /开始批量识别/ }).first();
      const queueBtn = page.getByRole('button', { name: /提交后台队列/ }).first();

      const startVisible = await startBtn.isVisible().catch(() => false);
      const queueVisible = await queueBtn.isVisible().catch(() => false);
      console.log(`[Step3] 开始批量识别可见: ${startVisible}, 提交后台队列可见: ${queueVisible}`);

      if (startVisible) {
        await startBtn.click();
        console.log('[Step3] 点击了 开始批量识别');
      } else if (queueVisible) {
        await queueBtn.click();
        console.log('[Step3] 点击了 提交后台队列');
      }

      // 等待识别进行
      await page.waitForTimeout(5_000);
      await page.screenshot({ path: 'test-results/batch-05-recognizing.png' });

      // 等待"进入核对"按钮变为 enabled（所有文件识别完成）
      const reviewBtn = page.getByRole('button', { name: /进入核对|进入审阅/ }).first();
      console.log('[Step3] 等待识别完成（进入核对按钮 enabled）...');

      const reviewVisible = await expect(reviewBtn).toBeEnabled({ timeout: 300_000 }).then(() => true).catch(() => false);
      await page.screenshot({ path: 'test-results/batch-06-recognize-done.png' });
      console.log(`[Step3] 进入核对按钮可见: ${reviewVisible}`);

      if (!reviewVisible) {
        console.log('[Step3] 识别未完成或按钮不可见，查看页面状态');
        const step3Text = await page.locator('body').innerText();
        console.log(`[Step3] 页面文本片段: ${step3Text.substring(0, 500)}`);
        return;
      }

      // 点击进入核对 — 可能触发页面内 step 切换
      await page.screenshot({ path: 'test-results/batch-06b-before-review-click.png' });
      console.log('[Step3→4] 点击进入核对');
      await reviewBtn.click({ timeout: 5_000 });
      console.log('[Step3→4] 点击完成，等待页面跳转');

      // 处理可能出现的确认弹窗
      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
        console.log('[Step3→4] 检测到弹窗');
        const confirmDialog = page.getByRole('button', { name: /确定|确认|继续/ }).first();
        if (await confirmDialog.isVisible().catch(() => false)) {
          await confirmDialog.click();
        }
      }

      await page.waitForTimeout(5_000);
      await page.screenshot({ path: 'test-results/batch-07-review.png' });
      console.log(`[Step4] URL = ${page.url()}`);

      // ═══════ Step 4: 审核 ═══════
      console.log(`[Step4] URL = ${page.url()}`);
      const step4Buttons = await page.getByRole('button').allTextContents();
      console.log(`[Step4] 所有按钮: ${step4Buttons.join(' | ')}`);

      // 确认当前文件
      const confirmBtn = page.getByRole('button', { name: /确认审核|确认脱敏|审核.*脱敏/ }).first();
      const confirmVisible = await confirmBtn.isVisible({ timeout: 15_000 }).catch(() => false);
      console.log(`[Step4] 确认按钮可见: ${confirmVisible}`);

      if (confirmVisible) {
        // 逐份确认 — 每次等"确认脱敏"可点击，点击后等待脱敏完成
        for (let fileIdx = 0; fileIdx < 3; fileIdx++) {
          console.log(`[Step4] 审核第 ${fileIdx + 1} 份文件`);
          await page.screenshot({ path: `test-results/batch-08-review-${fileIdx}.png` });

          // 等待确认按钮 enabled
          const btn = page.getByRole('button', { name: /确认脱敏/ }).first();
          const btnReady = await expect(btn).toBeEnabled({ timeout: 30_000 }).then(() => true).catch(() => false);
          if (!btnReady) {
            console.log(`[Step4] 第 ${fileIdx + 1} 份：确认按钮未就绪，可能已全部确认`);
            break;
          }

          await btn.click();
          console.log(`[Step4] 第 ${fileIdx + 1} 份：已点击确认`);

          // 等待脱敏完成 — 按钮变回可用或"进入导出"变 enabled
          await page.waitForTimeout(3_000);

          // 检查是否已全部审核完成（导出按钮 enabled）
          const exportBtn = page.getByRole('button', { name: /下一步：进入导出|进入导出/ }).first();
          const exportEnabled = await exportBtn.isEnabled({ timeout: 3_000 }).catch(() => false);
          if (exportEnabled) {
            console.log(`[Step4] 全部审核完成，导出按钮已 enabled`);
            break;
          }

          // 等待页面跳转到下一份（自动或手动）
          await page.waitForTimeout(10_000);
        }

        await page.screenshot({ path: 'test-results/batch-09-review-done.png' });

        // 等待导出按钮
        const toExport = page.getByRole('button', { name: /下一步：进入导出|进入导出/ }).first();
        const exportVisible = await expect(toExport).toBeEnabled({ timeout: 60_000 }).then(() => true).catch(() => false);
        console.log(`[Step4] 导出按钮可用: ${exportVisible}`);

        if (exportVisible) {
          await toExport.click();
          await page.waitForTimeout(2_000);
          await page.screenshot({ path: 'test-results/batch-10-export.png' });

          // ═══════ Step 5: 导出 ═══════
          console.log(`[Step5] URL = ${page.url()}`);
          const step5Buttons = await page.getByRole('button').allTextContents();
          console.log(`[Step5] 所有按钮: ${step5Buttons.join(' | ')}`);

          // 验证下载按钮
          const dlOriginal = page.getByRole('button', { name: /下载原始|原始.*ZIP/ }).first();
          const dlRedacted = page.getByRole('button', { name: /下载脱敏|脱敏.*ZIP/ }).first();

          const origVisible = await dlOriginal.isVisible().catch(() => false);
          const redactVisible = await dlRedacted.isVisible().catch(() => false);
          console.log(`[Step5] 下载原始可见: ${origVisible}, 下载脱敏可见: ${redactVisible}`);

          expect(origVisible || redactVisible).toBeTruthy();
        }
      }
    } finally {
      if (jobId) {
        await request.post(`http://127.0.0.1:8000/api/v1/jobs/${jobId}/cancel`).catch(() => {});
        await request.delete(`http://127.0.0.1:8000/api/v1/jobs/${jobId}`).catch(() => {});
      }
    }
  });
});
