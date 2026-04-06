
import { type FC, type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { showToast } from '@/components/Toast';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { getEntityRiskConfig, getEntityTypeName } from '@/config/entityTypes';
import ImageBBoxEditor from '@/components/ImageBBoxEditor';
import { PlaygroundUpload } from './components/playground-upload';
import { PlaygroundToolbar } from './components/playground-toolbar';
import { PlaygroundEntityPanel } from './components/playground-entity-panel';
import { PlaygroundResult } from './components/playground-result';
import { PlaygroundLoading } from './components/playground-loading';
import { usePlayground } from './hooks/use-playground';
import { clampPopoverInCanvas, previewEntityHoverRingClass, previewEntityMarkStyle } from './utils';
import { getSelectionOffsets } from '@/utils/domSelection';
import type { Entity } from './types';

export const Playground: FC = () => {
  const t = useT();
  const ctx = usePlayground();
  const {
    stage,
    setStage,
    fileInfo,
    content,
    isImageMode,
    entities,
    applyEntities,
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
    mergeVisibleBoxes,
    openPopout,
    recognition,
    imageHistory,
  } = ctx;

  const [selectedText, setSelectedText] = useState<{ text: string; start: number; end: number } | null>(null);
  const [selectionPos, setSelectionPos] = useState<{ left: number; top: number } | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [selectedOverlapIds, setSelectedOverlapIds] = useState<string[]>([]);
  const [clickedEntity, setClickedEntity] = useState<Entity | null>(null);
  const [entityPopupPos, setEntityPopupPos] = useState<{ left: number; top: number } | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const textScrollRef = useRef<HTMLDivElement>(null);
  const selectionRangeRef = useRef<Range | null>(null);

  const { entityTypes, selectedTypes } = recognition;

  useEffect(() => {
    if (!selectedTypeId && entityTypes.length > 0) {
      setSelectedTypeId(entityTypes[0].id);
    }
  }, [entityTypes, selectedTypeId]);

  const clearTextSelection = useCallback(() => {
    selectionRangeRef.current = null;
    setSelectedText(null);
    setSelectionPos(null);
    setSelectedOverlapIds([]);
  }, []);

  const handleTextSelect = useCallback(() => {
    if (isImageMode || clickedEntity) return;

    const selection = window.getSelection();
    if (!selection || !contentRef.current) {
      clearTextSelection();
      return;
    }

    if (selection.isCollapsed) {
      if (!selectedText || !selectionPos) clearTextSelection();
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length < 2) {
      clearTextSelection();
      return;
    }

    const range = selection.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      clearTextSelection();
      return;
    }

    const offsets = getSelectionOffsets(range, contentRef.current);
    const start = offsets?.start ?? content.indexOf(text);
    const end = offsets?.end ?? (start + text.length);
    if (start < 0 || end < 0) {
      clearTextSelection();
      return;
    }

    const overlaps = entities.filter((entity) =>
      (entity.start <= start && entity.end > start) || (entity.start < end && entity.end >= end),
    );

    try {
      selectionRangeRef.current = range.cloneRange();
    } catch {
      clearTextSelection();
      return;
    }

    setSelectedOverlapIds(overlaps.map((entity) => entity.id));
    if (overlaps.length > 0) {
      setSelectedTypeId(overlaps[0].type);
    } else if (!selectedTypeId) {
      const fallbackType = entityTypes.find((entityType) => selectedTypes.includes(entityType.id))?.id || entityTypes[0]?.id;
      if (fallbackType) setSelectedTypeId(fallbackType);
    }

    setSelectionPos(null);
    setSelectedText({ text, start, end });
  }, [clearTextSelection, clickedEntity, content, entities, entityTypes, isImageMode, selectedText, selectedTypeId, selectedTypes, selectionPos]);

  useLayoutEffect(() => {
    if (!selectedText) {
      selectionRangeRef.current = null;
      setSelectionPos(null);
      return;
    }

    const root = contentRef.current;
    if (!root) return;

    const update = () => {
      const range = selectionRangeRef.current;
      if (!range || range.collapsed) {
        setSelectionPos(null);
        return;
      }

      let rect: DOMRect;
      try {
        rect = range.getBoundingClientRect();
      } catch {
        setSelectionPos(null);
        return;
      }

      if (rect.width === 0 && rect.height === 0) return;
      setSelectionPos(clampPopoverInCanvas(rect, root.getBoundingClientRect(), 320, 280));
    };

    update();

    const scrollEl = textScrollRef.current;
    window.addEventListener('resize', update);
    scrollEl?.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('resize', update);
      scrollEl?.removeEventListener('scroll', update);
    };
  }, [selectedText]);

  useLayoutEffect(() => {
    if (!clickedEntity) {
      setEntityPopupPos(null);
      return;
    }

    const root = contentRef.current;
    if (!root) return;

    const update = () => {
      let element: HTMLElement | null = null;
      try {
        element = root.querySelector(`[data-entity-id="${CSS.escape(clickedEntity.id)}"]`);
      } catch {
        element = null;
      }

      if (!element) return;
      setEntityPopupPos(clampPopoverInCanvas(element.getBoundingClientRect(), root.getBoundingClientRect(), 240, 120));
    };

    update();

    const scrollEl = textScrollRef.current;
    window.addEventListener('resize', update);
    scrollEl?.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('resize', update);
      scrollEl?.removeEventListener('scroll', update);
    };
  }, [clickedEntity]);

  const addManualEntity = useCallback((typeId: string) => {
    if (!selectedText) return;

    const newEntity: Entity = {
      id: `manual_${Date.now()}`,
      text: selectedText.text,
      type: typeId,
      start: selectedText.start,
      end: selectedText.end,
      selected: true,
      source: 'manual',
    };

    const nextEntities = entities
      .filter((entity) => !selectedOverlapIds.includes(entity.id))
      .concat(newEntity)
      .sort((left, right) => left.start - right.start);

    applyEntities(nextEntities);
    showToast(
      selectedOverlapIds.length > 0
        ? t('playground.toast.updated')
        : t('playground.toast.added').replace('{name}', recognition.getTypeConfig(typeId).name),
      'success',
    );
    clearTextSelection();
    window.getSelection()?.removeAllRanges();
  }, [applyEntities, clearTextSelection, entities, recognition, selectedOverlapIds, selectedText, t]);

  const removeSelectedEntities = useCallback(() => {
    if (selectedOverlapIds.length === 0) return;
    applyEntities(entities.filter((entity) => !selectedOverlapIds.includes(entity.id)));
    clearTextSelection();
    window.getSelection()?.removeAllRanges();
    showToast(t('playground.toast.removed'), 'info');
  }, [applyEntities, clearTextSelection, entities, selectedOverlapIds, t]);

  const handleEntityClick = useCallback((entity: Entity, event: ReactMouseEvent) => {
    event.stopPropagation();
    clearTextSelection();
    setClickedEntity(entity);
    setSelectedTypeId(entity.type);
  }, [clearTextSelection]);

  const confirmRemoveEntity = useCallback(() => {
    if (clickedEntity) {
      applyEntities(entities.filter((entity) => entity.id !== clickedEntity.id));
      showToast(t('playground.toast.removed'), 'info');
    }
    setClickedEntity(null);
    setEntityPopupPos(null);
  }, [applyEntities, clickedEntity, entities, t]);

  const renderMarkedContent = () => {
    if (!content) {
      return <p className="text-muted-foreground">{t('playground.noContent')}</p>;
    }

    const sortedEntities = [...entities].sort((left, right) => left.start - right.start);
    const segments: ReactNode[] = [];
    let lastEnd = 0;

    sortedEntities.forEach((entity) => {
      if (entity.start < lastEnd) return;

      if (entity.start > lastEnd) {
        segments.push(<span key={`text-${lastEnd}`}>{content.slice(lastEnd, entity.start)}</span>);
      }

      const typeName = getEntityTypeName(entity.type);
      const sourceLabel = entity.source === 'regex'
        ? t('playground.sourceRegex')
        : entity.source === 'manual'
          ? t('playground.sourceManual')
          : t('playground.sourceAi');

      segments.push(
        <mark
          key={entity.id}
          data-entity-id={entity.id}
          onClick={(event) => handleEntityClick(entity, event)}
          style={previewEntityMarkStyle(entity)}
          className={`inline cursor-pointer rounded-sm px-0.5 py-[1px] transition-all hover:brightness-95 hover:ring-2 hover:ring-offset-1 hover:shadow-sm ${previewEntityHoverRingClass(entity.source)}`}
          title={`${typeName} [${sourceLabel}]`}
        >
          {content.slice(entity.start, entity.end)}
        </mark>,
      );

      lastEnd = entity.end;
    });

    if (lastEnd < content.length) {
      segments.push(<span key="content-end">{content.slice(lastEnd)}</span>);
    }

    return segments;
  };

  return (
    <div className="playground-root saas-page flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background" data-testid="playground">
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
                isImageMode
                  ? t('playground.previewHint.image')
                  : t('playground.previewHint.text')
              }
              onPopout={isImageMode ? openPopout : undefined}
            />

            <div
              ref={contentRef}
              onMouseUp={handleTextSelect}
              onKeyUp={handleTextSelect}
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
                    />
                  )}
                </div>
              ) : (
                <div ref={textScrollRef} className="flex-1 min-h-0 overflow-auto">
                  <div className="p-4 font-[system-ui] text-sm leading-relaxed whitespace-pre-wrap">
                    {renderMarkedContent()}
                  </div>
                </div>
              )}

              {!isImageMode && selectedText && selectionPos && (
                <div
                  className="fixed z-50 w-[320px] animate-scale-in rounded-xl border border-border bg-popover shadow-lg"
                  style={{ left: selectionPos.left, top: selectionPos.top }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                    <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      &ldquo;{selectedText.text}&rdquo;
                    </p>
                    <button
                      type="button"
                      onClick={clearTextSelection}
                      className="ml-2 shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M11.782 4.032a.575.575 0 10-.813-.814L7.5 6.687 4.032 3.218a.575.575 0 00-.814.814L6.687 7.5l-3.469 3.468a.575.575 0 00.814.814L7.5 8.313l3.469 3.469a.575.575 0 00.813-.814L8.313 7.5l3.469-3.468z" fill="currentColor"/></svg>
                    </button>
                  </div>

                  <div className="max-h-[240px] overflow-y-auto overscroll-contain px-2 py-2">
                    <div className="grid grid-cols-3 gap-1">
                      {entityTypes.map((et) => {
                        const risk = getEntityRiskConfig(et.id);
                        const active = selectedTypeId === et.id;
                        return (
                          <button
                            key={et.id}
                            type="button"
                            onClick={() => setSelectedTypeId(et.id)}
                            className={cn(
                              'truncate rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors',
                              active ? 'font-medium shadow-sm ring-1 ring-inset' : 'hover:bg-accent',
                            )}
                            style={active ? { backgroundColor: risk.bgColor, color: risk.textColor, '--tw-ring-color': risk.color } as React.CSSProperties : undefined}
                          >
                            {getEntityTypeName(et.id)}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setSelectedTypeId('CUSTOM')}
                        className={cn(
                          'truncate rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors',
                          selectedTypeId === 'CUSTOM' ? 'bg-muted font-medium shadow-sm ring-1 ring-inset ring-border' : 'hover:bg-accent',
                        )}
                      >
                        {t('playground.customType')}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2">
                    <Button
                      size="sm"
                      onClick={() => addManualEntity(selectedTypeId)}
                      disabled={!selectedTypeId}
                      className="h-7 flex-1 text-xs"
                    >
                      {selectedOverlapIds.length > 0 ? t('playground.updateAnnotation') : t('playground.addAnnotation')}
                    </Button>
                    {selectedOverlapIds.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={removeSelectedEntities} className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive">
                        {t('playground.remove')}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {!isImageMode && clickedEntity && entityPopupPos && (() => {
                const risk = getEntityRiskConfig(clickedEntity.type);
                return (
                  <div
                    className="fixed z-50 w-[240px] animate-scale-in rounded-xl border border-border bg-popover p-3 shadow-lg"
                    style={{ left: entityPopupPos.left, top: entityPopupPos.top }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onMouseUp={(event) => event.stopPropagation()}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ backgroundColor: risk.bgColor, color: risk.textColor }}
                        >
                          {getEntityTypeName(clickedEntity.type)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{clickedEntity.text}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setClickedEntity(null); setEntityPopupPos(null); }}
                        className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M11.782 4.032a.575.575 0 10-.813-.814L7.5 6.687 4.032 3.218a.575.575 0 00-.814.814L6.687 7.5l-3.469 3.468a.575.575 0 00.814.814L7.5 8.313l3.469 3.469a.575.575 0 00.813-.814L8.313 7.5l3.469-3.468z" fill="currentColor"/></svg>
                      </button>
                    </div>
                    <Button size="sm" variant="ghost" onClick={confirmRemoveEntity} className="h-7 w-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive">
                      {t('playground.removeAnnotation')}
                    </Button>
                  </div>
                );
              })()}
            </div>
          </div>

          <PlaygroundEntityPanel
            isImageMode={isImageMode}
            isLoading={isLoading}
            entities={entities}
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
            onEntityClick={handleEntityClick}
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
