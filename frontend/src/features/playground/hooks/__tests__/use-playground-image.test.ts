// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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

vi.mock('@/services/api-client', () => ({
  authFetch: vi.fn(),
  authenticatedBlobUrl: vi.fn(),
  revokeObjectUrl: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('@/utils/localizeError', () => ({
  localizeErrorMessage: vi.fn((_e: unknown, key: string) => key),
}));

vi.mock('../../utils', () => ({
  runVisionDetectionPages: vi.fn(),
  safeJson: vi.fn(async (res: Response) => res.json()),
}));

import { authFetch, authenticatedBlobUrl } from '@/services/api-client';
import { usePlaygroundImage } from '../use-playground-image';
import { runVisionDetectionPages } from '../../utils';

type Msg = Record<string, unknown>;

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  readonly name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: Msg[] = [];

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: Msg): void {
    this.sent.push(data);
  }

  emit(data: Msg): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  close(): void {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePlaygroundImage popout sync', () => {
  const originalBroadcast = globalThis.BroadcastChannel;
  const originalOpen = window.open;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeBroadcastChannel.instances = [];
    // @ts-expect-error test override
    globalThis.BroadcastChannel = FakeBroadcastChannel;
    window.open = vi.fn(() => ({ closed: false }) as Window);
  });

  afterEach(() => {
    globalThis.BroadcastChannel = originalBroadcast;
    window.open = originalOpen;
  });

  it('sends raw image URL in init message for popout', async () => {
    const pending = deferred<string>();
    vi.mocked(authenticatedBlobUrl).mockImplementation((url: string) =>
      url.includes('redacted=true') ? Promise.resolve('blob:redacted-ready') : pending.promise,
    );

    const { result } = renderHook(() =>
      usePlaygroundImage({
        fileInfo: {
          file_id: 'file-1',
          filename: 'demo.png',
          file_size: 10,
          file_type: 'image',
          is_scanned: false,
        },
      }),
    );

    act(() => {
      result.current.setBoundingBoxes([
        {
          id: 'b1',
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          type: 'img_1',
          selected: true,
        },
      ]);
      result.current.openPopout([{ id: 'img_1', name: 'Image', color: '#999' }]);
    });

    const channel = FakeBroadcastChannel.instances[0];
    expect(channel).toBeDefined();

    act(() => {
      channel.emit({ type: 'popout-ready' });
    });

    const initMsg = channel.sent.find((m) => m.type === 'init');
    expect(initMsg).toBeDefined();
    expect(initMsg?.rawImageUrl).toBe('/api/v1/files/file-1/download');
    expect(Array.isArray(initMsg?.boxes)).toBe(true);

    await act(async () => {
      pending.resolve('blob:img-ready');
      await Promise.resolve();
    });

    const imageUpdate = channel.sent.find((m) => m.type === 'image-update');
    expect(imageUpdate).toBeDefined();
    expect(imageUpdate?.imageUrl).toBe('/api/v1/files/file-1/download');
  });

  it('pushes boxes-update after popout is open', async () => {
    vi.mocked(authenticatedBlobUrl).mockResolvedValue('blob:img-ready');

    const { result } = renderHook(() =>
      usePlaygroundImage({
        fileInfo: {
          file_id: 'file-2',
          filename: 'demo2.png',
          file_size: 11,
          file_type: 'image',
          is_scanned: false,
        },
      }),
    );

    act(() => {
      result.current.openPopout([{ id: 'img_1', name: 'Image', color: '#999' }]);
    });

    const channel = FakeBroadcastChannel.instances[0];
    expect(channel).toBeDefined();

    act(() => {
      result.current.setBoundingBoxes([
        {
          id: 'b2',
          x: 0.2,
          y: 0.2,
          width: 0.3,
          height: 0.3,
          type: 'img_1',
          selected: true,
        },
      ]);
    });

    const boxUpdate = channel.sent.find((m) => m.type === 'boxes-update');
    expect(boxUpdate).toBeDefined();
    const boxes = boxUpdate?.boxes as Array<{ id: string }> | undefined;
    expect(boxes?.[0]?.id).toBe('b2');
  });

  it('renders scanned PDF using preview image endpoint', async () => {
    const response = {
      ok: true,
      json: vi.fn().mockResolvedValue({ image_base64: 'ZmFrZS1wbmctYmFzZTY0' }),
    } as unknown as Response;
    vi.mocked(authFetch).mockResolvedValue(response);

    const { result } = renderHook(() =>
      usePlaygroundImage({
        fileInfo: {
          file_id: 'pdf-1',
          filename: 'scan.pdf',
          file_size: 10,
          file_type: 'pdf',
          is_scanned: true,
        },
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authFetch).toHaveBeenCalledWith(
      '/api/v1/redaction/pdf-1/preview-image?page=1',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(authenticatedBlobUrl).not.toHaveBeenCalledWith('/api/v1/files/pdf-1/download');
    expect(result.current.imageUrl).toBe('data:image/png;base64,ZmFrZS1wbmctYmFzZTY0');
    expect(result.current.redactedImageUrl).toBe('');
    expect(result.current.redactedImageError).toBeNull();

    act(() => {
      result.current.openPopout([{ id: 'img_1', name: 'Image', color: '#999' }]);
    });
    const channel = FakeBroadcastChannel.instances[0];
    act(() => {
      channel.emit({ type: 'popout-ready' });
    });
    const initMsg = channel.sent.find((m) => m.type === 'init');
    expect(typeof initMsg?.rawImageUrl).toBe('string');
    expect(String(initMsg?.rawImageUrl)).toContain('data:image/png;base64,');
  });

  it('refreshes the redacted image URL after redaction completes', async () => {
    let redactedReady = false;
    vi.mocked(authenticatedBlobUrl).mockImplementation((url: string) => {
      if (url.includes('redacted=true')) {
        return redactedReady
          ? Promise.resolve('blob:redacted-ready')
          : Promise.reject(new Error('not ready'));
      }
      return Promise.resolve('blob:original');
    });

    const fileInfo = {
      file_id: 'image-redact-1',
      filename: 'demo.png',
      file_size: 10,
      file_type: 'image',
      is_scanned: false,
    } as const;

    const { result, rerender } = renderHook(
      ({ version }) => usePlaygroundImage({ fileInfo, redactionVersion: version }),
      { initialProps: { version: 0 } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.redactedImageUrl).toBe('');
    const redactedFetchesBefore = vi
      .mocked(authenticatedBlobUrl)
      .mock.calls.filter(([url]) => String(url).includes('redacted=true')).length;

    redactedReady = true;
    rerender({ version: 1 });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.redactedImageUrl).toBe('blob:redacted-ready');
    expect(result.current.redactedImageError).toBeNull();
    const redactedFetches = vi
      .mocked(authenticatedBlobUrl)
      .mock.calls.filter(([url]) => String(url).includes('redacted=true'));
    expect(redactedFetches.length).toBeGreaterThan(redactedFetchesBefore);
  });

  it('does not request scanned PDF redacted preview before redaction result is shown', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response);

    const { result } = renderHook(() =>
      usePlaygroundImage({
        fileInfo: {
          file_id: 'scan-redact-fail',
          filename: 'scan.pdf',
          file_size: 10,
          file_type: 'pdf',
          is_scanned: true,
        },
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.redactedImageUrl).toBe('');
    expect(result.current.redactedImageError).toBeNull();
  });

  it('does not fall back to the original image when scanned PDF redacted preview fails after redaction', async () => {
    vi.mocked(authFetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response);

    const { result } = renderHook(() =>
      usePlaygroundImage({
        fileInfo: {
          file_id: 'scan-redact-fail',
          filename: 'scan.pdf',
          file_size: 10,
          file_type: 'pdf',
          is_scanned: true,
        },
        redactionVersion: 1,
        showRedactedPreview: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.redactedImageUrl).toBe('');
    expect(result.current.redactedImageError).toBe('Redacted preview failed to load');
  });

  it('does not request a redacted image URL for text documents', async () => {
    vi.mocked(authenticatedBlobUrl).mockResolvedValue('blob:any');

    renderHook(() =>
      usePlaygroundImage({
        fileInfo: {
          file_id: 'docx-1',
          filename: 'demo.docx',
          file_size: 10,
          file_type: 'docx',
          is_scanned: false,
        },
        redactionVersion: 1,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authenticatedBlobUrl).not.toHaveBeenCalledWith(
      '/api/v1/files/docx-1/download?redacted=true',
    );
  });

  it('restores existing boxes when a rerun is cancelled after partial page updates', async () => {
    const pending = deferred<{ boxes: Array<Record<string, unknown>>; totalBoxes: number }>();
    vi.mocked(runVisionDetectionPages).mockReturnValue(
      pending.promise as unknown as ReturnType<typeof runVisionDetectionPages>,
    );

    const { result } = renderHook(() =>
      usePlaygroundImage({
        fileInfo: {
          file_id: 'image-rerun-cancel',
          filename: 'demo.png',
          file_size: 10,
          file_type: 'image',
          is_scanned: false,
        },
      }),
    );

    const previousBox = {
      id: 'old-box',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      type: 'SEAL',
      selected: true,
    };
    act(() => {
      result.current.setBoundingBoxes([previousBox]);
    });

    let rerun: Promise<void>;
    await act(async () => {
      rerun = result.current.handleRerunNerImage(
        'image-rerun-cancel',
        [],
        ['SEAL'],
        vi.fn(),
        vi.fn(),
      );
      await Promise.resolve();
    });

    const call = vi.mocked(runVisionDetectionPages).mock.calls[0]?.[0];
    act(() => {
      call?.onPageComplete?.({
        page: 2,
        pageBoxes: [
          {
            id: 'new-page-2',
            x: 0.2,
            y: 0.2,
            width: 0.2,
            height: 0.2,
            type: 'SEAL',
            selected: true,
            page: 2,
          },
        ],
        completedPages: 1,
        totalPages: 1,
        totalBoxes: 1,
      });
    });

    expect(result.current.boundingBoxes).toEqual([
      previousBox,
      expect.objectContaining({ id: 'new-page-2', page: 2 }),
    ]);

    act(() => {
      result.current.cancelRerunNerImage();
    });
    await act(async () => {
      pending.reject(new DOMException('Aborted', 'AbortError'));
      await rerun!;
    });

    expect(result.current.boundingBoxes).toEqual([previousBox]);
  });

  it('ignores duplicate image recognition triggers while a rerun is in flight', async () => {
    const pending = deferred<{ boxes: Array<Record<string, unknown>>; totalBoxes: number }>();
    vi.mocked(authenticatedBlobUrl).mockResolvedValue('blob:img-ready');
    vi.mocked(runVisionDetectionPages).mockReturnValue(
      pending.promise as unknown as ReturnType<typeof runVisionDetectionPages>,
    );

    const { result } = renderHook(() =>
      usePlaygroundImage({
        fileInfo: {
          file_id: 'image-rerun-dedupe',
          filename: 'demo.png',
          file_size: 10,
          file_type: 'image',
          is_scanned: false,
        },
      }),
    );

    let firstRun: Promise<void>;
    let secondRun: Promise<void>;
    await act(async () => {
      firstRun = result.current.handleRerunNerImage(
        'image-rerun-dedupe',
        [],
        ['SEAL'],
        vi.fn(),
        vi.fn(),
      );
      secondRun = result.current.handleRerunNerImage(
        'image-rerun-dedupe',
        [],
        ['SEAL'],
        vi.fn(),
        vi.fn(),
      );
      await Promise.resolve();
    });

    expect(runVisionDetectionPages).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ boxes: [], totalBoxes: 0 });
      await firstRun!;
      await secondRun!;
    });
  });
});
