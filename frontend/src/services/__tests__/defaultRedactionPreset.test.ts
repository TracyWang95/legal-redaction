// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  buildDefaultPipelineCoverage,
  buildDefaultPipelineTypeIds,
  buildDefaultTextTypeIds,
  isDefaultExcludedPipelineTypeId,
  isHasImageModelTypeId,
  isOcrFallbackOnlyVisualTypeId,
} from '../defaultRedactionPreset';

describe('default redaction preset helpers', () => {
  it('selects enabled HaS Image model classes by default but leaves page containers opt-in', () => {
    const defaults = buildDefaultPipelineTypeIds(
      [
        {
          mode: 'has_image',
          enabled: true,
          types: [
            { id: 'official_seal', enabled: true, order: 12 },
            { id: 'paper', enabled: true, order: 20 },
          ],
        },
      ],
      'has_image',
    );

    expect(defaults).toEqual(['official_seal']);
    expect(isDefaultExcludedPipelineTypeId('has_image', 'paper')).toBe(true);
  });

  it('keeps disabled HaS Image model classes out of selected and visible coverage', () => {
    const coverage = buildDefaultPipelineCoverage(
      [
        {
          mode: 'has_image',
          enabled: true,
          types: [
            { id: 'official_seal', enabled: true, order: 12 },
            { id: 'paper', enabled: false, order: 20 },
          ],
        },
      ],
      'has_image',
    );

    expect(coverage.selectedIds).toEqual(['official_seal']);
    expect(coverage.excludedIds).toEqual([]);
    expect(coverage.enabledIds).toEqual(['official_seal']);
  });

  it('uses atomic organization types in generic text defaults without the broad ORG bucket', () => {
    const defaults = buildDefaultTextTypeIds([
      { id: 'PERSON', enabled: true, order: 1 },
      { id: 'ORG', enabled: true, order: 2 },
      { id: 'COMPANY_NAME', enabled: true, order: 3 },
      { id: 'INSTITUTION_NAME', enabled: true, order: 4 },
      { id: 'GOVERNMENT_AGENCY', enabled: true, order: 5 },
      { id: 'WORK_UNIT', enabled: true, order: 6 },
      { id: 'LEGAL_PLAINTIFF', enabled: true, order: 7 },
      { id: 'FIN_TRANSACTION_ID', enabled: true, order: 8 },
      { id: 'MED_RECORD_ID', enabled: true, order: 9 },
      { id: 'custom_project_secret', enabled: true, order: 10 },
    ]);

    expect(defaults).toEqual([
      'PERSON',
      'COMPANY_NAME',
      'INSTITUTION_NAME',
      'GOVERNMENT_AGENCY',
      'custom_project_secret',
    ]);
  });

  it('selects generic enabled OCR+HaS types by default', () => {
    const defaults = buildDefaultPipelineTypeIds(
      [
        {
          mode: 'ocr_has',
          enabled: true,
          types: [
            { id: 'PERSON', enabled: true, order: 1 },
            { id: 'LEGAL_COURT', enabled: true, order: 120 },
            { id: 'MED_RECORD_ID', enabled: true, order: 121 },
            { id: 'custom_sensitive_mark', enabled: true, order: 122 },
          ],
        },
      ],
      'ocr_has',
    );

    expect(defaults).toEqual(['PERSON', 'custom_sensitive_mark']);
    expect(isDefaultExcludedPipelineTypeId('ocr_has', 'LEGAL_COURT')).toBe(true);
  });

  it('summarizes selected and excluded pipeline defaults from the same rules', () => {
    const coverage = buildDefaultPipelineCoverage(
      [
        {
          mode: 'ocr_has',
          enabled: true,
          types: [
            { id: 'PERSON', enabled: true, order: 1 },
            { id: 'SIGNATURE', enabled: true, order: 120 },
            { id: 'disabled', enabled: false, order: 2 },
          ],
        },
        {
          mode: 'has_image',
          enabled: true,
          types: [{ id: 'official_seal', enabled: true, order: 12 }],
        },
      ],
      'ocr_has',
    );

    expect(coverage.selectedIds).toEqual(['PERSON', 'SIGNATURE']);
    expect(coverage.excludedIds).toEqual([]);
    expect(coverage.enabledIds).toEqual(['PERSON', 'SIGNATURE']);
  });

  it('treats signature and handwriting visual ids as OCR fallback-only, never HaS Image defaults', () => {
    expect(isOcrFallbackOnlyVisualTypeId('SIGNATURE')).toBe(true);
    expect(isOcrFallbackOnlyVisualTypeId('hand-written')).toBe(true);
    expect(isOcrFallbackOnlyVisualTypeId('handwriting')).toBe(true);
    expect(isOcrFallbackOnlyVisualTypeId('face')).toBe(false);

    const defaults = buildDefaultPipelineTypeIds(
      [
        {
          mode: 'has_image',
          enabled: true,
          types: [
            { id: 'face', enabled: true, order: 0 },
            { id: 'signature', enabled: true, order: 1 },
            { id: 'handwriting', enabled: true, order: 2 },
            { id: 'hand-written', enabled: true, order: 3 },
          ],
        },
      ],
      'has_image',
    );

    expect(defaults).toEqual(['face']);
  });

  it('keeps HaS Image defaults and visible coverage to the fixed model classes only', () => {
    expect(isHasImageModelTypeId('official-seal')).toBe(true);
    expect(isHasImageModelTypeId('paper')).toBe(false);
    expect(isHasImageModelTypeId('custom_sensitive_region')).toBe(false);
    expect(isDefaultExcludedPipelineTypeId('has_image', 'custom_sensitive_region')).toBe(true);

    const coverage = buildDefaultPipelineCoverage(
      [
        {
          mode: 'has_image',
          enabled: true,
          types: [
            { id: 'face', enabled: true, order: 0 },
            { id: 'paper', enabled: false, order: 20 },
            { id: 'signature', enabled: true, order: 21 },
            { id: 'handwriting', enabled: true, order: 22 },
            { id: 'custom_sensitive_region', enabled: true, order: 23 },
          ],
        },
      ],
      'has_image',
    );

    expect(coverage.selectedIds).toEqual(['face']);
    expect(coverage.excludedIds).toEqual([]);
    expect(coverage.enabledIds).toEqual(['face']);
  });
});
