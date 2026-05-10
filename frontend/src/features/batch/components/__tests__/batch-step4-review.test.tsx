// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { BatchWizardProvider, type BatchWizardState } from '../../batch-wizard-context';
import { BatchStep4Review } from '../batch-step4-review';

vi.mock('../review-image-content', () => ({
  ReviewImageContent: () => <div data-testid="mock-review-image-content" />,
}));

vi.mock('../review-text-content', () => ({
  ReviewTextContent: () => <div data-testid="mock-review-text-content" />,
}));

function buildWizardState(patch: Partial<BatchWizardState> = {}): BatchWizardState {
  const setReviewCurrentPage = vi.fn();
  const rows = [
    {
      file_id: 'file-1',
      original_filename: 'contract.pdf',
      file_size: 100,
      file_type: 'pdf',
      created_at: '2026-01-01T00:00:00Z',
      has_output: false,
      analyzeStatus: 'awaiting_review',
      reviewConfirmed: false,
      isImageMode: true,
    },
  ];

  return {
    doneRows: rows,
    rows,
    reviewIndex: 0,
    reviewFile: rows[0],
    reviewLoading: false,
    reviewLoadError: null,
    reviewExecuteLoading: false,
    reviewFileReadOnly: false,
    reviewTotalPages: 3,
    reviewAllPagesVisited: false,
    reviewRequiredPagesVisited: false,
    visitedReviewPagesCount: 1,
    reviewCurrentPage: 1,
    reviewPageSummaries: [
      { page: 1, hitCount: 0, selectedCount: 0, issueCount: 0, visited: true, current: true },
      { page: 2, hitCount: 2, selectedCount: 2, issueCount: 0, visited: false, current: false },
      { page: 3, hitCount: 1, selectedCount: 1, issueCount: 1, visited: false, current: false },
    ],
    reviewHitPageCount: 2,
    reviewUnvisitedHitPageCount: 2,
    reviewRequiredPageCount: 2,
    reviewUnvisitedRequiredPageCount: 2,
    navigateReviewIndex: vi.fn(),
    reviewDraftSaving: false,
    reviewDraftError: null,
    reviewedOutputCount: 0,
    allReviewConfirmed: false,
    canAdvanceToExport: false,
    confirmCurrentReview: vi.fn(),
    advanceToExportStep: vi.fn(),
    loadReviewData: vi.fn(),
    rerunCurrentItemRecognition: vi.fn(),
    rerunRecognitionLoading: false,
    setReviewCurrentPage,
    reviewBoxes: [],
    visibleReviewBoxes: [],
    reviewOrigImageBlobUrl: null,
    reviewImagePreviewSrc: null,
    reviewImagePreviewLoading: false,
    selectedReviewBoxCount: 0,
    totalReviewBoxCount: 0,
    currentReviewVisionQuality: null,
    pipelines: [],
    setVisibleReviewBoxes: vi.fn(),
    handleReviewBoxesCommit: vi.fn(),
    toggleReviewBoxSelected: vi.fn(),
    undoReviewImage: vi.fn(),
    redoReviewImage: vi.fn(),
    reviewImageUndoStack: [],
    reviewImageRedoStack: [],
    undoReviewText: vi.fn(),
    redoReviewText: vi.fn(),
    reviewTextUndoStack: [],
    reviewTextRedoStack: [],
    reviewEntities: [],
    visibleReviewEntities: [],
    reviewTextContent: '',
    reviewPageContent: '',
    reviewTextContentRef: { current: null },
    reviewTextScrollRef: { current: null },
    selectedReviewEntityCount: 0,
    displayPreviewMap: new Map(),
    textPreviewSegments: [],
    applyReviewEntities: vi.fn(),
    textTypes: [],
    ...patch,
  } as unknown as BatchWizardState;
}

