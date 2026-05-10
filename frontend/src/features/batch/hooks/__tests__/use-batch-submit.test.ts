// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileType } from '@/types';
import { fileApi, getBatchZipManifest } from '@/services/api';
import type { BatchWizardPersistedConfig } from '@/services/batchPipeline';
import { commitItemReview, getJob, submitJob, updateJobDraft } from '@/services/jobsApi';
import type { BatchRow } from '../../types';
import { useBatchSubmit } from '../use-batch-submit';

vi.mock('@/i18n', () => ({ t: (k: string) => k }));

vi.mock('@/utils/localizeError', () => ({
  localizeErrorMessage: (_e: unknown, key: string) => key,
}));

vi.mock('@/services/api', () => ({
  fileApi: {
    batchDownloadZip: vi.fn(),
  },
  getBatchZipManifest: vi.fn(),
}));

vi.mock('@/services/jobsApi', () => ({
  submitJob: vi.fn(),
  commitItemReview: vi.fn(),
  getJob: vi.fn(),
  requeueFailed: vi.fn(),
  updateJobDraft: vi.fn(),
}));

const baseConfig: BatchWizardPersistedConfig = {
  selectedEntityTypeIds: [],
  ocrHasTypes: [],
  hasImageTypes: [],
  replacementMode: 'structured',
};

function row(fileId: string, hasOutput: boolean): BatchRow {
  return {
    file_id: fileId,
    original_filename: `${fileId}.pdf`,
    file_size: 100,
    file_type: FileType.PDF,
    has_output: hasOutput,
    entity_count: 0,
    analyzeStatus: hasOutput ? 'completed' : 'awaiting_review',
    reviewConfirmed: hasOutput,
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

function renderSubmit(
  rows: BatchRow[],
  selected = new Set(rows.map((r) => r.file_id)),
  setJobConfigLocked = vi.fn(),
) {
  const setMsg = vi.fn();
  const hook = renderHook(() =>
    useBatchSubmit(
      'smart',
      'job-1',
      false,
      baseConfig,
      5,
      rows,
      vi.fn(),
      selected,
      setMsg,
      vi.fn(),
      [],
      rows[0] ?? null,
      vi.fn(),
      rows,
      [],
      [],
      null,
      vi.fn().mockResolvedValue(true),
      { current: '' },
      { current: false },
      vi.fn(),
      { current: {} },
      { current: '' },
      setJobConfigLocked,
    ),
  );
  return { ...hook, setMsg, setJobConfigLocked };
}

function renderSubmitStateful({
  initialRows,
  reviewEntities = [],
  reviewBoxes = [],
  flushCurrentReviewDraft = vi.fn().mockResolvedValue(true),
}: {
  initialRows: BatchRow[];
  reviewEntities?: Parameters<typeof useBatchSubmit>[14];
  reviewBoxes?: Parameters<typeof useBatchSubmit>[15];
  flushCurrentReviewDraft?: () => Promise<boolean>;
}) {
  const setMsg = vi.fn();
  const setReviewExecuteLoading = vi.fn();
  const setReviewIndex = vi.fn();
  const setFurthestStep = vi.fn();
  const hook = renderHook(() => {
    const [stateRows, setRows] = useState(initialRows);
    const reviewLastSavedJsonRef = useRef('');
    const reviewDraftDirtyRef = useRef(false);
    const itemIdByFileIdRef = useRef<Record<string, string>>({ file: 'item-1', other: 'item-2' });
    const lastSavedJobConfigJson = useRef('');
    return {
      rows: stateRows,
      setRows,
      setReviewExecuteLoading,
      setReviewIndex,
      state: useBatchSubmit(
        'smart',
        'job-1',
        false,
        baseConfig,
        4,
        stateRows,
        setRows,
        new Set(stateRows.map((r) => r.file_id)),
        setMsg,
        setFurthestStep,
        [],
        stateRows[0] ?? null,
        setReviewIndex,
        stateRows,
        reviewEntities,
        reviewBoxes,
        null,
        flushCurrentReviewDraft,
        reviewLastSavedJsonRef,
        reviewDraftDirtyRef,
        setReviewExecuteLoading,
        itemIdByFileIdRef,
        lastSavedJobConfigJson,
      ),
    };
  });
  return { ...hook, setMsg, setReviewExecuteLoading, setReviewIndex, setFurthestStep };
}

describe('useBatchSubmit downloadZip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:zip'),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(fileApi.batchDownloadZip).mockResolvedValue(new Blob(['zip']));
    vi.mocked(getBatchZipManifest).mockReturnValue({
      requested_count: 2,
      included_count: 1,
      skipped_count: 1,
      redacted: true,
      skipped: [{ file_id: 'pending', reason: 'missing_redacted_output' }],
    });
  });

  it('blocks redacted ZIP for an active job when selected files include unfinished files', async () => {
    const { result, setMsg } = renderSubmit([row('ready', true), row('pending', false)]);

    await act(async () => {
      await result.current.downloadZip(true);
    });

    expect(fileApi.batchDownloadZip).not.toHaveBeenCalled();
    expect(setMsg).toHaveBeenLastCalledWith({
      text: 'batchWizard.someFilesNotRedacted',
      tone: 'warn',
    });
  });

  it('passes the active job id when downloading a ready redacted ZIP', async () => {
    const { result } = renderSubmit([row('ready', true)]);

    await act(async () => {
      await result.current.downloadZip(true);
    });

    expect(fileApi.batchDownloadZip).toHaveBeenCalledWith(['ready'], true, 'job-1');
  });

  it('blocks redacted ZIP when none of the selected files has output', async () => {
    const { result, setMsg } = renderSubmit([row('pending-a', false), row('pending-b', false)]);

    await act(async () => {
      await result.current.downloadZip(true);
    });

    expect(fileApi.batchDownloadZip).not.toHaveBeenCalled();
    expect(setMsg).toHaveBeenCalledWith({
      text: 'batchWizard.someFilesNotRedacted',
      tone: 'warn',
    });
  });
});

