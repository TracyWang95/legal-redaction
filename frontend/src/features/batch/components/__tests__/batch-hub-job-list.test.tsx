// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test-utils';
import { BatchHubJobList } from '../batch-hub-job-list';
import type { JobSummary } from '@/services/jobsApi';

vi.mock('@/i18n', () => ({
  t: (key: string) => key,
  useT: () => (key: string) => (key === 'batchHub.moreActiveJobs' ? '{n} more active jobs' : key),
}));

const baseProgress = {
  total_items: 0,
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
};

function createJob(id: string): JobSummary {
  return {
    id,
    job_type: 'smart_batch',
    title: `Batch ${id}`,
    status: 'draft',
    skip_item_review: false,
    config: {},
    created_at: '2026-05-05T00:00:00.000Z',
    updated_at: '2026-05-05T00:00:00.000Z',
    progress: baseProgress,
    nav_hints: {
      item_count: 0,
    },
  };
}

describe('BatchHubJobList', () => {
  it('uses row-shaped loading placeholders so the recent list height does not jump', () => {
    render(<BatchHubJobList jobs={[]} loading onContinue={vi.fn()} />);

    expect(screen.getByTestId('recent-jobs-loading-skeleton')).toHaveClass('min-h-[12rem]');
    expect(screen.getAllByTestId('recent-jobs-loading-row')).toHaveLength(4);
  });

  it('keeps the hub compact by showing four jobs and routing overflow to Jobs', () => {
    render(
      <BatchHubJobList
        jobs={[
          createJob('one'),
          createJob('two'),
          createJob('three'),
          createJob('four'),
          createJob('five'),
        ]}
        loading={false}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByTestId('job-row-one')).toBeInTheDocument();
    expect(screen.getByTestId('job-row-two')).toBeInTheDocument();
    expect(screen.getByTestId('job-row-three')).toBeInTheDocument();
    expect(screen.getByTestId('job-row-four')).toBeInTheDocument();
    expect(screen.queryByTestId('job-row-five')).not.toBeInTheDocument();
    expect(screen.getByText('1 more active jobs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /batchHub.viewAll/ })).toHaveAttribute('href', '/jobs');
  });

  it('keeps existing jobs mounted under an accessible refresh overlay', () => {
    render(
      <BatchHubJobList
        jobs={[createJob('one')]}
        loading={false}
        tableLoading
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByTestId('job-row-one')).toBeInTheDocument();
    expect(screen.getByTestId('recent-jobs-list-frame')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('recent-jobs-refresh-overlay')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('recent-jobs-refresh-overlay')).toHaveAttribute(
      'aria-label',
      'jobs.refreshing',
    );
  });

  it('does not swap existing jobs for skeletons when loading is raised with cached rows', () => {
    render(
      <BatchHubJobList
        jobs={[createJob('cached')]}
        loading
        tableLoading={false}
        onContinue={vi.fn()}
      />,
    );

    expect(screen.getByTestId('job-row-cached')).toBeInTheDocument();
    expect(screen.getByTestId('recent-jobs-refresh-overlay')).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('recent-jobs-loading-skeleton')).not.toBeInTheDocument();
  });
});
