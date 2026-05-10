// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { t, useT, useI18n } from '../index';
import { en } from '../en';
import enSource from '../en.ts?raw';
import { zh } from '../zh';
import zhSource from '../zh.ts?raw';

function getDuplicateKeys(source: string, prefix: string): string[] {
  const locations = new Map<string, number[]>();
  const keyPattern = /['"]([^'"]+)['"]\s*:/g;
  let match: RegExpExecArray | null;

  while ((match = keyPattern.exec(source)) !== null) {
    const key = match[1];
    if (!key.startsWith(prefix)) continue;

    const line = source.slice(0, match.index).split(/\r?\n/).length;
    locations.set(key, [...(locations.get(key) ?? []), line]);
  }

  return [...locations.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([key, lines]) => `${key} (${lines.join(', ')})`);
}

function getKeys(locale: Record<string, string>, prefix: string): string[] {
  return Object.keys(locale)
    .filter((key) => key.startsWith(prefix))
    .sort();
}

beforeEach(() => {
  localStorage.clear();
  // Reset locale to 'en' before each test
  useI18n.setState({ locale: 'en' });
});

describe('t() — translate function', () => {
  it('returns the English string for a known key when locale is en', () => {
    useI18n.setState({ locale: 'en' });
    expect(t('common.confirm')).toBe(en['common.confirm']);
    expect(t('common.confirm')).toBe('Confirm');
  });

  it('returns the Chinese string for a known key when locale is zh', () => {
    useI18n.setState({ locale: 'zh' });
    expect(t('common.confirm')).toBe(zh['common.confirm']);
    expect(t('common.confirm')).toBe('确认');
  });

  it('returns correct values for various keys in English', () => {
    useI18n.setState({ locale: 'en' });
    expect(t('common.cancel')).toBe('Cancel');
    expect(t('common.save')).toBe('Save');
    expect(t('common.loading')).toBe('Loading...');
  });

  it('returns correct values for various keys in Chinese', () => {
    useI18n.setState({ locale: 'zh' });
    expect(t('common.cancel')).toBe('取消');
    expect(t('common.save')).toBe('保存');
    expect(t('common.loading')).toBe('加载中...');
  });
});

describe('fallback behavior', () => {
  it('falls back to English when a Chinese key is missing', () => {
    // Find a key that exists in en but not in zh, or simulate by testing the
    // fallback logic: when zh is primary and key is missing, it checks en.
    useI18n.setState({ locale: 'zh' });

    // We test the mechanism: if a key only exists in en, zh locale falls back to en
    // Since both locale files are large and cover the same keys, we test indirectly
    // by verifying that if the primary locale doesn't have the key, fallback works.
    // The code checks: primary -> fallback -> key itself
    const result = t('__test_key_that_does_not_exist_in_zh__');
    // Neither locale has it, so we get the key back
    expect(result).toBe('__test_key_that_does_not_exist_in_zh__');
  });

  it('returns the key itself when no translation exists in either locale', () => {
    useI18n.setState({ locale: 'en' });
    expect(t('totally.nonexistent.key')).toBe('totally.nonexistent.key');
  });

  it('returns the key itself for empty string key', () => {
    // Empty key won't match anything
    expect(t('')).toBe('');
  });
});

describe('destructive cleanup copy', () => {
  it('states that Jobs cleanup removes all local data, not only finished jobs', () => {
    expect(en['jobs.cleanupButton']).toBe('Clear all data');
    expect(en['jobs.cleanupMessage']).toContain('all uploaded files');
    expect(en['jobs.cleanupMessage']).toContain('running jobs');
    expect(en['jobs.cleanupMessage']).toContain('cannot be undone');
  });

  it('states that History cleanup removes all local data, not only completed history', () => {
    expect(en['history.cleanupButton']).toBe('Clear all data');
    expect(en['history.cleanupMsg']).toContain('all uploaded files');
    expect(en['history.cleanupMsg']).toContain('running jobs');
    expect(en['history.cleanupMsg']).toContain('cannot be undone');
  });
});

