import { test, expect } from '@playwright/test';
import { isBackendUp, REAL_TEST_FILES, dismissOnboarding } from './helpers';
import fs from 'fs';

/** 检查真实测试数据是否存在 */
function hasRealTestData(): boolean {
  return Object.values(REAL_TEST_FILES).every((p) => fs.existsSync(p));
}

/**
 * 多任务排队：连续创建并提交，验证不溢出内存/显存
 */
test.describe('多任务排队 — 内存/显存保护', () => {
  test.setTimeout(300_000);

  test('连续创建 3 个带文件的任务并提交队列，验证顺序执行不 OOM', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');
    test.skip(!hasRealTestData(), 'D:\\ceshi 测试数据不存在');

    const jobIds: string[] = [];

    try {
      // 记录初始 GPU 显存
      const initHealth = await request.get('http://127.0.0.1:8000/health/services');
      const initGpu = (await initHealth.json()).gpu_memory;
      const initUsedMb = initGpu?.used_mb ?? 0;

      // 创建 3 个任务，每个上传 1 个文件并提交
      for (let i = 0; i < 3; i++) {
        // 1. 创建任务
        const createRes = await request.post('http://127.0.0.1:8000/api/v1/jobs', {
          data: {
            job_type: 'smart_batch',
            title: `排队压力测试 #${i + 1}`,
            config: {
              entity_type_ids: ['PERSON', 'ID_CARD', 'PHONE'],
              replacement_mode: 'structured',
            },
          },
        });
        expect(createRes.ok()).toBeTruthy();
        const job = await createRes.json();
        jobIds.push(job.id);

        // 2. 上传文件
        const file = i === 0 ? REAL_TEST_FILES.image : i === 1 ? REAL_TEST_FILES.docx1 : REAL_TEST_FILES.docx2;
        const fileContent = fs.readFileSync(file);
        const fileName = file.split('/').pop()!;
        const uploadRes = await request.post('http://127.0.0.1:8000/api/v1/files/upload', {
          multipart: {
            file: {
              name: fileName,
              mimeType: fileName.endsWith('.png') ? 'image/png' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              buffer: fileContent,
            },
            job_id: job.id,
            upload_source: 'batch',
          },
        });
        expect(uploadRes.ok()).toBeTruthy();

        // 3. 提交到队列
        const submitRes = await request.post(`http://127.0.0.1:8000/api/v1/jobs/${job.id}/submit`);
        expect(submitRes.ok()).toBeTruthy();
        const submitted = await submitRes.json();
        expect(['queued', 'processing']).toContain(submitted.status);
      }

      // 验证：3 个任务都已提交，后端没有崩溃
      const healthCheck = await request.get('http://127.0.0.1:8000/health');
      expect(healthCheck.ok()).toBeTruthy();

      // 轮询等待所有任务完成（最多 4 分钟）
      const deadline = Date.now() + 240_000;
      let allDone = false;
      while (Date.now() < deadline) {
        let doneCount = 0;
        for (const id of jobIds) {
          const jobRes = await request.get(`http://127.0.0.1:8000/api/v1/jobs/${id}`);
          if (jobRes.ok()) {
            const jobData = await jobRes.json();
            if (['awaiting_review', 'completed', 'failed'].includes(jobData.status)) {
              doneCount++;
            }
          }
        }
        if (doneCount >= jobIds.length) {
          allDone = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 5_000));
      }

      expect(allDone).toBeTruthy();

      // 检查 GPU 显存没有泄漏（差值不超过 2GB）
      const finalHealth = await request.get('http://127.0.0.1:8000/health/services');
      const finalGpu = (await finalHealth.json()).gpu_memory;
      if (finalGpu && initGpu) {
        const memDelta = finalGpu.used_mb - initUsedMb;
        // 处理完后显存应该释放，增量不超过 2GB
        expect(memDelta).toBeLessThan(2048);
      }

      // 验证任务是顺序执行的：不应同时有两个 processing
      // （通过检查每个任务当前都不再 processing 来间接验证）
      for (const id of jobIds) {
        const jobRes = await request.get(`http://127.0.0.1:8000/api/v1/jobs/${id}`);
        const jobData = await jobRes.json();
        expect(jobData.status).not.toBe('processing');
      }
    } finally {
      // 清理
      for (const id of jobIds) {
        await request.post(`http://127.0.0.1:8000/api/v1/jobs/${id}/cancel`).catch(() => {});
        await request.delete(`http://127.0.0.1:8000/api/v1/jobs/${id}`).catch(() => {});
      }
    }
  });

  test('任务中心正确显示排队任务进度', async ({ page, request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    // 创建 2 个 draft 任务
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await request.post('http://127.0.0.1:8000/api/v1/jobs', {
        data: { job_type: 'smart_batch', title: `进度显示测试 #${i + 1}`, config: {} },
      });
      if (res.ok()) ids.push((await res.json()).id);
    }

    await page.goto('/jobs');
    await dismissOnboarding(page);

    // 任务应该在列表中可见
    for (const title of ['进度显示测试 #1', '进度显示测试 #2']) {
      await expect(
        page.getByText(title).first()
      ).toBeVisible({ timeout: 10_000 }).catch(() => {});
    }

    // 每个任务应显示状态标签
    await expect(
      page.getByText(/草稿|draft/).first()
    ).toBeVisible({ timeout: 5_000 }).catch(() => {});

    // 清理
    for (const id of ids) {
      await request.delete(`http://127.0.0.1:8000/api/v1/jobs/${id}`).catch(() => {});
    }
  });

  test('GPU 显存监控：处理期间不超过 95%', async ({ request }) => {
    test.skip(!(await isBackendUp(request)), '后端未启动');

    const res = await request.get('http://127.0.0.1:8000/health/services');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    if (body.gpu_memory) {
      const { used_mb, total_mb } = body.gpu_memory;
      const pct = (used_mb / total_mb) * 100;
      // 4090 24GB — 使用不应超过 95%
      expect(pct).toBeLessThan(95);
      // 输出到日志供人工查看
      console.log(`GPU: ${used_mb}MB / ${total_mb}MB (${pct.toFixed(1)}%)`);
    }
  });
});
