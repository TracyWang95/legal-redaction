
import type React from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import type { BoundingBox as EditorBox } from '@/components/ImageBBoxEditor';
import type { TextSegment } from '@/utils/textRedactionSegments';
import { tonePanelClass } from '@/utils/toneClasses';
import type {
  BatchRow,
  PipelineCfg,
  ReviewEntity,
  TextEntityType,
} from '../types';
import { ReviewImageContent } from './review-image-content';
import { ReviewTextContent } from './review-text-content';

interface BatchStep4ReviewProps {

  doneRows: BatchRow[];
  reviewIndex: number;
  reviewFile: BatchRow | null;
  reviewLoading: boolean;
  reviewExecuteLoading: boolean;
  reviewFileReadOnly: boolean;
  navigateReviewIndex: (idx: number) => void;

  reviewEntities: ReviewEntity[];
  reviewTextContent: string;
  reviewTextContentRef: React.RefObject<HTMLDivElement | null>;
  reviewTextScrollRef: React.RefObject<HTMLDivElement | null>;
  selectedReviewEntityCount: number;
  displayPreviewMap: Record<string, string>;
  textPreviewSegments: TextSegment[];
  applyReviewEntities: (updater: ReviewEntity[] | ((prev: ReviewEntity[]) => ReviewEntity[])) => void;
  /** @deprecated — group-level toggle is used instead; kept for interface compat */
  toggleReviewEntitySelected: (id: string) => void;

  reviewBoxes: EditorBox[];
  reviewOrigImageBlobUrl: string;
  reviewImagePreviewSrc: string;
  reviewImagePreviewLoading: boolean;
  selectedReviewBoxCount: number;
  pipelines: PipelineCfg[];
  textTypes: TextEntityType[];
  setReviewBoxes: React.Dispatch<React.SetStateAction<EditorBox[]>>;
  handleReviewBoxesCommit: (prev: EditorBox[], next: EditorBox[]) => void;
  toggleReviewBoxSelected: (id: string) => void;

  undoReviewText: () => void;
  redoReviewText: () => void;
  undoReviewImage: () => void;
  redoReviewImage: () => void;
  reviewTextUndoStack: ReviewEntity[][];
  reviewTextRedoStack: ReviewEntity[][];
  reviewImageUndoStack: EditorBox[][];
  reviewImageRedoStack: EditorBox[][];

  reviewDraftSaving: boolean;
  reviewDraftError: string | null;

  reviewedOutputCount: number;
  rows: BatchRow[];
  allReviewConfirmed: boolean;

  confirmCurrentReview: () => Promise<void>;
  advanceToExportStep: () => Promise<void>;

  onRerunRecognition?: () => Promise<void>;
  rerunRecognitionLoading?: boolean;
}

