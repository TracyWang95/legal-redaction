// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import type { BatchRow } from '../../types';
import {
  BATCH_EXPORT_BLOCKING_REASONS,
  buildBatchExportReport,
  buildBatchExportVisualEvidenceEntries,
} from '../batch-export-report';

function row(
  fileId: string,
  status: BatchRow['analyzeStatus'],
  patch: Partial<BatchRow> = {},
): BatchRow {
  return {
    file_id: fileId,
    original_filename: `${fileId}.pdf`,
    file_size: 100,
    file_type: 'pdf',
    created_at: '2026-01-01T00:00:00Z',
    has_output: false,
    entity_count: 0,
    analyzeStatus: status,
    ...patch,
  } as BatchRow;
}

describe('buildBatchExportReport', () => {
  it('summarizes selected files and preserves per-file audit detail', () => {
    const report = buildBatchExportReport(
      [
        row('ready', 'completed', {
          has_output: true,
          reviewConfirmed: true,
          entity_count: 3,
          page_count: 2,
        }),
        row('failed', 'failed', { analyzeError: 'OCR timeout' }),
        row('unselected', 'awaiting_review', { entity_count: 5 }),
      ],
      ['ready', 'failed'],
      '2026-05-05T00:00:00.000Z',
    );

    expect(report.generated_at).toBe('2026-05-05T00:00:00.000Z');
    expect(report.job).toBeNull();
    expect(report.redacted_zip).toEqual({
      included_count: 1,
      skipped_count: 1,
      skipped: [{ file_id: 'failed', reason: BATCH_EXPORT_BLOCKING_REASONS.missingRedactedOutput }],
    });
    expect(report.summary).toMatchObject({
      total_files: 3,
      selected_files: 2,
      redacted_selected_files: 1,
      unredacted_selected_files: 1,
      review_confirmed_selected_files: 1,
      failed_selected_files: 1,
      detected_entities: 3,
      redaction_coverage: 0.5,
      delivery_status: 'action_required',
      action_required_files: 1,
      action_required: true,
      blocking_files: 1,
      blocking: true,
      ready_for_delivery: false,
      zip_redacted_included_files: 1,
      zip_redacted_skipped_files: 1,
      visual_review_hint: false,
      visual_review_issue_files: 0,
      visual_review_issue_count: 0,
      visual_review_issue_pages_count: 0,
      visual_review_issue_labels: [],
      visual_review_by_issue: {},
      by_status: { completed: 1, failed: 1 },
    });
    expect(report.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file_id: 'ready',
          item_id: '',
          selected_for_export: true,
          has_output: true,
          page_count: 2,
          delivery_status: 'ready_for_delivery',
          ready_for_delivery: true,
          action_required: false,
          blocking: false,
          blocking_reasons: [],
          redacted_export_skip_reason: null,
          visual_review_hint: false,
          visual_review: {
            blocking: false,
            review_hint: false,
            issue_count: 0,
            issue_pages: [],
            issue_pages_count: 0,
            issue_labels: [],
            by_issue: {},
          },
        }),
        expect.objectContaining({
          file_id: 'unselected',
          selected_for_export: false,
          delivery_status: 'not_selected',
          ready_for_delivery: false,
          action_required: true,
          blocking: true,
          blocking_reasons: [
            BATCH_EXPORT_BLOCKING_REASONS.missingRedactedOutput,
            BATCH_EXPORT_BLOCKING_REASONS.reviewNotConfirmed,
          ],
          entity_count: 5,
          redacted_export_skip_reason: BATCH_EXPORT_BLOCKING_REASONS.missingRedactedOutput,
        }),
      ]),
    );
  });

  it('uses the export contract constants for delivery blocking reasons', () => {
    const report = buildBatchExportReport(
      [row('blocked', 'failed')],
      ['blocked'],
      '2026-05-05T00:00:00.000Z',
    );

    expect(report.files[0].blocking_reasons).toEqual([
      BATCH_EXPORT_BLOCKING_REASONS.failed,
      BATCH_EXPORT_BLOCKING_REASONS.missingRedactedOutput,
      BATCH_EXPORT_BLOCKING_REASONS.reviewNotConfirmed,
    ]);
    expect(report.files[0].redacted_export_skip_reason).toBe(
      BATCH_EXPORT_BLOCKING_REASONS.missingRedactedOutput,
    );
    expect(report.redacted_zip.skipped).toEqual([
      { file_id: 'blocked', reason: BATCH_EXPORT_BLOCKING_REASONS.missingRedactedOutput },
    ]);
  });

  it('keeps local visual review fields advisory and non-blocking by default', () => {
    const report = buildBatchExportReport(
      [row('ready-with-local-report', 'completed', { has_output: true, reviewConfirmed: true })],
      ['ready-with-local-report'],
      '2026-05-05T00:00:00.000Z',
    );

    expect(report.summary.delivery_status).toBe('ready_for_delivery');
    expect(report.summary.visual_review_hint).toBe(false);
    expect(report.files[0]).toMatchObject({
      delivery_status: 'ready_for_delivery',
      ready_for_delivery: true,
      blocking: false,
      visual_review_hint: false,
      visual_review: {
        blocking: false,
        review_hint: false,
      },
    });
    expect(report.summary.visual_evidence).toBeUndefined();
    expect(report.files[0].visual_evidence).toBeUndefined();
  });

  it('builds compact visual evidence source chips from report stats only', () => {
    expect(
      buildBatchExportVisualEvidenceEntries({
        total_boxes: 5,
        selected_boxes: 4,
        has_image_model: 2,
        local_fallback: 1,
        ocr_has: 1,
        table_structure: 1,
      }),
    ).toEqual([
      { key: 'hasImage', count: 2 },
      { key: 'fallback', count: 1 },
      { key: 'ocrHas', count: 1 },
      { key: 'table', count: 1 },
    ]);
  });

  it('falls back to nested visual source counters when scalar evidence fields are absent', () => {
    expect(
      buildBatchExportVisualEvidenceEntries({
        source_counts: { has_image: 3, ocr_has: 2 },
        evidence_source_counts: { local_fallback: 1 },
        source_detail_counts: { table_structure: 2 },
      }),
    ).toEqual([
      { key: 'hasImage', count: 2 },
      { key: 'fallback', count: 1 },
      { key: 'ocrHas', count: 2 },
      { key: 'table', count: 2 },
    ]);
    expect(buildBatchExportVisualEvidenceEntries(undefined)).toEqual([]);
  });

  it('marks selected rows ready only when every redacted output has confirmed review', () => {
    const report = buildBatchExportReport(
      [
        row('ready-a', 'completed', { has_output: true, reviewConfirmed: true }),
        row('ready-b', 'completed', { has_output: true, reviewConfirmed: true }),
      ],
      ['ready-a', 'ready-b'],
      '2026-05-05T00:00:00.000Z',
    );

    expect(report.summary.action_required_files).toBe(0);
    expect(report.summary.delivery_status).toBe('ready_for_delivery');
    expect(report.summary.ready_for_delivery).toBe(true);
  });

  it('marks an empty local export report as no_selection', () => {
    const report = buildBatchExportReport(
      [row('ready', 'completed', { has_output: true, reviewConfirmed: true })],
      [],
      '2026-05-05T00:00:00.000Z',
    );

    expect(report.summary.delivery_status).toBe('no_selection');
    expect(report.summary.ready_for_delivery).toBe(false);
    expect(report.summary.action_required).toBe(false);
    expect(report.files[0]).toMatchObject({
      delivery_status: 'not_selected',
      selected_for_export: false,
    });
  });
});
