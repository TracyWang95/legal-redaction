// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@/test-utils';
import { PlaygroundLoading } from '../playground-loading';

describe('PlaygroundLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById('root')?.remove();
  });

  it('uses a non-resetting progress value for long-running image recognition', () => {
    render(<PlaygroundLoading loadingMessage="Recognizing" isImageMode />);

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    const beforeMinute = Number(
      screen.getByTestId('playground-loading-progress').getAttribute('aria-valuenow'),
    );

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    const afterMinute = Number(
      screen.getByTestId('playground-loading-progress').getAttribute('aria-valuenow'),
    );

    expect(afterMinute).toBeGreaterThanOrEqual(beforeMinute);
    expect(screen.getByText(/Still working/i)).toBeInTheDocument();
  });

  it('shows elapsed waiting time without implying completion', () => {
    render(<PlaygroundLoading loadingMessage="" isImageMode />);

    act(() => {
      vi.advanceTimersByTime(75_000);
    });

    expect(screen.getByTestId('playground-loading-timer')).toHaveTextContent('75');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('locks the single-file workspace behind the centered progress panel', () => {
    render(<PlaygroundLoading loadingMessage="Recognizing" isImageMode />);

    expect(screen.getByTestId('playground-loading')).toHaveClass(
      'fixed',
      'inset-0',
      'items-center',
      'justify-center',
      'bg-background/70',
    );
  });

  it('locks and restores background page interaction while mounted', () => {
    const root = document.createElement('div');
    root.id = 'root';
    const focusedButton = document.createElement('button');
    focusedButton.textContent = 'Background action';
    root.appendChild(focusedButton);
    document.body.appendChild(root);
    focusedButton.focus();
    document.body.style.overflow = 'auto';
    document.body.style.pointerEvents = 'auto';
    document.body.style.touchAction = 'pan-y';

    const { unmount } = render(<PlaygroundLoading loadingMessage="Recognizing" isImageMode />);

    expect(root).toHaveAttribute('inert', '');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.pointerEvents).toBe('none');
    expect(document.body.style.touchAction).toBe('none');
    expect(document.activeElement).toBe(screen.getByText('Recognizing').closest('[tabindex="-1"]'));

    unmount();

    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.pointerEvents).toBe('auto');
    expect(document.body.style.touchAction).toBe('pan-y');
    expect(document.activeElement).toBe(focusedButton);
  });

  it('exposes an explicit cancel action for long-running work', () => {
    const onCancel = vi.fn();
    render(<PlaygroundLoading loadingMessage="Recognizing" isImageMode onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId('playground-cancel-processing'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
