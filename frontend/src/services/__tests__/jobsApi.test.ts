// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { get, post } from '../api-client';
import {
  getItemReviewDraft,
  getJobExportReport,
  getJobsBatch,
  listJobs,
  normalizeJobSummary,
} from '../jobsApi';

vi.mock('../api-client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

describe('jobsApi normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps job lists usable when older rows are missing progress', async () => {
    vi.mocked(get).mockResolvedValueOnce({
      jobs: [
        {
          id: 'job-legacy',
          type: 'text',
          name: 'Legacy import',
          status: 'awaiting_review',
          item_count: '3',
          completed_count: 1,
          failed_count: 1,
          created_at: '2026-04-01T10:00:00Z',
        },
      ],
      total: '1',
      page: '1',
      page_size: '20',
    });

    const response = await listJobs({ page: 1, page_size: 20 });

    expect(response.jobs[0]).toMatchObject({
      id: 'job-legacy',
      job_type: 'text_batch',
      title: 'Legacy import',
      progress: {
        total_items: 3,
        completed: 1,
        failed: 1,
        awaiting_review: 0,
      },
      nav_hints: {
        item_count: 3,
      },
    });
    expect(response.total).toBe(1);
  });

  it('normalizes batch detail responses with missing item arrays', async () => {
    vi.mocked(post).mockResolvedValueOnce({
      jobs: [
        {
          id: 'job-detail',
          job_type: 'smart_batch',
          title: 'Detail import',
          progress: { total_items: '2', awaiting_review: 2 },
          created_at: '2026-04-01T10:00:00Z',
        },
      ],
    });

    const response = await getJobsBatch(['job-detail']);

    expect(response.jobs[0]).toMatchObject({
      id: 'job-detail',
      job_type: 'smart_batch',
      progress: {
        total_items: 2,
        awaiting_review: 2,
      },
      items: [],
    });
  });

  it('falls back to safe defaults for empty job payloads', () => {
    expect(normalizeJobSummary(null)).toMatchObject({
      id: '',
      job_type: 'text_batch',
      title: 'Untitled job',
      status: 'draft',
      progress: {
        total_items: 0,
        completed: 0,
        failed: 0,
      },
      nav_hints: {
        item_count: 0,
      },
    });
  });

  it('uses a short timeout for review draft reads', async () => {
    vi.mocked(get).mockResolvedValueOnce({
      exists: false,
      entities: [],
      bounding_boxes: [],
      updated_at: null,
    });

    await getItemReviewDraft('job 1', 'item/1');

    expect(get).toHaveBeenCalledWith(
      '/jobs/job%201/items/item%2F1/review-draft',
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('normalizes the export report delivery and visual-review contract', async () => {
    vi.mocked(get).mockResolvedValueOnce({
      generated_at: '2026-05-05T00:00:00.000Z',
      job: {
        id: 'job-1',
        job_type: 'smart_batch',
        status: 'awaiting_review',
        skip_item_review: false,
        config: { mode: 'mixed' },
      },
      summary: {
        total_files: '2',
        selected_files: 2,
        redacted_selected_files: 1,
        unredacted_selected_files: 1,
        review_confirmed_selected_files: 1,
        failed_selected_files: 0,
        detected_entities: 4,
        redaction_coverage: 0.5,
        delivery_status: 'action_required',
        action_required_files: 1,
        action_required: true,
        blocking_files: 1,
        blocking: true,
        ready_for_delivery: true,
        by_status: { completed: 1, awaiting_review: '1' },
        zip_redacted_included_files: 1,
        zip_redacted_skipped_files: 1,
        visual_review_hint: true,
        visual_review_issue_files: 1,
        visual_review_issue_count: 2,
        visual_review_issue_pages_count: 1,
        visual_review_issue_labels: ['edge_seal', 'seam_seal'],
        visual_review_by_issue: { edge_seal: 1, seam_seal: '1' },
        visual_evidence: {
          total_boxes: '5',
          selected_boxes: 4,
          has_image_model: 2,
          local_fallback: '1',
          ocr_has: 1,
          table_structure: 1,
          fallback_detector: 1,
          source_counts: { has_image: '3', ocr_has: 1 },
          evidence_source_counts: { has_image_model: 2, local_fallback: '1', ocr_has: 1 },
          source_detail_counts: { table_structure: '1' },
          warnings_by_key: { 'near-page-edge': 1 },
        },
      },
      redacted_zip: {
        included_count: 1,
        skipped_count: 1,
        skipped: [{ file_id: 'needs-redaction', reason: 'missing_redacted_output' }],
      },
      files: [
        {
          item_id: 'item-ready',
          file_id: 'ready',
          filename: 'ready.pdf',
          file_type: 'pdf',
          file_size: 100,
          status: 'completed',
          has_output: true,
          review_confirmed: true,
          entity_count: 4,
          page_count: '5',
          selected_for_export: true,
          delivery_status: 'ready_for_delivery',
          error: null,
          ready_for_delivery: false,
          action_required: true,
          blocking: false,
          blocking_reasons: [],
          redacted_export_skip_reason: null,
          visual_review_hint: true,
          visual_review: {
            blocking: false,
            review_hint: true,
            issue_count: 2,
            issue_pages: ['5'],
            issue_pages_count: 1,
            issue_labels: ['edge_seal', 'seam_seal'],
            by_issue: { edge_seal: 1, seam_seal: '1' },
          },
          visual_evidence: {
            total_boxes: 3,
            selected_boxes: '3',
            has_image_model: '1',
            local_fallback: 1,
            ocr_has: 1,
            table_structure: '1',
            source_counts: { has_image: '2', ocr_has: 1 },
            evidence_source_counts: { has_image_model: '1', local_fallback: 1 },
            source_detail_counts: { table_structure: '1', red_seal_fallback: 1 },
          },
        },
      ],
    });

    const report = await getJobExportReport('job-1', ['ready', 'needs-redaction']);

    expect(get).toHaveBeenCalledWith(
      '/jobs/job-1/export-report?file_ids=ready&file_ids=needs-redaction',
    );
    expect(report).toMatchObject({
      job: {
        id: 'job-1',
        job_type: 'smart_batch',
        status: 'awaiting_review',
        skip_item_review: false,
        config: { mode: 'mixed' },
      },
      summary: {
        action_required_files: 1,
        delivery_status: 'action_required',
        action_required: true,
        blocking_files: 1,
        blocking: true,
        ready_for_delivery: false,
        zip_redacted_included_files: 1,
        zip_redacted_skipped_files: 1,
        visual_review_hint: true,
        visual_review_by_issue: { edge_seal: 1, seam_seal: 1 },
        visual_evidence: expect.objectContaining({
          total_boxes: 5,
          selected_boxes: 4,
          has_image_model: 2,
          local_fallback: 1,
          ocr_has: 1,
          table_structure: 1,
          source_counts: { has_image: 3, ocr_has: 1 },
          evidence_source_counts: { has_image_model: 2, local_fallback: 1, ocr_has: 1 },
        }),
        by_status: { completed: 1, awaiting_review: 1 },
      },
      redacted_zip: {
        included_count: 1,
        skipped_count: 1,
        skipped: [{ file_id: 'needs-redaction', reason: 'missing_redacted_output' }],
      },
      files: [
        expect.objectContaining({
          item_id: 'item-ready',
          file_id: 'ready',
          page_count: 5,
          delivery_status: 'ready_for_delivery',
          ready_for_delivery: true,
          action_required: false,
          blocking: false,
          blocking_reasons: [],
          redacted_export_skip_reason: null,
          visual_review_hint: true,
          visual_review: expect.objectContaining({
            blocking: false,
            review_hint: true,
            issue_count: 2,
            issue_pages: ['5'],
            by_issue: { edge_seal: 1, seam_seal: 1 },
          }),
          visual_evidence: expect.objectContaining({
            total_boxes: 3,
            selected_boxes: 3,
            has_image_model: 1,
            local_fallback: 1,
            ocr_has: 1,
            table_structure: 1,
          }),
        }),
      ],
    });
  });
});
