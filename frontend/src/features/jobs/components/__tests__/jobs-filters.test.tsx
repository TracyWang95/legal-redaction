// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JobsFilters } from '../jobs-filters';

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => key,
}));

function renderFilters() {
  const onRefresh = vi.fn();
  render(
    <JobsFilters
      onRefresh={onRefresh}
      onCleanup={vi.fn()}
      refreshing={false}
      tableBusy={false}
      metrics={{
        totalJobs: 341,
        activeJobs: 2,
        awaitingReviewItems: 9,
        completedItems: 112,
        riskItems: 5,
      }}
    />,
  );
  return { onRefresh };
}

describe('JobsFilters', () => {
  it('keeps key actions and metrics in the compact filter surface', () => {
    const { onRefresh } = renderFilters();

    expect(screen.getByText('jobs.filters.title')).toBeInTheDocument();
    expect(screen.getByText('jobs.metric.totalJobs')).toBeInTheDocument();
    expect(screen.getByText('jobs.metric.awaitingReviewFiles')).toBeInTheDocument();
    expect(screen.getByText('341')).toBeInTheDocument();
    expect(screen.getByTestId('jobs-refresh-btn')).toHaveClass('min-w-[7.5rem]');

    fireEvent.click(screen.getByTestId('jobs-refresh-btn'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