export function BatchStep4Review(props: BatchStep4ReviewProps) {
  const t = useT();
  const {
    doneRows, reviewIndex, reviewFile, reviewLoading, reviewExecuteLoading,
    reviewFileReadOnly, navigateReviewIndex,
    reviewDraftSaving, reviewDraftError,
    reviewedOutputCount, rows, allReviewConfirmed,
    confirmCurrentReview, advanceToExportStep,
    onRerunRecognition, rerunRecognitionLoading,
  } = props;

  if (!doneRows.length) {
    return (
      <Card data-testid="batch-step4-empty">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            {t('batchWizard.step4.noRecognized')}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (reviewLoading || !reviewFile) {
    return (
      <Card data-testid="batch-step4-loading">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">{t('batchWizard.step4.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  const isImage = reviewFile.isImageMode === true;

  return (
    <Card
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
      data-testid="batch-step4-review"
    >
      {reviewFileReadOnly && (
        <div className={`shrink-0 border-b px-4 py-2 text-sm ${tonePanelClass.success}`}>
          {t('batchWizard.step4.readOnlyHint')}
        </div>
      )}

      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <span className="text-xs font-semibold truncate max-w-[20rem]" title={reviewFile.original_filename}>
          {reviewFile.original_filename}
        </span>

        {doneRows.length > 1 && (
          <div className="flex items-center gap-1 border-l pl-2">
            <Button
              variant="outline"
              size="sm"
              disabled={reviewIndex <= 0}
              onClick={() => void navigateReviewIndex(reviewIndex - 1)}
              data-testid="review-prev"
            >
              {t('batchWizard.step4.prevFile')}
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {reviewIndex + 1}/{doneRows.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={reviewIndex >= doneRows.length - 1}
              onClick={() => void navigateReviewIndex(reviewIndex + 1)}
              data-testid="review-next"
            >
              {t('batchWizard.step4.nextFile')}
            </Button>
          </div>
        )}

        {/* Undo/Redo */}
        <div className="flex items-center gap-1 border-l pl-2">
          <Button
            variant="outline"
            size="sm"
            onClick={isImage ? props.undoReviewImage : props.undoReviewText}
            disabled={isImage ? !props.reviewImageUndoStack.length : !props.reviewTextUndoStack.length}
          >
            {t('playground.undo')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={isImage ? props.redoReviewImage : props.redoReviewText}
            disabled={isImage ? !props.reviewImageRedoStack.length : !props.reviewTextRedoStack.length}
          >
            {t('playground.redo')}
          </Button>
        </div>

        {/* Re-run recognition */}
        {onRerunRecognition && (
          <div className="flex items-center border-l pl-2">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              disabled={reviewFileReadOnly || reviewLoading || rerunRecognitionLoading}
              onClick={() => void onRerunRecognition()}
              data-testid="rerun-recognition"
            >
              {rerunRecognitionLoading
                ? t('batchWizard.step4.rerunningRecognition')
                : t('batchWizard.step4.rerunRecognition')}
            </Button>
          </div>
        )}

        {/* Draft status */}
        {reviewDraftSaving && (
          <span className="text-xs text-muted-foreground">{t('batchWizard.step4.savingDraft')}</span>
        )}
        {!reviewDraftSaving && reviewDraftError && (
          <span className="text-xs text-destructive truncate max-w-[10rem]">{reviewDraftError}</span>
        )}
        {!reviewDraftSaving && !reviewDraftError && (
          <span className="text-xs text-[var(--success-foreground)]">{t('batchWizard.step4.draftSynced')}</span>
        )}

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('batchWizard.step4.confirmed')} {reviewedOutputCount}/{rows.length}
          </span>
          <Button
            size="sm"
            onClick={() => void confirmCurrentReview()}
            disabled={reviewLoading || reviewExecuteLoading || reviewFileReadOnly}
            data-testid="confirm-redact"
          >
            {reviewFileReadOnly
              ? t('batchWizard.step4.completed')
              : reviewExecuteLoading
                ? t('batchWizard.step4.submitting')
                : t('batchWizard.step4.confirmRedact')}
          </Button>
          <Button
            size="sm"
            variant={allReviewConfirmed ? 'default' : 'outline'}
            disabled={!allReviewConfirmed || reviewExecuteLoading}
            onClick={() => void advanceToExportStep()}
            className={cn(allReviewConfirmed && 'bg-primary hover:bg-primary/90')}
            data-testid="go-export"
          >
            {t('batchWizard.step4.goExport')}
          </Button>
        </div>
      </div>

      {/* Content area */}
      {isImage ? (
        <ReviewImageContent
          reviewBoxes={props.reviewBoxes}
          reviewOrigImageBlobUrl={props.reviewOrigImageBlobUrl}
          reviewImagePreviewSrc={props.reviewImagePreviewSrc}
          reviewImagePreviewLoading={props.reviewImagePreviewLoading}
          selectedReviewBoxCount={props.selectedReviewBoxCount}
          pipelines={props.pipelines}
          setReviewBoxes={props.setReviewBoxes}
          handleReviewBoxesCommit={props.handleReviewBoxesCommit}
          toggleReviewBoxSelected={props.toggleReviewBoxSelected}
        />
      ) : (
        <ReviewTextContent
          reviewEntities={props.reviewEntities}
          reviewTextContent={props.reviewTextContent}
          reviewTextContentRef={props.reviewTextContentRef}
          reviewTextScrollRef={props.reviewTextScrollRef}
          selectedReviewEntityCount={props.selectedReviewEntityCount}
          displayPreviewMap={props.displayPreviewMap}
          textPreviewSegments={props.textPreviewSegments}
          applyReviewEntities={props.applyReviewEntities}
          textTypes={props.textTypes}
          reviewFileReadOnly={props.reviewFileReadOnly}
        />
      )}
    </Card>
  );
}
