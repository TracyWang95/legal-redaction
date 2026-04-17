// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import type { EntityTypeConfig } from '../../types';
import {
  makeEntityTypes,
  makePipelines,
  makeTextPreset,
  mockFetchRecognitionEntityTypes,
  renderHookUnderTest,
  resetRecognitionTestEnvironment,
  setupMocks,
} from './use-playground-recognition.test-helpers';

describe('usePlaygroundRecognition entity and text behavior', () => {
  beforeEach(() => {
    resetRecognitionTestEnvironment();
  });

  it('populates entityTypes after mount', async () => {
    const types = makeEntityTypes(4);
    setupMocks(types);
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.entityTypes.length).toBe(4));
  });

  it('sets textConfigState to ready when types are loaded', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.textConfigState).toBe('ready'));
  });

  it('sets textConfigState to empty when no types are returned', async () => {
    setupMocks([]);
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.textConfigState).toBe('empty'));
  });

  it('sets textConfigState to unavailable on fetch error', async () => {
    setupMocks(makeEntityTypes(), makePipelines());
    mockFetchRecognitionEntityTypes.mockRejectedValue(new Error('fail'));
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.textConfigState).toBe('unavailable'));
  });

  it('populates selectedTypes with default IDs from entity types', async () => {
    setupMocks(makeEntityTypes(5));
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedTypes.length).toBeGreaterThan(0));
  });

  it('calls fetchRecognitionEntityTypes with enabledOnly=true', async () => {
    setupMocks();
    renderHookUnderTest();
    await waitFor(() => expect(mockFetchRecognitionEntityTypes).toHaveBeenCalledWith(true, 1_200));
  });

  it('sorts regex-backed entity types first', async () => {
    setupMocks(makeEntityTypes(5));
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.sortedEntityTypes.length).toBe(5));
    expect(result.current.sortedEntityTypes.slice(0, 2).every((type) => type.regex_pattern)).toBe(
      true,
    );
  });

  it('setPlaygroundTextTypeGroupSelection adds IDs when turnOn=true', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.entityTypes.length).toBeGreaterThan(0));

    act(() => result.current.setSelectedTypes([]));
    act(() => result.current.setPlaygroundTextTypeGroupSelection(['TYPE_1', 'TYPE_2'], true));

    expect(result.current.selectedTypes).toContain('TYPE_1');
    expect(result.current.selectedTypes).toContain('TYPE_2');
  });

  it('setPlaygroundTextTypeGroupSelection removes IDs when turnOn=false', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.entityTypes.length).toBeGreaterThan(0));

    act(() => result.current.setSelectedTypes(['TYPE_1', 'TYPE_2', 'TYPE_3']));
    act(() => result.current.setPlaygroundTextTypeGroupSelection(['TYPE_1', 'TYPE_2'], false));

    expect(result.current.selectedTypes).toEqual(['TYPE_3']);
  });

  it('clears text preset tracking after group selection changes', async () => {
    const preset = makeTextPreset(['TYPE_1']);
    setupMocks(makeEntityTypes(), makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.textPresetsPg.length).toBe(1));

    act(() => result.current.selectPlaygroundTextPresetById('preset-text-1'));
    expect(result.current.playgroundPresetTextId).toBe('preset-text-1');

    act(() => result.current.setPlaygroundTextTypeGroupSelection(['TYPE_3'], true));
    expect(result.current.playgroundPresetTextId).toBeNull();
  });

  it('getTypeConfig returns config for a known type', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.entityTypes.length).toBeGreaterThan(0));

    expect(result.current.getTypeConfig('TYPE_1').name).toBe('Entity 1');
  });

  it('getTypeConfig returns a fallback for an unknown type', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.entityTypes.length).toBeGreaterThan(0));

    expect(result.current.getTypeConfig('UNKNOWN')).toEqual({
      name: 'UNKNOWN',
      color: '#6366F1',
    });
  });

  it('filters out disabled entity type IDs when applying a text preset', async () => {
    const types: EntityTypeConfig[] = [
      { id: 'TYPE_1', name: 'E1', color: '#000', enabled: true, order: 1 },
      { id: 'TYPE_2', name: 'E2', color: '#000', enabled: false, order: 2 },
    ];
    const preset = makeTextPreset(['TYPE_1', 'TYPE_2']);
    setupMocks(types, makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.textPresetsPg.length).toBe(1));

    act(() => result.current.selectPlaygroundTextPresetById('preset-text-1'));

    expect(result.current.selectedTypes).toEqual(['TYPE_1']);
  });
});
