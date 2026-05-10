// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NER_BACKEND_URL,
  normalizeNerBackendUrl,
  useVisionModelConfig,
} from '../use-model-config';

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  fetchWithTimeout: vi.fn(),
  showToast: vi.fn(),
  serviceHealth: { health: { services: {} } },
}));

vi.mock('@/services/api-client', () => ({
  authFetch: mocks.authFetch,
}));

vi.mock('@/utils/fetchWithTimeout', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
}));

vi.mock('@/components/Toast', () => ({
  showToast: mocks.showToast,
}));

vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: () => mocks.serviceHealth,
}));

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: vi.fn().mockResolvedValue(body),
  };
}

beforeEach(() => {
  mocks.authFetch.mockReset();
  mocks.fetchWithTimeout.mockReset();
  mocks.showToast.mockReset();
});

describe('normalizeNerBackendUrl', () => {
  it('uses the configured endpoint when present', () => {
    expect(normalizeNerBackendUrl({ llamacpp_base_url: 'http://127.0.0.1:18080/v1' })).toBe(
      'http://127.0.0.1:18080/v1',
    );
  });

  it('falls back when the payload is empty or malformed', () => {
    expect(normalizeNerBackendUrl(null)).toBe(DEFAULT_NER_BACKEND_URL);
    expect(normalizeNerBackendUrl({})).toBe(DEFAULT_NER_BACKEND_URL);
    expect(normalizeNerBackendUrl({ llamacpp_base_url: '' })).toBe(DEFAULT_NER_BACKEND_URL);
    expect(normalizeNerBackendUrl({ llamacpp_base_url: 8080 })).toBe(DEFAULT_NER_BACKEND_URL);
  });
});

describe('useVisionModelConfig', () => {
  it('keeps active_id from the model config list payload', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(
      jsonResponse({
        active_id: 'has_image_service',
        configs: [
          {
            id: 'has_image_service',
            name: 'HaS Image',
            provider: 'local',
            enabled: true,
            model_name: 'HaS-Image-YOLO11',
          },
        ],
      }),
    );

    const { result } = renderHook(() => useVisionModelConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.modelConfigs.active_id).toBe('has_image_service');
  });

  it('sets the active model config then refreshes the list', async () => {
    mocks.fetchWithTimeout
      .mockResolvedValueOnce(jsonResponse({ active_id: 'has_image_service', configs: [] }))
      .mockResolvedValueOnce(jsonResponse({ active_id: 'custom_has_image', configs: [] }));
    mocks.authFetch.mockResolvedValue(jsonResponse({ success: true, active_id: 'custom_has_image' }));

    const { result } = renderHook(() => useVisionModelConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setActiveModelConfig('custom_has_image');
    });

    expect(mocks.authFetch).toHaveBeenCalledWith('/api/v1/model-config/active/custom_has_image', {
      method: 'POST',
    });
    expect(result.current.modelConfigs.active_id).toBe('custom_has_image');
  });

  it('shows a toast when setting active model config fails', async () => {
    mocks.fetchWithTimeout.mockResolvedValue(jsonResponse({ active_id: 'has_image_service', configs: [] }));
    mocks.authFetch.mockResolvedValue(jsonResponse({ detail: 'not local' }, false));

    const { result } = renderHook(() => useVisionModelConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setActiveModelConfig('openai_vision');
    });

    expect(mocks.showToast).toHaveBeenCalledWith('not local', 'error');
    expect(result.current.modelConfigs.active_id).toBe('has_image_service');
  });
});
