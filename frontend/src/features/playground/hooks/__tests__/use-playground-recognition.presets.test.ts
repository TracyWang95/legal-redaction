// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeEntityTypes,
  makePipelines,
  makeTextPreset,
  makeVisionPreset,
  renderHookUnderTest,
  resetRecognitionTestEnvironment,
  setupMocks,
} from './use-playground-recognition.test-helpers';

describe('usePlaygroundRecognition preset behavior', () => {
  beforeEach(() => {
    resetRecognitionTestEnvironment();
  });

  it('selectPlaygroundTextPresetById updates selectedTypes', async () => {
    const preset = makeTextPreset(['TYPE_1', 'TYPE_3']);
    setupMocks(makeEntityTypes(5), makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => {
      expect(result.current.textPresetsPg.length).toBe(1);
      expect(result.current.entityTypes.length).toBe(5);
    });

    act(() => result.current.selectPlaygroundTextPresetById('preset-text-1'));

    expect(result.current.selectedTypes).toEqual(['TYPE_1', 'TYPE_3']);
  });

  it('selectPlaygroundTextPresetById sets playgroundPresetTextId', async () => {
    const preset = makeTextPreset(['TYPE_1']);
    setupMocks(makeEntityTypes(5), makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => {
      expect(result.current.textPresetsPg.length).toBe(1);
      expect(result.current.entityTypes.length).toBe(5);
    });

    act(() => result.current.selectPlaygroundTextPresetById('preset-text-1'));

    expect(result.current.playgroundPresetTextId).toBe('preset-text-1');
  });

  it('selectPlaygroundTextPresetById with empty string resets to defaults', async () => {
    const preset = makeTextPreset(['TYPE_1']);
    setupMocks(makeEntityTypes(5), makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => {
      expect(result.current.textPresetsPg.length).toBe(1);
      expect(result.current.entityTypes.length).toBe(5);
    });

    act(() => result.current.selectPlaygroundTextPresetById('preset-text-1'));
    act(() => result.current.selectPlaygroundTextPresetById(''));

    expect(result.current.playgroundPresetTextId).toBeNull();
    expect(result.current.replacementMode).toBe('structured');
  });

  it('selectPlaygroundVisionPresetById updates ocrHasTypes', async () => {
    const preset = makeVisionPreset();
    setupMocks(makeEntityTypes(), makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionPresetsPg.length).toBe(1));

    act(() => result.current.selectPlaygroundVisionPresetById('preset-vision-1'));

    expect(result.current.selectedOcrHasTypes).toEqual(['ocr_1']);
  });

  it('selectPlaygroundVisionPresetById bumps presetApplySeq', async () => {
    const preset = makeVisionPreset();
    setupMocks(makeEntityTypes(), makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionPresetsPg.length).toBe(1));

    act(() => result.current.selectPlaygroundVisionPresetById('preset-vision-1'));

    expect(result.current.presetApplySeq).toBe(1);
  });

  it('selectPlaygroundVisionPresetById with empty resets to defaults', async () => {
    const preset = makeVisionPreset();
    setupMocks(makeEntityTypes(), makePipelines(), [preset]);
    const { result } = renderHookUnderTest();
    await waitFor(() => expect(result.current.visionPresetsPg.length).toBe(1));

    act(() => result.current.selectPlaygroundVisionPresetById('preset-vision-1'));
    act(() => result.current.selectPlaygroundVisionPresetById(''));

    expect(result.current.playgroundPresetVisionId).toBeNull();
  });

  it('openTextPresetDialog sets kind to text', () => {
    setupMocks();
    const { result } = renderHookUnderTest();

    act(() => result.current.openTextPresetDialog());

    expect(result.current.presetDialogKind).toBe('text');
  });

  it('openVisionPresetDialog sets kind to vision', () => {
    setupMocks();
    const { result } = renderHookUnderTest();

    act(() => result.current.openVisionPresetDialog());

    expect(result.current.presetDialogKind).toBe('vision');
  });

  it('closePresetDialog resets dialog state', () => {
    setupMocks();
    const { result } = renderHookUnderTest();

    act(() => result.current.openTextPresetDialog());
    act(() => result.current.closePresetDialog());

    expect(result.current.presetDialogKind).toBeNull();
    expect(result.current.presetDialogName).toBe('');
  });
});
