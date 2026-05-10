// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { BatchStepProgress } from '../batch-step-progress';

describe('BatchStepProgress', () => {
  it('lets users jump back to unlocked steps', () => {
    const goStep = vi.fn();

    render(
      <BatchStepProgress
        currentStep={4}
        canGoStep={(step) => step <= 4}
        goStep={goStep}
      />,
    );

    fireEvent.click(screen.getByTestId('batch-step-2'));

    expect(goStep).toHaveBeenCalledWith(2);
  });

  it('keeps locked and current steps non-clickable', () => {
    const goStep = vi.fn();

    render(
      <BatchStepProgress
        currentStep={2}
        canGoStep={(step) => step <= 2}
        goStep={goStep}
      />,
    );

    const currentStep = screen.getByTestId('batch-step-2');
    const lockedStep = screen.getByTestId('batch-step-4');

    expect(currentStep).toBeDisabled();
    expect(lockedStep).toBeDisabled();
    expect(lockedStep).toHaveAttribute('title', 'Complete the previous steps first');

    fireEvent.click(currentStep);
    fireEvent.click(lockedStep);

    expect(goStep).not.toHaveBeenCalled();
  });
});
