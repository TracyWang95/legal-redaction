// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { authFetch, authenticatedBlobUrl, revokeObjectUrl } from '@/services/api-client';
import { showToast } from '@/components/Toast';
import { t } from '@/i18n';
import { localizeErrorMessage } from '@/utils/localizeError';
import { runVisionDetection, safeJson } from '../utils';
import type { FileInfo, BoundingBox, VisionTypeConfig } from '../types';

export interface UsePlaygroundImageOptions {
  fileInfo: FileInfo | null;
}

interface PreviewImageResponse {
  image_base64?: string;
}

function asPngDataUrl(imageBase64: string | undefined): string {
  if (!imageBase64) return '';
  return imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
}

export function usePlaygroundImage(options: UsePlaygroundImageOptions) {
  const { fileInfo } = options;

  const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [imageUrl, setImageUrl] = useState('');
  const [redactedImageUrl, setRedactedImageUrl] = useState('');
  const imageHistory = useUndoRedo<BoundingBox[]>();

  const imageObjectUrlRef = useRef<string | null>(null);
  const redactedImageObjectUrlRef = useRef<string | null>(null);
  const popoutChannelRef = useRef<BroadcastChannel | null>(null);
  const popoutTimerRef = useRef<number | null>(null);
  const visionAbortRef = useRef<AbortController | null>(null);
  const currentPageRef = useRef(currentPage);
  // Per-page cached original image (data URL). Switches pages instantly and
  // avoids the blank-flash while the POST /preview-image is in flight.
  const pageImageCacheRef = useRef<Map<string, string>>(new Map());

  const totalPages = Math.max(1, Number(fileInfo?.page_count || 1));
  const isScannedPdfMode =
    !!fileInfo &&
    (fileInfo.file_type === 'pdf_scanned' ||
      (fileInfo.file_type === 'pdf' && !!fileInfo.is_scanned));
  const visibleBoxes = boundingBoxes.filter((box) => Number(box.page || 1) === currentPage);

  useEffect(() => {
    setCurrentPage(1);
    pageImageCacheRef.current.clear();
  }, [fileInfo?.file_id]);

  // --- Image URL resolution ---
  const imageUrlRaw = fileInfo ? `/api/v1/files/${fileInfo.file_id}/download` : '';

  const prefetchPage = useCallback(
    (fileId: string, page: number) => {
      if (page < 1 || page > totalPages) return;
      const key = `${fileId}:${page}`;
      if (pageImageCacheRef.current.has(key)) return;
      authFetch(`/api/v1/redaction/${fileId}/preview-image?page=${page}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bounding_boxes: [],
          config: {
            replacement_mode: 'structured',
            entity_types: [],
            custom_replacements: {},
          },
        }),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = await safeJson<PreviewImageResponse>(res);
          const resolved = asPngDataUrl(data.image_base64);
          if (resolved) pageImageCacheRef.current.set(key, resolved);
        })
        .catch(() => {
          /* silent prefetch failure */
        });
    },
    [totalPages],
  );

  const scheduleNeighborPrefetch = useCallback(
    (fileId: string, page: number) => {
      // Defer to idle time so the active page's fetch/render isn't contended.
      const defer =
        (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
          .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
      defer(() => prefetchPage(fileId, page - 1));
      defer(() => prefetchPage(fileId, page + 1));
    },
    [prefetchPage],
  );

  useEffect(() => {
    setCurrentPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [totalPages]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      if (popoutTimerRef.current !== null) clearInterval(popoutTimerRef.current);
      popoutChannelRef.current?.close();
      visionAbortRef.current?.abort();
      revokeObjectUrl(imageObjectUrlRef.current);
      revokeObjectUrl(redactedImageObjectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!imageUrlRaw) {
      revokeObjectUrl(imageObjectUrlRef.current);
      imageObjectUrlRef.current = null;
      setImageUrl('');
      return;
    }

    if (isScannedPdfMode && fileInfo) {
      const cacheKey = `${fileInfo.file_id}:${currentPage}`;
      const cached = pageImageCacheRef.current.get(cacheKey);
      if (cached) {
        revokeObjectUrl(imageObjectUrlRef.current);
        imageObjectUrlRef.current = null;
        setImageUrl(cached);
        // Kick off neighbor prefetch without blocking the UI.
        scheduleNeighborPrefetch(fileInfo.file_id, currentPage);
        return;
      }

      authFetch(`/api/v1/redaction/${fileInfo.file_id}/preview-image?page=${currentPage}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bounding_boxes: [],
          config: {
            replacement_mode: 'structured',
            entity_types: [],
            custom_replacements: {},
          },
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await safeJson<PreviewImageResponse>(res);
          const resolved = asPngDataUrl(data.image_base64);
          if (!resolved) throw new Error('Missing image_base64');
          if (cancelled) return;
          pageImageCacheRef.current.set(cacheKey, resolved);
          revokeObjectUrl(imageObjectUrlRef.current);
          imageObjectUrlRef.current = null;
          setImageUrl(resolved);
          scheduleNeighborPrefetch(fileInfo.file_id, currentPage);
        })
        .catch(() => {
          // PDF download URL can't render in <img>, so keep the previous page's
          // image instead of falling back and showing a broken-image icon.
        });
      return () => {
        cancelled = true;
      };
    }

    authenticatedBlobUrl(imageUrlRaw)
      .then((url) => {
        if (cancelled) {
          revokeObjectUrl(url);
          return;
        }
        revokeObjectUrl(imageObjectUrlRef.current);
        imageObjectUrlRef.current = url;
        setImageUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        revokeObjectUrl(imageObjectUrlRef.current);
        imageObjectUrlRef.current = null;
        setImageUrl(imageUrlRaw);
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrlRaw, isScannedPdfMode, fileInfo, currentPage]);

  // --- Redacted image URL resolution ---
  useEffect(() => {
    let cancelled = false;
    if (!fileInfo) {
      revokeObjectUrl(redactedImageObjectUrlRef.current);
      redactedImageObjectUrlRef.current = null;
      setRedactedImageUrl('');
      return;
    }

    if (isScannedPdfMode) {
      const selectedPageBoxes = boundingBoxes
        .filter((box) => Number(box.page || 1) === currentPage && box.selected !== false)
        .map((box) => ({
          ...box,
          page: Number(box.page || currentPage),
        }));

      authFetch(`/api/v1/redaction/${fileInfo.file_id}/preview-image?page=${currentPage}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bounding_boxes: selectedPageBoxes,
          config: {
            replacement_mode: 'structured',
            entity_types: [],
            custom_replacements: {},
          },
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await safeJson<PreviewImageResponse>(res);
          const resolved = asPngDataUrl(data.image_base64);
          if (!resolved) throw new Error('Missing image_base64');
          if (!cancelled) setRedactedImageUrl(resolved);
        })
        .catch(() => {
          // Mirror original image on failure — avoids flashing a broken PDF src
          if (!cancelled && imageUrl) setRedactedImageUrl(imageUrl);
        });
      return;
    }

    const raw = `/api/v1/files/${fileInfo.file_id}/download?redacted=true`;
    authenticatedBlobUrl(raw)
      .then((url) => {
        if (cancelled) {
          revokeObjectUrl(url);
          return;
        }
        revokeObjectUrl(redactedImageObjectUrlRef.current);
        redactedImageObjectUrlRef.current = url;
        setRedactedImageUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        revokeObjectUrl(redactedImageObjectUrlRef.current);
        redactedImageObjectUrlRef.current = null;
        setRedactedImageUrl(raw);
      });
    return () => {
      cancelled = true;
    };
  }, [fileInfo, imageUrl, isScannedPdfMode, boundingBoxes, currentPage]);

  // --- Box operations ---
  const toggleBox = useCallback((id: string) => {
    setBoundingBoxes((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b)),
    );
  }, []);

  const selectAllBoxes = useCallback(
    (allSelectedVisionTypes: string[]) => {
      setBoundingBoxes((prev) =>
        prev.map((b) => ({
          ...b,
          selected:
            Number(b.page || 1) === currentPage ? allSelectedVisionTypes.includes(b.type) : b.selected,
        })),
      );
    },
    [currentPage],
  );

  const deselectAllBoxes = useCallback(() => {
    setBoundingBoxes((prev) =>
      prev.map((b) => ({
        ...b,
        selected: Number(b.page || 1) === currentPage ? false : b.selected,
      })),
    );
  }, [currentPage]);

  const mergeBoxesForPage = useCallback(
    (
      sourceBoxes: BoundingBox[],
      nextBoxes: BoundingBox[],
      prevBoxes: BoundingBox[] = [],
      page = currentPageRef.current,
    ) => {
      const normalizedNext = nextBoxes.map((box) => ({ ...box, page: Number(box.page || page) }));
      const normalizedPrev = prevBoxes.map((box) => ({ ...box, page: Number(box.page || page) }));
      const ids = new Set([...normalizedNext, ...normalizedPrev].map((b) => b.id));
      const otherBoxes = sourceBoxes.filter((b) => !ids.has(b.id));
      return [...otherBoxes, ...normalizedNext];
    },
    [],
  );

  const mergeVisibleBoxes = useCallback(
    (nextBoxes: BoundingBox[], prevBoxes: BoundingBox[] = []) =>
      mergeBoxesForPage(boundingBoxes, nextBoxes, prevBoxes, currentPage),
    [boundingBoxes, currentPage, mergeBoxesForPage],
  );

  // --- Re-run vision recognition ---
  const handleRerunNerImage = useCallback(
    async (
      fileId: string,
      ocrHasTypes: string[],
      hasImageTypes: string[],
      setIsLoading: (v: boolean) => void,
      setLoadingMessage: (v: string) => void,
    ) => {
      visionAbortRef.current?.abort();
      const controller = new AbortController();
      visionAbortRef.current = controller;

      setIsLoading(true);
      setLoadingMessage(t('playground.loading.vision'));
      try {
        const pages = Math.max(1, totalPages);
        setBoundingBoxes([]);
        imageHistory.reset();
        let totalBoxes = 0;
        for (let page = 1; page <= pages; page += 1) {
          setLoadingMessage(`${t('playground.loading.vision')} (${page}/${pages})`);
          let result: Awaited<ReturnType<typeof runVisionDetection>> | null = null;
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
              result = await runVisionDetection(
                fileId,
                ocrHasTypes,
                hasImageTypes,
                controller.signal,
                page,
              );
              break;
            } catch (error) {
              if (controller.signal.aborted) return;
              if (attempt >= 2) throw error;
              setLoadingMessage(`${t('playground.loading.vision')} (${page}/${pages}) · retry ${attempt}`);
            }
          }
          if (!result) {
            throw new Error(t('playground.recognizeFailed'));
          }
          if (controller.signal.aborted) return;
          const pageBoxes = result.boxes.map((box) => ({
            ...box,
            page: Number(box.page || page),
          }));
          totalBoxes += pageBoxes.length;
          setBoundingBoxes((prev) => [...prev, ...pageBoxes]);
        }
        if (controller.signal.aborted) return;
        showToast(
          t('playground.toast.detectedRegions').replace('{count}', String(totalBoxes)),
          'success',
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        showToast(localizeErrorMessage(err, 'playground.recognizeFailed'), 'error');
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setLoadingMessage('');
        }
      }
    },
    [imageHistory, totalPages],
  );

  // --- Popout support ---
  const openPopout = useCallback(
    (visionTypes: VisionTypeConfig[]) => {
      popoutChannelRef.current?.close();
      const ch = new BroadcastChannel('playground-image-popout');
      popoutChannelRef.current = ch;
      const popoutImageUrl = isScannedPdfMode ? imageUrl : imageUrlRaw;

      const sendInit = () => {
        ch.postMessage({
          type: 'init',
          imageUrl: popoutImageUrl,
          rawImageUrl: popoutImageUrl,
          currentPage,
          totalPages,
          boxes: visibleBoxes,
          visionTypes: visionTypes.map((vt) => ({ id: vt.id, name: vt.name, color: '#6366F1' })),
          defaultType: visionTypes[0]?.id || 'CUSTOM',
        });
      };

      ch.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (data?.type === 'popout-ready') sendInit();
        if (data?.type === 'boxes-sync') {
          setBoundingBoxes((prev) => {
            const activePage = currentPageRef.current;
            const visiblePrev = prev.filter((box) => Number(box.page || 1) === activePage);
            return mergeBoxesForPage(prev, data.boxes ?? [], visiblePrev, activePage);
          });
        }
        if (data?.type === 'boxes-commit') {
          const activePage = currentPageRef.current;
          setBoundingBoxes((prev) => {
            const prevAll = mergeBoxesForPage(prev, data.prevBoxes ?? [], data.nextBoxes ?? [], activePage);
            const nextAll = mergeBoxesForPage(prev, data.nextBoxes ?? [], data.prevBoxes ?? [], activePage);
            imageHistory.save(prevAll);
            return nextAll;
          });
        }
        if (data?.type === 'page-change') {
          const nextPage = Number(data.page || 1);
          setCurrentPage(Math.min(Math.max(1, nextPage), totalPages));
        }
      };

      const popup = window.open(
        '/playground/image-editor',
        '_blank',
        'width=1200,height=900,scrollbars=yes,resizable=yes',
      );
      if (popoutTimerRef.current !== null) clearInterval(popoutTimerRef.current);
      popoutTimerRef.current = window.setInterval(() => {
        if (popup && popup.closed) {
          if (popoutTimerRef.current !== null) clearInterval(popoutTimerRef.current);
          popoutTimerRef.current = null;
          ch.close();
          popoutChannelRef.current = null;
        }
      }, 1000);
    },
    [
      isScannedPdfMode,
      imageUrl,
      imageUrlRaw,
      visibleBoxes,
      currentPage,
      totalPages,
      mergeVisibleBoxes,
      mergeBoxesForPage,
      imageHistory,
    ],
  );

  useEffect(() => {
    const channel = popoutChannelRef.current;
    if (!channel) return;
    channel.postMessage({ type: 'boxes-update', boxes: visibleBoxes });
  }, [visibleBoxes]);

  useEffect(() => {
    const channel = popoutChannelRef.current;
    if (!channel) return;
    channel.postMessage({ type: 'page-update', currentPage, totalPages });
  }, [currentPage, totalPages]);

  useEffect(() => {
    const channel = popoutChannelRef.current;
    if (!channel) return;
    channel.postMessage({
      type: 'image-update',
      imageUrl: isScannedPdfMode ? imageUrl : imageUrlRaw || imageUrl,
    });
  }, [imageUrlRaw, imageUrl, isScannedPdfMode]);

  return {
    boundingBoxes,
    setBoundingBoxes,
    visibleBoxes,
    currentPage,
    setCurrentPage,
    totalPages,
    imageUrl,
    redactedImageUrl,
    imageHistory,
    toggleBox,
    selectAllBoxes,
    deselectAllBoxes,
    mergeVisibleBoxes,
    handleRerunNerImage,
    openPopout,
  };
}
