// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test-utils';
import type { BatchRow } from '../../types';
import { BatchStep5Export } from '../batch-step5-export';

const jobsApiMocks = vi.hoisted(() => ({
  getJobExportReport: vi.fn(),
}));

vi.mock('@/services/jobsApi', () => jobsApiMocks);

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

describe('BatchStep5Export', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:report');
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  const anchorClick = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    anchorClick.mockClear();
    jobsApiMocks.getJobExportReport.mockReset();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows compact delivery readiness and repair links for selected incomplete files', () => {
    render(
      <BatchStep5Export
        rows={[
          row('ready', 'completed', {
            has_output: true,
            reviewConfirmed: true,
            entity_count: 4,
          }),
          row('failed', 'failed', { analyzeError: 'OCR timeout' }),
          row('other', 'awaiting_review', { entity_count: 9 }),
        ]}
        selected={new Set(['ready', 'failed'])}
        selectedIds={['ready', 'failed']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('export-readiness-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-report-redacted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-report-coverage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-report-entities')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-delivery-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-quality-gate-hint')).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'The audit report includes selected files that failed or have no redacted output.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('export-delivery-breakdown')).toHaveTextContent(
      'Selected files that block delivery',
    );
    expect(screen.getByTestId('export-delivery-group-retry')).toHaveTextContent('failed.pdf');
    expect(
      screen.getByRole('button', { name: 'Fix delivery blocker for failed.pdf' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select ready.pdf for the delivery package' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('download-redacted')).toBeDisabled();
    expect(screen.queryByTestId('export-visual-source-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('interaction-lock-overlay')).not.toBeInTheDocument();
  });

  it('makes the redacted ZIP the primary export action', () => {
    const downloadZip = vi.fn();
    render(
      <BatchStep5Export
        rows={[
          row('ready', 'completed', {
            has_output: true,
            reviewConfirmed: true,
            entity_count: 4,
          }),
        ]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={downloadZip}
      />,
    );

    expect(screen.queryByTestId('export-delivery-state')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('download-redacted'));

    expect(downloadZip).toHaveBeenCalledWith(true);
  });

  it('keeps the file list visible while a ZIP is being packaged', () => {
    render(
      <BatchStep5Export
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={true}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('interaction-lock-overlay')).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select ready.pdf for the delivery package' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('download-redacted')).toHaveTextContent('Packaging...');
  });

  it('offers a safe selection action for mixed export readiness', () => {
    const selectReadyForDelivery = vi.fn();

    render(
      <BatchStep5Export
        rows={[
          row('ready', 'completed', {
            has_output: true,
            reviewConfirmed: true,
            entity_count: 4,
          }),
          row('failed', 'failed', { analyzeError: 'OCR timeout' }),
        ]}
        selected={new Set(['ready', 'failed'])}
        selectedIds={['ready', 'failed']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={selectReadyForDelivery}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    expect(screen.getByTestId('download-redacted')).toHaveTextContent('Download Redacted ZIP');
    expect(screen.getByTestId('download-redacted')).toBeDisabled();
    expect(screen.getByTestId('fix-selected-issues')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('select-ready-for-delivery'));

    expect(selectReadyForDelivery).toHaveBeenCalled();
  });

  it('jumps from the fix action to the first blocking selected file', () => {
    const resolveExportIssue = vi.fn();

    render(
      <BatchStep5Export
        rows={[
          row('ready', 'completed', {
            has_output: true,
            reviewConfirmed: true,
            entity_count: 4,
          }),
          row('needs-review', 'awaiting_review', { reviewConfirmed: false }),
          row('failed', 'failed', { analyzeError: 'OCR timeout' }),
        ]}
        selected={new Set(['ready', 'needs-review', 'failed'])}
        selectedIds={['ready', 'needs-review', 'failed']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        resolveExportIssue={resolveExportIssue}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('fix-selected-issues'));

    expect(resolveExportIssue).toHaveBeenCalledWith('needs-review');
  });

  it('returns to review at the first blocking selected file', () => {
    const resolveExportIssue = vi.fn();
    const goStep = vi.fn();

    render(
      <BatchStep5Export
        rows={[
          row('ready', 'completed', {
            has_output: true,
            reviewConfirmed: true,
            entity_count: 4,
          }),
          row('needs-review', 'awaiting_review', { reviewConfirmed: false }),
        ]}
        selected={new Set(['ready', 'needs-review'])}
        selectedIds={['ready', 'needs-review']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        resolveExportIssue={resolveExportIssue}
        goStep={goStep}
        downloadZip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('step5-back-review'));

    expect(resolveExportIssue).toHaveBeenCalledWith('needs-review');
    expect(goStep).not.toHaveBeenCalled();
  });

  it('lets users open a specific blocking file from the delivery breakdown', () => {
    const resolveExportIssue = vi.fn();

    render(
      <BatchStep5Export
        rows={[
          row('needs-review', 'awaiting_review', { reviewConfirmed: false }),
          row('failed', 'failed', { analyzeError: 'OCR timeout' }),
        ]}
        selected={new Set(['needs-review', 'failed'])}
        selectedIds={['needs-review', 'failed']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        resolveExportIssue={resolveExportIssue}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('resolve-export-issue-failed'));

    expect(resolveExportIssue).toHaveBeenCalledWith('failed');
  });

  it('shows visual review risks from the backend export report before download', async () => {
    jobsApiMocks.getJobExportReport.mockResolvedValue({
      generated_at: 'server-time',
      summary: {
        total_files: 1,
        selected_files: 1,
        redacted_selected_files: 1,
        unredacted_selected_files: 0,
        review_confirmed_selected_files: 1,
        failed_selected_files: 0,
        detected_entities: 4,
        redaction_coverage: 1,
        action_required_files: 0,
        ready_for_delivery: true,
        by_status: { completed: 1 },
        visual_review_issue_files: 1,
        visual_review_issue_count: 11,
        visual_review_by_issue: {
          low_confidence: 4,
          table_structure: 1,
          large_ocr_region: 3,
          fallback_detector: 2,
          edge_seal: 1,
          seam_seal: 1,
        },
        visual_evidence: {
          total_boxes: 8,
          selected_boxes: 7,
          has_image_model: 3,
          local_fallback: 2,
          ocr_has: 1,
          table_structure: 1,
        },
      },
      files: [
        {
          file_id: 'ready',
          filename: 'ready.pdf',
          file_type: 'pdf',
          file_size: 100,
          status: 'completed',
          has_output: true,
          review_confirmed: true,
          entity_count: 4,
          page_count: 5,
          selected_for_export: true,
          error: null,
          visual_review: {
            issue_count: 2,
            issue_pages: ['5'],
            by_issue: {
              low_confidence: 4,
              table_structure: 1,
              large_ocr_region: 3,
              fallback_detector: 2,
              edge_seal: 1,
              seam_seal: 1,
            },
          },
          visual_evidence: {
            total_boxes: 4,
            selected_boxes: 4,
            has_image_model: 2,
            local_fallback: 1,
            ocr_has: 1,
            table_structure: 1,
          },
        },
      ],
    });

    render(
      <BatchStep5Export
        activeJobId="job-1"
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('download-redacted')).not.toBeDisabled());
    expect(screen.queryByTestId('export-visual-review-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-delivery-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-visual-review-delivery-hint')).not.toBeInTheDocument();
    expect(
      screen.queryAllByTestId(/^export-visual-issue-/),
    ).toHaveLength(0);
    expect(screen.queryByTestId('export-visual-source-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-file-visual-source-ready')).not.toBeInTheDocument();
  });

  it('shows unavailable state when the backend visual report cannot be loaded', async () => {
    jobsApiMocks.getJobExportReport.mockRejectedValue(new Error('offline'));

    render(
      <BatchStep5Export
        activeJobId="job-1"
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('export-authoritative-report-unavailable')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('export-visual-review-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('export-authoritative-report-unavailable')).toHaveTextContent(
      'authoritative job report is unavailable',
    );
    expect(screen.getByRole('alert')).toBe(
      screen.getByTestId('export-authoritative-report-unavailable'),
    );
    expect(screen.getByTestId('export-authoritative-report-unavailable')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(screen.getByTestId('retry-quality-report')).toBeInTheDocument();
    expect(screen.getByTestId('download-quality-report')).toBeDisabled();
    expect(screen.getByTestId('download-redacted')).toBeDisabled();
  });

  it('retries loading the authoritative report after a transient failure', async () => {
    jobsApiMocks.getJobExportReport
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        generated_at: 'retry-time',
        summary: {
          total_files: 1,
          selected_files: 1,
          redacted_selected_files: 1,
          unredacted_selected_files: 0,
          review_confirmed_selected_files: 1,
          failed_selected_files: 0,
          detected_entities: 3,
          redaction_coverage: 1,
          action_required_files: 0,
          ready_for_delivery: true,
          by_status: { completed: 1 },
          visual_review_issue_files: 0,
          visual_review_issue_count: 0,
          visual_review_by_issue: {},
        },
        files: [],
      });

    render(
      <BatchStep5Export
        activeJobId="job-1"
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('retry-quality-report')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('retry-quality-report'));

    await waitFor(() =>
      expect(screen.queryByTestId('export-authoritative-report-unavailable')).toBeNull(),
    );
    expect(screen.getByTestId('download-quality-report')).not.toBeDisabled();
    expect(screen.getByTestId('download-redacted')).not.toBeDisabled();
    expect(jobsApiMocks.getJobExportReport).toHaveBeenCalledTimes(2);
  });

  it('blocks the redacted ZIP until the active job authoritative report is loaded', async () => {
    jobsApiMocks.getJobExportReport.mockResolvedValue({
      generated_at: 'server-time',
      summary: {
        total_files: 1,
        selected_files: 1,
        redacted_selected_files: 1,
        unredacted_selected_files: 0,
        review_confirmed_selected_files: 1,
        failed_selected_files: 0,
        detected_entities: 4,
        redaction_coverage: 1,
        action_required_files: 0,
        ready_for_delivery: true,
        by_status: { completed: 1 },
        visual_review_issue_files: 0,
        visual_review_issue_count: 0,
        visual_review_by_issue: {},
      },
      files: [],
    });

    render(
      <BatchStep5Export
        activeJobId="job-1"
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    expect(screen.getByTestId('download-redacted')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('download-redacted')).not.toBeDisabled());
  });

  it('uses canonical delivery_status from the backend report before legacy booleans', async () => {
    jobsApiMocks.getJobExportReport.mockResolvedValue({
      generated_at: 'server-time',
      summary: {
        total_files: 1,
        selected_files: 1,
        redacted_selected_files: 1,
        unredacted_selected_files: 0,
        review_confirmed_selected_files: 0,
        failed_selected_files: 0,
        detected_entities: 4,
        redaction_coverage: 1,
        delivery_status: 'action_required',
        action_required_files: 0,
        ready_for_delivery: true,
        by_status: { completed: 1 },
        visual_review_issue_files: 0,
        visual_review_issue_count: 0,
        visual_review_by_issue: {},
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
          review_confirmed: false,
          entity_count: 4,
          page_count: 5,
          selected_for_export: true,
          delivery_status: 'action_required',
          ready_for_delivery: true,
          action_required: false,
          blocking: false,
          blocking_reasons: ['review_not_confirmed'],
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
        },
      ],
    });

    render(
      <BatchStep5Export
        activeJobId="job-1"
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('download-redacted')).toBeDisabled());
    expect(screen.queryByTestId('export-delivery-state')).not.toBeInTheDocument();
    expect(screen.getByTestId('download-redacted')).toBeDisabled();
    expect(screen.getByTestId('export-delivery-group-review')).toHaveTextContent('ready.pdf');
  });

  it('treats unconfirmed redacted files as not ready for delivery', () => {
    render(
      <BatchStep5Export
        rows={[
          row('unconfirmed', 'completed', {
            has_output: true,
            reviewConfirmed: false,
            entity_count: 4,
          }),
        ]}
        selected={new Set(['unconfirmed'])}
        selectedIds={['unconfirmed']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('export-delivery-state')).not.toBeInTheDocument();
    expect(screen.getByTestId('download-redacted')).toHaveTextContent('Download Redacted ZIP');
    expect(screen.getByTestId('download-redacted')).toBeDisabled();
    expect(screen.getByTestId('export-delivery-group-review')).toHaveTextContent('unconfirmed.pdf');
  });

  it('downloads a JSON quality report for the selected rows', () => {
    render(
      <BatchStep5Export
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('download-quality-report'));

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it('downloads the backend authoritative report when a job is active', async () => {
    jobsApiMocks.getJobExportReport.mockResolvedValue({
      generated_at: 'server-time',
      summary: {
        total_files: 1,
        selected_files: 1,
        redacted_selected_files: 1,
        unredacted_selected_files: 0,
        review_confirmed_selected_files: 1,
        failed_selected_files: 0,
        detected_entities: 7,
        redaction_coverage: 1,
        action_required_files: 0,
        ready_for_delivery: true,
        by_status: { completed: 1 },
        visual_review_issue_files: 0,
        visual_review_issue_count: 0,
        visual_review_by_issue: {},
      },
      files: [],
    });

    render(
      <BatchStep5Export
        activeJobId="job-1"
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('download-quality-report')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('download-quality-report'));

    await waitFor(() =>
      expect(jobsApiMocks.getJobExportReport).toHaveBeenCalledWith('job-1', ['ready']),
    );
    const lastCall = createObjectURL.mock.calls[createObjectURL.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const blob = lastCall![0];
    await expect(blob.text()).resolves.toContain('server-time');
  });

  it('does not fall back to a local report when an active job report download fails', async () => {
    jobsApiMocks.getJobExportReport.mockRejectedValue(new Error('offline'));

    render(
      <BatchStep5Export
        activeJobId="job-1"
        rows={[row('ready', 'completed', { has_output: true, reviewConfirmed: true })]}
        selected={new Set(['ready'])}
        selectedIds={['ready']}
        zipLoading={false}
        toggle={vi.fn()}
        selectReadyForDelivery={vi.fn()}
        goStep={vi.fn()}
        downloadZip={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('download-quality-report')).toBeDisabled());

    fireEvent.click(screen.getByTestId('download-quality-report'));

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByTestId('export-authoritative-report-unavailable')).toBeInTheDocument();
  });
});
