// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, type Mock, beforeEach } from 'vitest';
import { listJobs, type JobSummary } from '@/services/jobsApi';
import { useBatchHub } from '../use-batch-hub';

vi.mock('@/services/jobsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/jobsApi')>();
  return {
    ...actual,
    listJobs: vi.fn(),
  };
});

function makeJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: 'job-1',
    job_type: 'smart_batch',
    title: 'Demo',
    status: 'queued',
    skip_item_review: false,
    config: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    progress: {
      total_items: 1,
      pending: 0,
      processing: 0,
      queued: 1,
      parsing: 0,
      ner: 0,
      vision: 0,
      awaiting_review: 0,
      review_approved: 0,
      redacting: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
    nav_hints: { item_count: 1 },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useBatchHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('loads and filters active jobs for the recent list', async () => {
    const active = makeJob({ id: 'active', status: 'running' });
    const idle = makeJob({ id: 'idle', status: 'completed' });
    (listJobs as Mock).mockResolvedValue({
      jobs: [idle, active],
      total: 2,
      page: 1,
      page_size: 20,
    });

    const { result } = renderHook(() => useBatchHub(), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });

    await waitFor(() => expect(result.current.activeJobs).toHaveLength(1));
    expect(result.current.loading).toBe(false);
    expect(result.current.activeJobs[0].id).toBe('active');
    expect(listJobs).toHaveBeenCalledWith({ page: 1, page_size: 20 });
  });

  it('restores cached jobs immediately and then refreshes silently', async () => {
    const cached = makeJob({
      id: 'cached',
      status: 'processing',
      updated_at: '2026-01-01T00:00:03Z',
    });
    window.localStorage.setItem(
      'batch-hub:active-jobs:v1',
      JSON.stringify({
        capturedAt: Date.now(),
        jobs: [cached],
      }),
    );

    const fresh = makeJob({ id: 'fresh', status: 'running', updated_at: '2026-01-01T00:00:04Z' });
    const request = deferred<{
      jobs: JobSummary[];
      total: number;
      page: number;
      page_size: number;
    }>();
    (listJobs as Mock).mockReturnValue(request.promise);

    const { result } = renderHook(() => useBatchHub(), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.tableLoading).toBe(false);
    expect(result.current.activeJobs[0]?.id).toBe('cached');

    request.resolve({
      jobs: [fresh],
      total: 1,
      page: 1,
      page_size: 20,
    });

    await waitFor(() => expect(result.current.activeJobs[0]?.id).toBe('fresh'));
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(1));
  });

  it('keeps cached rows when silent refresh fails', async () => {
    const cached = makeJob({
      id: 'cached',
      status: 'redacting',
      updated_at: '2026-01-01T00:00:03Z',
    });
    window.localStorage.setItem(
      'batch-hub:active-jobs:v1',
      JSON.stringify({
        capturedAt: Date.now(),
        jobs: [cached],
      }),
    );

    (listJobs as Mock).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useBatchHub(), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });

    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.activeJobs[0]?.id).toBe('cached'));
    expect(result.current.jobsUnavailable).toBe(false);
  });
});
