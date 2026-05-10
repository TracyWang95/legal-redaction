// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { FileType } from '@/types';
import type { BatchRow } from '../../types';
import type { ReviewDataDeps } from '../use-batch-review-data';

vi.mock('@/services/api', () => ({
  fileApi: {
    getDownloadUrl: vi.fn(),
  },
  authenticatedBlobUrl: vi.fn(),
}));

vi.mock('@/services/api-client', () => ({
  authFetch: vi.fn(),
}));

vi.mock('@/services/batchPipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/batchPipeline')>();
  return {
    ...actual,
    batchGetFileRaw: vi.fn(),
  };
});

vi.mock('@/services/jobsApi', () => ({
  getItemReviewDraft: vi.fn(),
}));

import { fileApi, authenticatedBlobUrl } from '@/services/api';
import { authFetch } from '@/services/api-client';
import { batchGetFileRaw } from '@/services/batchPipeline';
import { getItemReviewDraft } from '@/services/jobsApi';
import { sanitizeReviewBoxSelection, useBatchReviewData } from '../use-batch-review-data';

function createReviewFile(partial?: Partial<BatchRow>): BatchRow {
  return {
    file_id: 'file-1',
    original_filename: 'demo.pdf',
    file_size: 123,
    file_type: FileType.PDF_SCANNED,
    has_output: false,
    entity_count: 0,
    analyzeStatus: 'awaiting_review',
    isImageMode: true,
    ...partial,
  } as BatchRow;
}

function createDeps(overrides?: Partial<ReviewDataDeps>): ReviewDataDeps {
  return {
    step: 1,
    reviewFile: createReviewFile(),
    activeJobId: null,
    itemIdByFileIdRef: { current: {} },
    cfg: {
      selectedEntityTypeIds: [],
      ocrHasTypes: [],
      hasImageTypes: [],
      replacementMode: 'structured',
    },
    isPreviewMode: false,
    textTypes: [],
    reviewEntities: [],
    reviewBoxes: [],
    visibleReviewBoxes: [],
    reviewCurrentPage: 1,
    reviewTotalPages: 1,
    reviewItemId: undefined,
    reviewLoading: false,
    reviewTextContent: '',
    previewEntityMap: {},
    reviewDraftInitializedRef: { current: false },
    reviewDraftDirtyRef: { current: false },
    reviewLastSavedJsonRef: { current: '' },
    reviewAutosaveTimerRef: { current: null },
    setReviewLoading: vi.fn(),
    setPreviewEntityMap: vi.fn(),
    setReviewImagePreview: vi.fn(),
    setReviewDraftError: vi.fn(),
    setReviewLoadError: vi.fn(),
    setReviewEntities: vi.fn(),
    setReviewBoxes: vi.fn(),
    setReviewCurrentPage: vi.fn(),
    setReviewTotalPages: vi.fn(),
    setReviewPages: vi.fn(),
    setReviewVisionQualityByPage: vi.fn(),
    setReviewTextContent: vi.fn(),
    setReviewOrigImageBlobUrl: vi.fn(),
    setReviewTextUndoStack: vi.fn(),
    setReviewTextRedoStack: vi.fn(),
    setReviewImageUndoStack: vi.fn(),
    setReviewImageRedoStack: vi.fn(),
    buildCurrentReviewDraftPayload: () => ({ entities: [], bounding_boxes: [] }),
    flushCurrentReviewDraft: async () => true,
    setMsg: vi.fn(),
    ...overrides,
  };
}

