// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import type { BatchRow } from '../../types';
import {
  findFirstActionableReviewIndex,
  findFirstPendingReviewIndex,
  findNextPendingReviewIndex,
  getNextRequiredReviewPageTarget,
  getNextReviewIndex,
  getNextReviewPageTarget,
  isActionableReviewRow,
  resolveReviewResumeIndex,
} from '../review-navigation';

function row(
  fileId: string,
  reviewConfirmed = false,
  analyzeStatus: BatchRow['analyzeStatus'] = reviewConfirmed ? 'completed' : 'awaiting_review',
): BatchRow {
  return {
    file_id: fileId,
    original_filename: `${fileId}.txt`,
    file_size: 100,
    file_type: 'txt',
    created_at: '2026-01-01T00:00:00Z',
    has_output: reviewConfirmed,
    analyzeStatus,
    reviewConfirmed,
  } as BatchRow;
}

describe('batch review navigation', () => {
  it('finds the next unconfirmed file after the current file', () => {
    const rows = [row('file-1'), row('file-2'), row('file-3')];

    expect(findNextPendingReviewIndex(rows, 'file-1')).toBe(1);
  });

  it('finds the first pending review independent of current position', () => {
    const rows = [row('file-1', true), row('file-2'), row('file-3')];

    expect(findFirstPendingReviewIndex(rows)).toBe(1);
  });

  it('treats unconfirmed reviewable rows as immediately actionable review work', () => {
    expect(isActionableReviewRow(row('file-1'))).toBe(true);
    expect(isActionableReviewRow(row('file-2', false, 'redacting'))).toBe(false);
    expect(isActionableReviewRow(row('file-3', false, 'completed'))).toBe(true);
  });

  it('prefers the first actionable completed item over read-only pending rows', () => {
    const rows = [
      row('file-1', false, 'completed'),
      row('file-2', false, 'redacting'),
      row('file-3'),
    ];

    expect(findFirstPendingReviewIndex(rows)).toBe(0);
    expect(findFirstActionableReviewIndex(rows)).toBe(0);
    expect(resolveReviewResumeIndex(rows, 'file-1')).toBe(0);
  });

  it('resumes at the first pending review when the preferred file is already confirmed', () => {
    const rows = [row('file-1', true), row('file-2'), row('file-3', true)];

    expect(resolveReviewResumeIndex(rows, 'file-3')).toBe(1);
  });

  it('wraps to an earlier unconfirmed file instead of trapping at the end', () => {
    const rows = [row('file-1'), row('file-2'), row('file-3', true), row('file-4')];

    expect(findNextPendingReviewIndex(rows, 'file-4')).toBe(0);
    expect(getNextReviewIndex(rows, 3, 'file-4')).toBe(0);
  });

  it('returns null for next navigation when all files are confirmed and current is last', () => {
    const rows = [row('file-1', true), row('file-2', true)];

    expect(getNextReviewIndex(rows, 1, 'file-2')).toBeNull();
  });

  it('prioritizes unvisited issue pages before ordinary hit pages', () => {
    const target = getNextReviewPageTarget(
      [
        { page: 1, hitCount: 0, selectedCount: 0, issueCount: 0, visited: true, current: true },
        { page: 2, hitCount: 3, selectedCount: 3, issueCount: 0, visited: false, current: false },
        { page: 3, hitCount: 1, selectedCount: 1, issueCount: 1, visited: false, current: false },
      ],
      1,
    );

    expect(target?.page.page).toBe(3);
    expect(target?.kind).toBe('issue');
  });

  it('wraps review page target search after the current page', () => {
    const target = getNextReviewPageTarget(
      [
        { page: 1, hitCount: 0, selectedCount: 0, issueCount: 0, visited: false, current: false },
        { page: 2, hitCount: 0, selectedCount: 0, issueCount: 0, visited: true, current: true },
      ],
      2,
    );

    expect(target?.page.page).toBe(1);
    expect(target?.kind).toBe('unvisited');
  });

  it('required page target ignores blank unvisited pages after hit pages are reviewed', () => {
    const target = getNextRequiredReviewPageTarget(
      [
        { page: 1, hitCount: 1, selectedCount: 1, issueCount: 0, visited: true, current: true },
        { page: 2, hitCount: 0, selectedCount: 0, issueCount: 0, visited: false, current: false },
        { page: 3, hitCount: 0, selectedCount: 0, issueCount: 0, visited: false, current: false },
      ],
      1,
    );

    expect(target).toBeNull();
  });
});
