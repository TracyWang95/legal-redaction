// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaygroundFile } from '../use-playground-file';

const dropzoneState = vi.hoisted(() => ({
  onDrop: null as ((files: File[], rejected?: Array<{ file: File; errors: Array<{ code: string; message: string }> }>) => Promise<void>) | null,
  onDropRejected: null as ((rejected: Array<{ file: File; errors: Array<{ code: string; message: string }> }>) => void) | null,
  accept: null as Record<string, string[]> | null,
  noClick: null as boolean | null,
  maxSize: null as number | null,
}));

const mockedModules = vi.hoisted(() => ({
  showToast: vi.fn(),
  authFetch: vi.fn(),
}));

vi.mock('react-dropzone', () => ({
  useDropzone: vi.fn(
    (options: {
      onDrop: (files: File[], rejected?: Array<{ file: File; errors: Array<{ code: string; message: string }> }>) => Promise<void>;
      onDropRejected?: (rejected: Array<{ file: File; errors: Array<{ code: string; message: string }> }>) => void;
      accept?: Record<string, string[]>;
      noClick?: boolean;
      maxSize?: number;
    }) => {
      dropzoneState.onDrop = options.onDrop;
      dropzoneState.onDropRejected = options.onDropRejected ?? null;
      dropzoneState.accept = options.accept ?? null;
      dropzoneState.noClick = options.noClick ?? null;
      dropzoneState.maxSize = options.maxSize ?? null;
      return {
        getRootProps: () => ({}),
        getInputProps: () => ({}),
        isDragActive: false,
        open: vi.fn(),
        acceptedFiles: [],
        fileRejections: [],
        isFocused: false,
        isDragAccept: false,
        isDragReject: false,
        rootRef: { current: null },
        inputRef: { current: null },
      };
    },
  ),
}));

vi.mock('@/services/api-client', () => ({
  authFetch: mockedModules.authFetch,
  VISION_TIMEOUT: 400_000,
}));

vi.mock('@/components/Toast', () => ({
  showToast: mockedModules.showToast,
}));

vi.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('@/utils/localizeError', () => ({
  localizeErrorMessage: (_error: unknown, key: string) => key,
}));

vi.mock('../../utils', async () => {
  const actual = await vi.importActual<typeof import('../../utils')>('../../utils');
  return {
    ...actual,
    runVisionDetection: vi.fn(),
    runVisionDetectionPages: vi.fn(),
  };
});

