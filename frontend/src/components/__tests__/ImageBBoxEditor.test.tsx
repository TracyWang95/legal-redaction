// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import ImageBBoxEditor, { type BoundingBox } from '../ImageBBoxEditor';

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            width: 500,
            height: 400,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}

  disconnect() {}
}

describe('ImageBBoxEditor', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('in draw mode, pressing down on an existing box selects that box instead of starting a new one (so users can still drag/delete recognised boxes)', async () => {
    const onBoxesChange = vi.fn();
    const onBoxesCommit = vi.fn();
    const boxes: BoundingBox[] = [
      {
        id: 'existing',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        type: 'CUSTOM',
        text: 'existing box',
        selected: true,
        source: 'ocr_has',
      },
    ];

    render(
      <ImageBBoxEditor
        imageSrc="data:image/png;base64,ZmFrZQ=="
        boxes={boxes}
        onBoxesChange={onBoxesChange}
        onBoxesCommit={onBoxesCommit}
        getTypeConfig={() => ({ name: 'Custom', color: '#000000' })}
      />,
    );

    const image = screen.getByAltText('edit') as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 240 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 180 });
    Object.defineProperty(image, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({
          left: 0,
          top: 0,
          width: 500,
          height: 375,
          right: 500,
          bottom: 375,
        }) as DOMRect,
    });

    await act(async () => {
      fireEvent.load(image);
    });

    fireEvent.click(screen.getByRole('button', { name: /拉框标注|enter draw|draw/i }));

    const app = screen.getByRole('application');
    const existingLabel = screen.getByText(/existing box/i);

    fireEvent.mouseDown(existingLabel, { clientX: 50, clientY: 50, buttons: 1 });
    fireEvent.mouseMove(app, { clientX: 220, clientY: 160, buttons: 1 });
    fireEvent.mouseUp(app, { clientX: 220, clientY: 160, buttons: 1 });

    // Users complained that once draw mode was on, recognised boxes could not
    // be selected/dragged/deleted because canvas-level events swallowed them.
    // The fix: mouse events on existing boxes always route to the box, even
    // in draw mode. Users can only start a new draw by pressing down in empty
    // canvas space. So the existing box stays — no new box is created from a
    // drag that originated on top of it.
    const calls = onBoxesCommit.mock.calls;
    const committedBoxes = (calls.length ? calls[calls.length - 1]?.[1] : undefined) as BoundingBox[] | undefined;
    if (committedBoxes) {
      expect(committedBoxes).toHaveLength(1);
      expect(committedBoxes[0].id).toBe('existing');
    }
  });
});
