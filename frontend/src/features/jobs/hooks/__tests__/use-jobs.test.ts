// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { JOBS_LIST_POLL_MS } from '@/constants/timing';
import { useI18n } from '@/i18n';
import { listJobs, type JobProgress, type JobSummary } from '@/services/jobsApi';
import { buildProgressSummary, hasRefreshableJobWork, useJobs } from '../use-jobs';

vi.mock('@/services/jobsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/jobsApi')>();
  return {
    ...actual,
    listJobs: vi.fn(),
  };
});

function progress(overrides: Partial<JobProgress>): JobProgress {
  return {
    total_items: 4,
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
    failed: 0,
    cancelled: 0,
    ...overrides,
  };
}

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  const baseProgress = progress({ total_items: 1, completed: 1 });
  return {
    id: 'job-1',
    job_type: 'smart_batch',
    title: 'Batch job',
    status: 'completed',
    skip_item_review: false,
    config: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    progress: baseProgress,
    nav_hints: { item_count: 1 },
    ...overrides,
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

describe('buildProgressSummary', () => {
  it('counts backend processing items as active recognition work', () => {
    useI18n.setState({ locale: 'zh' });

    expect(buildProgressSummary(progress({ pending: 3, processing: 1 }), 4, 0)).toContain(
      '识别中 1',
    );
  });
});

describe('hasRefreshableJobWork', () => {
  it('keeps awaiting-review jobs refreshable while backend work is still running', () => {
    expect(
      hasRefreshableJobWork(
        job({
          status: 'awaiting_review',
          progress: progress({ total_items: 4, awaiting_review: 1, processing: 1 }),
        }),
      ),
    ).toBe(true);
    expect(
      hasRefreshableJobWork(
        job({
          status: 'awaiting_review',
          progress: progress({ total_items: 1, awaiting_review: 1 }),
        }),
      ),
    ).toBe(false);
  });
});

describe('useJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not reload just because the first response populated rows', async () => {
    (listJobs as Mock).mockResolvedValue({
      jobs: [job()],
      total: 1,
      page: 1,
      page_size: 10,
    });

    const { result } = renderHook(() => useJobs());

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listJobs).toHaveBeenCalledTimes(1);
  });

  it('reuses cache for first paint to avoid initial loading skeletons', async () => {
    const cacheKey = 'jobs:list-cache:v1:all:1:10';
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        capturedAt: Date.now(),
        tab: 'all',
        page: 1,
        pageSize: 10,
        total: 1,
        jobs: [job()],
      }),
    );
    (listJobs as Mock).mockResolvedValue({
      jobs: [job({ id: 'job-cache' })],
      total: 1,
      page: 1,
      page_size: 10,
    });

    const { result } = renderHook(() => useJobs());

    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toHaveLength(1);

    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));
  });

  it('refreshes cached data silently without showing hard errors', async () => {
    const cacheKey = 'jobs:list-cache:v1:all:1:10';
    const cached = job({ id: 'job-cache' });
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        capturedAt: Date.now(),
        tab: 'all',
        page: 1,
        pageSize: 10,
        total: 1,
        jobs: [cached],
      }),
    );
    (listJobs as Mock).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useJobs());

    expect(result.current.loading).toBe(false);
    expect(result.current.tableLoading).toBe(false);
    await waitFor(() => expect(listJobs).toHaveBeenCalled());
    await waitFor(() => expect(result.current.err).toBeNull());
    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-cache'));
    expect(result.current.loading).toBe(false);
    expect(result.current.tableLoading).toBe(false);
  });

  it('uses stale cache for first paint but still reports refresh errors', async () => {
    const cacheKey = 'jobs:list-cache:v1:all:1:10';
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        capturedAt: Date.now() - 31_000,
        tab: 'all',
        page: 1,
        pageSize: 10,
        total: 1,
        jobs: [job({ id: 'job-stale-cache' })],
      }),
    );
    (listJobs as Mock).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useJobs());

    expect(result.current.loading).toBe(false);
    expect(result.current.rows[0]?.id).toBe('job-stale-cache');
    await waitFor(() => expect(listJobs).toHaveBeenCalled());
    await waitFor(() => expect(result.current.err).not.toBeNull());
    expect(result.current.rows[0]?.id).toBe('job-stale-cache');
  });

  it('hydrates the target page from cache before refreshing it silently', async () => {
    (listJobs as Mock).mockResolvedValueOnce({
      jobs: [job({ id: 'job-page-1' })],
      total: 25,
      page: 1,
      page_size: 10,
    });
    window.localStorage.setItem(
      'jobs:list-cache:v1:all:2:10',
      JSON.stringify({
        capturedAt: Date.now(),
        tab: 'all',
        page: 2,
        pageSize: 10,
        total: 25,
        jobs: [job({ id: 'job-page-2-cache' })],
      }),
    );
    const pageRequest = deferred<{
      jobs: JobSummary[];
      total: number;
      page: number;
      page_size: number;
    }>();
    (listJobs as Mock).mockReturnValueOnce(pageRequest.promise);

    const { result } = renderHook(() => useJobs());

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-page-1'));

    act(() => {
      result.current.goPage(2);
    });

    expect(result.current.rows[0]?.id).toBe('job-page-2-cache');
    expect(result.current.page).toBe(2);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.tableLoading).toBe(false);

    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(2));

    await act(async () => {
      pageRequest.resolve({
        jobs: [job({ id: 'job-page-2-live' })],
        total: 25,
        page: 2,
        page_size: 10,
      });
      await pageRequest.promise;
    });

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-page-2-live'));
  });

  it('keeps the previous page visible when the next page has no cache', async () => {
    (listJobs as Mock).mockResolvedValueOnce({
      jobs: [job({ id: 'job-page-1' })],
      total: 25,
      page: 1,
      page_size: 10,
    });
    const pageRequest = deferred<{
      jobs: JobSummary[];
      total: number;
      page: number;
      page_size: number;
    }>();
    (listJobs as Mock).mockReturnValueOnce(pageRequest.promise);

    const { result } = renderHook(() => useJobs());

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-page-1'));

    act(() => {
      result.current.goPage(2);
    });

    expect(result.current.page).toBe(2);
    expect(result.current.rows[0]?.id).toBe('job-page-1');
    expect(result.current.refreshing).toBe(true);
    expect(result.current.tableLoading).toBe(true);

    await act(async () => {
      pageRequest.resolve({
        jobs: [job({ id: 'job-page-2-live' })],
        total: 25,
        page: 2,
        page_size: 10,
      });
      await pageRequest.promise;
    });

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-page-2-live'));
  });

  it('ignores stale page responses after rapid pagination', async () => {
    (listJobs as Mock).mockResolvedValueOnce({
      jobs: [job({ id: 'job-page-1' })],
      total: 35,
      page: 1,
      page_size: 10,
    });
    const pageTwoRequest = deferred<{
      jobs: JobSummary[];
      total: number;
      page: number;
      page_size: number;
    }>();
    const pageThreeRequest = deferred<{
      jobs: JobSummary[];
      total: number;
      page: number;
      page_size: number;
    }>();
    (listJobs as Mock).mockReturnValueOnce(pageTwoRequest.promise);
    (listJobs as Mock).mockReturnValueOnce(pageThreeRequest.promise);

    const { result } = renderHook(() => useJobs());

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-page-1'));

    act(() => {
      result.current.goPage(2);
    });
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.goPage(3);
    });
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(3));

    await act(async () => {
      pageThreeRequest.resolve({
        jobs: [job({ id: 'job-page-3-live' })],
        total: 35,
        page: 3,
        page_size: 10,
      });
      await pageThreeRequest.promise;
    });

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-page-3-live'));
    expect(result.current.page).toBe(3);

    await act(async () => {
      pageTwoRequest.resolve({
        jobs: [job({ id: 'job-page-2-stale' })],
        total: 35,
        page: 2,
        page_size: 10,
      });
      await pageTwoRequest.promise;
    });

    expect(result.current.page).toBe(3);
    expect(result.current.rows[0]?.id).toBe('job-page-3-live');
    expect(result.current.tableLoading).toBe(false);
  });

  it('keeps the displayed row density stable while a new page size loads', async () => {
    (listJobs as Mock).mockResolvedValueOnce({
      jobs: [job({ id: 'job-page-size-10' })],
      total: 120,
      page: 1,
      page_size: 10,
    });
    const pageSizeRequest = deferred<{
      jobs: JobSummary[];
      total: number;
      page: number;
      page_size: number;
    }>();
    (listJobs as Mock).mockReturnValueOnce(pageSizeRequest.promise);

    const { result } = renderHook(() => useJobs());

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-page-size-10'));
    expect(result.current.rowsPageSize).toBe(10);

    act(() => {
      result.current.changePageSize(20);
    });

    expect(result.current.pageSize).toBe(20);
    expect(result.current.rowsPageSize).toBe(10);
    expect(result.current.rows[0]?.id).toBe('job-page-size-10');
    expect(result.current.refreshing).toBe(true);
    expect(result.current.tableLoading).toBe(true);

    await act(async () => {
      pageSizeRequest.resolve({
        jobs: [job({ id: 'job-page-size-20' })],
        total: 120,
        page: 1,
        page_size: 20,
      });
      await pageSizeRequest.promise;
    });

    await waitFor(() => expect(result.current.rows[0]?.id).toBe('job-page-size-20'));
    expect(result.current.rowsPageSize).toBe(20);
    expect(result.current.tableLoading).toBe(false);
  });

  it('waits for the active interval before polling active jobs again', async () => {
    vi.useFakeTimers();
    (listJobs as Mock).mockResolvedValue({
      jobs: [job({ status: 'running', progress: progress({ total_items: 4, processing: 1 }) })],
      total: 1,
      page: 1,
      page_size: 10,
    });

    renderHook(() => useJobs());

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(listJobs).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(JOBS_LIST_POLL_MS - 1);
    });
    expect(listJobs).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(listJobs).toHaveBeenCalledTimes(2);
  });

  it('polls awaiting-review jobs while other items are still recognizing in the background', async () => {
    vi.useFakeTimers();
    (listJobs as Mock).mockResolvedValue({
      jobs: [
        job({
          status: 'awaiting_review',
          progress: progress({ total_items: 4, awaiting_review: 1, processing: 1 }),
        }),
      ],
      total: 1,
      page: 1,
      page_size: 10,
    });

    renderHook(() => useJobs());

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(listJobs).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(JOBS_LIST_POLL_MS);
    });

    expect(listJobs).toHaveBeenCalledTimes(2);
  });
});
