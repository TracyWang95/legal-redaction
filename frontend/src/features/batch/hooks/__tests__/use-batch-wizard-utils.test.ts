// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  defaultConfig,
  mapBackendStatus,
  mergeJobConfigIntoWizardCfg,
} from '../use-batch-wizard-utils';

describe('mergeJobConfigIntoWizardCfg', () => {
  it('preserves explicitly configured HaS Image categories from restored job config', () => {
    const merged = mergeJobConfigIntoWizardCfg(defaultConfig(), {
      has_image_types: ['official_seal', 'paper'],
    });

    expect(merged.hasImageTypes).toEqual(['official_seal', 'paper']);
  });
});

describe('mapBackendStatus', () => {
  it('treats terminal reviewable aliases as Step3 reviewable rows', () => {
    expect(mapBackendStatus('reviewing')).toBe('awaiting_review');
    expect(mapBackendStatus('reviewed')).toBe('completed');
    expect(mapBackendStatus('redacted')).toBe('completed');
    expect(mapBackendStatus('exported')).toBe('completed');
  });
});
