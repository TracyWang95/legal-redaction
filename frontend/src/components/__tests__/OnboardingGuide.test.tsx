// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingGuide } from '../OnboardingGuide';
import { STORAGE_KEYS } from '@/constants/storage-keys';

function renderGuide(path = '/batch') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OnboardingGuide />
    </MemoryRouter>,
  );
}

describe('OnboardingGuide', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens on the default batch entry route', async () => {
    renderGuide('/batch');

    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeNull());
    expect(screen.getByText('Start With One File')).toBeInTheDocument();
  });

  it('does not open when onboarding was already completed', async () => {
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETED, 'true');

    renderGuide('/batch');

    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });

  it('does not open on non-entry routes', async () => {
    renderGuide('/settings');

    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });

  it('does not open on the single-file workspace', async () => {
    renderGuide('/single');

    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });

  it('marks onboarding complete from the dismiss action', async () => {
    renderGuide('/batch');

    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED)).toBe('true');
  });

  it('links batch users to the single-file workspace and completes onboarding', async () => {
    renderGuide('/batch');

    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeNull());

    fireEvent.click(screen.getByRole('link', { name: /Open Single File/i }));

    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED)).toBe('true');
  });
});
