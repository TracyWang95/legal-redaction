import { test, expect } from '@playwright/test';
import { mockApi } from './support/mock-api';

test('history: navigate to history page and verify page loads', async ({ page }) => {
  await mockApi(page);
  await page.goto('/history');

  const dismissButton = page.getByRole('button', {
    name: /dismiss|skip|close|got it|start|begin|ok|跳过|关闭|开始|知道了/i,
  });
  if (await dismissButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dismissButton.click();
  }

  await expect(page.getByTestId('history-source-tabs')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/No files yet|暂无文件/i)).toBeVisible();
});

test('history: continue review opens the batch wizard on step 4', async ({ page }) => {
  await mockApi(page, {
    files: [
      {
        file_id: 'file-review-1',
        original_filename: 'supplier-agreement.pdf',
        file_size: 2048,
        file_type: 'pdf',
        created_at: new Date('2026-04-05T10:00:00Z').toISOString(),
        has_output: false,
        entity_count: 8,
        upload_source: 'batch',
        batch_group_id: 'job-review',
        batch_group_count: 1,
        job_id: 'job-review',
        item_id: 'item-review-1',
        item_status: 'awaiting_review',
        job_embed: {
          status: 'awaiting_review',
          job_type: 'smart_batch',
          first_awaiting_review_item_id: 'item-review-1',
          wizard_furthest_step: 4,
          batch_step1_configured: true,
          items: [{ id: 'item-review-1', status: 'awaiting_review' }],
          progress: {
            total_items: 1,
            pending: 0,
            processing: 0,
            queued: 0,
            parsing: 0,
            ner: 0,
            vision: 0,
            awaiting_review: 1,
            review_approved: 0,
            redacting: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
          },
        },
      },
    ],
    jobs: [
      {
        id: 'job-review',
        job_type: 'smart_batch',
        title: 'Supplier review',
        status: 'awaiting_review',
        skip_item_review: false,
        item_count: 1,
        created_at: new Date('2026-04-05T09:30:00Z').toISOString(),
        updated_at: new Date('2026-04-05T09:45:00Z').toISOString(),
        config: {
          batch_wizard_mode: 'smart',
          entity_type_ids: ['PERSON'],
          ocr_has_types: ['STAMP'],
          has_image_types: ['FACE'],
          wizard_furthest_step: 4,
        },
        items: [
          {
            id: 'item-review-1',
            job_id: 'job-review',
            file_id: 'file-review-1',
            sort_order: 0,
            status: 'awaiting_review',
            filename: 'supplier-agreement.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 8,
            created_at: new Date('2026-04-05T09:30:00Z').toISOString(),
            updated_at: new Date('2026-04-05T09:45:00Z').toISOString(),
          },
        ],
      },
    ],
  });
  await page.goto('/history');

  await expect(page.getByTestId('continue-review-file-review-1')).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId('continue-review-file-review-1').click();

  await expect(page).toHaveURL(/\/batch\/smart\?jobId=job-review&step=4&itemId=item-review-1/);
});
