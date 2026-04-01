import { test, expect } from '@playwright/test';
import { isBackendUp, REAL_TEST_FILES, dismissOnboarding } from './helpers';
import fs from 'fs';

function hasRealTestData(): boolean {
  return Object.values(REAL_TEST_FILES).every((p) => fs.existsSync(p));
}

test.describe('批量确认脱敏 + 历史图片查看', () => {
  test.setTimeout(600_000);

  test('3文件混合 → 逐份确认脱敏 → 历史查看图片', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');
    test.skip(!hasRealTestData(), 'D:\\ceshi 测试数据不存在');

    let jobId: string | null = null;
    try {
      // Step 1: 创建任务
      await page.goto('/batch');
      await dismissOnboarding(page);
      await page.getByRole('button', { name: /新建|批量/ }).first().click();
      await expect(page).toHaveURL(/step=1/, { timeout: 15_000 });
      jobId = new URL(page.url()).searchParams.get('jobId');

      // Step 1: 等配置加载 → 勾选 → 下一步
      await expect(page.getByText(/任务与配置|配置/).first()).toBeVisible({ timeout: 10_000 });
      const checkboxes = page.locator('input[type="checkbox"]');
      const checkboxCount = await checkboxes.count();
      if (checkboxCount > 0) {
        const first = checkboxes.first();
        if (!(await first.isChecked())) await first.check();
      }
      await page.screenshot({ path: 'test-results/confirm-step1.png' });
      const allBtns = await page.getByRole('button').allTextContents();
      console.log('[Step1] buttons:', allBtns.join(' | '));
      const toStep2 = page.getByRole('button', { name: '下一步：上传' });
      await expect(toStep2).toBeEnabled({ timeout: 60_000 });
      await toStep2.click();
      await expect(page).toHaveURL(/step=2/, { timeout: 10_000 });

      // Step 2: 上传
      await page.locator('input[type="file"]').setInputFiles([
        REAL_TEST_FILES.image,
        REAL_TEST_FILES.docx1,
        REAL_TEST_FILES.docx2,
      ]);
      await page.waitForTimeout(5_000);
      await page.getByRole('button', { name: /下一步.*识别|批量识别/ }).first().click();
      await expect(page).toHaveURL(/step=3/, { timeout: 10_000 });

      // Step 3: 提交队列并等待
      await page.getByRole('button', { name: '提交后台队列' }).click();
      const nextBtn = page.getByRole('button', { name: /下一步：进入核对/ });
      await expect(nextBtn).toBeEnabled({ timeout: 300_000 });
      await nextBtn.click();
      await expect(page).toHaveURL(/step=4/, { timeout: 10_000 });

      // Step 4: 逐份确认脱敏
      console.log('[Step4] 开始逐份确认');
      for (let i = 0; i < 3; i++) {
        console.log(`[Step4] 确认第 ${i + 1} 份`);
        const confirmBtn = page.getByRole('button', { name: /确认脱敏/ }).first();

        // 等待确认按钮可点击（loading 结束）
        await expect(confirmBtn).toBeEnabled({ timeout: 30_000 });

        // 检查按钮文字不是"已完成"
        const btnText = await confirmBtn.textContent();
        if (btnText?.includes('已完成')) {
          console.log(`[Step4] 第 ${i + 1} 份已完成，跳过`);
          continue;
        }

        // 点击确认
        await confirmBtn.click();
        console.log(`[Step4] 第 ${i + 1} 份已点击`);

        // 等待请求完成（按钮恢复或切到下一份）
        await page.waitForTimeout(10_000);

        // 检查是否有错误提示
        const errorToast = page.locator('.text-red-600, .text-red-500, [role="alert"]').first();
        const hasError = await errorToast.isVisible({ timeout: 1_000 }).catch(() => false);
        if (hasError) {
          const errorText = await errorToast.textContent();
          console.error(`[Step4] 第 ${i + 1} 份确认失败: ${errorText}`);
          // 截图
          await page.screenshot({ path: `test-results/confirm-error-${i}.png` });
          throw new Error(`确认脱敏失败: ${errorText}`);
        }

        // 导出按钮是否可用
        const exportBtn = page.getByRole('button', { name: /进入导出/ }).first();
        const exportEnabled = await exportBtn.isEnabled().catch(() => false);
        if (exportEnabled) {
          console.log('[Step4] 全部确认完成');
          break;
        }
      }

      // Step 5: 验证导出
      const exportBtn = page.getByRole('button', { name: /进入导出/ }).first();
      await expect(exportBtn).toBeEnabled({ timeout: 30_000 });
      await exportBtn.click();
      await expect(page).toHaveURL(/step=5/, { timeout: 10_000 });
      await expect(page.getByRole('button', { name: /下载脱敏 ZIP/ })).toBeVisible();
      console.log('[Step5] 导出页面正常');

      // 去历史记录检查图片
      await page.goto('/history');
      await dismissOnboarding(page);
      await page.waitForTimeout(3_000);

      // 找到图片文件的"眼睛"按钮
      const imgRow = page.locator('text=图片_20260131115035').first();
      if (await imgRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
        // 点击同行的眼睛/查看按钮
        const viewBtn = imgRow.locator('..').locator('button, a').filter({ hasText: /查看|对比/ }).first();
        if (await viewBtn.isVisible().catch(() => false)) {
          await viewBtn.click();
          await page.waitForTimeout(3_000);

          // 检查图片是否加载
          const images = page.locator('img[alt*="脱敏"]');
          const imgCount = await images.count();
          console.log(`[History] 找到 ${imgCount} 张脱敏图片`);

          if (imgCount > 0) {
            const firstImg = images.first();
            const src = await firstImg.getAttribute('src');
            console.log(`[History] 图片 src: ${src?.substring(0, 50)}...`);
            // 图片应该有有效 src
            expect(src).toBeTruthy();
            expect(src).not.toBe('');
          }

          await page.screenshot({ path: 'test-results/history-image-compare.png' });
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
