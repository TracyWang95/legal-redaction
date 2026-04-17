// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { authFetch } from '@/services/api-client';
import { showToast } from '@/components/Toast';
import { t } from '@/i18n';
import { localizeErrorMessage } from '@/utils/localizeError';
import { safeJson, runVisionDetection } from '../utils';
import type {
  FileInfo,
  Entity,
  BoundingBox,
  Stage,
  UploadResponse,
  ParseResponse,
  NerResponse,
} from '../types';

export interface PendingFile {
  fileId: string;
  fileType: string;
  isScanned: boolean;
  pageCount: number;
  content: string;
}

export interface UsePlaygroundFileOptions {
  /** Ref to latest selectedOcrHasTypes for use in async callbacks */
  latestOcrHasTypesRef: React.RefObject<string[]>;
  /** Ref to latest selectedHasImageTypes for use in async callbacks */
  latestHasImageTypesRef: React.RefObject<string[]>;
  /** Ref to latest selectedTypes for use in async callbacks */
  latestSelectedTypesRef: React.RefObject<string[]>;
  /** Reset entity history */
  resetEntityHistory: () => void;
  /** Reset image history */
  resetImageHistory: () => void;
  /** Set entities from recognition result */
  setEntities: React.Dispatch<React.SetStateAction<Entity[]>>;
  /** Set bounding boxes from recognition result */
  setBoundingBoxes: React.Dispatch<React.SetStateAction<BoundingBox[]>>;
}

