// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/services/recognition-config', () => ({
  fetchRecognitionEntityTypes: vi.fn(),
  fetchRecognitionPipelines: vi.fn(),
  fetchRecognitionPresets: vi.fn(),
}));

vi.mock('@/services/batchPipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/batchPipeline')>();
  return {
    ...actual,
    loadBatchWizardConfig: vi.fn(() => null),
    saveBatchWizardConfig: vi.fn(),
    batchGetFileRaw: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('@/services/activePresetBridge', () => ({
  getActivePresetTextId: vi.fn(() => null),
  getActivePresetVisionId: vi.fn(() => null),
  setActivePresetTextId: vi.fn(),
  setActivePresetVisionId: vi.fn(),
}));

vi.mock('@/services/presetsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/presetsApi')>();
  return { ...actual };
});

vi.mock('@/services/jobsApi', () => ({
  createJob: vi.fn().mockResolvedValue({ id: 'new-job-1' }),
  getJob: vi.fn().mockResolvedValue({
    id: 'job-1',
    job_type: 'smart_batch',
    status: 'draft',
    config: {},
    items: [],
    nav_hints: {},
  }),
  submitJob: vi.fn().mockResolvedValue({}),
  updateJobDraft: vi.fn().mockResolvedValue({}),
  putItemReviewDraft: vi.fn().mockResolvedValue({}),
  getItemReviewDraft: vi.fn().mockResolvedValue(null),
  requeueFailed: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/api', () => ({
  fileApi: vi.fn(),
  authenticatedBlobUrl: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/services/api-client', () => ({
  authFetch: vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
}));

vi.mock('@/services/defaultRedactionPreset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/defaultRedactionPreset')>();
  return { ...actual };
});

vi.mock('@/services/hooks/use-presets', () => ({
  usePresets: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useInvalidatePresets: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  PRESETS_QUERY_KEY: ['presets'],
}));

vi.mock('@/i18n', () => ({ t: (k: string) => k }));

vi.mock('@/utils/localizeError', () => ({
  localizeErrorMessage: (_e: unknown, key: string) => key,
}));

vi.mock('@/utils/textRedactionSegments', () => ({
  buildTextSegments: vi.fn(() => []),
  mergePreviewMapWithDocumentSlices: vi.fn(() => ({})),
}));

vi.mock('../use-batch-review-data', () => ({
  useBatchReviewData: vi.fn(() => ({
    loadReviewData: vi.fn(),
    rerunCurrentItemRecognition: vi.fn(),
    rerunRecognitionLoading: false,
    reviewImagePreviewLoading: false,
  })),
}));

import {
  fetchRecognitionEntityTypes,
  fetchRecognitionPipelines,
  fetchRecognitionPresets,
} from '@/services/recognition-config';
import { batchGetFileRaw } from '@/services/batchPipeline';
import {
  createJob,
  getJob,
  putItemReviewDraft,
  requeueFailed,
  submitJob,
  updateJobDraft,
} from '@/services/jobsApi';
import type { TextEntityType, PipelineCfg } from '../../types';
import { useBatchWizard } from '../use-batch-wizard';

// ── Test fixtures ──────────────────────────────────────────────────────────

function makeTextTypes(count = 5): TextEntityType[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `TYPE_${i + 1}`,
    name: `Type ${i + 1}`,
    color: '#0f766e',
    regex_pattern: i < 3 ? '\\d+' : null,
    order: i + 1,
  }));
}

