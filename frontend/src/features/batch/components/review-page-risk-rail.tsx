// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { memo, useId, useMemo } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { getNextRequiredReviewPageTarget } from '../lib/review-navigation';
import type { ReviewPageSummary } from '../types';

interface ReviewPageRiskRailProps {
  pages: ReviewPageSummary[];
  currentPage: number;
  hitPageCount: number;
  unvisitedHitPageCount: number;
  allPagesVisited: boolean;
  requiredPagesVisited: boolean;
  onPageChange: (page: number) => void;
}

function ReviewPageRiskRailInner({
  pages,
  currentPage,
  hitPageCount,
  unvisitedHitPageCount,
  allPagesVisited,
  requiredPagesVisited,
  onPageChange,
}: ReviewPageRiskRailProps) {
  const t = useT();
  const statusId = useId();
  const issuePageCount = useMemo(() => pages.filter((page) => page.issueCount > 0).length, [pages]);
  const nextTarget = useMemo(() => {
    return getNextRequiredReviewPageTarget(pages, currentPage);
  }, [currentPage, pages]);
  const nextIssueTarget = useMemo(() => {
    return (
      pages.find((page) => page.page > currentPage && page.issueCount > 0 && !page.visited) ??
      pages.find((page) => page.issueCount > 0 && !page.visited) ??
      null
    );
  }, [currentPage, pages]);
  const nextTargetLabel = nextTarget
    ? t('batchWizard.step4.nextUnvisitedPage')
    : t('batchWizard.step4.requiredPagesVisitedDone');
  const railLabel = t('batchWizard.step4.pageRiskSummary')
    .replace('{hit}', String(hitPageCount))
    .replace('{unvisitedHit}', String(unvisitedHitPageCount));

  if (pages.length <= 1) return null;

  return (
    <div
      className="shrink-0 border-b bg-background/95 px-3 py-2"
      data-testid="review-page-risk-rail"
      role="navigation"
      aria-label={railLabel}
      aria-describedby={statusId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('batchWizard.step4.pageRiskSummary')
            .replace('{hit}', String(hitPageCount))
            .replace('{unvisitedHit}', String(unvisitedHitPageCount))}
        </span>
        {issuePageCount > 0 && nextIssueTarget && (
          <button
            type="button"
            className="rounded-full border border-border bg-white px-2 py-0.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={`${t('batchWizard.step4.jumpIssuePage')} ${nextIssueTarget.page}`}
            onClick={() => onPageChange(nextIssueTarget.page)}
            data-testid="review-page-issue-summary"
          >
            {issuePageCount}/{pages.length}
          </button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-full px-3 text-xs font-medium"
          disabled={!nextTarget}
          aria-describedby={statusId}
          aria-label={nextTargetLabel}
          onClick={() => {
            if (nextTarget) onPageChange(nextTarget.page.page);
          }}
          data-testid="review-next-risk-page"
        >
          {nextTargetLabel}
        </Button>
        <span
          id={statusId}
          className={cn(
            'ml-auto text-xs tabular-nums',
            requiredPagesVisited ? 'text-[var(--success-foreground)]' : 'text-muted-foreground',
          )}
          aria-live="polite"
        >
          {requiredPagesVisited
            ? t('batchWizard.step4.requiredPagesVisitedDone')
            : allPagesVisited
              ? t('batchWizard.step4.allPagesVisited')
              : t('batchWizard.step4.pendingPages')}
        </span>
      </div>

      <div
        className="mt-2 flex gap-1.5 overflow-x-auto pb-1"
        role="list"
        aria-label={t('batchWizard.step4.pageRailLabel')}
      >
        {pages.map((page) => {
          const hasIssue = page.issueCount > 0;
          const chipTitle = t('batchWizard.step4.pageChipTitle')
            .replace('{page}', String(page.page))
            .replace('{hits}', String(page.hitCount))
            .replace('{selected}', String(page.selectedCount))
            .replace('{issues}', String(page.issueCount));
          const chipState = [
            hasIssue ? t('batchWizard.step4.riskPage') : '',
            page.current ? t('batchWizard.step4.currentPage') : '',
            !page.visited ? t('batchWizard.step4.notVisitedYet') : '',
          ]
            .filter(Boolean)
            .join('. ');

          return (
            <div key={page.page} role="listitem">
              <button
                type="button"
                className={cn(
                  'min-w-12 shrink-0 rounded-full border px-2.5 py-1 text-xs tabular-nums transition',
                  page.current && 'border-primary bg-primary text-primary-foreground',
                  !page.current &&
                    hasIssue &&
                    'border-[var(--warning-border)] bg-[var(--warning-surface)] font-semibold text-[var(--warning-foreground)]',
                  !page.current &&
                    !hasIssue &&
                    page.hitCount > 0 &&
                    'border-primary/40 bg-primary/5 text-primary',
                  !page.current &&
                    !hasIssue &&
                    page.hitCount === 0 &&
                    'border-border bg-[var(--surface-control)] text-muted-foreground',
                  !page.visited && 'ring-2 ring-[var(--warning-border)]',
                )}
                title={chipTitle}
                aria-label={chipState ? `${chipTitle}. ${chipState}` : chipTitle}
                aria-current={page.current ? 'page' : undefined}
                onClick={() => onPageChange(page.page)}
                data-testid={`review-page-chip-${page.page}`}
              >
                {page.page}
                {page.hitCount > 0 ? ` ${page.hitCount}` : ''}
                {hasIssue ? ` +${page.issueCount}` : ''}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ReviewPageRiskRail = memo(ReviewPageRiskRailInner);