export function usePlaygroundFile(options: UsePlaygroundFileOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [stage, setStage] = useState<Stage>('upload');
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const isImageMode = !!fileInfo && (fileInfo.file_type === 'image' || !!fileInfo.is_scanned);

  // --- Loading elapsed timer ---
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);
  useEffect(() => {
    if (!isLoading) {
      setLoadingElapsedSec(0);
      return;
    }
    setLoadingElapsedSec(0);
    const id = window.setInterval(() => setLoadingElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  // --- Cleanup abort on unmount ---
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const resetRecognizedState = useCallback(() => {
    const opts = optionsRef.current;
    setStage('upload');
    setFileInfo(null);
    setContent('');
    opts.setEntities([]);
    opts.setBoundingBoxes([]);
    opts.resetEntityHistory();
    opts.resetImageHistory();
  }, []);

  // --- File upload ---
  const handleFileDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    setIsLoading(true);

    const opts = optionsRef.current;
    try {
      setLoadingMessage(t('playground.uploading'));
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_source', 'playground');

      const uploadRes = await authFetch('/api/v1/files/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(t('playground.uploadFailed'));
      const uploadData = await safeJson<UploadResponse>(uploadRes);

      setLoadingMessage(t('playground.parsing'));
      const parseRes = await authFetch(`/api/v1/files/${uploadData.file_id}/parse`);
      if (!parseRes.ok) throw new Error(t('playground.parseFailed'));
      const parseData = await safeJson<ParseResponse>(parseRes);

      const isScanned = parseData.is_scanned || false;
      const pageCount = Math.max(1, Number(parseData.page_count || 1));
      const parsedFileType = parseData.file_type || uploadData.file_type;
      const parsedContent = parseData.content || '';
      const parsedPages = Array.isArray(parseData.pages) ? parseData.pages : undefined;

      setFileInfo({
        file_id: uploadData.file_id,
        filename: uploadData.filename,
        file_size: uploadData.file_size,
        file_type: parsedFileType,
        is_scanned: isScanned,
        page_count: pageCount,
        pages: parsedPages,
      });
      setContent(parsedContent);
      opts.setBoundingBoxes([]);
      opts.resetImageHistory();
      opts.setEntities([]);

      setPendingFile({
        fileId: uploadData.file_id,
        fileType: parsedFileType,
        isScanned,
        pageCount,
        content: parsedContent,
      });
    } catch (err) {
      showToast(localizeErrorMessage(err, 'playground.processFailed'), 'error');
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, []);

  // --- Auto-recognition after upload ---
  useEffect(() => {
    if (!pendingFile) return;
    const { fileId, fileType, isScanned, pageCount, content: parsedContent } = pendingFile;
    setPendingFile(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const opts = optionsRef.current;

    const doRecognition = async () => {
      try {
        const isImage = fileType === 'image' || isScanned;
        if (isImage) {
          const ocrTypes = opts.latestOcrHasTypesRef.current;
          const hiTypes = opts.latestHasImageTypesRef.current;
          const vLabel =
            ocrTypes.length > 0 && hiTypes.length > 0
              ? t('playground.loading.visionHybrid')
              : ocrTypes.length > 0
                ? t('playground.loading.visionOcr')
                : hiTypes.length > 0
                  ? t('playground.loading.visionImage')
                  : t('playground.loading.vision');
          setLoadingMessage(vLabel);

          opts.setBoundingBoxes([]);
          opts.resetImageHistory();
          const totalPages = Math.max(1, pageCount);
          let totalBoxes = 0;
          for (let page = 1; page <= totalPages; page += 1) {
            setLoadingMessage(`${vLabel} (${page}/${totalPages})`);
            let result: Awaited<ReturnType<typeof runVisionDetection>> | null = null;
            for (let attempt = 1; attempt <= 2; attempt += 1) {
              try {
                result = await runVisionDetection(fileId, ocrTypes, hiTypes, signal, page);
                break;
              } catch (error) {
                if (signal.aborted) return;
                if (attempt >= 2) throw error;
                setLoadingMessage(`${vLabel} (${page}/${totalPages}) · retry ${attempt}`);
              }
            }
            if (!result) {
              throw new Error(t('playground.recognizeFailed'));
            }
            if (signal.aborted) return;
            const pageBoxes = result.boxes.map((box) => ({
              ...box,
              page: Number(box.page || page),
            }));
            totalBoxes += pageBoxes.length;
            opts.setBoundingBoxes((prev) => [...prev, ...pageBoxes]);
          }

          showToast(
            t('playground.toast.detectedRegions').replace('{count}', String(totalBoxes)),
            'success',
          );
        } else if (parsedContent) {
          setLoadingMessage(t('playground.loading.text'));
          const nerRes = await authFetch(`/api/v1/files/${fileId}/ner/hybrid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_type_ids: opts.latestSelectedTypesRef.current }),
            signal,
          });
          if (signal.aborted) return;

          if (!nerRes.ok) {
            throw new Error(t('playground.recognizeFailed'));
          }

          const nerData = await safeJson<NerResponse>(nerRes);
          const entitiesWithSource = (nerData.entities || []).map(
            (e: Record<string, unknown>, idx: number) =>
              ({
                ...e,
                id: e.id || `entity_${idx}`,
                selected: true,
                source: e.source || 'llm',
              }) as Entity,
          );
          opts.setEntities(entitiesWithSource);
          opts.resetEntityHistory();
          showToast(
            t('playground.toast.detectedEntities').replace(
              '{count}',
              String(entitiesWithSource.length),
            ),
            'success',
          );
        }
        if (signal.aborted) return;
        setStage('preview');
      } catch (err) {
        if (signal.aborted) return;
        resetRecognizedState();
        showToast(localizeErrorMessage(err, 'playground.recognizeFailed'), 'error');
      } finally {
        if (!signal.aborted) {
          setIsLoading(false);
          setLoadingMessage('');
        }
      }
    };

    doRecognition();
  }, [pendingFile, resetRecognizedState]);

  // --- Dropzone ---
  const dropzone = useDropzone({
    onDrop: handleFileDrop,
    accept: {
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxFiles: 1,
    disabled: isLoading,
  });

  return {
    stage,
    setStage,
    fileInfo,
    setFileInfo,
    content,
    setContent,
    isLoading,
    setIsLoading,
    loadingMessage,
    setLoadingMessage,
    loadingElapsedSec,
    isImageMode,
    dropzone,
  };
}
