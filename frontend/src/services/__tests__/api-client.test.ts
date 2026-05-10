// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AUTH_UNAUTHORIZED_EVENT,
  buildAuthHeaders,
  apiClient,
  ApiError,
  API_TIMEOUT,
  VISION_TIMEOUT,
  BATCH_TIMEOUT,
  authFetch,
  downloadFile,
  fetchBlob,
  getCsrfToken,
  revokeObjectUrl,
} from '../api-client';
import type { ApiErrorType } from '../api-client';

describe('timeout constants', () => {
  it('API_TIMEOUT is 60 seconds', () => {
    expect(API_TIMEOUT).toBe(60_000);
  });

  it('VISION_TIMEOUT is 900 seconds', () => {
    expect(VISION_TIMEOUT).toBe(900_000);
  });

  it('BATCH_TIMEOUT is 120 seconds', () => {
    expect(BATCH_TIMEOUT).toBe(120_000);
  });
});

describe('buildAuthHeaders', () => {
  afterEach(() => {
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('returns empty object when no extra headers', () => {
    const headers = buildAuthHeaders();
    expect(headers).toEqual({});
  });

  it('passes through extra headers', () => {
    const headers = buildAuthHeaders({ 'X-Custom': 'value' });
    expect(headers['X-Custom']).toBe('value');
  });

  it('includes CSRF header when cookie is present', () => {
    document.cookie = 'csrf_token=test-token; path=/';
    const headers = buildAuthHeaders();
    expect(headers['X-CSRF-Token']).toBe('test-token');
  });
});

describe('getCsrfToken', () => {
  afterEach(() => {
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('returns null when cookie is missing', () => {
    expect(getCsrfToken()).toBeNull();
  });

  it('reads csrf_token from cookies', () => {
    document.cookie = 'csrf_token=abc123; path=/';
    expect(getCsrfToken()).toBe('abc123');
  });
});

describe('authFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('adds X-CSRF-Token on mutating requests', async () => {
    document.cookie = 'csrf_token=csrf-123; path=/';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await authFetch('/api/v1/test', { method: 'POST' });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-123');
    expect(init?.credentials).toBe('include');
  });

  it('does not add X-CSRF-Token on GET requests', async () => {
    document.cookie = 'csrf_token=csrf-123; path=/';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    await authFetch('/api/v1/test');

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('X-CSRF-Token')).toBeNull();
  });

  it('dispatches a global unauthorized event on 401 responses', async () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

    await authFetch('/api/v1/files');

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  });

  it('does not dispatch the unauthorized event for login failures', async () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

    await authFetch('/api/v1/auth/login', { method: 'POST' });

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  });
});

describe('downloadFile and fetchBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies downloadFile 401 as auth error', async () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

    await expect(downloadFile('/api/v1/files/1/download', 'x.txt')).rejects.toMatchObject({
      status: 401,
      errorType: 'auth',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  });

  it('classifies fetchBlob 401 as auth error', async () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(fetchBlob('/api/v1/files/1/blob')).rejects.toMatchObject({
      status: 401,
      errorType: 'auth',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  });
});

describe('ApiError', () => {
  it('has name "ApiError"', () => {
    const err = new ApiError('test');
    expect(err.name).toBe('ApiError');
  });

  it('stores message and optional status', () => {
    const err = new ApiError('Not found', 404);
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
  });

  it('is an instance of Error', () => {
    const err = new ApiError('fail');
    expect(err).toBeInstanceOf(Error);
  });

  it('has undefined status when not provided', () => {
    const err = new ApiError('oops');
    expect(err.status).toBeUndefined();
  });

  it('defaults errorType to unknown', () => {
    const err = new ApiError('oops');
    expect(err.errorType).toBe('unknown');
  });

  it('stores custom errorType', () => {
    const err = new ApiError('timeout', 0, 'timeout');
    expect(err.errorType).toBe('timeout');
  });

  it('accepts all valid error types', () => {
    const types: ApiErrorType[] = ['network', 'timeout', 'cancelled', 'server', 'auth', 'unknown'];
    types.forEach((t) => {
      const err = new ApiError('msg', undefined, t);
      expect(err.errorType).toBe(t);
    });
  });
});

describe('revokeObjectUrl', () => {
  it('does not throw for null or undefined', () => {
    expect(() => revokeObjectUrl(null)).not.toThrow();
    expect(() => revokeObjectUrl(undefined)).not.toThrow();
  });

  it('does not throw for non-blob URL', () => {
    expect(() => revokeObjectUrl('https://example.com')).not.toThrow();
  });
});

describe('apiClient configuration', () => {
  it('has baseURL set to /api/v1', () => {
    expect(apiClient.defaults.baseURL).toBe('/api/v1');
  });

  it('has timeout set to API_TIMEOUT', () => {
    expect(apiClient.defaults.timeout).toBe(API_TIMEOUT);
  });
});

describe('apiClient response interceptor — error handling', () => {
  it('rejects with ApiError containing status and server errorType', async () => {
    const mockError = {
      response: {
        status: 403,
        data: { message: 'Forbidden' },
      },
      message: 'Request failed with status code 403',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rejected = (apiClient.interceptors.response as any).handlers[0].rejected!;
    try {
      await rejected(mockError);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Forbidden');
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).errorType).toBe('server');
    }
  });

  it('classifies 401 as auth errorType', async () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
    const mockError = {
      config: { url: '/files' },
      response: {
        status: 401,
        data: { message: 'Unauthorized' },
      },
      message: 'Request failed',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rejected = (apiClient.interceptors.response as any).handlers[0].rejected!;
    try {
      await rejected(mockError);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).errorType).toBe('auth');
      expect((err as ApiError).status).toBe(401);
      expect(handler).toHaveBeenCalledTimes(1);
    }
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  });

  it('classifies missing response as network errorType', async () => {
    const mockError = {
      message: 'Network Error',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rejected = (apiClient.interceptors.response as any).handlers[0].rejected!;
    try {
      await rejected(mockError);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).errorType).toBe('network');
    }
  });

  it('classifies ECONNABORTED as timeout errorType', async () => {
    const mockError = {
      code: 'ECONNABORTED',
      message: 'timeout of 60000ms exceeded',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rejected = (apiClient.interceptors.response as any).handlers[0].rejected!;
    try {
      await rejected(mockError);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).errorType).toBe('timeout');
    }
  });

  it('uses detail field when message is missing', async () => {
    const mockError = {
      response: {
        status: 422,
        data: { detail: 'Validation failed' },
      },
      message: 'Request failed',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rejected = (apiClient.interceptors.response as any).handlers[0].rejected!;
    try {
      await rejected(mockError);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Validation failed');
      expect((err as ApiError).status).toBe(422);
    }
  });

  it('falls back to error.message when response data is empty', async () => {
    const mockError = {
      response: {
        status: 500,
        data: {},
      },
      message: 'Internal Server Error',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rejected = (apiClient.interceptors.response as any).handlers[0].rejected!;
    try {
      await rejected(mockError);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Internal Server Error');
      expect((err as ApiError).status).toBe(500);
    }
  });

  it('uses "Request failed" when no message is available', async () => {
    const mockError = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rejected = (apiClient.interceptors.response as any).handlers[0].rejected!;
    try {
      await rejected(mockError);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('Request failed');
    }
  });
});