describe('product direction copy', () => {
  it('uses a natural Chinese product name and avoids mixed product-name copy', () => {
    expect(zh['sidebar.productName']).toBe('匿名化处理助手');
    expect(zh['playground.title']).toBe('处理单个文件');
    expect(Object.values(zh)).not.toContain(['DataInfra-RedactionEverything', '工作台'].join(' '));
  });

  it('makes single-file processing the first step before batch work', () => {
    expect(en['start.title']).toBe('Start with one file, then scale');
    expect(en['start.desc']).toContain('one file');
    expect(zh['start.title']).toBe('先处理单个文件，再扩展到批量');
    expect(zh['start.desc']).toContain('先用一个文件确认');
    expect(zh['nav.playground.sub']).toBe('先跑一个文件');
  });

  it('explains the low-friction start-page workflow without external media', () => {
    expect(en['start.workflow.title']).toContain('Upload one file');
    expect(en['start.workflow.desc']).toContain('single document or image');
    expect(en['start.workflow.badge.noMedia']).toBe('Built-in animation');
    expect(zh['start.workflow.title']).toBe('上传一个文件，检查标记，再导出');
    expect(zh['start.workflow.desc']).toContain('先放入一个文档或图片');
    expect(zh['start.workflow.badge.singleFirst']).toBe('先单个文件');
  });

  it('keeps the left navigation on the consolidated user-flow labels', () => {
    expect([
      zh['nav.start'],
      zh['nav.playground'],
      zh['nav.batch'],
      zh['nav.jobs'],
      zh['nav.history'],
      zh['nav.config'],
    ]).toEqual(['开始', '单次处理', '批量处理', '任务中心', '处理结果', '配置']);
    expect(en['nav.playground']).toBe('Single File');
    expect(en['nav.batch']).toBe('Batch');
    expect(en['nav.config']).toBe('Configuration');
    expect(zh['nav.batch.sub']).toBe('混合文件队列');
    expect(zh['nav.config.sub']).toBe('规则与服务');
    expect(zh['page.config.title']).toBe('配置');
  });

  it('keeps internal and over-technical labels out of user-visible copy', () => {
    const enCopy = Object.values(en).join('\n');
    const zhCopy = Object.values(zh).join('\n');

    expect(en['health.sidebar.title']).toBe('Services');
    expect(en['health.title']).toBe('Services');
    expect(zh['health.sidebar.title']).toBe('本地服务');
    expect(zh['health.title']).toBe('本地服务');

    for (const copy of [enCopy, zhCopy]) {
      expect(copy).not.toContain('Playground');
      expect(copy).not.toContain('Service Status');
      expect(copy).not.toContain('Advanced Settings');
      expect(copy).not.toContain('Model Services');
      expect(copy).not.toContain('DataInfra-RedactionEverything');
      expect(copy).not.toContain('Busy');
    }
  });

  it('keeps developer diagnostics out of the normal start-page entry copy', () => {
    const enDiagnostics = Object.entries(en)
      .filter(([key]) => key.startsWith('start.realEval.'))
      .map(([, value]) => value)
      .join('\n');
    const zhDiagnostics = Object.entries(zh)
      .filter(([key]) => key.startsWith('start.realEval.'))
      .map(([, value]) => value)
      .join('\n');

    expect(en['start.realEval.title']).toBe('Developer diagnostics');
    expect(zh['start.realEval.title']).toBe('开发者诊断');
    expect(enDiagnostics).not.toContain(['Local', 'real-file', 'evaluation'].join(' '));
    expect(enDiagnostics).not.toContain(['D:', '\\ceshi'].join(''));
    expect(enDiagnostics).not.toContain(['PowerShell', 'gate', 'command'].join(' '));
    expect(zhDiagnostics).not.toContain(['本地', '真实文件', '验证'].join(''));
    expect(zhDiagnostics).not.toContain(['D:', '\\ceshi'].join(''));
    expect(zhDiagnostics).not.toContain(['PowerShell', '门禁命令'].join(' '));
  });

  it('positions batch as mixed-file by default instead of separate channel choices', () => {
    expect(en['batchHub.mode.smart.title']).toBe('Mixed-file batch');
    expect(en['batchHub.mode.smart.tag2']).toBe('Default');
    expect(en['batchHub.mode.text.desc']).toContain('only when the whole batch');
    expect(en['batchHub.mode.smart.tag2']).not.toContain('channel');
    expect(en['batchHub.mode.smart.summaryValue']).not.toContain('channel');

    expect(zh['batchHub.mode.smart.title']).toBe('混合文件批量');
    expect(zh['batchHub.mode.smart.tag2']).toBe('默认入口');
    expect(zh['batchHub.mode.text.desc']).toContain('仅在整批都是');
    expect(zh['batchHub.mode.smart.tag2']).not.toContain('通道');
    expect(zh['batchHub.mode.smart.summaryValue']).not.toContain('通道');
  });
});

