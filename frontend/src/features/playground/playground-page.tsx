// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { type FC, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { getEntityTypeName } from '@/config/entityTypes';
import ImageBBoxEditor from '@/components/ImageBBoxEditor';
import { PaginationRail } from '@/components/PaginationRail';
import { PlaygroundUpload } from './components/playground-upload';
import { PlaygroundToolbar } from './components/playground-toolbar';
import { PlaygroundEntityPanel } from './components/playground-entity-panel';
import { PlaygroundResult } from './components/playground-result';
import { PlaygroundLoading } from './components/playground-loading';
import { PlaygroundTextSelectionPopover } from './components/playground-text-selection-popover';
import { PlaygroundEntityPopover } from './components/playground-entity-popover';
import {
  PlaygroundProvider,
  usePlaygroundContext,
  usePlaygroundUIContext,
} from './playground-context';
import { previewEntityHoverRingClass, previewEntityMarkStyle } from './utils';

/** Inner component that consumes the playground context. */
const PlaygroundInner: FC = () => {
  const t = useT();
  const ctx = usePlaygroundContext();
  const ui = usePlaygroundUIContext();

  const {
    stage,
    setStage,
    fileInfo,
    content,
    isImageMode,
    entities,
    setBoundingBoxes,
    visibleBoxes,
    isLoading,
    loadingMessage,
    loadingElapsedSec,
    entityMap,
    redactedCount,
    redactionReport,
    reportOpen,
    setReportOpen,
    versionHistory,
    versionHistoryOpen,
    setVersionHistoryOpen,
    selectedCount,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    selectAll,
    deselectAll,
    toggleBox,
    removeEntity,
    handleRerunNer,
    handleRedact,
    handleReset,
    handleDownload,
    imageUrl,
    redactedImageUrl,
    currentPage,
    setCurrentPage,
    totalPages,
    mergeVisibleBoxes,
    openPopout,
    recognition,
    imageHistory,
  } = ctx;

  const { entityTypes } = recognition;

  const pagesArr = fileInfo?.pages;
  const hasTextPagination =
    !isImageMode &&
    totalPages > 1 &&
    Array.isArray(pagesArr) &&
    pagesArr.length === totalPages;
  const pageStartOffset = hasTextPagination
    ? pagesArr!.slice(0, currentPage - 1).reduce((sum, page) => sum + (page?.length || 0) + 2, 0)
    : 0;
  const previewContent = hasTextPagination
    ? pagesArr![currentPage - 1] ?? ''
    : content;
  const pageFilteredEntities = hasTextPagination
    ? entities.filter((entity) => Number(entity.page || 1) === currentPage)
    : entities;
  const previewEntities = hasTextPagination
    ? pageFilteredEntities.map((entity) => ({
        ...entity,
        start: entity.start - pageStartOffset,
        end: entity.end - pageStartOffset,
      }))
    : entities;

  const renderMarkedContent = () => {
    if (!previewContent) {
      return <p className="text-muted-foreground">{t('playground.noContent')}</p>;
    }

    const sortedEntities = [...previewEntities].sort((left, right) => left.start - right.start);
    const segments: ReactNode[] = [];
    let lastEnd = 0;

    sortedEntities.forEach((entity) => {
      if (entity.start < 0 || entity.end > previewContent.length) return;
      if (entity.start < lastEnd) return;

      if (entity.start > lastEnd) {
        segments.push(
          <span key={`text-${lastEnd}`}>{previewContent.slice(lastEnd, entity.start)}</span>,
        );
      }

      const typeName = getEntityTypeName(entity.type);
      const sourceLabel =
        entity.source === 'regex'
          ? t('playground.sourceRegex')
          : entity.source === 'manual'
            ? t('playground.sourceManual')
            : t('playground.sourceAi');

      segments.push(
        <mark
          key={entity.id}
          data-entity-id={entity.id}
          onClick={(event) => ui.handleEntityClick(entity, event)}
          style={previewEntityMarkStyle(entity)}
          className={`inline cursor-pointer rounded-sm px-0.5 py-[1px] transition-all hover:brightness-95 hover:ring-2 hover:ring-offset-1 hover:shadow-sm ${previewEntityHoverRingClass(entity.source)}`}
          title={`${typeName} [${sourceLabel}]`}
        >
          {previewContent.slice(entity.start, entity.end)}
        </mark>,
      );

      lastEnd = entity.end;
    });

    if (lastEnd < previewContent.length) {
      segments.push(<span key="content-end">{previewContent.slice(lastEnd)}</span>);
    }

    return segments;
  };

  return (
    <div
      className="playground-root saas-page flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid="playground"
    >
      {stage === 'upload' && (
        <div className="page-shell !max-w-[min(100%,2048px)] !px-3 !pt-4 sm:!px-5 sm:!pt-5 2xl:!px-8">
          <PlaygroundUpload ctx={ctx} />
        </div>
      )}

      {stage === 'preview' && (
        <div className="flex flex-1 min-h-0 min-w-0 flex-col gap-3 overflow-hidden p-3 sm:p-5 lg:flex-row">
          <div className="saas-panel flex min-w-0 flex-1 flex-col overflow-hidden">
            <PlaygroundToolbar
              filename={fileInfo?.filename}
              isImageMode={isImageMode}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onReset={handleReset}
              hintText={
                isImageMode ? t('playground.previewHint.image') : t('playground.previewHint.text')
              }
              onPopout={isImageMode ? openPopout : undefined}
            />

            <div
              ref={ui.contentRef}
              onMouseUp={ui.handleTextSelect}
              onKeyUp={ui.handleTextSelect}
              className="flex min-h-0 flex-1 flex-col overflow-hidden select-text"
            >
              {isImageMode ? (
                <div className="flex-1 min-h-0">
                  {fileInfo && (
                    <ImageBBoxEditor
                      imageSrc={imageUrl}
                      boxes={visibleBoxes}
                      onBoxesChange={(nextBoxes) => setBoundingBoxes(mergeVisibleBoxes(nextBoxes))}
                      onBoxesCommit={(previousBoxes, nextBoxes) => {
                        imageHistory.save(mergeVisibleBoxes(previousBoxes, nextBoxes));
                        setBoundingBoxes(mergeVisibleBoxes(nextBoxes, previousBoxes));
                      }}
                      getTypeConfig={recognition.getVisionTypeConfig}
                      availableTypes={recognition.visionTypes.map((visionType) => ({
                        id: visionType.id,
                        name: visionType.name,
                        color: '#6366F1',
                      }))}
                      defaultType={recognition.visionTypes[0]?.id || 'CUSTOM'}
                      viewportTopSlot={
                        totalPages > 1 ? (
                          <div className="w-full min-w-[320px]">
                            <PaginationRail
                              page={currentPage}
                              pageSize={1}
                              totalItems={totalPages}
                              totalPages={totalPages}
                              compact
                              onPageChange={(nextPage) => setCurrentPage(nextPage)}
                            />
                          </div>
                        ) : null
                      }
                    />
                  )}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  {hasTextPagination && (
                    <div className="flex-shrink-0 px-3 pt-2 sm:px-4">
                      <PaginationRail
                        page={currentPage}
                        pageSize={1}
                        totalItems={totalPages}
                        totalPages={totalPages}
                        compact
                        onPageChange={(nextPage) => setCurrentPage(nextPage)}
                      />
                    </div>
                  )}
                  <div ref={ui.textScrollRef} className="flex min-h-0 flex-1 overflow-auto">
                    <div className="p-4 font-[system-ui] text-sm leading-relaxed whitespace-pre-wrap">
                      {renderMarkedContent()}
                    </div>
                  </div>
                </div>
              )}

              {!isImageMode && <PlaygroundTextSelectionPopover entityTypes={entityTypes} />}
              {!isImageMode && <PlaygroundEntityPopover />}
            </div>
          </div>

          <PlaygroundEntityPanel
            isImageMode={isImageMode}
            isLoading={isLoading}
            entities={pageFilteredEntities}
            visibleBoxes={visibleBoxes}
            selectedCount={selectedCount}
            replacementMode={recognition.replacementMode}
            setReplacementMode={recognition.setReplacementMode}
            clearPlaygroundTextPresetTracking={recognition.clearPlaygroundTextPresetTracking}
            onRerunNer={handleRerunNer}
            onRedact={handleRedact}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onToggleBox={toggleBox}
            onEntityClick={ui.handleEntityClick}
            onRemoveEntity={removeEntity}
          />
        </div>
      )}

      {stage === 'result' && (
        <PlaygroundResult
          fileInfo={fileInfo}
          content={content}
          entities={entities}
          entityMap={entityMap}
          redactedCount={redactedCount}
          redactionReport={redactionReport}
          reportOpen={reportOpen}
          setReportOpen={setReportOpen}
          versionHistory={versionHistory}
          versionHistoryOpen={versionHistoryOpen}
          setVersionHistoryOpen={setVersionHistoryOpen}
          isImageMode={isImageMode}
          imageUrl={imageUrl}
          redactedImageUrl={redactedImageUrl}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          visibleBoxes={visibleBoxes}
          visionTypes={recognition.visionTypes}
          getVisionTypeConfig={recognition.getVisionTypeConfig}
          onBackToEdit={() => setStage('preview')}
          onReset={handleReset}
          onDownload={handleDownload}
        />
      )}

      {isLoading && (
        <PlaygroundLoading
          loadingMessage={loadingMessage}
          isImageMode={isImageMode}
          elapsedSec={loadingElapsedSec}
        />
      )}
    </div>
  );
};

/**
 * Playground page — wrapped in PlaygroundProvider so child components
 * can access the playground context directly without prop drilling.
 */
export const Playground: FC = () => (
  <PlaygroundProvider>
    <PlaygroundInner />
  </PlaygroundProvider>
);
