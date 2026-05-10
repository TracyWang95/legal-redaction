import { test, expect } from '@playwright/test';
import { mockApi } from './support/mock-api';

async function dismissOnboardingIfPresent(page: import('@playwright/test').Page) {
  const dismissButton = page.getByRole('button', {
    name: /dismiss|skip|close|got it|start|begin|ok|跳过|关闭|开始|知道了/i,
  });
  if (await dismissButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dismissButton.click();
  }
}

test('batch wizard: creates, uploads, submits, reviews, and exports with API contract payloads', async ({
  page,
}) => {
  const api = await mockApi(page, { servicesOnline: true });

  await page.goto('/batch/smart');
  await dismissOnboardingIfPresent(page);

  await expect(page.getByTestId('batch-step1-config')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('confirm-step1').click();
  await page.getByTestId('advance-upload').click();

  await expect.poll(() => api.createdJobs.length, { timeout: 10_000 }).toBe(1);
  expect(api.createdJobs[0]).toMatchObject({ job_type: 'smart_batch' });
  expect(api.createdJobs[0].config).toEqual(
    expect.objectContaining({
      entity_type_ids: expect.any(Array),
      has_image_types: expect.any(Array),
    }),
  );

  await expect(page.getByTestId('batch-step2-upload')).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-testid="drop-zone"] input[type="file"]').setInputFiles([
    {
      name: 'contract.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Contract between Alice Wang and Example Corp.', 'utf8'),
    },
    {
      name: 'stamp.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64',
      ),
    },
  ]);

  await expect.poll(() => api.uploads.length, { timeout: 10_000 }).toBe(2);
  expect(api.uploads.map((upload) => upload.job_id)).toEqual(['job-1', 'job-1']);
  expect(api.uploads.map((upload) => upload.upload_source)).toEqual(['batch', 'batch']);

  await page.getByTestId('step2-next').click();
  await expect(page.getByTestId('batch-step3-recognize')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('submit-queue').click();

  await expect.poll(() => api.submittedJobs, { timeout: 10_000 }).toContain('job-1');

  await page.goto('/batch/smart?jobId=job-1&step=4&itemId=item-1');
  await expect(page.getByTestId('batch-step4-review')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-review-entity-id="file-1-entity-1"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId('confirm-redact').click();

  await expect.poll(() => api.reviewCommits.length, { timeout: 10_000 }).toBe(1);
  expect(api.reviewCommits[0]).toMatchObject({ jobId: 'job-1', itemId: 'item-1' });
  expect(api.reviewCommits[0].body).toEqual(
    expect.objectContaining({
      entities: expect.arrayContaining([
        expect.objectContaining({ text: 'Alice Wang', type: 'PERSON' }),
      ]),
      bounding_boxes: expect.any(Array),
    }),
  );

  await expect(page.getByTestId('batch-step4-review')).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole('button', { name: /official_seal.*Source HaS Image model/i }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('confirm-redact').click();

  await expect.poll(() => api.reviewCommits.length, { timeout: 10_000 }).toBe(2);
  expect(api.reviewCommits[1]).toMatchObject({ jobId: 'job-1', itemId: 'item-2' });
  expect(api.reviewCommits[1].body).toEqual(
    expect.objectContaining({
      entities: expect.any(Array),
      bounding_boxes: expect.arrayContaining([
        expect.objectContaining({ type: 'official_seal', source: 'has_image' }),
      ]),
    }),
  );

  await expect(page.getByTestId('go-export')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('go-export').click();

  await expect(page.getByTestId('batch-step5-export')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('export-delivery-state')).toBeVisible();
  await expect.poll(() => api.exportReportRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(api.exportReportRequests.at(-1)).toEqual({
    jobId: 'job-1',
    fileIds: ['file-1', 'file-2'],
  });

  await expect(page.getByTestId('download-redacted')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('download-redacted').click();

  await expect.poll(() => api.batchDownloadRequests.length, { timeout: 10_000 }).toBe(1);
  expect(api.batchDownloadRequests[0]).toEqual({
    file_ids: ['file-1', 'file-2'],
    redacted: true,
    job_id: 'job-1',
  });
});
