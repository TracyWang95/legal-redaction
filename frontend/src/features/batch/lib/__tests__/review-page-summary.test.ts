// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { buildReviewPageSummaries } from '../review-page-summary';

describe('buildReviewPageSummaries', () => {
  it('summarizes text entity hits, selected counts, current page, and visited state', () => {
    const summaries = buildReviewPageSummaries({
      totalPages: 3,
      currentPage: 2,
      visitedPages: new Set([1, 2]),
      isImageMode: false,
      boxes: [],
      entities: [
        { id: 'e1', text: 'A', type: 'PERSON', start: 0, end: 1, selected: true, page: 1 },
        { id: 'e2', text: 'B', type: 'PHONE', start: 2, end: 3, selected: false, page: 2 },
        { id: 'e3', text: 'C', type: 'ORG', start: 4, end: 5, selected: true, page: 2 },
      ],
    });

    expect(summaries).toEqual([
      { page: 1, hitCount: 1, selectedCount: 1, issueCount: 0, visited: true, current: false },
      { page: 2, hitCount: 2, selectedCount: 1, issueCount: 0, visited: true, current: true },
      { page: 3, hitCount: 0, selectedCount: 0, issueCount: 0, visited: false, current: false },
    ]);
  });

  it('summarizes image boxes when reviewing scanned pages', () => {
    const summaries = buildReviewPageSummaries({
      totalPages: 2,
      currentPage: 1,
      visitedPages: new Set([1]),
      isImageMode: true,
      entities: [],
      boxes: [
        { id: 'b1', x: 0.2, y: 0.2, width: 0.1, height: 0.1, type: 'seal', selected: true, page: 1 },
        { id: 'b2', x: 0.4, y: 0.2, width: 0.1, height: 0.1, type: 'qr', selected: false, page: 1 },
        { id: 'b3', x: 0.2, y: 0.2, width: 0.1, height: 0.1, type: 'seal', selected: true, page: 2 },
      ],
    });

    expect(summaries).toEqual([
      { page: 1, hitCount: 2, selectedCount: 1, issueCount: 0, visited: true, current: true },
      { page: 2, hitCount: 1, selectedCount: 1, issueCount: 0, visited: false, current: false },
    ]);
  });

  it('flags pages with coarse OCR markup and oversized OCR boxes', () => {
    const summaries = buildReviewPageSummaries({
      totalPages: 2,
      currentPage: 1,
      visitedPages: new Set([1]),
      isImageMode: true,
      entities: [],
      boxes: [
        {
          id: 'coarse-table',
          x: 0.1,
          y: 0.1,
          width: 0.7,
          height: 0.3,
          type: 'ocr_text',
          text: '<table><tr><td>Total</td></tr></table>',
          source: 'ocr_has',
          selected: true,
          page: 1,
        },
        {
          id: 'fallback-seal',
          x: 0.75,
          y: 0.7,
          width: 0.1,
          height: 0.1,
          type: 'seal',
          source: 'has_image',
          source_detail: 'red_seal_fallback',
          warnings: ['fallback_detector'],
          selected: true,
          page: 2,
        },
      ],
    });

    expect(summaries[0].issueCount).toBe(1);
    expect(summaries[1].issueCount).toBe(1);
  });

  it('flags selected edge and seam seal boxes as review issues', () => {
    const summaries = buildReviewPageSummaries({
      totalPages: 2,
      currentPage: 1,
      visitedPages: new Set([1]),
      isImageMode: true,
      entities: [],
      boxes: [
        {
          id: 'right-seam-seal',
          x: 0.945,
          y: 0.42,
          width: 0.04,
          height: 0.13,
          type: 'official_seal',
          source: 'has_image',
          selected: true,
          page: 1,
        },
        {
          id: 'deselected-edge-seal',
          x: 0.01,
          y: 0.3,
          width: 0.05,
          height: 0.12,
          type: 'official_seal',
          source: 'has_image',
          selected: false,
          page: 2,
        },
      ],
    });

    expect(summaries[0].issueCount).toBe(1);
    expect(summaries[1].issueCount).toBe(0);
  });
});
