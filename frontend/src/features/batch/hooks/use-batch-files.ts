// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import { useDropzone } from 'react-dropzone';
import { fileApi } from '@/services/api';
import { FileType } from '@/types';
import { deleteJobItem, getJob } from '@/services/jobsApi';
import { batchGetFileRaw } from '@/services/batchPipeline';
import { localizeErrorMessage } from '@/utils/localizeError';
import type { BatchRow, Step } from '../types';
import { mapBackendStatus, deriveReviewConfirmed } from './use-batch-wizard-utils';

export interface BatchFilesState {
  rows: BatchRow[];
  setRows: React.Dispatch<React.SetStateAction<BatchRow[]>>;
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedIds: string[];
  loading: boolean;
  msg: { text: string; tone: 'neutral' | 'ok' | 'warn' | 'err' } | null;
  setMsg: (msg: { text: string; tone: 'neutral' | 'ok' | 'warn' | 'err' } | null) => void;
  toggle: (id: string) => void;
  removeRow: (fileId: string) => Promise<void>;
  clearRows: () => Promise<void>;
  getRootProps: ReturnType<typeof useDropzone>['getRootProps'];
  getInputProps: ReturnType<typeof useDropzone>['getInputProps'];
  isDragActive: boolean;
  failedRows: BatchRow[];
  analyzeRunning: boolean;
  hasItemsInProgress: boolean;
  batchGroupIdRef: React.MutableRefObject<string | null>;
  itemIdByFileIdRef: React.MutableRefObject<Record<string, string>>;
}

