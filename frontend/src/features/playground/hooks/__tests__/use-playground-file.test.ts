// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaygroundFile } from '../use-playground-file';

const dropzoneState = vi.hoisted(() => ({
  onDrop: null as ((files: File[]) => Promise<void>) | null,
}));

const mockedModules = vi.hoisted(() => ({
  showToast: vi.fn(),
  authFetch: vi.fn(),
}));

vi.mock('react-dropzone', () => ({
  useDropzone: vi.fn((options: { onDrop: (files: File[]) => Promise<void> }) => {
    dropzoneState.onDrop = options.onDrop;
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
  }),
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
  };
});

describe('usePlaygroundFile', () => {
  const setEntities = vi.fn();
  const setBoundingBoxes = vi.fn();
  const resetEntityHistory = vi.fn();
  const resetImageHistory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    dropzoneState.onDrop = null;
    mockedModules.authFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns to upload state when text recognition fails', async () => {
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

    expect(result.current.stage).toBe('upload');
    expect(result.current.fileInfo).toBeNull();
    expect(result.current.content).toBe('');
    expect(setEntities).toHaveBeenLastCalledWith([]);
    expect(setBoundingBoxes).toHaveBeenLastCalledWith([]);
    expect(mockedModules.showToast).toHaveBeenCalledWith('playground.recognizeFailed', 'error');
  });
});
