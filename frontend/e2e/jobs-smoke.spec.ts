import { test, expect } from '@playwright/test';
import { mockApi } from './support/mock-api';

test('jobs: renders legacy job rows without crashing', async ({ page }) => {
  await mockApi(page);
  await page.goto('/jobs');

  await expect(page.getByTestId('jobs-page')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('job-row-job-legacy')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Legacy import')).toBeVisible();
});

test('jobs: renders job detail page from a legacy job payload', async ({ page }) => {
  await mockApi(page);
  await page.goto('/jobs/job-legacy');

  await expect(page.getByTestId('job-detail-page')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Legacy import' })).toBeVisible();
});

test('jobs: awaiting-review primary action opens batch step 4', async ({ page }) => {
  await mockApi(page, {
    jobs: [
      {
        id: 'job-review',
        job_type: 'smart_batch',
        title: 'Supplier review',
        status: 'awaiting_review',
        skip_item_review: false,
        created_at: new Date('2026-04-05T09:30:00Z').toISOString(),
        updated_at: new Date('2026-04-05T09:45:00Z').toISOString(),
        config: {
          batch_wizard_mode: 'smart',
          entity_type_ids: ['PERSON'],
          ocr_has_types: ['STAMP'],
          has_image_types: ['FACE'],
          wizard_furthest_step: 4,
        },
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
        nav_hints: {
          item_count: 1,
          first_awaiting_review_item_id: 'item-review-1',
          wizard_furthest_step: 4,
          batch_step1_configured: true,
          awaiting_review_count: 1,
          redacted_count: 0,
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
  await page.goto('/jobs');

  await expect(page.getByTestId('job-primary-action-job-review')).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId('job-primary-action-job-review').click();

  await expect(page).toHaveURL(/\/batch\/smart\?jobId=job-review&step=4&itemId=item-review-1/);
});