describe('useBatchSubmit submitQueueToWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateJobDraft).mockResolvedValue({} as Awaited<ReturnType<typeof updateJobDraft>>);
    vi.mocked(submitJob).mockResolvedValue({} as Awaited<ReturnType<typeof submitJob>>);
  });

  it('saves the final config before submitting the job', async () => {
    const { result, setJobConfigLocked } = renderSubmit([row('pending', false)]);

    await act(async () => {
      await result.current.submitQueueToWorker();
    });

    expect(updateJobDraft).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ config: expect.any(Object) }),
    );
    expect(submitJob).toHaveBeenCalledWith('job-1');
    expect(setJobConfigLocked).toHaveBeenCalledWith(true);
  });

  it('does not submit when the backend reports the job config is locked', async () => {
    vi.mocked(updateJobDraft).mockRejectedValueOnce({ status: 409 });
    const { result, setMsg } = renderSubmit([row('pending', false)]);

    await act(async () => {
      await result.current.submitQueueToWorker();
    });

    expect(submitJob).not.toHaveBeenCalled();
    expect(result.current.zipLoading).toBe(false);
    expect(setMsg).toHaveBeenLastCalledWith({
      text: 'batchWizard.configLocked',
      tone: 'warn',
    });
  });

  it('updates rows from a first-reviewable job poll before submit returns', async () => {
    vi.useFakeTimers();
    const submit = deferred<Awaited<ReturnType<typeof submitJob>>>();
    vi.mocked(submitJob).mockReturnValue(submit.promise);
    vi.mocked(getJob).mockResolvedValue({
      id: 'job-1',
      job_type: 'smart_batch',
      title: 'Batch',
      status: 'processing',
      skip_item_review: false,
      config: {},
      created_at: '2026-05-06T00:00:00Z',
      updated_at: '2026-05-06T00:00:01Z',
      progress: {
        total_items: 2,
        pending: 1,
        processing: 1,
        queued: 0,
        parsing: 0,
        ner: 0,
        vision: 1,
        awaiting_review: 1,
        review_approved: 0,
        redacting: 0,
        completed: 0,
        failed: 0,
      },
      items: [
        {
          id: 'item-file',
          job_id: 'job-1',
          file_id: 'file',
          sort_order: 0,
          status: 'awaiting_review',
          filename: 'file.pdf',
          file_type: 'pdf',
          has_output: false,
          entity_count: 7,
          created_at: '2026-05-06T00:00:00Z',
          updated_at: '2026-05-06T00:00:01Z',
        },
        {
          id: 'item-other',
          job_id: 'job-1',
          file_id: 'other',
          sort_order: 1,
          status: 'vision',
          filename: 'other.pdf',
          file_type: 'pdf',
          has_output: false,
          entity_count: 0,
          created_at: '2026-05-06T00:00:00Z',
          updated_at: '2026-05-06T00:00:01Z',
        },
      ],
    });
    const pendingRows = [
      { ...row('file', false), analyzeStatus: 'pending' as const, reviewConfirmed: false },
      { ...row('other', false), analyzeStatus: 'pending' as const, reviewConfirmed: false },
    ];
    try {
      const { result } = renderSubmitStateful({ initialRows: pendingRows });

      let submitPromise!: Promise<void>;
      await act(async () => {
        submitPromise = result.current.state.submitQueueToWorker();
        await Promise.resolve();
      });

      expect(submitJob).toHaveBeenCalledWith('job-1');
      expect(getJob).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
        await Promise.resolve();
      });

      expect(result.current.rows[0].analyzeStatus).toBe('awaiting_review');
      expect(getJob).toHaveBeenCalled();
      expect(submitJob).toHaveBeenCalledBefore(vi.mocked(getJob));
      expect(result.current.rows[0]).toMatchObject({
        entity_count: 7,
        reviewConfirmed: false,
      });
      expect(result.current.rows[1]).toMatchObject({
        analyzeStatus: 'analyzing',
      });

      await act(async () => {
        submit.resolve({} as Awaited<ReturnType<typeof submitJob>>);
        await submitPromise;
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps first-reviewable polling when the API returns only unrelated reviewable items', async () => {
    vi.useFakeTimers();
    try {
      const submit = deferred<Awaited<ReturnType<typeof submitJob>>>();
      vi.mocked(submitJob).mockReturnValue(submit.promise);
      const baseJob = {
        id: 'job-1',
        job_type: 'smart_batch' as const,
        title: 'Batch',
        status: 'processing',
        skip_item_review: false,
        config: {},
        created_at: '2026-05-06T00:00:00Z',
        updated_at: '2026-05-06T00:00:01Z',
        progress: {
          total_items: 1,
          pending: 0,
          processing: 1,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 1,
          awaiting_review: 0,
          review_approved: 0,
          redacting: 0,
          completed: 0,
          failed: 0,
        },
      };
      vi.mocked(getJob)
        .mockResolvedValueOnce({
          ...baseJob,
          items: [
            {
              id: 'item-unrelated',
              job_id: 'job-1',
              file_id: 'unrelated',
              sort_order: 0,
              status: 'awaiting_review',
              filename: 'old.pdf',
              file_type: 'pdf',
              has_output: false,
              entity_count: 9,
              created_at: '2026-05-06T00:00:00Z',
              updated_at: '2026-05-06T00:00:01Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          ...baseJob,
          progress: { ...baseJob.progress, awaiting_review: 1, vision: 0 },
          items: [
            {
              id: 'item-file',
              job_id: 'job-1',
              file_id: 'file',
              sort_order: 0,
              status: 'awaiting_review',
              filename: 'file.pdf',
              file_type: 'pdf',
              has_output: false,
              entity_count: 7,
              created_at: '2026-05-06T00:00:00Z',
              updated_at: '2026-05-06T00:00:02Z',
            },
          ],
        });
      const pendingRows = [
        { ...row('file', false), analyzeStatus: 'pending' as const, reviewConfirmed: false },
      ];
      const { result } = renderSubmitStateful({ initialRows: pendingRows });

      let submitPromise!: Promise<void>;
      await act(async () => {
        submitPromise = result.current.state.submitQueueToWorker();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.rows[0].analyzeStatus).toBe('pending');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
        await Promise.resolve();
      });

      expect(result.current.rows[0].analyzeStatus).toBe('pending');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();
      });

      expect(result.current.rows[0].analyzeStatus).toBe('awaiting_review');
      expect(result.current.rows[0]).toMatchObject({ entity_count: 7 });

      await act(async () => {
        submit.resolve({} as Awaited<ReturnType<typeof submitJob>>);
        await submitPromise;
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useBatchSubmit confirmCurrentReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a submitting state before commit resolves and applies the commit result without a job refresh', async () => {
    const commit = deferred<Awaited<ReturnType<typeof commitItemReview>>>();
    vi.mocked(commitItemReview).mockReturnValue(commit.promise);
    const { result } = renderSubmitStateful({
      initialRows: [row('file', false), row('other', false)],
      reviewEntities: [
        {
          id: 'entity-1',
          text: 'Alice',
          type: 'PERSON',
          start: 0,
          end: 5,
          selected: true,
        },
      ],
    });

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.state.confirmCurrentReview();
      await Promise.resolve();
    });

    expect(result.current.rows[0]).toMatchObject({
      analyzeStatus: 'redacting',
      has_output: false,
      reviewConfirmed: false,
    });

    await act(async () => {
      commit.resolve({
        id: 'item-1',
        job_id: 'job-1',
        file_id: 'file',
        sort_order: 0,
        status: 'completed',
        filename: 'file.pdf',
        has_output: true,
        entity_count: 1,
        created_at: '2026-05-05T00:00:00Z',
        updated_at: '2026-05-05T00:00:01Z',
      });
      await pending;
    });

    expect(getJob).not.toHaveBeenCalled();
    expect(result.current.rows[0]).toMatchObject({
      analyzeStatus: 'completed',
      has_output: true,
      reviewConfirmed: true,
      entity_count: 1,
    });
    expect(result.current.rows[1]).toMatchObject({
      analyzeStatus: 'awaiting_review',
      has_output: false,
      reviewConfirmed: false,
    });
  });

  it('keeps the confirmed row count aligned with the edited selected entities', async () => {
    vi.mocked(commitItemReview).mockResolvedValue({
      id: 'item-1',
      job_id: 'job-1',
      file_id: 'file',
      sort_order: 0,
      status: 'completed',
      filename: 'file.pdf',
      has_output: true,
      entity_count: 99,
      created_at: '2026-05-05T00:00:00Z',
      updated_at: '2026-05-05T00:00:01Z',
    });
    const { result } = renderSubmitStateful({
      initialRows: [row('file', false)],
      reviewEntities: [
        { id: 'entity-1', text: 'Alice', type: 'PERSON', start: 0, end: 5, selected: true },
        { id: 'entity-2', text: 'Bob', type: 'PERSON', start: 8, end: 11, selected: false },
        { id: 'entity-3', text: 'Acme', type: 'ORG', start: 14, end: 18, selected: true },
      ],
    });

    await act(async () => {
      await result.current.state.confirmCurrentReview();
    });

    expect(result.current.rows[0]).toMatchObject({
      analyzeStatus: 'completed',
      has_output: true,
      reviewConfirmed: true,
      entity_count: 2,
    });
  });

  it('preserves background reviewability changes that arrive while confirming another file', async () => {
    const commit = deferred<Awaited<ReturnType<typeof commitItemReview>>>();
    vi.mocked(commitItemReview).mockReturnValue(commit.promise);
    const otherPending = { ...row('other', false), analyzeStatus: 'pending' as const };
    const { result } = renderSubmitStateful({
      initialRows: [row('file', false), otherPending],
    });

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.state.confirmCurrentReview();
      await Promise.resolve();
    });

    act(() => {
      result.current.setRows((prev) =>
        prev.map((item) =>
          item.file_id === 'other'
            ? { ...item, analyzeStatus: 'awaiting_review' as const, entity_count: 3 }
            : item,
        ),
      );
    });

    await act(async () => {
      commit.resolve({
        id: 'item-1',
        job_id: 'job-1',
        file_id: 'file',
        sort_order: 0,
        status: 'completed',
        filename: 'file.pdf',
        has_output: true,
        entity_count: 1,
        created_at: '2026-05-05T00:00:00Z',
        updated_at: '2026-05-05T00:00:01Z',
      });
      await pending;
    });

    expect(result.current.rows[0]).toMatchObject({
      analyzeStatus: 'completed',
      has_output: true,
      reviewConfirmed: true,
    });
    expect(result.current.rows[1]).toMatchObject({
      analyzeStatus: 'awaiting_review',
      has_output: false,
      reviewConfirmed: false,
      entity_count: 3,
    });
  });

  it('does not unlock export when the committed current item is still awaiting review', async () => {
    vi.mocked(commitItemReview).mockResolvedValue({
      id: 'item-1',
      job_id: 'job-1',
      file_id: 'file',
      sort_order: 0,
      status: 'awaiting_review',
      filename: 'file.pdf',
      has_output: false,
      entity_count: 1,
      created_at: '2026-05-05T00:00:00Z',
      updated_at: '2026-05-05T00:00:01Z',
    });
    const { result, setReviewIndex, setFurthestStep } = renderSubmitStateful({
      initialRows: [row('file', false)],
    });

    await act(async () => {
      await result.current.state.confirmCurrentReview();
    });

    expect(result.current.rows[0]).toMatchObject({
      analyzeStatus: 'awaiting_review',
      has_output: false,
      reviewConfirmed: false,
    });
    expect(setReviewIndex).toHaveBeenCalledWith(0);
    expect(setFurthestStep).not.toHaveBeenCalled();
  });

  it('does not show a completed row when commit fails', async () => {
    vi.mocked(commitItemReview).mockRejectedValue(new Error('redaction failed'));
    const { result, setMsg } = renderSubmitStateful({
      initialRows: [row('file', false)],
    });

    await act(async () => {
      await result.current.state.confirmCurrentReview();
    });

    expect(getJob).not.toHaveBeenCalled();
    expect(result.current.rows[0]).toMatchObject({
      analyzeStatus: 'awaiting_review',
      has_output: false,
      reviewConfirmed: false,
    });
    expect(setMsg).toHaveBeenLastCalledWith({
      text: 'batchWizard.actionFailed',
      tone: 'err',
    });
  });
});
