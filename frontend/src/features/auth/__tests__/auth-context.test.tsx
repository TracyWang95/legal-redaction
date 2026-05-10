// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth-context';
import { AUTH_UNAUTHORIZED_EVENT } from '@/services/api-client';

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps auth status unavailable when the status request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('status unavailable'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toBeNull();
    expect(result.current.error).toBe('status unavailable');
  });

  it('clears the error after a successful refresh', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBe('temporary failure');

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.status).toEqual({
      auth_enabled: true,
      password_set: true,
      authenticated: false,
    });
  });

  it('verifies the session after login before marking the user authenticated', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'token',
            token_type: 'bearer',
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.login('Strong!Pass123');
      } catch (err) {
        thrown = err as Error;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Authentication session was not established.');
    expect(result.current.status).toEqual({
      auth_enabled: true,
      password_set: true,
      authenticated: false,
    });
  });

  it('marks the session unauthenticated after a global unauthorized event', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status?.authenticated).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    });

    await waitFor(() => expect(result.current.status?.authenticated).toBe(false));
  });

  it('deduplicates background refreshes triggered by repeated unauthorized events', async () => {
    let resolveRefresh!: (value: Response) => void;
    const refreshPromise = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockImplementationOnce(() => refreshPromise);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status?.authenticated).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    });

    expect(result.current.loading).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: false,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
      await refreshPromise;
    });

    await waitFor(() => expect(result.current.status?.authenticated).toBe(false));
  });

  it('keeps unauthenticated status when background refresh fails after unauthorized event', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockRejectedValueOnce(new Error('status unavailable'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status?.authenticated).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    });

    await waitFor(() => {
      expect(result.current.status?.authenticated).toBe(false);
      expect(result.current.error).toBe('status unavailable');
    });
  });

  it('does not refresh status after logout when logout request fails', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_enabled: true,
            password_set: true,
            authenticated: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockRejectedValueOnce(new Error('logout failed'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status?.authenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.status?.authenticated).toBe(false);
    expect(result.current.error).toBe('logout failed');
  });
});
