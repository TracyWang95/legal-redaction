// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JobsPagination } from '../jobs-pagination';

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('@/components/PaginationRail', () => ({
  PaginationRail: ({
    className,
    compact,
    disabled,
    onPageChange,
    onPageSizeChange,
    reserveWhenEmpty,
  }: {
    className?: string;
    compact?: boolean;
    disabled?: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    reserveWhenEmpty?: boolean;
  }) => (
    <div
      data-testid="pagination-rail"
      data-compact={String(compact)}
      data-disabled={String(disabled)}
      data-reserve-empty={String(reserveWhenEmpty)}
      className={className}
    >
      <button type="button" onClick={() => onPageChange(2)}>
        page
      </button>
      <button type="button" onClick={() => onPageSizeChange?.(20)}>
        size
      </button>
    </div>
  ),
}));

describe('JobsPagination layout', () => {
  it('uses the stable compact jobs pagination rail', () => {
    render(
      <JobsPagination
        page={1}
        pageSize={20}
        totalPages={5}
        total={100}
        rangeStart={1}
        rangeEnd={20}
        jumpPage=""
        tableBusy={false}
        onGoPage={vi.fn()}
        onChangePageSize={vi.fn()}
        onJumpPageChange={vi.fn()}
      />,
    );

    const rail = screen.getByTestId('pagination-rail');
    expect(rail).toHaveAttribute('data-compact', 'true');
    expect(rail).toHaveAttribute('data-reserve-empty', 'true');
    expect(rail).toHaveAttribute('data-disabled', 'false');
    expect(rail).toHaveClass('jobs-pagination-rail', '!min-h-10', '!rounded-xl');
  });

  it('keeps the pagination rail mounted for empty or loading lists', () => {
    render(
      <JobsPagination
        page={1}
        pageSize={10}
        totalPages={1}
        total={0}
        rangeStart={0}
        rangeEnd={0}
        jumpPage=""
        tableBusy
        onGoPage={vi.fn()}
        onChangePageSize={vi.fn()}
        onJumpPageChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('pagination-rail')).toHaveAttribute('data-reserve-empty', 'true');
    expect(screen.getByTestId('pagination-rail')).toHaveAttribute('data-disabled', 'true');
  });

  it('blocks pagination callbacks while the jobs table is busy', () => {
    const onGoPage = vi.fn();
    const onChangePageSize = vi.fn();

    render(
      <JobsPagination
        page={1}
        pageSize={10}
        totalPages={3}
        total={30}
        rangeStart={1}
        rangeEnd={10}
        jumpPage=""
        tableBusy
        onGoPage={onGoPage}
        onChangePageSize={onChangePageSize}
        onJumpPageChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'page' }));
    fireEvent.click(screen.getByRole('button', { name: 'size' }));

    expect(onGoPage).not.toHaveBeenCalled();
    expect(onChangePageSize).not.toHaveBeenCalled();
  });
});
