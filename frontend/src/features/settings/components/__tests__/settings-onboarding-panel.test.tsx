// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { useI18n } from '@/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsOnboardingPanel } from '../settings-onboarding-panel';

describe('SettingsOnboardingPanel', () => {
  beforeEach(() => {
    useI18n.setState({ locale: 'zh' });
  });

  it('starts with default-plan guidance, review risk, and advanced rule entry points', () => {
    const onOpenTextRules = vi.fn();
    const onOpenVisionRules = vi.fn();

    render(
      <SettingsOnboardingPanel
        regexCount={3}
        semanticCount={4}
        ocrCount={5}
        imageCount={6}
        onOpenTextRules={onOpenTextRules}
        onOpenVisionRules={onOpenVisionRules}
      />,
    );

    expect(screen.getByTestId('settings-onboarding-panel')).toHaveTextContent('先用默认清单开始');
    expect(screen.getByTestId('settings-onboarding-panel')).toHaveTextContent('默认文本配置清单');
    expect(screen.getByTestId('settings-onboarding-panel')).toHaveTextContent('导出前必须人工复核');
    expect(screen.getByText(/7 项/)).toBeInTheDocument();
    expect(screen.getByText(/11 项/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '文本识别项设置' }));
    fireEvent.click(screen.getByRole('button', { name: '图像识别项设置' }));

    expect(onOpenTextRules).toHaveBeenCalledTimes(1);
    expect(onOpenVisionRules).toHaveBeenCalledTimes(1);
  });
});