export function useBatchFiles(
  step: Step,
  activeJobId: string | null,
  isPreviewMode: boolean,
): BatchFilesState {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const batchGroupIdRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [analyzeRunning, _setAnalyzeRunning] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'neutral' | 'ok' | 'warn' | 'err' } | null>(
    null,
  );
  const itemIdByFileIdRef = useRef<Record<string, string>>({});

  const failedRows = useMemo(() => rows.filter((r) => r.analyzeStatus === 'failed'), [rows]);
  const hasItemsInProgress = useMemo(
    () =>
      rows.some(
        (r) =>
          r.analyzeStatus === 'pending' ||
          r.analyzeStatus === 'parsing' ||
          r.analyzeStatus === 'analyzing',
      ),
    [rows],
  );
  const selectedIds = rows.filter((r) => selected.has(r.file_id)).map((r) => r.file_id);

  // ── File upload ──
  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (!accepted.length) return;
      setLoading(true);
      setMsg(null);
      if (isPreviewMode) {
        const uploaded = accepted.map((file, index) => {
          const name = file.name.toLowerCase();
          const isImage =
            name.endsWith('.png') ||
            name.endsWith('.jpg') ||
            name.endsWith('.jpeg') ||
            name.endsWith('.pdf');
          const fileType =
            name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')
              ? FileType.IMAGE
              : name.endsWith('.pdf')
                ? FileType.PDF
                : name.endsWith('.doc')
                  ? FileType.DOC
                  : FileType.DOCX;
          return {
            file_id: `preview-upload-${Date.now()}-${index}`,
            original_filename: file.name,
            file_size: file.size,
            file_type: fileType,
            created_at: new Date().toISOString(),
            has_output: false,
            reviewConfirmed: false,
            entity_count: 0,
            analyzeStatus: 'pending' as const,
            isImageMode: isImage,
          };
        });
        setRows((prev) => [...uploaded, ...prev]);
        setSelected((prev) => {
          const next = new Set(prev);
          uploaded.forEach((row) => next.add(row.file_id));
          return next;
        });
        setMsg({
          text: t('batchWizard.previewFilesAdded').replace('{count}', String(uploaded.length)),
          tone: 'ok',
        });
        setLoading(false);
        return;
      }
      const uploaded: BatchRow[] = [];
      const failed: string[] = [];
      try {
        if (!batchGroupIdRef.current) {
          batchGroupIdRef.current =
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `bg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        }
        const bg = batchGroupIdRef.current;
        for (const file of accepted) {
          try {
            const r = await fileApi.upload(file, bg, activeJobId ?? undefined, 'batch');
            const ft = String(r.file_type ?? '').toLowerCase();
            const isImg =
              ft === 'image' ||
              ft === 'jpg' ||
              ft === 'jpeg' ||
              ft === 'png' ||
              ft === 'pdf_scanned';
            uploaded.push({
              file_id: r.file_id,
              original_filename: r.filename,
              file_size: r.file_size,
              file_type: r.file_type,
              created_at: r.created_at ?? undefined,
              has_output: false,
              reviewConfirmed: false,
              entity_count: 0,
              analyzeStatus: 'pending',
              isImageMode: isImg,
            });
          } catch {
            failed.push(file.name);
          }
        }
        if (uploaded.length) {
          setRows((prev) => [...uploaded, ...prev]);
          setSelected((prev) => {
            const n = new Set(prev);
            uploaded.forEach((u) => n.add(u.file_id));
            return n;
          });
          if (activeJobId) {
            try {
              const d = await getJob(activeJobId);
              const m = { ...itemIdByFileIdRef.current };
              for (const it of d.items) m[it.file_id] = it.id;
              itemIdByFileIdRef.current = m;
            } catch {
              /* ignore */
            }
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [activeJobId, isPreviewMode],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: loading,
    multiple: true,
  });

  // ── Polling ──
  // Tracks file_ids whose file_info we've already synced post-parse. Upload
  // records file_type from magic bytes ("pdf"), but the parse step may reclassify
  // it to "pdf_scanned" once the text-density heuristic decides. Without this
  // sync the step4 UI would still route scanned PDFs through the text review pane.
  const syncedFileInfoRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isPreviewMode) return;
    if (step !== 3 || !activeJobId || !hasItemsInProgress || analyzeRunning) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const detail = await getJob(activeJobId);
        if (cancelled) return;
        const itemMap = new Map(detail.items.map((it) => [it.file_id, it]));
        setRows((prev) =>
          prev.map((r) => {
            const item = itemMap.get(r.file_id);
            if (!item) return r;
            return {
              ...r,
              analyzeStatus: mapBackendStatus(item.status),
              reviewConfirmed: deriveReviewConfirmed(item),
              has_output: Boolean(item.has_output),
              isImageMode: r.isImageMode ?? false,
              analyzeError:
                item.status === 'failed' || item.status === 'cancelled'
                  ? item.error_message || t('batchWizard.actionFailed')
                  : undefined,
              entity_count:
                typeof item.entity_count === 'number' ? item.entity_count : r.entity_count,
            };
          }),
        );

        // For each item that's past parsing, refresh file_type/isImageMode from
        // the authoritative file_store so scanned PDFs get routed correctly.
        const needsSync: string[] = [];
        for (const it of detail.items) {
          const status = String(it.status);
          const parsed = status !== 'pending' && status !== 'parsing';
          if (parsed && !syncedFileInfoRef.current.has(it.file_id)) {
            needsSync.push(it.file_id);
          }
        }
        if (needsSync.length) {
          const updates: Record<string, { fileType: FileType; isImageMode: boolean }> = {};
          await Promise.all(
            needsSync.map(async (fid) => {
              try {
                const info = await batchGetFileRaw(fid);
                if (cancelled) return;
                syncedFileInfoRef.current.add(fid);
                const ftRaw = String(info.file_type ?? '').toLowerCase();
                const isScanned = Boolean(info.is_scanned);
                const resolvedType: FileType =
                  ftRaw === 'image' || ftRaw === 'jpg' || ftRaw === 'jpeg' || ftRaw === 'png'
                    ? FileType.IMAGE
                    : ftRaw === 'pdf_scanned' || (ftRaw === 'pdf' && isScanned)
                      ? FileType.PDF_SCANNED
                      : ftRaw === 'pdf'
                        ? FileType.PDF
                        : ftRaw === 'doc'
                          ? FileType.DOC
                          : FileType.DOCX;
                updates[fid] = {
                  fileType: resolvedType,
                  isImageMode:
                    resolvedType === FileType.IMAGE || resolvedType === FileType.PDF_SCANNED,
                };
              } catch {
                /* ignore — will retry on next poll tick */
              }
            }),
          );
          if (!cancelled && Object.keys(updates).length) {
            setRows((prev) =>
              prev.map((r) => {
                const u = updates[r.file_id];
                if (!u) return r;
                if (r.file_type === u.fileType && r.isImageMode === u.isImageMode) return r;
                return { ...r, file_type: u.fileType, isImageMode: u.isImageMode };
              }),
            );
          }
        }
      } catch {
        /* ignore network jitter */
      }
    };
    const timer = setInterval(poll, 1000);
    poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, activeJobId, hasItemsInProgress, analyzeRunning, isPreviewMode]);

  // Reset the sync cache whenever we switch jobs so a new job re-syncs cleanly.
  useEffect(() => {
    syncedFileInfoRef.current = new Set();
  }, [activeJobId]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const dropRowLocally = useCallback((fileId: string) => {
    setRows((prev) => prev.filter((r) => r.file_id !== fileId));
    setSelected((prev) => {
      if (!prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
    if (itemIdByFileIdRef.current[fileId]) {
      const { [fileId]: _, ...rest } = itemIdByFileIdRef.current;
      itemIdByFileIdRef.current = rest;
    }
  }, []);

  const removeRow = useCallback(
    async (fileId: string) => {
      if (isPreviewMode) {
        dropRowLocally(fileId);
        return;
      }
      const itemId = itemIdByFileIdRef.current[fileId];
      try {
        if (activeJobId && itemId) {
          await deleteJobItem(activeJobId, itemId);
        } else {
          // No linked job item (e.g. file uploaded outside a batch job) — delete
          // the file directly so it doesn't linger in the upload store.
          await fileApi.delete(fileId);
        }
        dropRowLocally(fileId);
      } catch (err) {
        setMsg({ text: localizeErrorMessage(err, 'batchWizard.actionFailed'), tone: 'err' });
      }
    },
    [activeJobId, dropRowLocally, isPreviewMode],
  );

  const clearRows = useCallback(async () => {
    if (isPreviewMode) {
      setRows([]);
      setSelected(new Set());
      itemIdByFileIdRef.current = {};
      return;
    }
    const ids = rows.map((r) => r.file_id);
    if (!ids.length) return;
    const failures: string[] = [];
    for (const fid of ids) {
      const itemId = itemIdByFileIdRef.current[fid];
      try {
        if (activeJobId && itemId) {
          await deleteJobItem(activeJobId, itemId);
        } else {
          await fileApi.delete(fid);
        }
        dropRowLocally(fid);
      } catch (err) {
        failures.push(fid);
        // eslint-disable-next-line no-console
        console.warn('clearRows: failed to remove', fid, err);
      }
    }
    if (failures.length) {
      setMsg({ text: t('batchWizard.actionFailed'), tone: 'err' });
    }
  }, [activeJobId, dropRowLocally, isPreviewMode, rows]);

  return {
    rows,
    setRows,
    selected,
    setSelected,
    selectedIds,
    loading,
    msg,
    setMsg,
    toggle,
    removeRow,
    clearRows,
    getRootProps,
    getInputProps,
    isDragActive,
    failedRows,
    analyzeRunning,
    hasItemsInProgress,
    batchGroupIdRef,
    itemIdByFileIdRef,
  };
}