import { runVisionDetectionPages } from '../../utils';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePlaygroundFile', () => {
  const setEntities = vi.fn();
  const setBoundingBoxes = vi.fn();
  const resetEntityHistory = vi.fn();
  const resetImageHistory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    dropzoneState.onDrop = null;
    dropzoneState.onDropRejected = null;
    dropzoneState.accept = null;
    dropzoneState.noClick = null;
    dropzoneState.maxSize = null;
    mockedModules.authFetch.mockReset();
    vi.mocked(runVisionDetectionPages).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the parsed file in preview when text recognition fails', async () => {
    mockedModules.authFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            file_id: 'file-1',
            filename: 'test.docx',
            file_size: 128,
            file_type: 'docx',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            is_scanned: false,
            content: 'Alice',
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'NER failed' }),
      });

    const { result } = renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: ['PERSON'] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    await act(async () => {
      await dropzoneState.onDrop?.([
        new File(['content'], 'test.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ]);
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stage).toBe('preview');
    expect(result.current.fileInfo?.file_id).toBe('file-1');
    expect(result.current.content).toBe('Alice');
    expect(result.current.recognitionIssue).toBe('playground.recognizeFailed');
    expect(mockedModules.showToast).toHaveBeenCalledWith('playground.recognizeFailed', 'error');
  });

  it('keeps the parsed file in preview when required recognition services are unavailable', async () => {
    mockedModules.authFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            file_id: 'file-1',
            filename: 'test.docx',
            file_size: 128,
            file_type: 'docx',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            is_scanned: false,
            content: 'Alice',
          }),
      });

    const { result } = renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: ['PERSON'] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
        getRecognitionBlocker: () => 'HaS Text: Offline',
      }),
    );

    await act(async () => {
      await dropzoneState.onDrop?.([
        new File(['content'], 'test.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ]);
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stage).toBe('preview');
    expect(result.current.fileInfo?.file_id).toBe('file-1');
    expect(result.current.content).toBe('Alice');
    expect(result.current.recognitionIssue).toBe('HaS Text: Offline');
    expect(mockedModules.authFetch).toHaveBeenCalledTimes(2);
    expect(mockedModules.showToast).toHaveBeenCalledWith('HaS Text: Offline', 'info');
  });

  it('keeps the upload surface active until scanned PDF recognition finishes', async () => {
    const pendingRecognition = deferred<{ boxes: []; totalBoxes: number }>();
    vi.mocked(runVisionDetectionPages).mockReturnValue(
      pendingRecognition.promise as unknown as ReturnType<typeof runVisionDetectionPages>,
    );
    mockedModules.authFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            file_id: 'scan-1',
            filename: 'scan.pdf',
            file_size: 1024,
            file_type: 'pdf',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            is_scanned: true,
            file_type: 'pdf',
            page_count: 4,
            content: '',
          }),
      });

    const { result } = renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: ['PERSON'] },
        latestHasImageTypesRef: { current: ['SEAL'] },
        latestSelectedTypesRef: { current: [] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    await act(async () => {
      await dropzoneState.onDrop?.([
        new File(['scan'], 'scan.pdf', {
          type: 'application/pdf',
        }),
      ]);
    });

    await waitFor(() => expect(result.current.fileInfo?.file_id).toBe('scan-1'));
    expect(result.current.stage).toBe('upload');
    expect(result.current.fileInfo?.file_id).toBe('scan-1');
    expect(result.current.fileInfo?.page_count).toBe(4);
    expect(result.current.isLoading).toBe(true);
    expect(runVisionDetectionPages).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'scan-1', totalPages: 4 }),
    );

    await act(async () => {
      pendingRecognition.resolve({ boxes: [], totalBoxes: 0 });
      await pendingRecognition.promise;
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stage).toBe('preview');
  });

  it('keeps the upload surface active until text recognition finishes', async () => {
    const pendingNer = deferred<{
      ok: boolean;
      json: () => Promise<{ entities: Array<Record<string, unknown>> }>;
    }>();
    mockedModules.authFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            file_id: 'text-pending',
            filename: 'pending.docx',
            file_size: 128,
            file_type: 'docx',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            is_scanned: false,
            file_type: 'docx',
            content: 'Alice',
          }),
      })
      .mockReturnValueOnce(pendingNer.promise);

    const { result } = renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: ['PERSON'] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    await act(async () => {
      await dropzoneState.onDrop?.([
        new File(['content'], 'pending.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ]);
    });

    await waitFor(() => expect(result.current.fileInfo?.file_id).toBe('text-pending'));
    expect(result.current.stage).toBe('upload');
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      pendingNer.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            entities: [{ id: 'e1', text: 'Alice', type: 'PERSON', start: 0, end: 5 }],
          }),
      });
      await pendingNer.promise;
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.stage).toBe('preview');
  });

  it('skips scanned PDF vision recognition when no vision types are selected', async () => {
    mockedModules.authFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            file_id: 'scan-no-types',
            filename: 'scan.pdf',
            file_size: 1024,
            file_type: 'pdf',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            is_scanned: true,
            file_type: 'pdf',
            page_count: 3,
            content: '',
          }),
      });

    const { result } = renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: [] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    await act(async () => {
      await dropzoneState.onDrop?.([new File(['scan'], 'scan.pdf', { type: 'application/pdf' })]);
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.stage).toBe('preview');
    expect(result.current.fileInfo?.file_id).toBe('scan-no-types');
    expect(runVisionDetectionPages).not.toHaveBeenCalled();
    expect(mockedModules.authFetch).toHaveBeenCalledTimes(2);
  });

  it('accepts every file family supported by the backend upload endpoint', () => {
    renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: [] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    const acceptedExtensions = Object.values(dropzoneState.accept ?? {}).flat();
    expect(acceptedExtensions).toEqual(
      expect.arrayContaining([
        '.doc',
        '.docx',
        '.txt',
        '.md',
        '.html',
        '.pdf',
        '.jpg',
        '.png',
        '.webp',
        '.tif',
      ]),
    );
  });

  it('disables the default root click so the explicit file picker works in Chromium', () => {
    renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: [] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    expect(dropzoneState.noClick).toBe(true);
  });

  it('surfaces rejected file reasons without starting upload', async () => {
    const { result } = renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: [] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    act(() => {
      dropzoneState.onDropRejected?.([
        {
          file: new File(['bad'], 'demo.exe', { type: 'application/x-msdownload' }),
          errors: [{ code: 'file-invalid-type', message: 'invalid type' }],
        },
      ]);
    });

    expect(result.current.uploadIssue).toBe(
      'playground.upload.rejectInvalidType'.replace('{filename}', 'demo.exe'),
    );
    expect(mockedModules.showToast).toHaveBeenCalledWith(result.current.uploadIssue, 'error');
    expect(mockedModules.authFetch).not.toHaveBeenCalled();
  });

  it('configures a client-side max size that matches the default backend limit', () => {
    renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: [] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    expect(dropzoneState.maxSize).toBe(50 * 1024 * 1024);
  });

  it('cancels an in-flight upload without surfacing a failure toast', async () => {
    mockedModules.authFetch.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });

    const { result } = renderHook(() =>
      usePlaygroundFile({
        latestOcrHasTypesRef: { current: [] },
        latestHasImageTypesRef: { current: [] },
        latestSelectedTypesRef: { current: [] },
        resetEntityHistory,
        resetImageHistory,
        setEntities,
        setBoundingBoxes,
      }),
    );

    let uploadPromise: Promise<void> | undefined;
    act(() => {
      uploadPromise = dropzoneState.onDrop?.([
        new File(['content'], 'test.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ]);
    });

    await waitFor(() => expect(result.current.isLoading).toBe(true));

    act(() => {
      result.current.cancelProcessing();
    });
    await act(async () => {
      await uploadPromise;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadingMessage).toBe('');
    expect(mockedModules.showToast).toHaveBeenCalledWith('playground.cancelled', 'info');
    expect(mockedModules.showToast).not.toHaveBeenCalledWith('playground.processFailed', 'error');
  });
});
