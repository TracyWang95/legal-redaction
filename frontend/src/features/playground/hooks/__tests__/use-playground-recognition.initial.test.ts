// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import type { EntityTypeConfig } from '../../types';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderHookUnderTest,
  resetRecognitionTestEnvironment,
  setupMocks,
} from './use-playground-recognition.test-helpers';

describe('usePlaygroundRecognition initial state', () => {
  beforeEach(() => {
    resetRecognitionTestEnvironment();
  });

  it('textConfigState starts as loading', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.textConfigState).toBe('loading');
  });

  it('visionConfigState starts as loading', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.visionConfigState).toBe('loading');
  });

  it('entityTypes starts empty', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.entityTypes).toEqual([]);
  });

  it('selectedTypes starts empty', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.selectedTypes).toEqual([]);
  });

  it('visionTypes starts empty', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.visionTypes).toEqual([]);
  });

  it('selectedOcrHasTypes starts empty', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.selectedOcrHasTypes).toEqual([]);
  });

  it('selectedHasImageTypes starts empty', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.selectedHasImageTypes).toEqual([]);
  });

  it('typeTab starts as text', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.typeTab).toBe('text');
  });

  it('replacementMode starts as structured', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.replacementMode).toBe('structured');
  });

  it('playgroundPresetTextId starts null', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.playgroundPresetTextId).toBeNull();
  });

  it('playgroundPresetVisionId starts null', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.playgroundPresetVisionId).toBeNull();
  });

  it('hydrates state from cache on mount', () => {
    const payload = {
      version: 1,
      savedAt: Date.now(),
      entityTypes: [
        {
          id: 'TYPE_1',
          name: 'Cached type',
          color: '#2563eb',
          regex_pattern: null,
          enabled: true,
          order: 1,
        } as EntityTypeConfig,
      ],
      pipelines: [
        {
          mode: 'ocr_has',
          name: 'OCR',
          description: 'OCR',
          enabled: true,
          types: [{ id: 'ocr_1', name: 'OCR', color: '#2563eb', enabled: true, order: 1 }],
        },
        {
          mode: 'has_image',
          name: 'Visual',
          description: 'Visual',
          enabled: true,
          types: [{ id: 'face', name: 'Face', color: '#4c1d95', enabled: true, order: 1 }],
        },
      ],
    };
    localStorage.setItem('datainfraRedaction:recognitionConfigCache', JSON.stringify(payload));

    setupMocks();
    const { result } = renderHookUnderTest();

    expect(result.current.textConfigState).toBe('ready');
    expect(result.current.visionConfigState).toBe('ready');
    expect(result.current.entityTypes).toEqual(payload.entityTypes);
    expect(result.current.visionTypes.length).toBe(2);
  });

  it('presetDialogKind starts null', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.presetDialogKind).toBeNull();
  });

  it('presetSaving starts false', () => {
    setupMocks();
    const { result } = renderHookUnderTest();
    expect(result.current.presetSaving).toBe(false);
  });
});
