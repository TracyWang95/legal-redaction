// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../auth-page';

const authState = vi.hoisted(() => ({
  status: { auth_enabled: true, password_set: true, authenticated: false },
  login: vi.fn().mockResolvedValue(undefined),
  setup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../auth-context', () => ({
  useAuth: () => authState,
}));

describe('AuthPage', () => {
  beforeEach(() => {
    authState.status = { auth_enabled: true, password_set: true, authenticated: false };
    authState.login.mockClear();
    authState.setup.mockClear();
  });

  function renderPage(initialEntry = '/auth?next=/jobs') {
    const router = createMemoryRouter(
      [
        { path: '/auth', element: <AuthPage /> },
        { path: '/', element: <div>Home target</div> },
        { path: '/jobs', element: <div>Jobs target</div> },
      ],
      { initialEntries: [initialEntry] },
    );

    render(<RouterProvider router={router} />);
  }

  it('submits login and navigates to next route', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Strong!Pass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authState.login).toHaveBeenCalledWith('Strong!Pass123'));
    await screen.findByText('Jobs target');
  });

  it('requires matching confirmation during first-time setup', async () => {
    authState.status = { auth_enabled: true, password_set: false, authenticated: false };
    renderPage('/auth?next=/');

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Strong!Pass123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Wrong!Pass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create password' }));

    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(authState.setup).not.toHaveBeenCalled();
  });

  it('falls back to home when next is invalid', async () => {
    renderPage('/auth?next=//evil.com');

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Strong!Pass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authState.login).toHaveBeenCalledWith('Strong!Pass123'));
    await screen.findByText('Home target');
  });
});
