// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeEntityTypes,
  makePipelines,
  makeVisionPreset,
  mockFetchRecognitionPipelines,
  renderHookUnderTest,
  resetRecognitionTestEnvironment,
  setupMocks,
} from './use-playground-recognition.test-helpers';

const DEFAULT_VISION_SIGNATURE = JSON.stringify({
  ocrHas: ['ocr_1', 'ocr_2'],
  hasImage: ['face', 'official_seal'],
});

describe('usePlaygroundRecognition vision behavior', () => {
  beforeEach(() => {
    resetRecognitionTestEnvironment();
  });

  it('populates visionTypes after mount', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionTypes.length).toBeGreaterThan(0));
  });

  it('sets visionConfigState to ready when pipelines are loaded', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('ready'));
  });

  it('populates selectedOcrHasTypes with defaults', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedOcrHasTypes.length).toBeGreaterThan(0));
  });

  it('populates selectedHasImageTypes with defaults', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedHasImageTypes.length).toBeGreaterThan(0));
    expect(result.current.selectedHasImageTypes).not.toContain('paper');
  });

  it('keeps HaS Image recognition config to fixed model classes only', async () => {
    const pipelines = makePipelines();
    pipelines[1].types.push(
      { id: 'signature', name: 'Signature', color: '#b91c1c', enabled: true, order: 21 },
      { id: 'handwriting', name: 'Handwriting', color: '#991b1b', enabled: true, order: 22 },
      {
        id: 'custom_sensitive_region',
        name: 'Custom region',
        color: '#7f1d1d',
        enabled: true,
        order: 23,
      },
    );
    setupMocks(makeEntityTypes(), pipelines);
    const { result } = renderHookUnderTest();

    await waitFor(() => expect(result.current.visionConfigState).toBe('ready'));

    const imagePipeline = result.current.pipelines.find((pipeline) => pipeline.mode === 'has_image');
    expect(imagePipeline?.types.map((type) => type.id)).toEqual(['face', 'official_seal', 'paper']);
    expect(result.current.selectedHasImageTypes).toEqual(['face', 'official_seal']);
  });

  it('sets visionConfigState to unavailable on pipeline fetch error', async () => {
    setupMocks();
    mockFetchRecognitionPipelines.mockRejectedValue(new Error('fail'));
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('unavailable'));
  });

  it('restores ocrHasTypes from localStorage', async () => {
    localStorage.setItem('ocrHasTypes', JSON.stringify(['ocr_1']));
    localStorage.setItem(
      'datainfraRedaction:visionSelectionSignature',
      JSON.stringify(DEFAULT_VISION_SIGNATURE),
    );
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedOcrHasTypes).toEqual(['ocr_1']));
  });

  it('restores hasImageTypes from localStorage', async () => {
    localStorage.setItem('hasImageTypes', JSON.stringify(['face', 'paper']));
    localStorage.setItem(
      'datainfraRedaction:visionSelectionSignature',
      JSON.stringify(DEFAULT_VISION_SIGNATURE),
    );
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedHasImageTypes).toEqual(['face', 'paper']));
  });

  it('preserves explicit empty localStorage vision lists', async () => {
    localStorage.setItem('ocrHasTypes', JSON.stringify([]));
    localStorage.setItem('hasImageTypes', JSON.stringify([]));
    localStorage.setItem(
      'datainfraRedaction:visionSelectionSignature',
      JSON.stringify(DEFAULT_VISION_SIGNATURE),
    );
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => {
      expect(result.current.selectedOcrHasTypes).toEqual([]);
      expect(result.current.selectedHasImageTypes).toEqual([]);
    });
  });

  it('filters out unknown IDs from localStorage ocrHasTypes', async () => {
    localStorage.setItem('ocrHasTypes', JSON.stringify(['ocr_1', 'missing']));
    localStorage.setItem(
      'datainfraRedaction:visionSelectionSignature',
      JSON.stringify(DEFAULT_VISION_SIGNATURE),
    );
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedOcrHasTypes).toEqual(['ocr_1']));
  });

  it('resets stale localStorage selections when backend defaults change', async () => {
    localStorage.setItem('ocrHasTypes', JSON.stringify(['ocr_1']));
    localStorage.setItem('hasImageTypes', JSON.stringify(['paper']));
    localStorage.setItem(
      'datainfraRedaction:visionSelectionSignature',
      JSON.stringify('old-defaults'),
    );
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => {
      expect(result.current.selectedOcrHasTypes).toEqual(['ocr_1', 'ocr_2']);
      expect(result.current.selectedHasImageTypes).toEqual(['face', 'official_seal']);
    });
  });

  it('adds a type to selectedOcrHasTypes when not present', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('ready'));

    act(() => result.current.updateOcrHasTypes([]));
    act(() => result.current.toggleVisionType('ocr_1', 'ocr_has'));

    expect(result.current.selectedOcrHasTypes).toContain('ocr_1');
  });

  it('removes a type from selectedOcrHasTypes when present', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('ready'));

    act(() => result.current.updateOcrHasTypes(['ocr_1', 'ocr_2']));
    act(() => result.current.toggleVisionType('ocr_1', 'ocr_has'));

    expect(result.current.selectedOcrHasTypes).toEqual(['ocr_2']);
  });

  it('adds a type to selectedHasImageTypes when not present', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('ready'));

    act(() => result.current.updateHasImageTypes([]));
    act(() => result.current.toggleVisionType('face', 'has_image'));

    expect(result.current.selectedHasImageTypes).toContain('face');
  });

  it('removes a type from selectedHasImageTypes when present', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('ready'));

    act(() => result.current.updateHasImageTypes(['face', 'official_seal']));
    act(() => result.current.toggleVisionType('face', 'has_image'));

    expect(result.current.selectedHasImageTypes).toEqual(['official_seal']);
  });

  it('returns info about the toggled type', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('ready'));

    act(() => result.current.updateOcrHasTypes(['ocr_1']));

    let toggleResult: { typeId: string; wasActive: boolean } | undefined;
    act(() => {
      toggleResult = result.current.toggleVisionType('ocr_1', 'ocr_has');
    });

    expect(toggleResult).toEqual({ typeId: 'ocr_1', wasActive: true });
  });

  it('clears vision preset tracking after toggle', async () => {
    const preset = makeVisionPreset();
    setupMocks(makeEntityTypes(), makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionPresetsPg.length).toBe(1));

    act(() => result.current.selectPlaygroundVisionPresetById('preset-vision-1'));
    expect(result.current.playgroundPresetVisionId).toBe('preset-vision-1');

    act(() => result.current.toggleVisionType('ocr_2', 'ocr_has'));
    expect(result.current.playgroundPresetVisionId).toBeNull();
  });

  it('getVisionTypeConfig returns config for a known vision type', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionTypes.length).toBeGreaterThan(0));

    expect(result.current.getVisionTypeConfig('ocr_1').name).toBe('OCR Type 1');
  });

  it('getVisionTypeConfig returns a fallback for an unknown vision type', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();

    expect(result.current.getVisionTypeConfig('UNKNOWN')).toEqual({
      name: 'UNKNOWN',
      color: '#6366F1',
    });
  });
});
