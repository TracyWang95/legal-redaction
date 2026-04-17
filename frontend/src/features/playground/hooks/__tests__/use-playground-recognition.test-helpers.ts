// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi, type Mock } from 'vitest';

const usePresetsMock = vi.fn();
const invalidatePresetsMock = vi.fn().mockResolvedValue(undefined);
const useInvalidatePresetsMock = vi.fn(() => invalidatePresetsMock);

vi.mock('@/services/recognition-config', () => ({
  fetchRecognitionEntityTypes: vi.fn(),
  fetchRecognitionPipelines: vi.fn(),
}));

vi.mock('@/services/presetsApi', () => ({
  createPreset: vi.fn(),
  presetAppliesText: vi.fn((preset: { kind?: string }) => {
    const kind = preset.kind ?? 'full';
    return kind === 'text' || kind === 'full';
  }),
  presetAppliesVision: vi.fn((preset: { kind?: string }) => {
    const kind = preset.kind ?? 'full';
    return kind === 'vision' || kind === 'full';
  }),
}));

vi.mock('@/services/hooks/use-presets', () => ({
  usePresets: vi.fn(() => usePresetsMock()),
  useInvalidatePresets: vi.fn(() => useInvalidatePresetsMock()),
  PRESETS_QUERY_KEY: ['presets'],
}));

vi.mock('@/services/activePresetBridge', () => ({
  getActivePresetTextId: vi.fn(() => null),
  getActivePresetVisionId: vi.fn(() => null),
  setActivePresetTextId: vi.fn(),
  setActivePresetVisionId: vi.fn(),
}));

vi.mock('@/services/defaultRedactionPreset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/defaultRedactionPreset')>();
  return { ...actual };
});

vi.mock('@/i18n', () => ({ t: (key: string) => key }));

vi.mock('@/components/Toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('@/utils/localizeError', () => ({
  localizeErrorMessage: (_error: unknown, key: string) => key,
}));

import {
  fetchRecognitionEntityTypes,
  fetchRecognitionPipelines,
} from '@/services/recognition-config';
import { createPreset, type RecognitionPreset } from '@/services/presetsApi';
import type { EntityTypeConfig, PipelineConfig } from '../../types';
import { usePlaygroundRecognition } from '../use-playground-recognition';

export const mockFetchRecognitionEntityTypes = fetchRecognitionEntityTypes as Mock;
export const mockFetchRecognitionPipelines = fetchRecognitionPipelines as Mock;
export const mockCreatePreset = createPreset as Mock;

export function makeEntityTypes(count = 5): EntityTypeConfig[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `TYPE_${index + 1}`,
    name: `Entity ${index + 1}`,
    color: '#0f766e',
    regex_pattern: index < 2 ? '\\d+' : null,
    enabled: true,
    order: index + 1,
  }));
}

export function makePipelines(): PipelineConfig[] {
  return [
    {
      mode: 'ocr_has',
      name: 'OCR Pipeline',
      description: 'OCR text detection',
      enabled: true,
      types: [
        { id: 'ocr_1', name: 'OCR Type 1', color: '#0f766e', enabled: true, order: 1 },
        { id: 'ocr_2', name: 'OCR Type 2', color: '#0f766e', enabled: true, order: 2 },
      ],
    },
    {
      mode: 'has_image',
      name: 'Image Pipeline',
      description: 'Image feature detection',
      enabled: true,
      types: [
        { id: 'img_1', name: 'Image Type 1', color: '#b45309', enabled: true, order: 1 },
        { id: 'img_2', name: 'Image Type 2', color: '#b45309', enabled: true, order: 2 },
      ],
    },
  ];
}

export function makeTextPreset(ids: string[]): RecognitionPreset {
  return {
    id: 'preset-text-1',
    name: 'Text Preset',
    kind: 'text',
    selectedEntityTypeIds: ids,
    ocrHasTypes: [],
    hasImageTypes: [],
    replacementMode: 'structured',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

export function makeVisionPreset(): RecognitionPreset {
  return {
    id: 'preset-vision-1',
    name: 'Vision Preset',
    kind: 'vision',
    selectedEntityTypeIds: [],
    ocrHasTypes: ['ocr_1'],
    hasImageTypes: ['img_1'],
    replacementMode: 'structured',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, null, children);

export function resetRecognitionTestEnvironment() {
  vi.clearAllMocks();
  localStorage.clear();
  usePresetsMock.mockReturnValue({ data: [], isLoading: false, error: null });
  useInvalidatePresetsMock.mockReturnValue(invalidatePresetsMock);
  mockCreatePreset.mockResolvedValue({
    id: 'created-preset',
    name: 'Created Preset',
    kind: 'text',
    selectedEntityTypeIds: [],
    ocrHasTypes: [],
    hasImageTypes: [],
    replacementMode: 'structured',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });
}

export function setupMocks(
  types: EntityTypeConfig[] = makeEntityTypes(),
  pipelines: PipelineConfig[] = makePipelines(),
  presets: RecognitionPreset[] = [],
) {
  mockFetchRecognitionEntityTypes.mockResolvedValue(types);
  mockFetchRecognitionPipelines.mockResolvedValue(pipelines);
  usePresetsMock.mockReturnValue({ data: presets, isLoading: false, error: null });
}

export function renderHookUnderTest() {
  return renderHook(() => usePlaygroundRecognition(), { wrapper });
}
