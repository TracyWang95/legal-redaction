// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test-utils';
import { History } from '../index';

const useHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/use-history', () => ({
  PAGE_SIZE_OPTIONS: [10, 20],
  useHistory: useHistoryMock,
}));

vi.mock('../components/history-filters', () => ({
  HistoryFilters: () => <div data-testid="history-filters" />,
  HistoryFilterMenu: () => <div data-testid="history-filter-menu-inline" />,
}));

vi.mock('../components/history-table', () => ({
  HistoryTable: () => <div data-testid="history-table" />,
}));

function baseHistoryState(patch: Record<string, unknown> = {}) {
  return {
    sourceTab: 'all',
    changeSourceTab: vi.fn(),
    dateFilter: 'all',
    setDateFilter: vi.fn(),
    fileTypeFilter: 'all',
    setFileTypeFilter: vi.fn(),
    statusFilter: 'all',
    setStatusFilter: vi.fn(),
    hasActiveFilter: false,
    clearFilters: vi.fn(),
    load: vi.fn(),
    setCleanupConfirmOpen: vi.fn(),
    downloadZip: vi.fn(),
    refreshing: false,
    tableLoading: false,
    initialLoading: false,
    zipLoading: false,
    interactionLocked: false,
    selectedIds: [],
    msg: null,
    filteredRows: [],
    selected: new Set<string>(),
    toggle: vi.fn(),
    allSelected: false,
    setSelected: vi.fn(),
    downloadRow: vi.fn(),
    remove: vi.fn(),
    openCompareModal: vi.fn(),
    total: 0,
    totalPages: 1,
    page: 1,
    pageSize: 10,
    displayPageSize: 10,
    goPage: vi.fn(),
    changePageSize: vi.fn(),
    compareOpen: true,
    closeCompareModal: vi.fn(),
    compareLoading: false,
    compareErr: null,
    compareData: {
      original_content: 'before',
      redacted_content: 'after',
    },
    compareBlobUrls: null,
    compareTotalPages: 1,
    comparePage: 1,
    setComparePage: vi.fn(),
    cleanupConfirmOpen: false,
    handleCleanup: vi.fn(),
    confirmDlg: null,
    setConfirmDlg: vi.fn(),
    ...patch,
  };
}

describe('History page compare dialog', () => {
  it('keeps the compact pagination rail mounted when the list is empty', () => {
    useHistoryMock.mockReturnValue(baseHistoryState({ compareOpen: false }));

    render(<History />);

    expect(screen.getByTestId('pagination-rail')).toHaveTextContent('1 / 1');
    expect(screen.getByTestId('pagination-rail')).toHaveClass(
      'history-pagination-rail',
      'jobs-pagination-rail',
    );
  });

  it('stacks text comparison panes on small screens and keeps desktop split view', () => {
    useHistoryMock.mockReturnValue(baseHistoryState());

    render(<History />);

    expect(screen.getByTestId('history-text-compare-grid')).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-2',
    );
  });

  it('stacks image comparison panes on small screens and keeps desktop split view', () => {
    useHistoryMock.mockReturnValue(
      baseHistoryState({
        compareBlobUrls: {
          original: 'blob:original',
          redacted: 'blob:redacted',
        },
      }),
    );

    render(<History />);

    expect(screen.getByTestId('history-image-compare-grid')).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-2',
    );
  });
});
