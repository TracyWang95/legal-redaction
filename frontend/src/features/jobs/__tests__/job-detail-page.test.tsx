// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@/test-utils';
import { JOB_DETAIL_POLL_ACTIVE_MS, JOB_DETAIL_POLL_IDLE_MS } from '@/constants/timing';
import type { JobDetail, JobSummary } from '@/services/jobsApi';
import { JobDetailPage } from '../job-detail-page';

const navigateMock = vi.hoisted(() => vi.fn());
const jobsApiMocks = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  deleteJob: vi.fn(),
  getJob: vi.fn(),
  requeueFailed: vi.fn(),
  submitJob: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ jobId: 'job-1' }),
  };
});

vi.mock('@/i18n', () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));

vi.mock('@/services/jobsApi', () => jobsApiMocks);

vi.mock('@/utils/localizeError', () => ({
  localizeErrorMessage: (_error: unknown, fallbackKey: string) => fallbackKey,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeJob(patch: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 'job-1',
    job_type: 'smart_batch',
    title: 'Job 1',
    status: 'draft',
    skip_item_review: false,
    config: {},
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
      cancelled: 0,
    },
    items: [
      {
        id: 'item-1',
        job_id: 'job-1',
        file_id: 'file-1',
        sort_order: 1,
        status: 'pending',
        filename: 'a.pdf',
        file_type: 'pdf',
        has_output: false,
        entity_count: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    ...patch,
  };
}

function makeSummary(patch: Partial<JobSummary> = {}): JobSummary {
  const job = makeJob(patch);
  const { items: _items, ...summary } = job;
  return summary;
}

describe('JobDetailPage actions', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    jobsApiMocks.cancelJob.mockReset();
    jobsApiMocks.deleteJob.mockReset();
    jobsApiMocks.getJob.mockReset();
    jobsApiMocks.requeueFailed.mockReset();
    jobsApiMocks.submitJob.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a pending submit state and destructive failure feedback', async () => {
    const submit = deferred<JobSummary>();
    jobsApiMocks.getJob.mockResolvedValue(makeJob());
    jobsApiMocks.submitJob.mockReturnValue(submit.promise);

    render(<JobDetailPage />);

    await screen.findByTestId('job-detail-page');
    fireEvent.click(screen.getByRole('button', { name: 'jobDetail.submitQueue' }));

    expect(screen.getByRole('button', { name: 'jobDetail.submitting' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'jobDetail.cancelTask' })).toBeDisabled();

    submit.reject(new Error('failed'));

    await waitFor(() =>
      expect(screen.getByTestId('job-detail-action-alert')).toHaveTextContent(
        'jobDetail.submitFailed',
      ),
    );
    expect(screen.getByTestId('job-detail-action-alert')).toHaveClass('text-destructive');
    expect(screen.getByRole('button', { name: 'jobDetail.submitQueue' })).not.toBeDisabled();
  });

  it('locks sibling actions while failed items are being re-queued', async () => {
    const requeue = deferred<JobSummary>();
    jobsApiMocks.getJob.mockResolvedValue(
      makeJob({
        status: 'failed',
        progress: {
          ...makeJob().progress,
          failed: 2,
          pending: 0,
        },
      }),
    );
    jobsApiMocks.requeueFailed.mockReturnValue(requeue.promise);

    render(<JobDetailPage />);

    await screen.findByTestId('job-detail-page');
    fireEvent.click(screen.getByRole('button', { name: 'jobDetail.requeueFailed.btn' }));

    expect(screen.getByRole('button', { name: 'jobDetail.requeueing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'jobDetail.deleteTask' })).toBeDisabled();

    requeue.resolve(makeSummary({ status: 'queued' }));

    await waitFor(() =>
      expect(screen.getByTestId('job-detail-action-alert')).toHaveTextContent(
        'jobDetail.requeuedSuccess',
      ),
    );
    expect(screen.getByTestId('job-detail-action-alert')).not.toHaveClass('text-destructive');
  });

  it('groups failed items into recovery actions with concrete destinations', async () => {
    jobsApiMocks.getJob.mockResolvedValue(
      makeJob({
        status: 'failed',
        progress: {
          ...makeJob().progress,
          pending: 0,
          awaiting_review: 1,
          failed: 2,
        },
        nav_hints: {
          item_count: 3,
          first_awaiting_review_item_id: 'item-review',
          awaiting_review_count: 1,
        },
        items: [
          {
            id: 'item-ocr',
            job_id: 'job-1',
            file_id: 'file-ocr',
            sort_order: 1,
            status: 'failed',
            filename: 'scan.pdf',
            file_type: 'pdf_scanned',
            error_message: 'OCR service timeout',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-ner',
            job_id: 'job-1',
            file_id: 'file-ner',
            sort_order: 2,
            status: 'failed',
            filename: 'contract.docx',
            file_type: 'docx',
            error_message: 'HaS NER request failed',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'item-review',
            job_id: 'job-1',
            file_id: 'file-review',
            sort_order: 3,
            status: 'awaiting_review',
            filename: 'ready.pdf',
            file_type: 'pdf',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );

    render(<JobDetailPage />);

    await screen.findByTestId('job-recovery-panel');

    expect(screen.getByTestId('job-recovery-panel')).toHaveTextContent('jobDetail.recovery.desc');
    expect(screen.getByTestId('job-recovery-action-vision_model')).toHaveTextContent('scan.pdf');
    expect(screen.getByTestId('job-recovery-action-text_model')).toHaveTextContent(
      'contract.docx',
    );
    expect(
      screen.getByTestId('job-recovery-action-vision_model').querySelector('a'),
    ).toHaveAttribute('href', '/model-settings/vision');
    expect(screen.getByTestId('job-recovery-action-text_model').querySelector('a')).toHaveAttribute(
      'href',
      '/model-settings/text',
    );
    expect(screen.getByTestId('job-recovery-partial-review').querySelector('a')).toHaveAttribute(
      'href',
      '/batch/smart?jobId=job-1&step=4&itemId=item-review',
    );
  });

  it('keeps the current detail visible when a background refresh fails', async () => {
    jobsApiMocks.getJob
      .mockResolvedValueOnce(makeJob({ status: 'queued', title: 'Still visible' }))
      .mockRejectedValueOnce(new Error('offline'));

    render(<JobDetailPage />);

    await screen.findByTestId('job-detail-page');
    expect(screen.getAllByText('Still visible')).toHaveLength(2);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(await screen.findByTestId('job-detail-page')).toBeInTheDocument();
    expect(screen.getAllByText('Still visible')).toHaveLength(2);
    expect(screen.queryByText('jobDetail.loadFailed')).not.toBeInTheDocument();
  });

  it('polls processing jobs faster than queued jobs', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    jobsApiMocks.getJob.mockResolvedValueOnce(makeJob({ status: 'processing' }));

    const { unmount } = render(<JobDetailPage />);
    await screen.findByTestId('job-detail-page');

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), JOB_DETAIL_POLL_ACTIVE_MS);
    expect(JOB_DETAIL_POLL_ACTIVE_MS).toBeLessThan(JOB_DETAIL_POLL_IDLE_MS);

    unmount();
    intervalSpy.mockClear();
    jobsApiMocks.getJob.mockResolvedValueOnce(makeJob({ status: 'queued' }));

    render(<JobDetailPage />);
    await screen.findByTestId('job-detail-page');

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), JOB_DETAIL_POLL_IDLE_MS);
  });
});
