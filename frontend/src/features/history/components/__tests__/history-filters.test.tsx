// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryFilters } from '../history-filters';

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => key,
}));

function renderFilters(
  options: { zipLoading?: boolean; hasSelection?: boolean; refreshing?: boolean } = {},
) {
  render(
    <HistoryFilters
      sourceTab="all"
      onSourceTabChange={vi.fn()}
      dateFilter="all"
      onDateFilterChange={vi.fn()}
      fileTypeFilter="all"
      onFileTypeFilterChange={vi.fn()}
      statusFilter="all"
      onStatusFilterChange={vi.fn()}
      hasActiveFilter={false}
      onClearFilters={vi.fn()}
      onRefresh={vi.fn()}
      onCleanup={vi.fn()}
      onDownloadOriginal={vi.fn()}
      onDownloadRedacted={vi.fn()}
      refreshing={options.refreshing ?? false}
      loading={false}
      zipLoading={options.zipLoading ?? false}
      hasSelection={options.hasSelection ?? true}
      metrics={{
        totalFiles: 24,
        redactedFiles: 18,
        awaitingReviewFiles: 3,
        entitySum: 120,
        sizeLabel: '4.2 MB',
      }}
    />,
  );
}

describe('HistoryFilters', () => {
  it('keeps export busy state on existing buttons without adding a duplicate status', () => {
    renderFilters({ zipLoading: true });

    expect(screen.queryByTestId('history-zip-status')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('download-original-zip')).queryByText('history.packing'),
    ).toBeNull();
    expect(
      within(screen.getByTestId('download-redacted-zip')).queryByText('history.packing'),
    ).toBeNull();
    expect(screen.getByTestId('download-original-zip')).toHaveTextContent(
      'history.downloadOriginalZipShort',
    );
    expect(screen.getByTestId('download-redacted-zip')).toHaveTextContent(
      'history.downloadRedactedZipShort',
    );
    expect(screen.getByTestId('download-original-zip')).toHaveAttribute(
      'aria-label',
      'history.downloadOriginalZip',
    );
    expect(screen.getByTestId('download-redacted-zip')).toHaveAttribute(
      'aria-label',
      'history.downloadRedactedZip',
    );
    expect(screen.getByTestId('download-original-zip')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('download-redacted-zip')).toHaveAttribute('aria-busy', 'true');
  });

  it('uses the shared refreshing label while the list is refreshing', () => {
    renderFilters({ refreshing: true });

    expect(screen.getByTestId('history-refresh')).toHaveTextContent('jobs.refreshing');
    expect(screen.getByTestId('history-refresh')).not.toHaveTextContent('history.refresh');
  });

  it('keeps delivery metrics and filters in a single console-style row', () => {
    renderFilters();

    expect(screen.getByText('history.filters.title')).toBeInTheDocument();
    expect(screen.getByText('history.metric.total')).toBeInTheDocument();
    expect(screen.getByText('history.metric.redacted')).toBeInTheDocument();
    expect(screen.getByText('history.metric.awaitingReview')).toBeInTheDocument();
    expect(screen.getByText('history.metric.entities')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByTestId('history-source-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('history-date-filter')).toBeInTheDocument();
    expect(screen.getByTestId('history-type-filter')).toBeInTheDocument();
    expect(screen.getByTestId('history-status-filter')).toBeInTheDocument();
  });
});
