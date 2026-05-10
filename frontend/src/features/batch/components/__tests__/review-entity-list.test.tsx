// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewEntity } from '../../types';
import { ReviewEntityList } from '../review-entity-list';

const refs = {
  reviewTextContentRef: { current: null },
  reviewTextScrollRef: { current: null },
  previewScrollRef: { current: null },
};

describe('ReviewEntityList', () => {
  it('shows an actionable empty state and disables bulk actions when no entities exist', () => {
    render(
      <ReviewEntityList
        reviewEntities={[]}
        selectedReviewEntityCount={0}
        textTypes={[]}
        applyReviewEntities={vi.fn()}
        {...refs}
      />,
    );

    expect(screen.getByTestId('review-entity-empty')).toHaveTextContent('No entities detected');
    expect(screen.getByTestId('select-all-entities')).toBeDisabled();
    expect(screen.getByTestId('deselect-all-entities')).toBeDisabled();
  });

  it('keeps only the useful bulk action enabled for the current selection state', () => {
    const applyReviewEntities = vi.fn();
    render(
      <ReviewEntityList
        reviewEntities={[
          {
            id: 'entity-1',
            text: 'Alice',
            type: 'PERSON',
            start: 0,
            end: 5,
            selected: false,
            page: 1,
          },
        ]}
        selectedReviewEntityCount={0}
        textTypes={[{ id: 'PERSON', name: 'Person', color: '#2563eb' }]}
        applyReviewEntities={applyReviewEntities}
        {...refs}
      />,
    );

    expect(screen.getByTestId('select-all-entities')).not.toBeDisabled();
    expect(screen.getByTestId('deselect-all-entities')).toBeDisabled();

    fireEvent.click(screen.getByTestId('select-all-entities'));

    expect(applyReviewEntities).toHaveBeenCalled();
  });

  it('labels entity groups and supports keyboard jump to the next occurrence', () => {
    const target = document.createElement('span');
    target.scrollIntoView = vi.fn();
    const reviewTextContentRef = {
      current: {
        querySelector: vi.fn(() => target),
      } as unknown as HTMLDivElement,
    };
    const reviewTextScrollRef = {
      current: { scrollHeight: 100, clientHeight: 50, scrollTop: 25 } as unknown as HTMLDivElement,
    };
    const previewScrollRef = {
      current: { scrollHeight: 200, clientHeight: 100, scrollTop: 0 } as unknown as HTMLDivElement,
    };

    render(
      <ReviewEntityList
        reviewEntities={[
          {
            id: 'entity-1',
            text: 'Alice',
            type: 'PERSON',
            start: 0,
            end: 5,
            selected: true,
            page: 1,
          },
        ]}
        selectedReviewEntityCount={1}
        textTypes={[{ id: 'PERSON', name: 'Person', color: '#2563eb' }]}
        applyReviewEntities={vi.fn()}
        reviewTextContentRef={reviewTextContentRef}
        reviewTextScrollRef={reviewTextScrollRef}
        previewScrollRef={previewScrollRef}
      />,
    );

    expect(screen.getByLabelText('1 of 1 entities selected')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(
      screen.getByRole('checkbox', { name: 'Toggle Person Alice; 1 of 1 selected' }),
    ).toBeInTheDocument();

    const group = screen.getByRole('button', {
      name: 'Person Alice, 1 of 1 selected. Press Enter to find the next occurrence.',
    });
    fireEvent.keyDown(group, { key: 'Enter' });

    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(previewScrollRef.current.scrollTop).toBe(50);
  });

  it('uses occurrence groups for review counts and jumping when replacement coverage is broader than entity spans', () => {
    const target = document.createElement('span');
    target.scrollIntoView = vi.fn();
    const reviewTextContentRef = {
      current: {
        querySelector: vi.fn(() => target),
      } as unknown as HTMLDivElement,
    };

    render(
      <ReviewEntityList
        reviewEntities={[
          {
            id: 'entity-1',
            text: 'Alice',
            type: 'PERSON',
            start: 0,
            end: 5,
            selected: true,
            page: 1,
          },
        ]}
        selectedReviewEntityCount={1}
        displaySelectedCount={3}
        displayTotalCount={3}
        occurrenceGroups={[
          {
            type: 'PERSON',
            text: 'Alice',
            entityIds: ['entity-1'],
            occurrenceIds: ['occ-Alice-0', 'occ-Alice-1', 'occ-Alice-2'],
            selected: 3,
            total: 3,
          },
        ]}
        textTypes={[{ id: 'PERSON', name: 'Person', color: '#2563eb' }]}
        applyReviewEntities={vi.fn()}
        reviewTextContentRef={reviewTextContentRef}
        reviewTextScrollRef={refs.reviewTextScrollRef}
        previewScrollRef={refs.previewScrollRef}
      />,
    );

    expect(screen.getByLabelText('3 of 3 entities selected')).toHaveTextContent('3/3');
    expect(screen.getByText('×3')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Person Alice, 3 of 3 selected. Press Enter to find the next occurrence.',
      }),
    );

    expect(reviewTextContentRef.current.querySelector).toHaveBeenCalledWith(
      '[data-review-occurrence-id="occ-Alice-0"], [data-review-entity-id="occ-Alice-0"]',
    );
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('toggles every entity in a repeated text group without changing other groups', () => {
    const applyReviewEntities = vi.fn();
    const reviewEntities: ReviewEntity[] = [
      {
        id: 'entity-1',
        text: 'Alice',
        type: 'PERSON',
        start: 0,
        end: 5,
        selected: true,
        page: 1,
      },
      {
        id: 'entity-2',
        text: 'Alice',
        type: 'PERSON',
        start: 20,
        end: 25,
        selected: true,
        page: 1,
      },
      {
        id: 'entity-3',
        text: 'Acme',
        type: 'ORG',
        start: 40,
        end: 44,
        selected: true,
        page: 1,
      },
    ];

    render(
      <ReviewEntityList
        reviewEntities={reviewEntities}
        selectedReviewEntityCount={3}
        textTypes={[
          { id: 'PERSON', name: 'Person', color: '#2563eb' },
          { id: 'ORG', name: 'Organization', color: '#16a34a' },
        ]}
        applyReviewEntities={applyReviewEntities}
        {...refs}
      />,
    );

    fireEvent.click(screen.getByTestId('entity-group-toggle-PERSON-Alice'));

    const updater = applyReviewEntities.mock.calls[0][0] as
      | ((prev: typeof reviewEntities) => typeof reviewEntities)
      | typeof reviewEntities;
    expect(typeof updater).toBe('function');
    if (typeof updater !== 'function') return;

    const nextEntities = updater(reviewEntities);
    expect(nextEntities.map((entity) => [entity.id, entity.selected])).toEqual([
      ['entity-1', false],
      ['entity-2', false],
      ['entity-3', true],
    ]);
    expect(nextEntities[2]).toBe(reviewEntities[2]);
  });
});
