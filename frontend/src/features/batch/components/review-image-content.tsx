// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react';
import { useT } from '@/i18n';
import { Checkbox } from '@/components/ui/checkbox';
import { PaginationRail } from '@/components/PaginationRail';
import ImageBBoxEditor from '@/components/ImageBBoxEditor';
import type { BoundingBox as EditorBox } from '@/components/ImageBBoxEditor';
import type { PipelineCfg } from '../types';

export interface ReviewImageContentProps {
  reviewBoxes: EditorBox[];
  visibleReviewBoxes: EditorBox[];
  reviewOrigImageBlobUrl: string;
  reviewImagePreviewSrc: string;
  reviewImagePreviewLoading: boolean;
  reviewCurrentPage: number;
  reviewTotalPages: number;
  selectedReviewBoxCount: number;
  totalReviewBoxCount: number;
  pipelines: PipelineCfg[];
  onReviewPageChange: (page: number) => void;
  setVisibleReviewBoxes: React.Dispatch<React.SetStateAction<EditorBox[]>>;
  handleReviewBoxesCommit: (prev: EditorBox[], next: EditorBox[]) => void;
  toggleReviewBoxSelected: (id: string) => void;
}

function ReviewImageContentInner({
  reviewBoxes,
  visibleReviewBoxes,
  reviewOrigImageBlobUrl,
  reviewImagePreviewSrc,
  reviewImagePreviewLoading,
  reviewCurrentPage,
  reviewTotalPages,
  selectedReviewBoxCount,
  totalReviewBoxCount,
  pipelines,
  onReviewPageChange,
  setVisibleReviewBoxes,
  handleReviewBoxesCommit,
  toggleReviewBoxSelected,
}: ReviewImageContentProps) {
  const t = useT();

  const getVisionTypeMeta = (id: string) => {
    for (const pipeline of pipelines) {
      const found = pipeline.types.find((type) => type.id === id);
      if (found) return { name: found.name, color: '#6366F1' };
    }
    return { name: id, color: '#6366F1' };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {reviewTotalPages > 1 && (
        <div className="shrink-0 border-b bg-muted/20 px-3 py-1.5">
          <PaginationRail
            page={reviewCurrentPage}
            pageSize={1}
            totalItems={reviewTotalPages}
            totalPages={reviewTotalPages}
            compact
            onPageChange={onReviewPageChange}
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-[2] flex-col border-r">
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b bg-muted/30 px-2">
          <span className="text-xs font-medium">{t('batchWizard.step4.originalText')}</span>
        </div>
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <ImageBBoxEditor
              imageSrc={reviewOrigImageBlobUrl}
              boxes={visibleReviewBoxes}
              onBoxesChange={setVisibleReviewBoxes}
              onBoxesCommit={handleReviewBoxesCommit}
              getTypeConfig={getVisionTypeMeta}
              availableTypes={pipelines.flatMap((pipeline) =>
                pipeline.types.filter((type) => type.enabled),
              )}
              defaultType="CUSTOM"
            />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-[2] flex-col overflow-hidden border-r">
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b bg-muted/30 px-2">
          <span className="text-xs font-medium">{t('batchWizard.step4.previewImage')}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {reviewImagePreviewLoading
              ? t('batchWizard.step4.generating')
              : `${selectedReviewBoxCount}/${visibleReviewBoxes.length} ${t('batchWizard.step4.selected')}`}
          </span>
        </div>
        {/* Spacer — matches the internal toolbar of ImageBBoxEditor so both
            image panes have identical top offsets and the two renders align
            pixel-for-pixel along the top and bottom edges. */}
        <div
          className="h-[42px] shrink-0 border-b border-border/70 bg-[var(--surface-overlay)]"
          aria-hidden="true"
        />
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20">
          {reviewImagePreviewSrc ? (
            <img
              src={reviewImagePreviewSrc}
              alt={t('batchWizard.step4.previewImage')}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {reviewImagePreviewLoading
                ? t('batchWizard.step4.generating')
                : t('batchWizard.step4.noBoxes')}
            </p>
          )}
        </div>
      </div>

      <div className="flex min-h-0 min-w-[220px] max-w-[320px] flex-[1] flex-col bg-background">
        <div className="flex shrink-0 items-center border-b px-2 py-1.5">
          <span className="text-xs font-medium">{t('batchWizard.step4.detectionRegions')}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {selectedReviewBoxCount}/{visibleReviewBoxes.length}
          </span>
        </div>
        <div className="px-2 pb-1 pt-1 text-[11px] text-muted-foreground">
          {reviewTotalPages > 1
            ? `${t('jobs.showRange')
                .replace('{start}', String(reviewCurrentPage))
                .replace('{end}', String(reviewCurrentPage))
                .replace('{total}', String(reviewTotalPages))} | ${totalReviewBoxCount}`
            : `${totalReviewBoxCount}`}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2 pt-1">
          {visibleReviewBoxes.map((box) => {
            const meta = getVisionTypeMeta(box.type);
            return (
              <button
                key={box.id}
                type="button"
                onClick={() => toggleReviewBoxSelected(box.id)}
                className="w-full rounded-lg border px-2.5 py-1.5 text-left transition hover:border-muted-foreground/40"
                style={{
                  borderColor: box.selected !== false ? meta.color : undefined,
                  backgroundColor: box.selected === false ? undefined : `${meta.color}0d`,
                }}
                data-testid={`bbox-toggle-${box.id}`}
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={box.selected !== false}
                    onCheckedChange={() => toggleReviewBoxSelected(box.id)}
                  />
                  <span className="truncate text-xs font-medium" style={{ color: meta.color }}>
                    {meta.name}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {Math.round(box.width * 100)}&times;{Math.round(box.height * 100)}%
                  </span>
                </div>
                {box.text && (
                  <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">{box.text}</p>
                )}
              </button>
            );
          })}
          {visibleReviewBoxes.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t('batchWizard.step4.noBoxes')}
            </p>
          )}
        </div>
        <div className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
          {reviewBoxes.length} {t('batchWizard.step4.detectionRegions')}
        </div>
      </div>
      </div>
    </div>
  );
}

export const ReviewImageContent = memo(ReviewImageContentInner);