describe('BatchStep4Review', () => {
  it('hides risk review prompts while still blocking an unvisited current file', () => {
    const confirmCurrentReview = vi.fn();
    const advanceToExportStep = vi.fn();
    const state = buildWizardState({ confirmCurrentReview, advanceToExportStep });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    expect(screen.getByTestId('review-file-toolbar')).toHaveTextContent('contract.pdf');
    expect(screen.getByTestId('review-action-bar')).toHaveTextContent('Pages viewed 0/2');
    expect(screen.getByTestId('review-action-bar')).toHaveTextContent('Confirmed 0/1');
    expect(screen.getByTestId('review-next-required-page')).toHaveTextContent('Next page');
    expect(screen.queryByTestId('review-pages-gate')).toBeNull();
    expect(screen.queryByTestId('review-page-risk-rail')).toBeNull();
    expect(screen.queryByText(/required pages left/i)).toBeNull();
    expect(screen.queryByText(/Next (issue|hit|risk) page/i)).toBeNull();
    expect(screen.getByTestId('confirm-redact')).toBeDisabled();
    expect(screen.getByTestId('go-export')).toBeDisabled();

    fireEvent.click(screen.getByTestId('review-next-required-page'));
    fireEvent.click(screen.getByTestId('confirm-redact'));
    fireEvent.click(screen.getByTestId('go-export'));

    expect(state.setReviewCurrentPage).toHaveBeenCalledWith(3);
    expect(confirmCurrentReview).not.toHaveBeenCalled();
    expect(advanceToExportStep).not.toHaveBeenCalled();
  });

  it('does not jump to the next file before the current file is confirmed', () => {
    const base = buildWizardState();
    const current = base.doneRows[0];
    const next = {
      ...current,
      file_id: 'file-2',
      original_filename: 'appendix.pdf',
      reviewConfirmed: false,
    };
    const navigateReviewIndex = vi.fn();
    const state = buildWizardState({
      doneRows: [current, next],
      rows: [current, next],
      reviewFile: current,
      navigateReviewIndex,
      reviewRequiredPagesVisited: true,
    });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    expect(screen.getByTestId('review-next')).toBeDisabled();
    expect(screen.getByTestId('review-next')).toHaveAttribute(
      'title',
      'Confirm Redaction',
    );

    fireEvent.click(screen.getByTestId('review-next'));

    expect(navigateReviewIndex).not.toHaveBeenCalled();
  });

  it('allows jumping to the next file after current review is confirmed', () => {
    const base = buildWizardState();
    const current = { ...base.doneRows[0], reviewConfirmed: true, has_output: true };
    const next = {
      ...current,
      file_id: 'file-2',
      original_filename: 'appendix.pdf',
      reviewConfirmed: false,
      has_output: false,
    };
    const navigateReviewIndex = vi.fn();
    const state = buildWizardState({
      doneRows: [current, next],
      rows: [current, next],
      reviewFile: current,
      navigateReviewIndex,
      reviewRequiredPagesVisited: true,
    });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    fireEvent.click(screen.getByTestId('review-next'));

    expect(navigateReviewIndex).toHaveBeenCalledWith(1);
  });

  it('shows unfinished batch item statuses while reviewing ready files', () => {
    const base = buildWizardState();
    const ready = base.doneRows[0];
    const processing = {
      ...ready,
      file_id: 'file-processing',
      original_filename: 'processing.pdf',
      analyzeStatus: 'analyzing' as const,
      reviewConfirmed: false,
      recognitionCurrent: 3,
      recognitionTotal: 6,
    };
    const pending = {
      ...ready,
      file_id: 'file-pending',
      original_filename: 'pending.pdf',
      analyzeStatus: 'pending' as const,
      reviewConfirmed: false,
    };
    const state = buildWizardState({
      doneRows: [ready],
      rows: [ready, processing, pending],
      reviewFile: ready,
      reviewedOutputCount: 0,
      canAdvanceToExport: false,
    });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    expect(screen.getByTestId('review-unfinished-status')).toHaveTextContent('Reviewable 1/3');
    expect(screen.getByTestId('review-queue-status-background')).toHaveTextContent(
      'Background recognition still running',
    );
    expect(screen.getByTestId('review-queue-status-background-hint')).toHaveTextContent(
      'Keep reviewing ready files',
    );
    expect(screen.getByTestId('review-unfinished-status')).toHaveTextContent('processing.pdf');
    expect(screen.getByTestId('review-unfinished-status')).toHaveTextContent('Recognizing');
    expect(screen.getByTestId('review-unfinished-status')).toHaveTextContent('3/6');
    expect(screen.getByTestId('review-unfinished-status')).toHaveTextContent('pending.pdf');
    expect(screen.getByTestId('review-unfinished-status')).toHaveTextContent('Pending');
    expect(screen.getByTestId('review-background-wait')).toHaveTextContent(
      'Waiting for background recognition 1/3',
    );
    expect(screen.getByTestId('go-export')).toHaveAttribute(
      'title',
      'Keep reviewing ready files; export unlocks after the remaining files finish and are confirmed.',
    );
    expect(screen.getByTestId('go-export')).toBeDisabled();
  });

  it('shows a compact waiting queue when no file is ready for review yet', () => {
    const base = buildWizardState();
    const waitingRows = [
      {
        ...base.rows[0],
        file_id: 'file-processing',
        original_filename: 'processing.pdf',
        analyzeStatus: 'analyzing' as const,
        reviewConfirmed: false,
      },
      {
        ...base.rows[0],
        file_id: 'file-pending',
        original_filename: 'pending.pdf',
        analyzeStatus: 'pending' as const,
        reviewConfirmed: false,
      },
    ];
    const state = buildWizardState({
      doneRows: [],
      rows: waitingRows,
      reviewFile: null,
      canAdvanceToExport: false,
    });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    expect(screen.getByTestId('batch-step4-empty')).toHaveTextContent('No recognized files yet');
    expect(screen.getByTestId('review-waiting-status')).toHaveTextContent('Reviewable 0/2');
    expect(screen.getByTestId('review-waiting-status-background')).toHaveTextContent(
      'Background recognition still running',
    );
    expect(screen.getByTestId('review-waiting-status')).toHaveTextContent('processing.pdf');
    expect(screen.getByTestId('review-waiting-status')).toHaveTextContent('Recognizing');
    expect(screen.getByTestId('review-waiting-status')).toHaveTextContent('pending.pdf');
    expect(screen.getByTestId('review-waiting-status')).toHaveTextContent('Pending');
    expect(screen.queryByTestId('batch-step4-content-loading')).toBeNull();
    expect(screen.queryByTestId('go-export')).toBeNull();
  });

  it('moves to the next unvisited required page after the current page before wrapping', () => {
    const setReviewCurrentPage = vi.fn();
    const state = buildWizardState({
      reviewCurrentPage: 2,
      setReviewCurrentPage,
      reviewPageSummaries: [
        { page: 1, hitCount: 2, selectedCount: 2, issueCount: 0, visited: false, current: false },
        { page: 2, hitCount: 0, selectedCount: 0, issueCount: 0, visited: true, current: true },
        { page: 3, hitCount: 1, selectedCount: 1, issueCount: 1, visited: false, current: false },
      ],
      reviewRequiredPagesVisited: false,
      reviewRequiredPageCount: 2,
      reviewUnvisitedRequiredPageCount: 2,
    });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    fireEvent.click(screen.getByTestId('review-next-required-page'));

    expect(setReviewCurrentPage).toHaveBeenCalledWith(3);
  });

  it('shows submitting while a read-only review item is being committed', () => {
    const state = buildWizardState({
      reviewExecuteLoading: true,
      reviewFileReadOnly: true,
      reviewAllPagesVisited: true,
      reviewRequiredPagesVisited: true,
    });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    expect(screen.getByTestId('confirm-redact')).toHaveTextContent('Submitting...');
  });

  it('allows confirmation after all required hit and issue pages are visited even if blank pages remain', () => {
    const confirmCurrentReview = vi.fn();
    const state = buildWizardState({
      confirmCurrentReview,
      reviewAllPagesVisited: false,
      reviewRequiredPagesVisited: true,
      visitedReviewPagesCount: 2,
      reviewRequiredPageCount: 1,
      reviewUnvisitedRequiredPageCount: 0,
      reviewPageSummaries: [
        { page: 1, hitCount: 1, selectedCount: 1, issueCount: 0, visited: true, current: true },
        { page: 2, hitCount: 0, selectedCount: 0, issueCount: 0, visited: false, current: false },
        { page: 3, hitCount: 0, selectedCount: 0, issueCount: 0, visited: true, current: false },
      ],
      reviewHitPageCount: 1,
      reviewUnvisitedHitPageCount: 0,
    });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    expect(screen.queryByTestId('review-pages-gate')).toBeNull();
    expect(screen.getByTestId('confirm-redact')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('confirm-redact'));

    expect(confirmCurrentReview).toHaveBeenCalled();
  });

  it('blocks confirmation and offers retry when review data fails to load', () => {
    const loadReviewData = vi.fn();
    const state = buildWizardState({
      reviewLoadError: 'Review data could not be loaded.',
      loadReviewData,
    });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    expect(screen.getByTestId('batch-step4-load-error')).toHaveTextContent(
      'Review data failed to load',
    );
    expect(screen.queryByTestId('confirm-redact')).toBeNull();

    fireEvent.click(screen.getByTestId('retry-review-load'));

    expect(loadReviewData).toHaveBeenCalledWith('file-1', true);
  });

  it('shows a stable loading state instead of empty review panes while data is loading', () => {
    const state = buildWizardState({ reviewLoading: true });

    render(
      <BatchWizardProvider value={state}>
        <BatchStep4Review />
      </BatchWizardProvider>,
    );

    expect(screen.getByTestId('review-file-toolbar')).toHaveTextContent('contract.pdf');
    expect(screen.getByTestId('batch-step4-content-loading')).toHaveTextContent(
      'Loading review data',
    );
    expect(screen.queryByTestId('mock-review-image-content')).toBeNull();
    expect(screen.queryByTestId('mock-review-text-content')).toBeNull();
    expect(screen.getByTestId('confirm-redact')).toBeDisabled();
    expect(screen.getByTestId('go-export')).toBeDisabled();
  });
});
