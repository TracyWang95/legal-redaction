// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

import { fileApi, authenticatedBlobUrl } from '@/services/api';
import { authFetch } from '@/services/api-client';
import { useBatchReviewData } from '../use-batch-review-data';

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
    setReviewEntities: vi.fn(),
    setReviewBoxes: vi.fn(),
    setReviewCurrentPage: vi.fn(),
    setReviewTotalPages: vi.fn(),
    setReviewPages: vi.fn(),
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
});
