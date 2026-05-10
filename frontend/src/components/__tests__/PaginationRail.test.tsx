// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaginationRail } from '../PaginationRail';

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => {
    if (key === 'jobs.showRange') return '{start}-{end} / {total}';
    if (key === 'jobs.perPage') return 'per page';
    if (key === 'jobs.itemsUnit') return 'items';
    return key;
  },
}));

describe('PaginationRail stable layout', () => {
  it('does not mount for empty totals unless a stable empty slot is requested', () => {
    const { rerender } = render(
      <PaginationRail
        page={1}
        pageSize={10}
        totalItems={0}
        totalPages={1}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('pagination-rail')).not.toBeInTheDocument();

    rerender(
      <PaginationRail
        page={1}
        pageSize={10}
        totalItems={0}
        totalPages={1}
        reserveWhenEmpty
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('pagination-rail')).toHaveTextContent('0-0 / 0');
    expect(screen.getByTestId('pagination-rail')).toHaveTextContent('1 / 1');
  });

  it('keeps page action button dimensions fixed in compact mode', () => {
    render(
      <PaginationRail
        page={2}
        pageSize={20}
        totalItems={100}
        totalPages={5}
        compact
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByTitle('jobs.firstPage')).toHaveClass('size-7');
    expect(screen.getByText('jobs.prevPage')).toHaveClass('min-w-11');
    expect(screen.getByText('jobs.nextPage')).toHaveClass('min-w-11');
    expect(screen.getByTitle('jobs.lastPage')).toHaveClass('size-7');
  });

  it('adds prefixed stable test ids to page actions without changing the root test id', () => {
    const onPageChange = vi.fn();

    render(
      <PaginationRail
        page={2}
        pageSize={20}
        totalItems={100}
        totalPages={5}
        compact
        testIdPrefix="review-page"
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByTestId('pagination-rail')).toBeInTheDocument();
    expect(screen.getByTestId('review-page-first')).toHaveClass('size-7');
    expect(screen.getByTestId('review-page-prev')).toHaveClass('min-w-11');
    expect(screen.getByTestId('review-page-next')).toHaveClass('min-w-11');
    expect(screen.getByTestId('review-page-last')).toHaveClass('size-7');

    fireEvent.click(screen.getByTestId('review-page-prev'));
    fireEvent.click(screen.getByTestId('review-page-next'));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
  });

  it('keeps disabled page actions mounted with the same fixed sizing classes', () => {
    const { rerender } = render(
      <PaginationRail
        page={1}
        pageSize={20}
        totalItems={100}
        totalPages={5}
        compact
        testIdPrefix="review-page"
        onPageChange={vi.fn()}
      />,
    );

    const enabledNextClass = screen.getByTestId('review-page-next').className;
    const disabledPrevClass = screen.getByTestId('review-page-prev').className;
    expect(screen.getByTestId('review-page-prev')).toBeDisabled();
    expect(screen.getByTestId('review-page-next')).not.toBeDisabled();

    rerender(
      <PaginationRail
        page={1}
        pageSize={20}
        totalItems={100}
        totalPages={5}
        compact
        disabled
        testIdPrefix="review-page"
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('review-page-prev')).toBeDisabled();
    expect(screen.getByTestId('review-page-next')).toBeDisabled();
    expect(screen.getByTestId('review-page-prev').className).toBe(disabledPrevClass);
    expect(screen.getByTestId('review-page-next').className).toBe(enabledNextClass);
  });

  it('keeps range and page-size controls on a single stable rail', () => {
    render(
      <PaginationRail
        page={2}
        pageSize={20}
        totalItems={100}
        totalPages={5}
        compact
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        pageSizeOptions={[10, 20, 50, 100]}
      />,
    );

    expect(screen.getByTestId('pagination-rail')).toHaveClass(
      'overflow-x-auto',
      'overflow-y-hidden',
    );
    expect(screen.getByText('21-40 / 100')).toHaveClass('whitespace-nowrap', 'tabular-nums');
    expect(screen.getByText('per page')).toHaveClass('whitespace-nowrap');
    expect(document.querySelector('.pagination-rail__page-size')).toHaveClass(
      'w-[5.25rem]',
      'tabular-nums',
    );
  });

  it('uses a caller-provided range label without changing rail layout', () => {
    render(
      <PaginationRail
        page={1}
        pageSize={10}
        totalItems={100}
        totalPages={10}
        compact
        rangeLabel="history {start}-{end} / {total}"
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByText('history 1-10 / 100')).toHaveClass(
      'whitespace-nowrap',
      'tabular-nums',
    );
  });
});
