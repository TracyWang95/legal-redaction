// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ReviewPageRiskRail } from '../review-page-risk-rail';

describe('ReviewPageRiskRail', () => {
  it('jumps to the next unvisited page with detections first', () => {
    const onPageChange = vi.fn();

    render(
      <ReviewPageRiskRail
        currentPage={1}
        hitPageCount={2}
        unvisitedHitPageCount={1}
        allPagesVisited={false}
        requiredPagesVisited={false}
        onPageChange={onPageChange}
        pages={[
          { page: 1, hitCount: 2, selectedCount: 2, issueCount: 0, visited: true, current: true },
          { page: 2, hitCount: 0, selectedCount: 0, issueCount: 0, visited: false, current: false },
          { page: 3, hitCount: 1, selectedCount: 1, issueCount: 0, visited: false, current: false },
        ]}
      />,
    );

    expect(screen.getByTestId('review-page-risk-rail')).not.toHaveTextContent('Review by page');
    expect(screen.getByTestId('review-next-risk-page')).toHaveTextContent('Next page');
    expect(screen.getByTestId('review-next-risk-page')).not.toHaveTextContent('P3');
    fireEvent.click(screen.getByTestId('review-next-risk-page'));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('lets users jump directly to a specific page chip', () => {
    const onPageChange = vi.fn();

    render(
      <ReviewPageRiskRail
        currentPage={1}
        hitPageCount={1}
        unvisitedHitPageCount={0}
        allPagesVisited={false}
        requiredPagesVisited={true}
        onPageChange={onPageChange}
        pages={[
          { page: 1, hitCount: 1, selectedCount: 1, issueCount: 0, visited: true, current: true },
          { page: 2, hitCount: 0, selectedCount: 0, issueCount: 0, visited: false, current: false },
        ]}
      />,
    );

    expect(
      screen.getByRole('navigation', {
        name: 'Pages with detections 1; unvisited detection pages 0',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('review-page-chip-1')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('list', { name: 'Review pages' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Page 2: 0 detections, 0 selected, 0 review hints. Not visited yet',
      }),
    ).toBeInTheDocument();

    const pageTwoChip = screen.getByTestId('review-page-chip-2');
    pageTwoChip.focus();
    expect(pageTwoChip).toHaveFocus();

    fireEvent.click(pageTwoChip);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('prioritizes unvisited review-hint pages ahead of ordinary detection pages', () => {
    const onPageChange = vi.fn();

    render(
      <ReviewPageRiskRail
        currentPage={1}
        hitPageCount={2}
        unvisitedHitPageCount={2}
        allPagesVisited={false}
        requiredPagesVisited={false}
        onPageChange={onPageChange}
        pages={[
          { page: 1, hitCount: 0, selectedCount: 0, issueCount: 0, visited: true, current: true },
          { page: 2, hitCount: 3, selectedCount: 3, issueCount: 0, visited: false, current: false },
          { page: 3, hitCount: 1, selectedCount: 1, issueCount: 1, visited: false, current: false },
        ]}
      />,
    );

    expect(screen.getByTestId('review-page-issue-summary')).toBeInTheDocument();
    expect(screen.getByTestId('review-page-issue-summary')).toHaveTextContent('1/3');
    expect(screen.getByTestId('review-page-chip-3')).toHaveTextContent('3 1 +1');
    expect(screen.getByTestId('review-page-chip-3')).not.toHaveTextContent('hint 1');
    fireEvent.click(screen.getByTestId('review-page-issue-summary'));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
