// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

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
