// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HISTORY_ACTIVE_POLL_MS, HISTORY_EMPTY_RESULT_POLL_MS } from '@/constants/timing';
import { fileApi } from '@/services/api';
import { FileType, type FileListItem } from '@/types';
import { PAGE_SIZE_OPTIONS, useHistory } from '../use-history';

vi.mock('@/services/api', () => ({
  fileApi: {
    list: vi.fn(),
    getInfo: vi.fn(),
    getDownloadUrl: vi.fn(),
    batchDownloadZip: vi.fn(),
    delete: vi.fn(),
  },
  getBatchZipManifest: vi.fn(),
  redactionApi: {
    getComparison: vi.fn(),
  },
}));

vi.mock('@/services/api-client', () => ({
  authFetch: vi.fn(),
  authenticatedBlobUrl: vi.fn(),
  downloadFile: vi.fn(),
  revokeObjectUrl: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  showToast: vi.fn(),
}));

function file(overrides: Partial<FileListItem> = {}): FileListItem {
  return {
    file_id: 'file-1',
    original_filename: 'demo.docx',
    file_size: 123,
    file_type: FileType.DOCX,
    created_at: '2026-01-01T00:00:00Z',
    has_output: true,
    entity_count: 1,
    ...overrides,
  };
}

function listResponse(files: FileListItem[] = []) {
  return {
    files,
    total: files.length,
    page: 1,
    page_size: 10,
  };
}

