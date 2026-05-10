// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import type { BoundingBox as EditorBox } from '@/components/ImageBBoxEditor';
import {
  getReviewBoxQualityIssueKeys,
  getReviewBoxSourceKind,
} from '../review-box-quality';

function box(partial: Partial<EditorBox>): EditorBox {
  return {
    id: partial.id ?? 'box-1',
    x: partial.x ?? 0.1,
    y: partial.y ?? 0.1,
    width: partial.width ?? 0.2,
    height: partial.height ?? 0.2,
    page: partial.page ?? 1,
    type: partial.type ?? 'official_seal',
    selected: partial.selected ?? true,
    ...partial,
  };
}

describe('review box quality source evidence', () => {
  it('uses evidence_source to separate model hits from local fallback boxes', () => {
    expect(
      getReviewBoxSourceKind(
        box({
          source: 'has_image',
          evidence_source: 'has_image_model',
          source_detail: 'has_image',
        }),
      ),
    ).toBe('hasImage');

    const fallback = box({
      source: 'has_image',
      evidence_source: 'local_fallback',
      source_detail: 'local_red_seal_fallback',
    });
    expect(getReviewBoxSourceKind(fallback)).toBe('fallback');
    expect(getReviewBoxQualityIssueKeys(fallback)).toContain('fallback');
  });
});
