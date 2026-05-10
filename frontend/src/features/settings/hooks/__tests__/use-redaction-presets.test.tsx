// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18n } from '@/i18n';
import { useRedactionPresets } from '../use-redaction-presets';

const mocks = vi.hoisted(() => ({
  fetchRecognitionEntityTypes: vi.fn(),
  fetchRecognitionPipelines: vi.fn(),
  fetchRecognitionPresets: vi.fn(),
}));

vi.mock('@/services/recognition-config', () => ({
  fetchRecognitionEntityTypes: mocks.fetchRecognitionEntityTypes,
  fetchRecognitionPipelines: mocks.fetchRecognitionPipelines,
  fetchRecognitionPresets: mocks.fetchRecognitionPresets,
}));

beforeEach(() => {
  localStorage.clear();
  useI18n.setState({ locale: 'en' });
  mocks.fetchRecognitionEntityTypes.mockResolvedValue([]);
  mocks.fetchRecognitionPresets.mockResolvedValue([]);
  mocks.fetchRecognitionPipelines.mockResolvedValue([
    {
      mode: 'has_image',
      name: 'HaS Image',
      description: '',
      enabled: true,
      types: [
        { id: 'receipt_region', name: 'Receipt', enabled: true, order: 1 },
        { id: 'paper', name: 'Paper', enabled: true, order: 20 },
      ],
    },
  ]);
});

describe('useRedactionPresets', () => {
  it('selects every enabled pipeline type for new preset defaults', async () => {
    const { result } = renderHook(() => useRedactionPresets());

    await waitFor(() => expect(result.current.effectivePipelines).toHaveLength(1));

    act(() => result.current.openNew('vision'));

    expect(result.current.presetForm.kind).toBe('vision');
    expect(result.current.presetForm.hasImageTypes).toEqual(['receipt_region', 'paper']);
  });

  it('localizes settings load failures instead of surfacing raw i18n keys', async () => {
    mocks.fetchRecognitionEntityTypes.mockRejectedValue(new Error('offline'));
    mocks.fetchRecognitionPipelines.mockRejectedValue(new Error('offline'));
    mocks.fetchRecognitionPresets.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useRedactionPresets());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loadError).toBe(
      'Settings failed to load. Check the backend service and try again.',
    );
    expect(result.current.loadError).not.toBe('settings.loadFailed');
  });
});
