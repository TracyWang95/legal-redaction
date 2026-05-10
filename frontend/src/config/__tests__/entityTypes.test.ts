// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  ALL_ENTITY_TYPES,
  getEntityGroup,
  getEntityTypeName,
  normalizeEntityTypeId,
} from '../entityTypes';
import { useI18n } from '@/i18n';

describe('entity type normalization', () => {
  it('keeps atomic field labels visible without duplicate date aliases', () => {
    const visibleTypeIds = ALL_ENTITY_TYPES.map((type) => type.id);

    expect(visibleTypeIds).toContain('DATE');
    expect(visibleTypeIds).toContain('TIME');
    expect(visibleTypeIds).toContain('AMOUNT');
    expect(visibleTypeIds).toContain('AGE');
    expect(visibleTypeIds).toContain('ETHNICITY');
    expect(visibleTypeIds).toContain('RELIGION');
    expect(visibleTypeIds).not.toContain('PERSONAL_ATTRIBUTE');
    expect(visibleTypeIds).not.toEqual(expect.arrayContaining(['DATETIME', 'DATE_TIME', 'MONEY']));
  });

  it('normalizes legacy semantic duplicates for display lookups', () => {
    useI18n.getState().setLocale('zh');

    expect(normalizeEntityTypeId('COMPANY')).toBe('COMPANY_NAME');
    expect(normalizeEntityTypeId('WORK_UNIT')).toBe('WORK_UNIT');
    expect(normalizeEntityTypeId('AGE')).toBe('AGE');
    expect(normalizeEntityTypeId('RACE_ETHNICITY')).toBe('ETHNICITY');
    expect(normalizeEntityTypeId('RELIGION')).toBe('RELIGION');
    expect(normalizeEntityTypeId('TIME')).toBe('TIME');
    expect(normalizeEntityTypeId('DATETIME')).toBe('DATE');
    expect(normalizeEntityTypeId('DATE_TIME')).toBe('DATE');
    expect(normalizeEntityTypeId('MONEY')).toBe('AMOUNT');

    expect(getEntityGroup('COMPANY')?.id).toBe(getEntityGroup('COMPANY_NAME')?.id);
    expect(getEntityTypeName('COMPANY')).toBe(getEntityTypeName('COMPANY_NAME'));
    expect(getEntityGroup('WORK_UNIT')?.id).toBe('business');
    expect(getEntityTypeName('WORK_UNIT')).toBe('工作单位');
    expect(getEntityTypeName('TIME')).not.toBe(getEntityTypeName('DATE'));
    expect(getEntityTypeName('MONEY')).toBe(getEntityTypeName('AMOUNT'));
  });

  it('renders HaS Image class ids as visual labels instead of prettified English fallbacks', () => {
    useI18n.getState().setLocale('zh');

    expect(getEntityGroup('official_seal')?.id).toBe('visual');
    expect(getEntityTypeName('official_seal')).toBe('公章');
    expect(getEntityTypeName('qr_code')).toBe('二维码');
    expect(getEntityTypeName('mobile_screen')).toBe('手机屏幕');
  });
});
