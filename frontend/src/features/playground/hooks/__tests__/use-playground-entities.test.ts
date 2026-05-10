// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaygroundEntities } from '../use-playground-entities';

vi.mock('@/hooks/useUndoRedo', () => ({
  useUndoRedo: vi.fn(() => ({
    canUndo: false,
    canRedo: false,
    save: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    reset: vi.fn(),
  })),
}));

const mockedModules = vi.hoisted(() => ({
  authFetch: vi.fn(),
  showToast: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePlaygroundEntities rerun cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps existing entities when text recognition is cancelled', async () => {
    const pending = deferred<Response>();
    mockedModules.authFetch.mockReturnValue(pending.promise);
    const setIsLoading = vi.fn();
    const setLoadingMessage = vi.fn();

    const { result } = renderHook(() => usePlaygroundEntities());

    act(() => {
      result.current.setEntities([
        {
          id: 'old-entity',
          text: 'Alice',
          type: 'PERSON',
          start: 0,
          end: 5,
          selected: true,
          source: 'llm',
        },
      ]);
    });

    let rerun: Promise<void>;
    await act(async () => {
      rerun = result.current.handleRerunNerText(
        'file-1',
        ['PERSON'],
        setIsLoading,
        setLoadingMessage,
      );
      await Promise.resolve();
    });

    act(() => {
      result.current.cancelRerunNerText();
    });

    await act(async () => {
      pending.reject(new DOMException('Aborted', 'AbortError'));
      await rerun!;
    });

    expect(result.current.entities).toEqual([
      expect.objectContaining({ id: 'old-entity', text: 'Alice' }),
    ]);
    expect(setIsLoading).toHaveBeenCalledWith(true);
    expect(mockedModules.showToast).not.toHaveBeenCalledWith(
      'playground.recognizeFailed',
      'error',
    );
  });
});
