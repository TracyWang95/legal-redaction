// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { JobsTable } from '../jobs-table';
import type { JobSummary } from '@/services/jobsApi';

vi.mock('@/i18n', () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
  useI18n: {
    getState: () => ({ locale: 'en' }),
  },
}));

function makeJob(overrides: Partial<JobSummary>): JobSummary {
  return {
    id: 'job-base',
    job_type: 'smart_batch',
    title: 'Demo Job',
    status: 'processing',
    skip_item_review: false,
    config: {
      preferred_execution: 'queue',
    },
    created_at: '2026-05-02T10:00:00Z',
    updated_at: '2026-05-02T10:00:00Z',
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
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
    nav_hints: {
      item_count: 2,
    },
    ...overrides,
  };
}

function renderTable(rows: JobSummary[]) {
  return renderTableWithOptions(rows);
}

function renderTableWithOptions(
  rows: JobSummary[],
  options: {
    loading?: boolean;
    refreshing?: boolean;
    tableLoading?: boolean;
    pageSize?: number;
  } = {},
) {
  return render(
    <MemoryRouter>
      <JobsTable
        rows={rows}
        loading={options.loading ?? false}
        refreshing={options.refreshing ?? false}
        tableLoading={options.tableLoading}
        total={rows.length}
        page={1}
        pageSize={options.pageSize ?? 10}
        totalPages={1}
        expandedJobIds={new Set()}
        jobDetails={{}}
        detailLoadingIds={new Set()}
        deletingJobId={null}
        requeueingJobId={null}
        tableBusy={false}
        onToggleExpand={vi.fn()}
        onDelete={vi.fn()}
        onRequeueFailed={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function expectedRowHeight(pageSize: number): number {
  const safePageSize = Math.min(Math.max(Math.round(pageSize), 10), 20);
  return 600 / safePageSize;
}

describe('JobsTable result visibility', () => {
  it('splits processing task counts from the progress percentage', () => {
    renderTable([
      makeJob({
        id: 'job-processing',
        status: 'processing',
        progress: {
          total_items: 4,
          pending: 0,
          processing: 3,
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
        nav_hints: {
          item_count: 4,
        },
      }),
    ]);

    expect(screen.getByTestId('job-total-count-job-processing')).toHaveTextContent('4');
    expect(screen.getByTestId('job-completed-count-job-processing')).toHaveTextContent('0');
    expect(screen.getByTestId('job-awaiting-review-count-job-processing')).toHaveTextContent('0');
    expect(screen.getByTestId('job-progress-state-job-processing')).toHaveTextContent('0%');
    expect(screen.queryByTestId('job-result-state-job-processing')).not.toBeInTheDocument();
  });

  it('shows awaiting-review work in its own count column', () => {
    renderTable([
      makeJob({
        id: 'job-await-review',
        status: 'completed',
        progress: {
          total_items: 3,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: 2,
          review_approved: 1,
          redacting: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
        nav_hints: {
          item_count: 3,
        },
      }),
    ]);

    expect(screen.getByTestId('job-total-count-job-await-review')).toHaveTextContent('3');
    expect(screen.getByTestId('job-awaiting-review-count-job-await-review')).toHaveTextContent(
      '3',
    );
    expect(screen.getByTestId('job-progress-state-job-await-review')).toHaveTextContent('100%');
  });

  it('shows completion without repeating export readiness in status text', () => {
    renderTable([
      makeJob({
        id: 'job-completed-export',
        status: 'completed',
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
          completed: 2,
          failed: 0,
          cancelled: 0,
        },
        nav_hints: {
          item_count: 2,
        },
      }),
    ]);

    const state = screen.getByTestId('job-progress-state-job-completed-export');
    expect(screen.getByTestId('job-total-count-job-completed-export')).toHaveTextContent('2');
    expect(screen.getByTestId('job-completed-count-job-completed-export')).toHaveTextContent('2');
    expect(state).toHaveTextContent('100%');
    expect(state).not.toHaveTextContent('common.export');
    expect(screen.queryByTestId('job-result-state-job-completed-export')).not.toBeInTheDocument();
  });

  it('keeps task rows to detail, review, and delete actions only', () => {
    renderTable([
      makeJob({
        id: 'job-actions',
        status: 'processing',
        progress: {
          total_items: 3,
          pending: 0,
          processing: 2,
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
        nav_hints: {
          item_count: 3,
        },
      }),
    ]);

    expect(screen.getByTestId('job-detail-link-job-actions')).toBeInTheDocument();
    expect(screen.getByTestId('job-delete-disabled-job-actions')).toBeInTheDocument();
    expect(screen.queryByTestId('job-expand-job-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-workbench-job-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('job-requeue-job-actions')).not.toBeInTheDocument();
  });

  it('shows a subtle overlay while table refreshes in-place', () => {
    const { container } = renderTableWithOptions(
      [
        makeJob({
          id: 'job-refreshing',
          status: 'completed',
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
            completed: 2,
            failed: 0,
            cancelled: 0,
          },
          nav_hints: {
            item_count: 2,
          },
        }),
      ],
      { refreshing: true },
    );

    expect(screen.queryByTestId('jobs-table-refresh-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('jobs-table-surface')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('job-row-job-refreshing')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('keeps the internal refresh indicator hidden during page changes', () => {
    renderTableWithOptions([makeJob({ id: 'job-page-change' })], { tableLoading: true });

    expect(screen.queryByTestId('jobs-table-refresh-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('jobs-table-surface')).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps existing rows mounted if loading is raised with cached data', () => {
    renderTableWithOptions([makeJob({ id: 'job-cached-loading' })], { loading: true });

    expect(screen.queryByTestId('jobs-table-refresh-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('jobs-table-surface')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('job-row-job-cached-loading')).toBeInTheDocument();
    expect(screen.queryByText('jobs.noRecords')).not.toBeInTheDocument();
  });

  it('keeps the table surface visible during the first load', () => {
    renderTableWithOptions([], { loading: true });

    expect(screen.getByText('jobs.taskRecords')).toBeInTheDocument();
    expect(screen.getByText('jobs.task')).toBeInTheDocument();
    expect(screen.queryByText('jobs.noRecords')).not.toBeInTheDocument();
  });

  it('keeps the table body in a stable flex scroll region', () => {
    renderTableWithOptions([makeJob({ id: 'job-stable-body' })]);

    expect(screen.getByTestId('jobs-table-surface')).toHaveClass(
      'flex',
      'min-h-0',
      'flex-1',
      'flex-col',
      'overflow-hidden',
    );
    expect(screen.getByTestId('jobs-table-body')).toHaveClass(
      'jobs-table-body',
      'flex-1',
      'overflow-x-auto',
      'overflow-y-auto',
    );
    expect(screen.getByTestId('jobs-table-body')).toHaveStyle({
      height: '0px',
      minHeight: '0px',
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
    });
    expect(screen.queryByTestId('jobs-pagination-slot')).not.toBeInTheDocument();
  });

  it('centers the empty state in the same stable scroll body', () => {
    renderTableWithOptions([], { loading: false });

    expect(screen.getByTestId('jobs-table-body')).toHaveClass(
      'flex-1',
      'overflow-x-auto',
      'overflow-y-auto',
    );
    expect(screen.getByTestId('jobs-table-body')).toHaveStyle({
      height: '0px',
      minHeight: '0px',
    });
    expect(screen.getByTestId('jobs-table-empty')).toHaveClass(
      'min-h-full',
      'items-center',
      'justify-center',
    );
    expect(screen.getByTestId('jobs-table-empty')).toHaveTextContent('jobs.noRecords');
  });

  it('uses aria-busy for initial and in-place loading states', () => {
    const { rerender } = render(
      <MemoryRouter>
        <JobsTable
          rows={[]}
          loading
          refreshing={false}
          total={0}
          page={1}
          pageSize={10}
          totalPages={1}
          expandedJobIds={new Set()}
          jobDetails={{}}
          detailLoadingIds={new Set()}
          deletingJobId={null}
          requeueingJobId={null}
          tableBusy
          onToggleExpand={vi.fn()}
          onDelete={vi.fn()}
          onRequeueFailed={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('jobs-table-surface')).toHaveAttribute('aria-busy', 'true');

    rerender(
      <MemoryRouter>
        <JobsTable
          rows={[makeJob({ id: 'job-loaded' })]}
          loading={false}
          refreshing={false}
          tableLoading={false}
          total={1}
          page={1}
          pageSize={10}
          totalPages={1}
          expandedJobIds={new Set()}
          jobDetails={{}}
          detailLoadingIds={new Set()}
          deletingJobId={null}
          requeueingJobId={null}
          tableBusy={false}
          onToggleExpand={vi.fn()}
          onDelete={vi.fn()}
          onRequeueFailed={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('jobs-table-surface')).toHaveAttribute('aria-busy', 'false');
  });

  it('keeps page-size row density stable and tightens from 20 rows upward', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <JobsTable
          rows={[makeJob({ id: 'job-density' })]}
          loading={false}
          refreshing={false}
          total={1}
          page={1}
          pageSize={10}
          totalPages={1}
          expandedJobIds={new Set()}
          jobDetails={{}}
          detailLoadingIds={new Set()}
          deletingJobId={null}
          requeueingJobId={null}
          tableBusy={false}
          onToggleExpand={vi.fn()}
          onDelete={vi.fn()}
          onRequeueFailed={vi.fn()}
        />
      </MemoryRouter>,
    );
    const rowElement10 = container.querySelector('.jobs-row-main') as HTMLElement;
    expect(rowElement10).not.toBeNull();
    expect(parseFloat(rowElement10.style.height)).toBeCloseTo(expectedRowHeight(10), 3);

    rerender(
      <MemoryRouter>
        <JobsTable
          rows={[makeJob({ id: 'job-density' })]}
          loading={false}
          refreshing={false}
          total={1}
          page={1}
          pageSize={20}
          totalPages={1}
          expandedJobIds={new Set()}
          jobDetails={{}}
          detailLoadingIds={new Set()}
          deletingJobId={null}
          requeueingJobId={null}
          tableBusy={false}
          onToggleExpand={vi.fn()}
          onDelete={vi.fn()}
          onRequeueFailed={vi.fn()}
        />
      </MemoryRouter>,
    );

    const rowElement20 = container.querySelector('.jobs-row-main') as HTMLElement;
    expect(rowElement20).not.toBeNull();
    expect(parseFloat(rowElement20.style.height)).toBeCloseTo(expectedRowHeight(20), 3);

    expect(screen.getByTestId('jobs-table-body')).toHaveStyle({
      height: '0px',
      minHeight: '0px',
    });
  });

  it('keeps the body height stable for 10 and 20 rows', () => {
    const { rerender } = renderTableWithOptions([makeJob({ id: 'job-height' })], {
      pageSize: 10,
    });

    expect(screen.getByTestId('jobs-table-body')).toHaveStyle({
      minHeight: '0px',
    });

    rerender(
      <MemoryRouter>
        <JobsTable
          rows={[makeJob({ id: 'job-height' })]}
          loading={false}
          refreshing={false}
          tableLoading={false}
          total={1}
          page={1}
          pageSize={20}
          totalPages={1}
          expandedJobIds={new Set()}
          jobDetails={{}}
          detailLoadingIds={new Set()}
          deletingJobId={null}
          requeueingJobId={null}
          tableBusy={false}
          onToggleExpand={vi.fn()}
          onDelete={vi.fn()}
          onRequeueFailed={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('jobs-table-body')).toHaveStyle({
      minHeight: '0px',
    });
  });

  it('scales first-load skeleton rows with the largest page size', () => {
    const { container } = renderTableWithOptions([], { loading: true, pageSize: 20 });

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(20);
  });
});
