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
  });

  it('sets visionConfigState to unavailable on pipeline fetch error', async () => {
    setupMocks();
    mockFetchRecognitionPipelines.mockRejectedValue(new Error('fail'));
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('unavailable'));
  });

  it('restores ocrHasTypes from localStorage', async () => {
    localStorage.setItem('ocrHasTypes', JSON.stringify(['ocr_1']));
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedOcrHasTypes).toEqual(['ocr_1']));
  });

  it('restores hasImageTypes from localStorage', async () => {
    localStorage.setItem('hasImageTypes', JSON.stringify(['img_1']));
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedHasImageTypes).toEqual(['img_1']));
  });

  it('recovers defaults when both localStorage vision lists are empty', async () => {
    localStorage.setItem('ocrHasTypes', JSON.stringify([]));
    localStorage.setItem('hasImageTypes', JSON.stringify([]));
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => {
      expect(result.current.selectedOcrHasTypes.length).toBeGreaterThan(0);
      expect(result.current.selectedHasImageTypes.length).toBeGreaterThan(0);
    });
  });

  it('filters out unknown IDs from localStorage ocrHasTypes', async () => {
    localStorage.setItem('ocrHasTypes', JSON.stringify(['ocr_1', 'missing']));
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.selectedOcrHasTypes).toEqual(['ocr_1']));
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
    act(() => result.current.toggleVisionType('img_1', 'has_image'));

    expect(result.current.selectedHasImageTypes).toContain('img_1');
  });

  it('removes a type from selectedHasImageTypes when present', async () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionConfigState).toBe('ready'));

    act(() => result.current.updateHasImageTypes(['img_1', 'img_2']));
    act(() => result.current.toggleVisionType('img_1', 'has_image'));

    expect(result.current.selectedHasImageTypes).toEqual(['img_2']);
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