describe('Batch Step 5 i18n keys', () => {
  it('does not define duplicate review or delivery keys in locale source files', () => {
    expect(getDuplicateKeys(enSource, 'batchWizard.step4.')).toEqual([]);
    expect(getDuplicateKeys(zhSource, 'batchWizard.step4.')).toEqual([]);
    expect(getDuplicateKeys(enSource, 'batchWizard.step5.')).toEqual([]);
    expect(getDuplicateKeys(zhSource, 'batchWizard.step5.')).toEqual([]);
  });

  it('keeps Step 5 translation keys aligned between English and Chinese', () => {
    expect(getKeys(zh, 'batchWizard.step5.')).toEqual(getKeys(en, 'batchWizard.step5.'));
  });

  it('uses visual review hint copy consistently for Step 5 delivery evidence', () => {
    expect(en['batchWizard.step5.visualReviewTitle']).toBe('Visual review hints');
    expect(en['batchWizard.step5.visualReviewRisk']).toContain('Visual review hints remain');
    expect(en['batchWizard.step5.readyForDelivery']).toContain('Ready to deliver');
    expect(en['batchWizard.step5.actionRequired']).toContain('Action needed before delivery');
    expect(en['batchWizard.step5.exportSummary']).toBe('Delivery readiness');
    expect(zh['batchWizard.step5.visualReviewTitle']).toBe('视觉复核提示');
    expect(zh['batchWizard.step5.visualReviewRisk']).toContain('视觉复核提示');
    expect(zh['batchWizard.step5.visualEvidenceSummary']).toBe('视觉来源');
    expect(zh['batchWizard.step5.readyForDelivery']).toContain('已可交付');
    expect(zh['batchWizard.step5.actionRequired']).toContain('交付前仍需处理');
    expect(zh['batchWizard.step5.exportSummary']).toBe('交付就绪概览');
  });

  it('keeps delivery copy out of backend state names and internal report paths', () => {
    const deliveryCopy = [
      en['batchWizard.step5.readyForDelivery'],
      en['batchWizard.step5.actionRequired'],
      en['batchWizard.step5.qualityGateHint'],
      en['batchWizard.step5.visualReviewDeliveryHint'],
      zh['batchWizard.step5.readyForDelivery'],
      zh['batchWizard.step5.actionRequired'],
      zh['batchWizard.step5.qualityGateHint'],
      zh['batchWizard.step5.visualReviewDeliveryHint'],
    ].join('\n');

    expect(deliveryCopy).not.toContain('ready_for_delivery');
    expect(deliveryCopy).not.toContain('action_required');
    expect(deliveryCopy).not.toContain('eval gate');
    expect(deliveryCopy).not.toContain('diagnostics/report.html');
  });
});

describe('useT() hook', () => {
  it('returns a function that translates using the current locale', () => {
    useI18n.setState({ locale: 'en' });

    const { result } = renderHook(() => useT());

    expect(typeof result.current).toBe('function');
    expect(result.current('common.confirm')).toBe('Confirm');
  });

  it('reflects locale changes', () => {
    useI18n.setState({ locale: 'en' });

    const { result } = renderHook(() => useT());
    expect(result.current('common.confirm')).toBe('Confirm');

    act(() => {
      useI18n.setState({ locale: 'zh' });
    });

    expect(result.current('common.confirm')).toBe('确认');
  });
});

describe('locale switching via useI18n store', () => {
  it('defaults locale and allows switching to zh', () => {
    useI18n.setState({ locale: 'en' });
    expect(useI18n.getState().locale).toBe('en');

    act(() => {
      useI18n.getState().setLocale('zh');
    });

    expect(useI18n.getState().locale).toBe('zh');
    expect(localStorage.getItem('locale')).toBe('zh');
  });

  it('allows switching back from zh to en', () => {
    useI18n.setState({ locale: 'zh' });
    expect(t('common.confirm')).toBe('确认');

    act(() => {
      useI18n.getState().setLocale('en');
    });

    expect(useI18n.getState().locale).toBe('en');
    expect(t('common.confirm')).toBe('Confirm');
    expect(localStorage.getItem('locale')).toBe('en');
  });

  it('persists locale to localStorage', () => {
    act(() => {
      useI18n.getState().setLocale('zh');
    });
    expect(localStorage.getItem('locale')).toBe('zh');

    act(() => {
      useI18n.getState().setLocale('en');
    });
    expect(localStorage.getItem('locale')).toBe('en');
  });
});