describe('useBatchReviewData scanned PDF image loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fileApi.getDownloadUrl).mockReturnValue('/api/v1/files/file-1/download');
    vi.mocked(getItemReviewDraft).mockResolvedValue({
      exists: false,
      entities: [],
      bounding_boxes: [],
      updated_at: null,
    });
  });

  it('loads scanned PDF original image from preview-image endpoint', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ image_base64: 'YmF0Y2gtc2Nhbm5lZA==' }),
    } as unknown as Response);

    const deps = createDeps({
      reviewFile: createReviewFile({ file_type: FileType.PDF_SCANNED, isImageMode: true }),
    });
    renderHook(() => useBatchReviewData(deps));

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith(
        '/api/v1/redaction/file-1/preview-image?page=1',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(deps.setReviewOrigImageBlobUrl).toHaveBeenCalledWith(
        'data:image/png;base64,YmF0Y2gtc2Nhbm5lZA==',
      );
    });

    expect(authenticatedBlobUrl).not.toHaveBeenCalled();
  });

  it('keeps previous image on preview-image failure for scanned PDF', async () => {
    // Falling back to /files/{id}/download returns a PDF binary that <img>
    // can't render — it flashes a broken-image icon on every page switch.
    // So on failure we keep whatever image was showing before.
    vi.mocked(authFetch).mockRejectedValue(new Error('preview failed'));
    vi.mocked(authenticatedBlobUrl).mockResolvedValue('blob:fallback-image');

    const deps = createDeps({
      reviewFile: createReviewFile({ file_type: FileType.PDF_SCANNED, isImageMode: true }),
    });
    renderHook(() => useBatchReviewData(deps));

    // Wait for the failed fetch to settle, then assert no blob fallback happened
    await new Promise((r) => setTimeout(r, 20));
    expect(authenticatedBlobUrl).not.toHaveBeenCalled();
    expect(deps.setReviewOrigImageBlobUrl).not.toHaveBeenCalledWith(
      expect.stringMatching(/blob:|\/api\/v1\/files\/file-1\/download/),
    );
  });

  it('cancels rerun recognition before replacing existing image review boxes', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const deps = createDeps({
      reviewBoxes: [
        {
          id: 'box-1',
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          page: 1,
          type: 'official_seal',
          selected: true,
        },
      ],
    });
    const { result } = renderHook(() => useBatchReviewData(deps));

    await act(async () => {
      await result.current.rerunCurrentItemRecognition();
    });

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Re-running recognition'));
    expect(authFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/vision'),
      expect.anything(),
    );
    expect(deps.setReviewBoxes).not.toHaveBeenCalledWith([]);
    expect(deps.setMsg).toHaveBeenCalledWith({
      text: expect.stringContaining('Re-run cancelled'),
      tone: 'neutral',
    });
    vi.unstubAllGlobals();
  });

  it('reports load failures and keeps review drafts uninitialized', async () => {
    vi.mocked(batchGetFileRaw).mockRejectedValue(new Error('failed'));
    const deps = createDeps({
      step: 4,
      reviewFile: createReviewFile({ isImageMode: false }),
    });
    const { result } = renderHook(() => useBatchReviewData(deps));

    await act(async () => {
      await result.current.loadReviewData('file-1', false);
    });

    expect(deps.setReviewLoadError).toHaveBeenCalledWith(
      expect.stringContaining('Review data could not be loaded'),
    );
    expect(deps.setReviewDraftError).toHaveBeenCalledWith(
      expect.stringContaining('Review data could not be loaded'),
    );
    expect(deps.setMsg).toHaveBeenCalledWith({
      text: expect.stringContaining('Review data could not be loaded'),
      tone: 'err',
    });
    expect(deps.reviewDraftInitializedRef.current).toBe(false);
  });

  it('falls back to raw file data when review draft read fails', async () => {
    vi.mocked(batchGetFileRaw).mockResolvedValue({
      file_id: 'file-1',
      filename: 'demo.txt',
      file_type: FileType.TXT,
      file_size: 123,
      content: 'Alice approved.',
      page_count: 1,
      entities: [
        {
          id: 'raw-1',
          text: 'Alice',
          type: 'PERSON',
          start: 0,
          end: 5,
          page: 1,
          selected: true,
        },
      ],
    });
    vi.mocked(getItemReviewDraft).mockRejectedValueOnce(new Error('database busy'));
    const deps = createDeps({
      step: 4,
      activeJobId: 'job-1',
      itemIdByFileIdRef: { current: { 'file-1': 'item-1' } },
      reviewFile: createReviewFile({
        file_type: FileType.TXT,
        isImageMode: false,
        hasReviewDraft: true,
      }),
    });
    const { result } = renderHook(() => useBatchReviewData(deps));

    await act(async () => {
      await result.current.loadReviewData('file-1', false);
    });

    expect(getItemReviewDraft).toHaveBeenCalledWith('job-1', 'item-1');
    expect(deps.setReviewTextContent).toHaveBeenCalledWith('Alice approved.');
    expect(deps.setReviewEntities).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'raw-1', text: 'Alice', type: 'PERSON' }),
    ]);
    expect(deps.setReviewLoadError).toHaveBeenLastCalledWith(null);
    expect(deps.setReviewDraftError).toHaveBeenLastCalledWith(null);
    expect(deps.reviewDraftInitializedRef.current).toBe(true);
  });

  it('preserves visual evidence source when loading scanned PDF boxes', async () => {
    vi.mocked(batchGetFileRaw).mockResolvedValue({
      file_id: 'file-1',
      filename: 'demo.pdf',
      file_type: FileType.PDF_SCANNED,
      file_size: 123,
      page_count: 2,
      bounding_boxes: [
        {
          id: 'seal-1',
          x: 0.02,
          y: 0.03,
          width: 0.2,
          height: 0.18,
          page: 2,
          type: 'official_seal',
          selected: true,
          source: 'has_image',
          evidence_source: 'local_fallback',
          source_detail: 'local_red_seal_fallback',
          warnings: ['fallback_detector'],
        },
      ],
    });
    const deps = createDeps({
      step: 4,
      reviewFile: createReviewFile({ isImageMode: true }),
    });
    const { result } = renderHook(() => useBatchReviewData(deps));

    await act(async () => {
      await result.current.loadReviewData('file-1', true);
    });

    expect(deps.setReviewBoxes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'seal-1',
        page: 2,
        source: 'has_image',
        evidence_source: 'local_fallback',
        source_detail: 'local_red_seal_fallback',
        warnings: ['fallback_detector'],
      }),
    ]);
    expect(deps.reviewLastSavedJsonRef.current).toContain('"evidence_source":"local_fallback"');
  });

  it('does not request a server draft for completed output rows', async () => {
    vi.mocked(batchGetFileRaw).mockResolvedValue({
      file_id: 'file-1',
      filename: 'demo.pdf',
      file_type: FileType.PDF_SCANNED,
      file_size: 123,
      page_count: 1,
      bounding_boxes: [],
    });
    const deps = createDeps({
      step: 4,
      activeJobId: 'job-1',
      itemIdByFileIdRef: { current: { 'file-1': 'item-1' } },
      reviewFile: createReviewFile({
        analyzeStatus: 'completed',
        has_output: true,
        reviewConfirmed: true,
        hasReviewDraft: false,
        isImageMode: true,
      }),
    });
    const { result } = renderHook(() => useBatchReviewData(deps));

    await act(async () => {
      await result.current.loadReviewData('file-1', true);
    });

    expect(getItemReviewDraft).not.toHaveBeenCalled();
    expect(deps.reviewDraftInitializedRef.current).toBe(true);
  });

  it('loads a server draft only when the job item reports one', async () => {
    vi.mocked(batchGetFileRaw).mockResolvedValue({
      file_id: 'file-1',
      filename: 'demo.pdf',
      file_type: FileType.PDF_SCANNED,
      file_size: 123,
      page_count: 1,
      bounding_boxes: [],
    });
    vi.mocked(getItemReviewDraft).mockResolvedValueOnce({
      exists: true,
      entities: [],
      bounding_boxes: [
        {
          id: 'draft-box',
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          page: 1,
          type: 'official_seal',
          selected: true,
        },
      ],
      updated_at: '2026-05-06T00:00:00Z',
    });
    const deps = createDeps({
      step: 4,
      activeJobId: 'job-1',
      itemIdByFileIdRef: { current: { 'file-1': 'item-1' } },
      reviewFile: createReviewFile({ hasReviewDraft: true, isImageMode: true }),
    });
    const { result } = renderHook(() => useBatchReviewData(deps));

    await act(async () => {
      await result.current.loadReviewData('file-1', true);
    });

    expect(getItemReviewDraft).toHaveBeenCalledWith('job-1', 'item-1');
    expect(deps.setReviewBoxes).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'draft-box' }),
    ]);
  });
});

describe('sanitizeReviewBoxSelection', () => {
  it('deselects legacy full-page paper boxes unless explicitly configured', () => {
    const box = {
      id: 'paper-1',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      page: 1,
      type: 'paper',
      selected: true,
      source: 'has_image' as const,
    };

    expect(sanitizeReviewBoxSelection(box, { hasImageTypes: [] }).selected).toBe(false);
    expect(sanitizeReviewBoxSelection(box, { hasImageTypes: ['paper'] }).selected).toBe(true);
  });
});
