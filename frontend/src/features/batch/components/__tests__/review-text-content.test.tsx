// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { createRef } from 'react';
import { fireEvent, render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ReviewTextContent } from '../review-text-content';

describe('ReviewTextContent', () => {
  it('marks every exact occurrence that the redaction map will replace', () => {
    const { container } = render(
      <ReviewTextContent
        reviewEntities={[
          {
            id: 'e1',
            text: 'Alice',
            type: 'PERSON',
            start: 0,
            end: 5,
            selected: true,
            page: 1,
          },
        ]}
        visibleReviewEntities={[
          {
            id: 'e1',
            text: 'Alice',
            type: 'PERSON',
            start: 0,
            end: 5,
            selected: true,
            page: 1,
          },
        ]}
        reviewTextContent="Alice met Bob. Alice signed."
        reviewPageContent="Alice met Bob. Alice signed."
        reviewTextContentRef={createRef<HTMLDivElement>()}
        reviewTextScrollRef={createRef<HTMLDivElement>()}
        selectedReviewEntityCount={1}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        onReviewPageChange={vi.fn()}
        displayPreviewMap={{ Alice: '<PERSON[001]>' }}
        textPreviewSegments={[{ text: 'Alice met Bob. Alice signed.', isMatch: false }]}
        applyReviewEntities={vi.fn()}
        textTypes={[]}
        reviewFileReadOnly={false}
      />,
    );

    expect(container.querySelectorAll('[data-review-entity-id="e1"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-review-occurrence-id]')).toHaveLength(2);
    expect(container.querySelector('[data-review-entity-id="e1"]')).toHaveTextContent(
      '<PERSON[001]>',
    );
    expect(container).toHaveTextContent('2/2');
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  it('uses all review entities to mark replacement occurrences on the current page', () => {
    const { container } = render(
      <ReviewTextContent
        reviewEntities={[
          {
            id: 'e1',
            text: 'Acme Corp',
            type: 'ORG',
            start: 0,
            end: 9,
            selected: true,
            page: 1,
          },
        ]}
        visibleReviewEntities={[]}
        reviewTextContent="Page two says Acme Corp again."
        reviewPageContent="Page two says Acme Corp again."
        reviewTextContentRef={createRef<HTMLDivElement>()}
        reviewTextScrollRef={createRef<HTMLDivElement>()}
        selectedReviewEntityCount={0}
        reviewCurrentPage={2}
        reviewTotalPages={2}
        onReviewPageChange={vi.fn()}
        displayPreviewMap={{ 'Acme Corp': '<ORG[001]>' }}
        textPreviewSegments={[{ text: 'Page two says Acme Corp again.', isMatch: false }]}
        applyReviewEntities={vi.fn()}
        textTypes={[]}
        reviewFileReadOnly={false}
      />,
    );

    expect(container.querySelectorAll('[data-review-entity-id="e1"]')).toHaveLength(1);
  });

  it('marks authoritative entity-map text even when the entity list is incomplete', () => {
    const { container } = render(
      <ReviewTextContent
        reviewEntities={[]}
        visibleReviewEntities={[]}
        reviewTextContent="Alice is still visible."
        reviewPageContent="Alice is still visible."
        reviewTextContentRef={createRef<HTMLDivElement>()}
        reviewTextScrollRef={createRef<HTMLDivElement>()}
        selectedReviewEntityCount={0}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        onReviewPageChange={vi.fn()}
        displayPreviewMap={{ Alice: '<PERSON[001]>' }}
        textPreviewSegments={[{ text: 'Alice is still visible.', isMatch: false }]}
        applyReviewEntities={vi.fn()}
        textTypes={[]}
        reviewFileReadOnly
      />,
    );

    expect(container.querySelectorAll('[data-review-entity-id="entity-map-Alice"]')).toHaveLength(1);
    expect(container.querySelector('[data-review-entity-id="entity-map-Alice"]')).toHaveTextContent(
      '<PERSON[001]>',
    );
  });

  it('exposes stable review page pagination test ids', () => {
    const onReviewPageChange = vi.fn();

    render(
      <ReviewTextContent
        reviewEntities={[]}
        visibleReviewEntities={[]}
        reviewTextContent="first page text"
        reviewPageContent="first page text"
        reviewTextContentRef={createRef<HTMLDivElement>()}
        reviewTextScrollRef={createRef<HTMLDivElement>()}
        selectedReviewEntityCount={0}
        reviewCurrentPage={2}
        reviewTotalPages={3}
        onReviewPageChange={onReviewPageChange}
        displayPreviewMap={{}}
        textPreviewSegments={[{ text: 'first page text', isMatch: false }]}
        applyReviewEntities={vi.fn()}
        textTypes={[]}
        reviewFileReadOnly={false}
      />,
    );

    expect(screen.getByTestId('review-page-prev')).toHaveClass('min-w-11');
    expect(screen.getByTestId('review-page-next')).toHaveClass('min-w-11');
    fireEvent.click(screen.getByTestId('review-page-prev'));
    fireEvent.click(screen.getByTestId('review-page-next'));
    expect(onReviewPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onReviewPageChange).toHaveBeenNthCalledWith(2, 3);
  });
});
