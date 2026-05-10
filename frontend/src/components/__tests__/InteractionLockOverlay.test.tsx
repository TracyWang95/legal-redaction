// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InteractionLockOverlay } from '../InteractionLockOverlay';

describe('InteractionLockOverlay', () => {
  afterEach(() => {
    document.body.style.overflow = '';
    document.body.style.pointerEvents = '';
    document.body.style.touchAction = '';
    document.getElementById('root')?.remove();
  });

  it('locks the app root and page scroll while active', () => {
    const root = document.createElement('div');
    root.id = 'root';
    const focusedButton = document.createElement('button');
    focusedButton.textContent = 'background action';
    root.appendChild(focusedButton);
    document.body.appendChild(root);
    document.body.style.overflow = 'auto';
    document.body.style.pointerEvents = 'auto';
    document.body.style.touchAction = 'pan-y';
    focusedButton.focus();

    const { unmount } = render(<InteractionLockOverlay active label="Deleting..." />);

    const overlay = screen.getByTestId('interaction-lock-overlay');
    expect(overlay).toHaveAttribute('aria-busy', 'true');
    expect(overlay).toHaveTextContent('Deleting...');
    expect(overlay.parentElement).toBe(document.body);
    expect(root).toHaveAttribute('inert', '');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.pointerEvents).toBe('none');
    expect(document.body.style.touchAction).toBe('none');
    expect(overlay).toHaveStyle({ pointerEvents: 'auto' });
    expect(document.activeElement).toBe(screen.getByText('Deleting...').parentElement);

    unmount();

    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.pointerEvents).toBe('auto');
    expect(document.body.style.touchAction).toBe('pan-y');
    expect(document.activeElement).toBe(focusedButton);
  });

  it('keeps the page locked until nested overlays are all gone', () => {
    const root = document.createElement('div');
    root.id = 'root';
    const focusedButton = document.createElement('button');
    root.appendChild(focusedButton);
    document.body.appendChild(root);
    document.body.style.overflow = 'auto';
    document.body.style.pointerEvents = 'auto';
    document.body.style.touchAction = 'pan-y';
    focusedButton.focus();

    const first = render(<InteractionLockOverlay active label="First lock" testId="first-lock" />);
    const second = render(
      <InteractionLockOverlay active label="Second lock" testId="second-lock" />,
    );

    expect(document.body.style.pointerEvents).toBe('none');
    expect(root).toHaveAttribute('inert', '');

    second.unmount();

    expect(document.body.style.pointerEvents).toBe('none');
    expect(root).toHaveAttribute('inert', '');

    first.unmount();

    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.pointerEvents).toBe('auto');
    expect(document.body.style.touchAction).toBe('pan-y');
    expect(root).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(focusedButton);
  });

  it('does not mount anything when inactive', () => {
    render(<InteractionLockOverlay active={false} />);

    expect(screen.queryByTestId('interaction-lock-overlay')).not.toBeInTheDocument();
  });
});