function makePipelines(): PipelineCfg[] {
  return [
    {
      mode: 'ocr_has',
      name: 'OCR',
      description: 'OCR pipeline',
      enabled: true,
      types: [{ id: 'ocr_1', name: 'OCR Type 1', color: '#0f766e', enabled: true, order: 1 }],
    },
    {
      mode: 'has_image',
      name: 'Image',
      description: 'Image pipeline',
      enabled: true,
      types: [{ id: 'img_1', name: 'Image Type 1', color: '#b45309', enabled: true, order: 1 }],
    },
  ];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function setupMocks(
  types: TextEntityType[] = makeTextTypes(),
  pipes: PipelineCfg[] = makePipelines(),
) {
  (fetchRecognitionEntityTypes as Mock).mockResolvedValue(types);
  (fetchRecognitionPipelines as Mock).mockResolvedValue(pipes);
  (fetchRecognitionPresets as Mock).mockResolvedValue([]);
}

/**
 * Creates a wrapper that uses createMemoryRouter + RouterProvider.
 * useBlocker (used in useBatchWizard) requires a data router.
 */
function wrapperWithRoute(path: string) {
  return ({ children }: { children: React.ReactNode }) => {
    const router = createMemoryRouter([{ path: '/batch/:batchMode', element: children }], {
      initialEntries: [path],
    });
    return createElement(RouterProvider, { router });
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const defaultWrapper = wrapperWithRoute('/batch/smart');

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useBatchWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    (createJob as Mock).mockReset();
    (getJob as Mock).mockReset();
    (batchGetFileRaw as Mock).mockReset();
    (putItemReviewDraft as Mock).mockReset();
    (requeueFailed as Mock).mockReset();
    (submitJob as Mock).mockReset();
    (updateJobDraft as Mock).mockReset();
    (createJob as Mock).mockResolvedValue({ id: 'new-job-1' });
    (getJob as Mock).mockResolvedValue({
      id: 'job-1',
      job_type: 'smart_batch',
      status: 'draft',
      config: {},
      items: [],
      nav_hints: {},
    });
    (batchGetFileRaw as Mock).mockResolvedValue({});
    (putItemReviewDraft as Mock).mockResolvedValue({});
    (requeueFailed as Mock).mockResolvedValue({});
    (submitJob as Mock).mockResolvedValue({});
    (updateJobDraft as Mock).mockResolvedValue({});
  });

  // ── Initial state ──

  describe('initial state', () => {
    it('starts at step 1', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.step).toBe(1);
    });

    it('furthestStep starts at 1', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.furthestStep).toBe(1);
    });

    it('activeJobId starts null', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.activeJobId).toBeNull();
    });

    it('previewMode starts false (no ?preview=1)', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.previewMode).toBe(false);
    });

    it('mode defaults to smart', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.mode).toBe('smart');
    });

    it('modeValid is true for known modes', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/text'),
      });
      expect(result.current.modeValid).toBe(true);
    });

    it('configLoaded starts false', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.configLoaded).toBe(false);
    });

    it('rows starts empty', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.rows).toEqual([]);
    });

    it('isStep1Complete starts false', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.isStep1Complete).toBe(false);
    });

    it('allReviewConfirmed starts false', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.allReviewConfirmed).toBe(false);
    });

    it('default cfg has expected shape', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.cfg).toHaveProperty('selectedEntityTypeIds');
      expect(result.current.cfg).toHaveProperty('replacementMode');
      expect(result.current.cfg.replacementMode).toBe('structured');
    });
  });

  // ── Step navigation (canGoStep / goStep) ──

  describe('step navigation', () => {
    it('canGoStep(1) is always true', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));
      expect(result.current.canGoStep(1)).toBe(true);
    });

    it('canGoStep(2) is false when step 1 is incomplete', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));
      // Without confirmStep1 being set, step1 is incomplete
      expect(result.current.canGoStep(2)).toBe(false);
    });

    it('keeps Step 2 locked until the user clicks the Step 1 next action', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));
      // After config loads, entity types are populated with defaults
      act(() => result.current.setConfirmStep1(true));
      expect(result.current.isStep1Complete).toBe(true);
      expect(result.current.canGoStep(2)).toBe(false);

      await act(async () => {
        await result.current.advanceToUploadStep();
      });

      expect(result.current.step).toBe(2);
      expect(result.current.canGoStep(2)).toBe(true);
    });

    it('lets the Step 2 next action advance after files are uploaded', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-upload-ready',
        job_type: 'smart_batch',
        title: 'Upload ready batch',
        status: 'draft',
        skip_item_review: false,
        config: { wizard_furthest_step: 2 },
        nav_hints: { item_count: 1, wizard_furthest_step: 2 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        items: [
          {
            id: 'item-upload-ready',
            job_id: 'job-upload-ready',
            file_id: 'file-upload-ready',
            sort_order: 0,
            status: 'pending',
            filename: 'upload-ready.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'upload-ready.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      });

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-upload-ready&step=2'),
      });

      await waitFor(() => expect(result.current.step).toBe(2));
      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      expect(result.current.canGoStep(3)).toBe(false);

      act(() => result.current.goStep(3));

      expect(result.current.step).toBe(3);
      expect(result.current.furthestStep).toBe(3);
      expect(result.current.msg).toBeNull();
    });

    it('goStep shows warning when advancing to step 2 without confirmation', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));

      act(() => result.current.goStep(2));

      // Step should remain 1 and a warning message should appear
      expect(result.current.step).toBe(1);
      expect(result.current.msg).not.toBeNull();
    });

    it('goStep(1) from step 1 is a no-op', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });

      act(() => result.current.goStep(1));

      expect(result.current.step).toBe(1);
    });
  });

  // ── Config persistence ──

  describe('config persistence', () => {
    it('setCfg updates the config', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));

      act(() => {
        result.current.setCfg((c) => ({ ...c, replacementMode: 'mask' }));
      });

      expect(result.current.cfg.replacementMode).toBe('mask');
    });

    it('setConfirmStep1 toggles the confirmation flag', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));

      act(() => result.current.setConfirmStep1(true));
      expect(result.current.confirmStep1).toBe(true);

      act(() => result.current.setConfirmStep1(false));
      expect(result.current.confirmStep1).toBe(false);
    });

    it('setJobPriority updates jobPriority', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));

      act(() => result.current.setJobPriority(7));
      expect(result.current.jobPriority).toBe(7);
    });
  });

  // ── Preview mode ──

  describe('preview mode', () => {
    const previewWrapper = wrapperWithRoute('/batch/smart?preview=1');

    it('activates preview mode via ?preview=1', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: previewWrapper });
      expect(result.current.previewMode).toBe(true);
    });

    it('sets furthestStep to 5 in preview mode', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: previewWrapper });
      await waitFor(() => expect(result.current.furthestStep).toBe(5));
    });

    it('populates rows with preview fixtures', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: previewWrapper });
      await waitFor(() => expect(result.current.rows.length).toBeGreaterThan(0));
    });

    it('canGoStep returns true for any step in preview', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: previewWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));

      expect(result.current.canGoStep(1)).toBe(true);
      expect(result.current.canGoStep(3)).toBe(true);
      expect(result.current.canGoStep(5)).toBe(true);
    });
  });

  // ── advanceToUploadStep ──

  describe('URL hydration', () => {
    it('restores step 5 when confirmed ready items coexist with failed items', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-1',
        job_type: 'smart_batch',
        title: 'Mixed batch',
        status: 'completed',
        skip_item_review: false,
        config: { wizard_furthest_step: 5 },
        nav_hints: { item_count: 2, wizard_furthest_step: 5 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: 2,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: 0,
          review_approved: 0,
          redacting: 0,
          completed: 1,
          failed: 1,
        },
        items: [
          {
            id: 'item-ready',
            job_id: 'job-1',
            file_id: 'file-ready',
            sort_order: 0,
            status: 'completed',
            filename: 'ready.pdf',
            file_type: 'pdf',
            has_output: true,
            entity_count: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-failed',
            job_id: 'job-1',
            file_id: 'file-failed',
            sort_order: 1,
            status: 'failed',
            filename: 'failed.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            error_message: 'OCR timeout',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockImplementation(async (fileId: string) => ({
        original_filename: fileId === 'file-ready' ? 'ready.pdf' : 'failed.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
        output_path: fileId === 'file-ready' ? '/redacted/ready.pdf' : null,
      }));

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-1&step=5'),
      });

      await waitFor(() => expect(result.current.configLoaded).toBe(true));
      await waitFor(() => expect(result.current.rows).toHaveLength(2));
      expect(result.current.step).toBe(5);
      expect(result.current.allReviewConfirmed).toBe(true);
      expect(result.current.jobConfigLocked).toBe(true);
    });

    it('hydrates scanned PDFs as image review when job metadata is newer than file metadata', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-scanned',
        job_type: 'smart_batch',
        title: 'Scanned PDF batch',
        status: 'awaiting_review',
        skip_item_review: false,
        config: { wizard_furthest_step: 4 },
        nav_hints: { item_count: 1, wizard_furthest_step: 4 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
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
        },
        items: [
          {
            id: 'item-scanned',
            job_id: 'job-scanned',
            file_id: 'file-scanned',
            sort_order: 0,
            status: 'awaiting_review',
            filename: 'scanned.pdf',
            file_type: 'pdf_scanned',
            has_output: false,
            entity_count: 12,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'scanned.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      });

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-scanned&step=4'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      expect(result.current.rows[0]).toMatchObject({
        file_type: 'pdf_scanned',
        isImageMode: true,
      });
      expect(result.current.reviewFile?.isImageMode).toBe(true);
    });

    it('keeps step 5 locked and resumes at the first unconfirmed awaiting review item', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-review',
        job_type: 'smart_batch',
        title: 'Review batch',
        status: 'awaiting_review',
        skip_item_review: false,
        config: { wizard_furthest_step: 5 },
        nav_hints: { item_count: 3, wizard_furthest_step: 5 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: 3,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: 1,
          review_approved: 0,
          redacting: 0,
          completed: 1,
          failed: 1,
        },
        items: [
          {
            id: 'item-ready',
            job_id: 'job-review',
            file_id: 'file-ready',
            sort_order: 0,
            status: 'completed',
            filename: 'ready.pdf',
            file_type: 'pdf',
            has_output: true,
            entity_count: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-failed',
            job_id: 'job-review',
            file_id: 'file-failed',
            sort_order: 1,
            status: 'failed',
            filename: 'failed.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            error_message: 'OCR timeout',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-pending',
            job_id: 'job-review',
            file_id: 'file-pending',
            sort_order: 2,
            status: 'awaiting_review',
            filename: 'pending.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockImplementation(async (fileId: string) => ({
        original_filename:
          fileId === 'file-ready'
            ? 'ready.pdf'
            : fileId === 'file-failed'
              ? 'failed.pdf'
              : 'pending.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
        output_path: fileId === 'file-ready' ? '/redacted/ready.pdf' : null,
      }));

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-review&step=5&itemId=item-ready'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(3));
      expect(result.current.step).toBe(4);
      expect(result.current.canGoStep(5)).toBe(false);
      expect(result.current.reviewFile?.file_id).toBe('file-pending');
    });

    it('keeps step 3 when a ready item exists while other items are still recognizing', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-progressive',
        job_type: 'smart_batch',
        title: 'Progressive batch',
        status: 'processing',
        skip_item_review: false,
        config: { wizard_furthest_step: 4 },
        nav_hints: { item_count: 2, wizard_furthest_step: 4 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: 2,
          pending: 1,
          processing: 1,
          queued: 0,
          parsing: 0,
          ner: 1,
          vision: 0,
          awaiting_review: 1,
          review_approved: 0,
          redacting: 0,
          completed: 0,
          failed: 0,
        },
        items: [
          {
            id: 'item-ready',
            job_id: 'job-progressive',
            file_id: 'file-ready',
            sort_order: 0,
            status: 'awaiting_review',
            filename: 'ready.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-active',
            job_id: 'job-progressive',
            file_id: 'file-active',
            sort_order: 1,
            status: 'ner',
            filename: 'active.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockImplementation(async (fileId: string) => ({
        original_filename: fileId === 'file-ready' ? 'ready.pdf' : 'active.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      }));

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-progressive&step=4'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(2));
      expect(result.current.step).toBe(3);
      expect(result.current.canGoStep(4)).toBe(false);
      expect(result.current.canGoStep(5)).toBe(false);
      expect(result.current.reviewFile?.file_id).toBe('file-ready');
    });

    it('keeps step 3 when the URL item is still recognizing', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-active-url',
        job_type: 'smart_batch',
        title: 'Active URL batch',
        status: 'processing',
        skip_item_review: false,
        config: { wizard_furthest_step: 4 },
        nav_hints: { item_count: 2, wizard_furthest_step: 4 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: 2,
          pending: 1,
          processing: 1,
          queued: 0,
          parsing: 0,
          ner: 1,
          vision: 0,
          awaiting_review: 1,
          review_approved: 0,
          redacting: 0,
          completed: 0,
          failed: 0,
        },
        items: [
          {
            id: 'item-active',
            job_id: 'job-active-url',
            file_id: 'file-active',
            sort_order: 0,
            status: 'ner',
            filename: 'active.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-ready',
            job_id: 'job-active-url',
            file_id: 'file-ready',
            sort_order: 1,
            status: 'awaiting_review',
            filename: 'ready.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockImplementation(async (fileId: string) => ({
        original_filename: fileId === 'file-ready' ? 'ready.pdf' : 'active.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      }));

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-active-url&step=4&itemId=item-active'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(2));
      expect(result.current.step).toBe(3);
      expect(result.current.reviewFile?.file_id).toBe('file-ready');
      expect(result.current.canAdvanceToExport).toBe(false);
    });

    it('blocks export after refresh when the last reviewable item is still awaiting review', async () => {
      setupMocks();
      const detail = {
        id: 'job-awaiting',
        job_type: 'smart_batch',
        title: 'Awaiting batch',
        status: 'awaiting_review',
        skip_item_review: false,
        config: { wizard_furthest_step: 5 },
        nav_hints: { item_count: 2, wizard_furthest_step: 5 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: 2,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: 1,
          review_approved: 0,
          redacting: 0,
          completed: 1,
          failed: 0,
        },
        items: [
          {
            id: 'item-ready',
            job_id: 'job-awaiting',
            file_id: 'file-ready',
            sort_order: 0,
            status: 'completed',
            filename: 'ready.pdf',
            file_type: 'pdf',
            has_output: true,
            entity_count: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-last',
            job_id: 'job-awaiting',
            file_id: 'file-last',
            sort_order: 1,
            status: 'awaiting_review',
            filename: 'last.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      };
      (getJob as Mock).mockResolvedValue(detail);
      (batchGetFileRaw as Mock).mockImplementation(async (fileId: string) => ({
        original_filename: fileId === 'file-ready' ? 'ready.pdf' : 'last.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
        output_path: fileId === 'file-ready' ? '/redacted/ready.pdf' : null,
      }));

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-awaiting&step=4'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(2));
      expect(result.current.reviewFile?.file_id).toBe('file-last');

      await act(async () => {
        await result.current.advanceToExportStep();
      });

      expect(result.current.step).toBe(4);
      expect(result.current.reviewFile?.file_id).toBe('file-last');
      expect(result.current.msg).toEqual({
        text: 'batchWizard.notAllFilesConfirmed',
        tone: 'warn',
      });
    });

    it('limits concurrent file hydration when restoring a job', async () => {
      setupMocks();
      const items = Array.from({ length: 10 }, (_, index) => ({
        id: `item-${index}`,
        job_id: 'job-large',
        file_id: `file-${index}`,
        sort_order: index,
        status: 'awaiting_review',
        filename: `file-${index}.pdf`,
        file_type: 'pdf',
        has_output: false,
        entity_count: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }));
      (getJob as Mock).mockResolvedValueOnce({
        id: 'job-large',
        job_type: 'smart_batch',
        title: 'Large batch',
        status: 'awaiting_review',
        skip_item_review: false,
        config: { wizard_furthest_step: 4 },
        nav_hints: { item_count: items.length, wizard_furthest_step: 4 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: items.length,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: items.length,
          review_approved: 0,
          redacting: 0,
          completed: 0,
          failed: 0,
        },
        items,
      });

      let inFlight = 0;
      let maxInFlight = 0;
      (batchGetFileRaw as Mock).mockImplementation(async (fileId: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return {
          original_filename: `${fileId}.pdf`,
          file_type: 'pdf',
          file_size: 100,
          created_at: '2026-01-01T00:00:00Z',
        };
      });

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-large&step=4'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(items.length));
      expect(batchGetFileRaw).toHaveBeenCalledTimes(items.length);
      expect(maxInFlight).toBeLessThanOrEqual(4);
      expect(result.current.rows.map((row) => row.file_id)).toEqual(
        items.map((item) => item.file_id),
      );
    });

    it('requeues failed items even when the persisted execution mode is local', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValueOnce({
        id: 'job-local',
        job_type: 'smart_batch',
        title: 'Local failed batch',
        status: 'failed',
        skip_item_review: false,
        config: { wizard_furthest_step: 3 },
        nav_hints: { item_count: 1, wizard_furthest_step: 3 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: 1,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: 0,
          review_approved: 0,
          redacting: 0,
          completed: 0,
          failed: 1,
        },
        items: [
          {
            id: 'item-failed',
            job_id: 'job-local',
            file_id: 'file-failed',
            sort_order: 0,
            status: 'failed',
            filename: 'failed.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            error_message: 'OCR timeout',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'failed.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      });

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-local&step=3'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      act(() => {
        result.current.setCfg((current) => ({ ...current, executionDefault: 'local' }));
      });

      await act(async () => {
        await result.current.requeueFailedItems();
      });

      expect(requeueFailed).toHaveBeenCalledWith('job-local');
      expect(result.current.rows[0].analyzeStatus).toBe('pending');
      expect(result.current.msg?.text).toBe('batchWizard.requeueFailedQueued');
    });

    it('refreshes active job status during queue submit without waiting for the next poll tick', async () => {
      setupMocks();
      (getJob as Mock)
        .mockResolvedValueOnce({
          id: 'job-submit',
          job_type: 'smart_batch',
          title: 'Submit batch',
          status: 'draft',
          skip_item_review: false,
          config: { wizard_furthest_step: 2 },
          nav_hints: { item_count: 1, wizard_furthest_step: 2 },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          progress: {
            total_items: 1,
            pending: 1,
            processing: 0,
            queued: 0,
            parsing: 0,
            ner: 0,
            vision: 0,
            awaiting_review: 0,
            review_approved: 0,
            redacting: 0,
            completed: 0,
            failed: 0,
          },
          items: [
            {
              id: 'item-submit',
              job_id: 'job-submit',
              file_id: 'file-submit',
              sort_order: 0,
              status: 'pending',
              filename: 'submit.pdf',
              file_type: 'pdf',
              has_output: false,
              entity_count: 0,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'job-submit',
          job_type: 'smart_batch',
          title: 'Submit batch',
          status: 'processing',
          skip_item_review: false,
          config: { wizard_furthest_step: 2 },
          nav_hints: { item_count: 1, wizard_furthest_step: 2 },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:01Z',
          progress: {
            total_items: 1,
            pending: 0,
            processing: 1,
            queued: 0,
            parsing: 1,
            ner: 0,
            vision: 0,
            awaiting_review: 0,
            review_approved: 0,
            redacting: 0,
            completed: 0,
            failed: 0,
          },
          items: [
            {
              id: 'item-submit',
              job_id: 'job-submit',
              file_id: 'file-submit',
              sort_order: 0,
              status: 'parsing',
              filename: 'submit.pdf',
              file_type: 'pdf',
              has_output: false,
              entity_count: 0,
              progress_stage: 'parsing',
              progress_current: 1,
              progress_total: 3,
              progress_message: 'Parsing document',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:01Z',
            },
          ],
        });
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'submit.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      });

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-submit&step=2'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(1));

      await act(async () => {
        await result.current.submitQueueToWorker();
      });

      expect(submitJob).toHaveBeenCalledWith('job-submit');
      expect(getJob).toHaveBeenCalled();
      expect(result.current.rows[0]).toMatchObject({
        analyzeStatus: 'analyzing',
        recognitionStage: 'parsing',
      });
    });

    it('polls the active job on step 3 so review can open as soon as one item is ready', async () => {
      setupMocks();
      sessionStorage.setItem('lr_batch_job_id_smart', 'job-live');
      (getJob as Mock)
        .mockResolvedValueOnce({
          id: 'job-live',
          job_type: 'smart_batch',
          status: 'processing',
          config: {},
          nav_hints: { item_count: 1, wizard_furthest_step: 3 },
          items: [
            {
              id: 'item-live',
              job_id: 'job-live',
              file_id: 'file-live',
              sort_order: 0,
              status: 'parsing',
              filename: 'live.pdf',
              file_type: 'pdf',
              has_output: false,
              entity_count: 0,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:01Z',
            },
          ],
        })
        .mockResolvedValue({
          id: 'job-live',
          job_type: 'smart_batch',
          status: 'processing',
          config: {},
          nav_hints: { item_count: 1, wizard_furthest_step: 3 },
          items: [
            {
              id: 'item-live',
              job_id: 'job-live',
              file_id: 'file-live',
              sort_order: 0,
              status: 'awaiting_review',
              filename: 'live.pdf',
              file_type: 'pdf',
              has_output: false,
              entity_count: 9,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:05Z',
            },
          ],
        });
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'live.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      });

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-live&step=3'),
      });

      await waitFor(() => expect(result.current.step).toBe(3));
      await waitFor(() => expect(result.current.rows[0].analyzeStatus).toBe('awaiting_review'));
      expect((getJob as Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(result.current.canGoStep(4)).toBe(true);
    });

    it('uses a short Step3 refresh interval until the first row is reviewable', async () => {
      setupMocks();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      (getJob as Mock).mockResolvedValue({
        id: 'job-fast-first',
        job_type: 'smart_batch',
        status: 'processing',
        config: {},
        nav_hints: { item_count: 1, wizard_furthest_step: 3 },
        items: [
          {
            id: 'item-fast-first',
            job_id: 'job-fast-first',
            file_id: 'file-fast-first',
            sort_order: 0,
            status: 'parsing',
            filename: 'fast.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:01Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'fast.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      });

      try {
        const { result } = renderHook(() => useBatchWizard(), {
          wrapper: wrapperWithRoute('/batch/smart?jobId=job-fast-first&step=3'),
        });

        await waitFor(() => expect(result.current.rows).toHaveLength(1));
        await waitFor(() => {
          expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 250);
        });
      } finally {
        setIntervalSpy.mockRestore();
      }
    });

    it('does not rebuild the Step3 refresh interval for progress-only row updates', async () => {
      setupMocks();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const refresh = deferred<Awaited<ReturnType<typeof getJob>>>();
      const detail = (progressCurrent: number) => ({
        id: 'job-progress-refresh',
        job_type: 'smart_batch',
        status: 'processing',
        config: {},
        nav_hints: { item_count: 1, wizard_furthest_step: 3 },
        items: [
          {
            id: 'item-progress-refresh',
            job_id: 'job-progress-refresh',
            file_id: 'file-progress-refresh',
            sort_order: 0,
            status: 'vision',
            filename: 'progress.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            progress_stage: 'vision',
            progress_current: progressCurrent,
            progress_total: 3,
            progress_message: `Page ${progressCurrent}`,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: `2026-01-01T00:00:0${progressCurrent}Z`,
          },
        ],
      });
      (getJob as Mock).mockResolvedValueOnce(detail(1)).mockReturnValue(refresh.promise);
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'progress.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      });

      try {
        const { result } = renderHook(() => useBatchWizard(), {
          wrapper: wrapperWithRoute('/batch/smart?jobId=job-progress-refresh&step=3'),
        });
        const step3FastIntervalCount = () =>
          setIntervalSpy.mock.calls.filter(([, delay]) => delay === 250).length;

        await waitFor(() => expect(result.current.rows).toHaveLength(1));
        await waitFor(() => expect(step3FastIntervalCount()).toBeGreaterThan(0));
        const intervalCallsBeforeProgress = step3FastIntervalCount();
        await act(async () => {
          refresh.resolve(detail(2) as Awaited<ReturnType<typeof getJob>>);
          await refresh.promise;
        });
        await waitFor(() => expect(result.current.rows[0].recognitionCurrent).toBe(2));
        expect(step3FastIntervalCount()).toBe(intervalCallsBeforeProgress);
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 250);
      } finally {
        setIntervalSpy.mockRestore();
      }
    });
  });

  describe('advanceToUploadStep', () => {
    it('shows warning when config is not confirmed', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));

      await act(async () => {
        await result.current.advanceToUploadStep();
      });

      expect(result.current.step).toBe(1);
      expect(result.current.msg).not.toBeNull();
    });

    it('creates a job and advances to step 2 when config is complete', async () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));

      act(() => result.current.setConfirmStep1(true));
      expect(result.current.isStep1Complete).toBe(true);

      await act(async () => {
        await result.current.advanceToUploadStep();
      });

      expect(createJob).toHaveBeenCalled();
      expect(result.current.step).toBe(2);
      expect(result.current.activeJobId).toBe('new-job-1');
    });

    it('keeps the current job and blocks step 2 when an existing config is locked', async () => {
      setupMocks();
      sessionStorage.setItem('lr_batch_job_id_smart', 'locked-job');
      (updateJobDraft as Mock).mockRejectedValueOnce({ status: 409 });
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));

      act(() => result.current.setConfirmStep1(true));

      await act(async () => {
        await result.current.advanceToUploadStep();
      });

      expect(createJob).not.toHaveBeenCalled();
      expect(result.current.activeJobId).toBe('locked-job');
      expect(result.current.jobConfigLocked).toBe(true);
      expect(result.current.step).toBe(1);
      expect(result.current.msg).toEqual({
        text: 'batchWizard.configLocked',
        tone: 'warn',
      });
    });

    it('does not call createJob in preview mode', async () => {
      setupMocks();
      const previewWrapper = wrapperWithRoute('/batch/smart?preview=1&step=2');
      const { result } = renderHook(() => useBatchWizard(), { wrapper: previewWrapper });
      await waitFor(() => expect(result.current.configLoaded).toBe(true));
      await waitFor(() => expect(result.current.step).toBe(2));

      // In preview mode, step advancement does not create a job
      expect(createJob).not.toHaveBeenCalled();
      expect(result.current.previewMode).toBe(true);
    });
  });

  // ── Review state pass-through ──

  describe('review state', () => {
    it('exposes reviewIndex starting at 0', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.reviewIndex).toBe(0);
    });

    it('exposes reviewEntities starting empty', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.reviewEntities).toEqual([]);
    });

    it('exposes reviewLoading starting false', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.reviewLoading).toBe(false);
    });

    it('exposes pendingReviewCount', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(typeof result.current.pendingReviewCount).toBe('number');
    });
  });

  // ── Export state ──

  describe('export state', () => {
    it('zipLoading starts false', () => {
      setupMocks();
      const { result } = renderHook(() => useBatchWizard(), { wrapper: defaultWrapper });
      expect(result.current.zipLoading).toBe(false);
    });

    it('keeps step 4 when the current file is still unconfirmed before export', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-needs-review',
        job_type: 'smart_batch',
        title: 'Needs review batch',
        status: 'awaiting_review',
        skip_item_review: false,
        config: { wizard_furthest_step: 4 },
        nav_hints: { item_count: 1, wizard_furthest_step: 4 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
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
        },
        items: [
          {
            id: 'item-needs-review',
            job_id: 'job-needs-review',
            file_id: 'file-needs-review',
            sort_order: 0,
            status: 'awaiting_review',
            filename: 'needs-review.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'needs-review.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
      });

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-needs-review&step=4'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      await waitFor(() => expect(result.current.step).toBe(4));
      expect(result.current.allReviewConfirmed).toBe(false);

      await act(async () => {
        await result.current.advanceToExportStep();
      });

      expect(result.current.step).toBe(4);
      expect(result.current.furthestStep).toBeLessThan(5);
      expect(result.current.msg).toEqual({
        text: 'batchWizard.notAllFilesConfirmed',
        tone: 'warn',
      });
    });

    it('keeps review and export inaccessible while later files are still recognizing', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-progressive-export',
        job_type: 'smart_batch',
        title: 'Progressive export batch',
        status: 'processing',
        skip_item_review: false,
        config: { wizard_furthest_step: 4 },
        nav_hints: { item_count: 2, wizard_furthest_step: 4 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: 2,
          pending: 0,
          processing: 1,
          queued: 0,
          parsing: 0,
          ner: 1,
          vision: 0,
          awaiting_review: 0,
          review_approved: 0,
          redacting: 0,
          completed: 1,
          failed: 0,
        },
        items: [
          {
            id: 'item-ready',
            job_id: 'job-progressive-export',
            file_id: 'file-ready',
            sort_order: 0,
            status: 'completed',
            filename: 'ready.pdf',
            file_type: 'pdf',
            has_output: true,
            entity_count: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-active',
            job_id: 'job-progressive-export',
            file_id: 'file-active',
            sort_order: 1,
            status: 'ner',
            filename: 'active.pdf',
            file_type: 'pdf',
            has_output: false,
            entity_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockImplementation(async (fileId: string) => ({
        original_filename: fileId === 'file-ready' ? 'ready.pdf' : 'active.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
        output_path: fileId === 'file-ready' ? '/redacted/ready.pdf' : null,
      }));

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-progressive-export&step=4'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(2));
      await waitFor(() => expect(result.current.step).toBe(3));
      expect(result.current.allReviewConfirmed).toBe(true);
      expect(result.current.canAdvanceToExport).toBe(false);
      expect(result.current.canGoStep(4)).toBe(false);
      expect(result.current.step).toBe(3);
      expect(result.current.furthestStep).toBeLessThan(5);
    });

    it('blocks export when the current review draft cannot be saved', async () => {
      setupMocks();
      (getJob as Mock).mockResolvedValue({
        id: 'job-draft-fail',
        job_type: 'smart_batch',
        title: 'Draft fail batch',
        status: 'completed',
        skip_item_review: false,
        config: { wizard_furthest_step: 4 },
        nav_hints: { item_count: 1, wizard_furthest_step: 4 },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        progress: {
          total_items: 1,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: 0,
          review_approved: 0,
          redacting: 0,
          completed: 1,
          failed: 0,
        },
        items: [
          {
            id: 'item-ready',
            job_id: 'job-draft-fail',
            file_id: 'file-ready',
            sort_order: 0,
            status: 'completed',
            filename: 'ready.pdf',
            file_type: 'pdf',
            has_output: true,
            entity_count: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      (batchGetFileRaw as Mock).mockResolvedValue({
        original_filename: 'ready.pdf',
        file_type: 'pdf',
        file_size: 100,
        created_at: '2026-01-01T00:00:00Z',
        output_path: '/redacted/ready.pdf',
      });
      (putItemReviewDraft as Mock).mockRejectedValueOnce(new Error('save failed'));

      const { result } = renderHook(() => useBatchWizard(), {
        wrapper: wrapperWithRoute('/batch/smart?jobId=job-draft-fail&step=4'),
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      await waitFor(() => expect(result.current.step).toBe(4));
      const getJobCallsAfterHydration = (getJob as Mock).mock.calls.length;

      act(() => {
        result.current.setVisibleReviewBoxes([
          {
            id: 'box-1',
            x: 0.1,
            y: 0.1,
            width: 0.2,
            height: 0.2,
            page: 1,
            type: 'ocr_1',
            selected: true,
            source: 'manual',
          },
        ]);
      });

      await act(async () => {
        await result.current.advanceToExportStep();
      });

      expect(putItemReviewDraft).toHaveBeenCalledWith(
        'job-draft-fail',
        'item-ready',
        expect.objectContaining({
          bounding_boxes: expect.arrayContaining([expect.objectContaining({ id: 'box-1' })]),
        }),
      );
      expect((getJob as Mock).mock.calls.length).toBe(getJobCallsAfterHydration);
      expect(result.current.step).toBe(4);
      expect(result.current.msg).toEqual({
        text: 'batchWizard.reviewSaveBeforeExportFailed',
        tone: 'err',
      });
    });
  });
});
