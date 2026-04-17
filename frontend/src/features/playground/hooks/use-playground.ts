// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from '@/components/Toast';
import { t } from '@/i18n';
import { authFetch, downloadFile } from '@/services/api-client';
import type { VersionHistoryEntry } from '@/types';
import { localizeErrorMessage } from '@/utils/localizeError';
import { safeJson } from '../utils';
import type { RedactionResult } from '../types';
import { usePlaygroundEntities } from './use-playground-entities';
import { usePlaygroundFile } from './use-playground-file';
import { usePlaygroundHistory } from './use-playground-history';
import { usePlaygroundImage } from './use-playground-image';
import { usePlaygroundRecognition } from './use-playground-recognition';

export function usePlayground() {
  const recognition = usePlaygroundRecognition();

  const latestOcrHasTypesRef = useRef(recognition.selectedOcrHasTypes);
  const latestHasImageTypesRef = useRef(recognition.selectedHasImageTypes);
  const latestSelectedTypesRef = useRef(recognition.selectedTypes);
  latestOcrHasTypesRef.current = recognition.selectedOcrHasTypes;
  latestHasImageTypesRef.current = recognition.selectedHasImageTypes;
  latestSelectedTypesRef.current = recognition.selectedTypes;

  const entityCtx = usePlaygroundEntities();

  const [redactionReport, setRedactionReport] = useState<Record<string, unknown> | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [versionHistory, setVersionHistory] = useState<VersionHistoryEntry[]>([]);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [redactedCount, setRedactedCount] = useState(0);
  const [entityMap, setEntityMap] = useState<Record<string, string>>({});
  const latestFileIdRef = useRef<string | null>(null);
  const asyncResultEpochRef = useRef(0);

  const fileCtx = usePlaygroundFile({
    latestOcrHasTypesRef,
    latestHasImageTypesRef,
    latestSelectedTypesRef,
    resetEntityHistory: entityCtx.entityHistory.reset,
    resetImageHistory: () => imageCtx.imageHistory.reset(),
    setEntities: entityCtx.setEntities,
    setBoundingBoxes: (val) => imageCtx.setBoundingBoxes(val),
  });

  const imageCtx = usePlaygroundImage({
    fileInfo: fileCtx.fileInfo,
  });

  const { setTypeTab } = recognition;
  useEffect(() => {
    setTypeTab(fileCtx.isImageMode ? 'vision' : 'text');
  }, [fileCtx.isImageMode, setTypeTab]);

  useEffect(() => {
    latestFileIdRef.current = fileCtx.fileInfo?.file_id ?? null;
    asyncResultEpochRef.current += 1;
  }, [fileCtx.fileInfo?.file_id]);

  const allSelectedVisionTypes = useMemo(
    () => [...recognition.selectedOcrHasTypes, ...recognition.selectedHasImageTypes],
    [recognition.selectedOcrHasTypes, recognition.selectedHasImageTypes],
  );

  const historyCtx = usePlaygroundHistory({
    isImageMode: fileCtx.isImageMode,
    entities: entityCtx.entities,
    setEntities: entityCtx.setEntities,
    boundingBoxes: imageCtx.boundingBoxes,
    visibleBoxes: imageCtx.visibleBoxes,
    setBoundingBoxes: imageCtx.setBoundingBoxes,
    entityHistory: entityCtx.entityHistory,
    imageHistory: imageCtx.imageHistory,
    allSelectedVisionTypes,
  });

  const canApplyAsyncResult = useCallback((fileId: string, epoch: number) => {
    return latestFileIdRef.current === fileId && asyncResultEpochRef.current === epoch;
  }, []);

  const handleRerunNer = useCallback(async () => {
    if (!fileCtx.fileInfo) return;
    if (fileCtx.isImageMode) {
      await imageCtx.handleRerunNerImage(
        fileCtx.fileInfo.file_id,
        recognition.selectedOcrHasTypes,
        recognition.selectedHasImageTypes,
        fileCtx.setIsLoading,
        fileCtx.setLoadingMessage,
      );
    } else {
      await entityCtx.handleRerunNerText(
        fileCtx.fileInfo.file_id,
        recognition.selectedTypes,
        fileCtx.setIsLoading,
        fileCtx.setLoadingMessage,
      );
    }
  }, [entityCtx, fileCtx, imageCtx, recognition]);

  const presetSeqRef = useRef(recognition.presetApplySeq);
  useEffect(() => {
    if (recognition.presetApplySeq === presetSeqRef.current) return;
    presetSeqRef.current = recognition.presetApplySeq;
    if (!fileCtx.fileInfo || fileCtx.isLoading) return;
    if (fileCtx.stage !== 'preview') return;
    void handleRerunNer();
  }, [
    recognition.presetApplySeq,
    fileCtx.fileInfo,
    fileCtx.isLoading,
    fileCtx.stage,
    handleRerunNer,
  ]);

  const handleRedact = useCallback(async () => {
    if (!fileCtx.fileInfo) return;

    const fileId = fileCtx.fileInfo.file_id;
    fileCtx.setIsLoading(true);
    fileCtx.setLoadingMessage(t('playground.redacting'));

    try {
      const selectedEntities = entityCtx.entities.filter((e) => e.selected);
      const selectedBoxes = imageCtx.boundingBoxes.filter((b) => b.selected);

      const res = await authFetch('/api/v1/redaction/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId,
          entities: selectedEntities,
          bounding_boxes: selectedBoxes,
          config: {
            replacement_mode: recognition.replacementMode,
            entity_types: [],
            custom_replacements: {},
          },
        }),
      });

      if (!res.ok) throw new Error(t('playground.redactFailed'));
      const result = await safeJson<RedactionResult>(res);
      setEntityMap(result.entity_map || {});
      setRedactedCount(result.redacted_count || 0);
      fileCtx.setStage('result');

      latestFileIdRef.current = fileId;
      const asyncResultEpoch = asyncResultEpochRef.current + 1;
      asyncResultEpochRef.current = asyncResultEpoch;

      const loadAsyncResult = async <T,>(url: string): Promise<T> => {
        const response = await authFetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load ${url}`);
        }
        return safeJson<T>(response);
      };

      loadAsyncResult<Record<string, unknown>>(`/api/v1/redaction/${fileId}/report`)
        .then((data) => {
          if (canApplyAsyncResult(fileId, asyncResultEpoch)) {
            setRedactionReport(data);
          }
        })
        .catch(() => {
          if (canApplyAsyncResult(fileId, asyncResultEpoch)) {
            setRedactionReport(null);
          }
        });

      loadAsyncResult<{ versions?: VersionHistoryEntry[] }>(`/api/v1/redaction/${fileId}/versions`)
        .then((data) => {
          if (canApplyAsyncResult(fileId, asyncResultEpoch)) {
            setVersionHistory(data.versions || []);
          }
        })
        .catch(() => {
          if (canApplyAsyncResult(fileId, asyncResultEpoch)) {
            setVersionHistory([]);
          }
        });

      showToast(`Completed ${result.redacted_count} redactions.`, 'success');
    } catch (err) {
      showToast(localizeErrorMessage(err, 'playground.redactFailed'), 'error');
    } finally {
      fileCtx.setIsLoading(false);
      fileCtx.setLoadingMessage('');
    }
  }, [
    canApplyAsyncResult,
    entityCtx.entities,
    fileCtx,
    imageCtx.boundingBoxes,
    recognition.replacementMode,
  ]);

  const handleReset = useCallback(() => {
    asyncResultEpochRef.current += 1;
    latestFileIdRef.current = null;
    fileCtx.setStage('upload');
    fileCtx.setFileInfo(null);
    fileCtx.setContent('');
    entityCtx.setEntities([]);
    setRedactedCount(0);
    setEntityMap({});
    setRedactionReport(null);
    setReportOpen(false);
    entityCtx.entityHistory.reset();
    imageCtx.setBoundingBoxes([]);
    imageCtx.imageHistory.reset();
    setVersionHistory([]);
    setVersionHistoryOpen(false);
  }, [entityCtx, fileCtx, imageCtx]);

  const handleDownload = useCallback(() => {
    if (!fileCtx.fileInfo) return;
    downloadFile(
      `/api/v1/files/${fileCtx.fileInfo.file_id}/download?redacted=true`,
      `redacted_${fileCtx.fileInfo.filename}`,
    ).catch(() => {});
  }, [fileCtx.fileInfo]);

  const openPopout = useCallback(() => {
    imageCtx.openPopout(recognition.visionTypes);
  }, [imageCtx, recognition.visionTypes]);

  return {
    stage: fileCtx.stage,
    setStage: fileCtx.setStage,
    fileInfo: fileCtx.fileInfo,
    content: fileCtx.content,
    isImageMode: fileCtx.isImageMode,
    entities: entityCtx.entities,
    setEntities: entityCtx.setEntities,
    applyEntities: entityCtx.applyEntities,
    boundingBoxes: imageCtx.boundingBoxes,
    setBoundingBoxes: imageCtx.setBoundingBoxes,
    visibleBoxes: imageCtx.visibleBoxes,
    isLoading: fileCtx.isLoading,
    loadingMessage: fileCtx.loadingMessage,
    loadingElapsedSec: fileCtx.loadingElapsedSec,
    entityMap,
    redactedCount,
    redactionReport,
    reportOpen,
    setReportOpen,
    versionHistory,
    versionHistoryOpen,
    setVersionHistoryOpen,
    selectedCount: historyCtx.selectedCount,
    canUndo: historyCtx.canUndo,
    canRedo: historyCtx.canRedo,
    handleUndo: historyCtx.handleUndo,
    handleRedo: historyCtx.handleRedo,
    entityHistory: entityCtx.entityHistory,
    imageHistory: imageCtx.imageHistory,
    selectAll: historyCtx.selectAll,
    deselectAll: historyCtx.deselectAll,
    toggleBox: imageCtx.toggleBox,
    removeEntity: entityCtx.removeEntity,
    handleRerunNer,
    handleRedact,
    handleReset,
    handleDownload,
    dropzone: fileCtx.dropzone,
    imageUrl: imageCtx.imageUrl,
    redactedImageUrl: imageCtx.redactedImageUrl,
    currentPage: imageCtx.currentPage,
    setCurrentPage: imageCtx.setCurrentPage,
    totalPages: imageCtx.totalPages,
    mergeVisibleBoxes: imageCtx.mergeVisibleBoxes,
    openPopout,
    recognition,
  };
}
