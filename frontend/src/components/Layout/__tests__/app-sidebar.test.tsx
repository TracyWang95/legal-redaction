// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useI18n } from '@/i18n';
import { AppSidebar } from '../app-sidebar';

const healthMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: healthMock,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

function renderSidebar(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('AppSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    useI18n.setState({ locale: 'zh' });
    refreshMock.mockReset();
    healthMock.mockReset();
    healthMock.mockReturnValue({
      health: {
        all_online: true,
        gpu_memory: { used_mb: 2048, total_mb: 8192 },
        services: {
          paddle_ocr: { name: 'PaddleOCR', status: 'online' },
          has_ner: { name: 'HaS Text', status: 'busy', detail: { runtime_mode: 'gpu' } },
          has_image: { name: 'HaS Image', status: 'online' },
        },
      },
      checking: false,
      roundTripMs: 18,
      refresh: refreshMock,
    });
  });

  it('renders the consolidated left navigation in the expected order', () => {
    renderSidebar();

    const links = within(screen.getByRole('navigation', { name: '主导航' })).getAllByRole('link');

    expect(links.map((link) => link.textContent)).toEqual([
      '开始选择处理路径',
      '单次处理先跑一个文件',
      '批量处理混合文件队列',
      '任务中心进度与复核',
      '处理结果对比与下载',
      '配置规则与服务',
    ]);
    expect(screen.queryByRole('link', { name: /匿名化清单/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /文本模型配置/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Playground/i)).not.toBeInTheDocument();
  });

  it('keeps model and GPU status visible without surfacing busy as copy', () => {
    renderSidebar();

    const panel = screen.getByTestId('sidebar-service-status');

    expect(within(panel).getByText('本地服务')).toBeInTheDocument();
    expect(within(panel).getByText('PaddleOCR')).toBeInTheDocument();
    expect(within(panel).getByText('HaS Text')).toBeInTheDocument();
    expect(within(panel).getByText('HaS Image')).toBeInTheDocument();
    expect(within(panel).getByText('2.0/8.0 GB')).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/Busy/i);
  });
});