function pagedListResponse(files: FileListItem[], total: number, page: number, pageSize = 10) {
  return {
    files,
    total,
    page,
    page_size: pageSize,
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

function wrapperFor(initialEntry: string) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

async function flushHookUpdates() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useHistory loading and polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers compact large-page options that match the table density scale', () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 20]);
  });

  it('loads immediately from batch route params', async () => {
    (fileApi.list as Mock).mockResolvedValue(listResponse());

    renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history?source=batch&jobId=job-1'),
    });

    await waitFor(() =>
      expect(fileApi.list).toHaveBeenCalledWith(1, 10, {
        source: 'batch',
        embed_job: true,
        job_id: 'job-1',
      }),
    );
  });

  it('restores cached rows for first render and keeps initial loading false', async () => {
    const cacheKey = 'history:list-cache:v1:all:_none_:1:10';
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        capturedAt: Date.now(),
        source: 'all',
        jobId: null,
        page: 1,
        page_size: 10,
        total: 1,
        files: [file()],
      }),
    );
    (fileApi.list as Mock).mockResolvedValue(listResponse([file({ file_id: 'cached-file' })]));

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    expect(result.current.initialLoading).toBe(false);
    expect(result.current.rows).toHaveLength(1);
    await waitFor(() => expect(fileApi.list).toHaveBeenCalled());
  });

  it('keeps cached rows on silent refresh failures', async () => {
    const cacheKey = 'history:list-cache:v1:all:_none_:1:10';
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        capturedAt: Date.now(),
        source: 'all',
        jobId: null,
        page: 1,
        page_size: 10,
        total: 1,
        files: [file({ file_id: 'cached-file' })],
      }),
    );
    (fileApi.list as Mock).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    expect(result.current.initialLoading).toBe(false);
    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('cached-file'));
    expect(result.current.msg).toBeNull();
  });

  it('uses stale cache for first render but still reports load errors', async () => {
    const cacheKey = 'history:list-cache:v1:all:_none_:1:10';
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        capturedAt: Date.now() - 31_000,
        source: 'all',
        jobId: null,
        page: 1,
        page_size: 10,
        total: 1,
        files: [file({ file_id: 'stale-file' })],
      }),
    );
    (fileApi.list as Mock).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    expect(result.current.initialLoading).toBe(false);
    expect(result.current.rows[0]?.file_id).toBe('stale-file');
    await waitFor(() => expect(fileApi.list).toHaveBeenCalled());
    await waitFor(() => expect(result.current.msg?.tone).toBe('err'));
    expect(result.current.rows[0]?.file_id).toBe('stale-file');
  });

  it('shows cached target page immediately while page load is in flight', async () => {
    (fileApi.list as Mock).mockResolvedValueOnce(
      pagedListResponse([file({ file_id: 'page-1-file' })], 25, 1),
    );
    window.localStorage.setItem(
      'history:list-cache:v1:all:_none_:2:10',
      JSON.stringify({
        capturedAt: Date.now(),
        source: 'all',
        jobId: null,
        page: 2,
        page_size: 10,
        total: 25,
        files: [file({ file_id: 'page-2-cache' })],
      }),
    );
    const pageRequest = deferred<ReturnType<typeof pagedListResponse>>();
    (fileApi.list as Mock).mockReturnValueOnce(pageRequest.promise);

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-1-file'));

    act(() => {
      result.current.goPage(2);
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-2-cache'));
    expect(result.current.page).toBe(2);

    await act(async () => {
      pageRequest.resolve(pagedListResponse([file({ file_id: 'page-2-live' })], 25, 2));
      await pageRequest.promise;
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-2-live'));
  });

  it('loads once when changing source tabs through URL params', async () => {
    (fileApi.list as Mock)
      .mockResolvedValueOnce(listResponse([file({ file_id: 'all-file' })]))
      .mockResolvedValueOnce(listResponse([file({ file_id: 'batch-file' })]));

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('all-file'));
    expect(fileApi.list).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.changeSourceTab('batch');
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('batch-file'));
    expect(fileApi.list).toHaveBeenCalledTimes(2);
    expect(fileApi.list).toHaveBeenLastCalledWith(1, 10, {
      source: 'batch',
      embed_job: true,
      job_id: undefined,
    });
  });

  it('does not reload when selecting the current source tab', async () => {
    (fileApi.list as Mock).mockResolvedValueOnce(listResponse([file({ file_id: 'all-file' })]));

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('all-file'));
    expect(fileApi.list).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.changeSourceTab('all');
    });

    await flushHookUpdates();
    expect(fileApi.list).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous page visible when the next page has no cache', async () => {
    (fileApi.list as Mock).mockResolvedValueOnce(
      pagedListResponse([file({ file_id: 'page-1-file' })], 25, 1),
    );
    const pageRequest = deferred<ReturnType<typeof pagedListResponse>>();
    (fileApi.list as Mock).mockReturnValueOnce(pageRequest.promise);

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-1-file'));

    act(() => {
      result.current.goPage(2);
    });

    expect(result.current.page).toBe(2);
    expect(result.current.rows[0]?.file_id).toBe('page-1-file');

    await act(async () => {
      pageRequest.resolve(pagedListResponse([file({ file_id: 'page-2-live' })], 25, 2));
      await pageRequest.promise;
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-2-live'));
  });

  it('ignores stale history responses after rapid pagination', async () => {
    (fileApi.list as Mock).mockResolvedValueOnce(
      pagedListResponse([file({ file_id: 'page-1-file' })], 35, 1),
    );
    const pageTwoRequest = deferred<ReturnType<typeof pagedListResponse>>();
    const pageThreeRequest = deferred<ReturnType<typeof pagedListResponse>>();
    (fileApi.list as Mock).mockReturnValueOnce(pageTwoRequest.promise);
    (fileApi.list as Mock).mockReturnValueOnce(pageThreeRequest.promise);

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-1-file'));

    act(() => {
      result.current.goPage(2);
    });
    await waitFor(() => expect(fileApi.list).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.goPage(3);
    });
    await waitFor(() => expect(fileApi.list).toHaveBeenCalledTimes(3));

    await act(async () => {
      pageThreeRequest.resolve(pagedListResponse([file({ file_id: 'page-3-live' })], 35, 3));
      await pageThreeRequest.promise;
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-3-live'));
    expect(result.current.page).toBe(3);

    await act(async () => {
      pageTwoRequest.resolve(pagedListResponse([file({ file_id: 'page-2-stale' })], 35, 2));
      await pageTwoRequest.promise;
    });

    expect(result.current.page).toBe(3);
    expect(result.current.rows[0]?.file_id).toBe('page-3-live');
    expect(result.current.tableLoading).toBe(false);
  });

  it('updates row density immediately while a page-size change is loading', async () => {
    (fileApi.list as Mock).mockResolvedValueOnce(
      pagedListResponse([file({ file_id: 'page-1-file' })], 25, 1, 10),
    );
    const pageSizeRequest = deferred<ReturnType<typeof pagedListResponse>>();
    (fileApi.list as Mock).mockReturnValueOnce(pageSizeRequest.promise);

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-1-file'));
    expect(result.current.pageSize).toBe(10);
    expect(result.current.displayPageSize).toBe(10);

    act(() => {
      result.current.changePageSize(20);
    });

    expect(result.current.pageSize).toBe(20);
    expect(result.current.displayPageSize).toBe(20);
    expect(result.current.rows[0]?.file_id).toBe('page-1-file');
    await waitFor(() => expect(result.current.tableLoading).toBe(true));

    await act(async () => {
      pageSizeRequest.resolve(pagedListResponse([file({ file_id: 'page-size-live' })], 25, 1, 20));
      await pageSizeRequest.promise;
    });

    await waitFor(() => expect(result.current.rows[0]?.file_id).toBe('page-size-live'));
    expect(result.current.displayPageSize).toBe(20);
    expect(result.current.tableLoading).toBe(false);
  });

  it('polls a visible batch history page without waiting for manual refresh', async () => {
    vi.useFakeTimers();
    (fileApi.list as Mock).mockResolvedValue(listResponse([file()]));

    renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history?source=batch'),
    });

    await flushHookUpdates();
    expect(fileApi.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HISTORY_ACTIVE_POLL_MS);
    });

    expect(fileApi.list).toHaveBeenCalledTimes(2);
  });

  it('uses a short first retry for empty batch result pages', async () => {
    vi.useFakeTimers();
    (fileApi.list as Mock)
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce(listResponse([file({ file_id: 'new-result' })]));

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history?source=batch'),
    });

    await flushHookUpdates();
    expect(fileApi.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HISTORY_EMPTY_RESULT_POLL_MS);
    });

    await flushHookUpdates();
    expect(result.current.rows[0]?.file_id).toBe('new-result');
    expect(fileApi.list).toHaveBeenCalledTimes(2);
  });

  it('polls while visible rows still have active item statuses', async () => {
    vi.useFakeTimers();
    (fileApi.list as Mock).mockResolvedValue(
      listResponse([file({ has_output: false, item_status: 'processing' })]),
    );

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await flushHookUpdates();
    expect(result.current.rows[0]?.item_status).toBe('processing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HISTORY_ACTIVE_POLL_MS);
    });

    expect(fileApi.list).toHaveBeenCalledTimes(2);
  });

  it('keeps polling briefly after an active row completes so output can settle', async () => {
    vi.useFakeTimers();
    (fileApi.list as Mock)
      .mockResolvedValueOnce(listResponse([file({ has_output: false, item_status: 'processing' })]))
      .mockResolvedValueOnce(listResponse([file({ has_output: false, item_status: 'completed' })]))
      .mockResolvedValueOnce(listResponse([file({ has_output: true, item_status: 'completed' })]));

    renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await flushHookUpdates();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HISTORY_ACTIVE_POLL_MS);
    });
    await flushHookUpdates();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HISTORY_ACTIVE_POLL_MS);
    });

    expect(fileApi.list).toHaveBeenCalledTimes(3);
  });

  it('does not poll a static all-history page', async () => {
    vi.useFakeTimers();
    (fileApi.list as Mock).mockResolvedValue(
      listResponse([file({ has_output: true, item_status: 'completed' })]),
    );

    renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await flushHookUpdates();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HISTORY_ACTIVE_POLL_MS);
    });

    expect(fileApi.list).toHaveBeenCalledTimes(1);
  });

  it('keeps current selection across refreshes when the row remains visible', async () => {
    (fileApi.list as Mock).mockResolvedValue(listResponse([file({ file_id: 'file-1' })]));

    const { result } = renderHook(() => useHistory(), {
      wrapper: wrapperFor('/history'),
    });

    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => {
      result.current.toggle('file-1');
    });

    expect(result.current.selected.has('file-1')).toBe(true);

    await act(async () => {
      await result.current.load(true);
    });

    expect(result.current.selected.has('file-1')).toBe(true);
  });
});
