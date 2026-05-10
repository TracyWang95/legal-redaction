// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test-utils';
import { useI18n } from '@/i18n';
import { BatchHub } from '../batch-hub';

const batchHubMocks = vi.hoisted(() => ({
  useBatchHub: vi.fn(),
  useServiceHealth: vi.fn(),
}));

vi.mock('../hooks/use-batch-hub', () => ({
  useBatchHub: batchHubMocks.useBatchHub,
}));

vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: batchHubMocks.useServiceHealth,
}));

function baseBatchHubState() {
  return {
    loading: false,
    jobsUnavailable: false,
    activeJobs: [],
    openBatch: vi.fn(),
    continueJob: vi.fn(),
    openPreview: vi.fn(),
  };
}

function setBatchHubMock(overrides: Partial<ReturnType<typeof baseBatchHubState>> = {}) {
  batchHubMocks.useBatchHub.mockReturnValue({ ...baseBatchHubState(), ...overrides });
}

function setHealthMock(
  allOnline: boolean | null,
  checking = false,
  statuses: {
    paddle_ocr?: 'online' | 'offline' | 'checking' | 'busy' | 'degraded';
    has_ner?: 'online' | 'offline' | 'checking' | 'busy' | 'degraded';
    has_image?: 'online' | 'offline' | 'checking' | 'busy' | 'degraded';
  } = {},
) {
  batchHubMocks.useServiceHealth.mockReturnValue({
    checking,
    roundTripMs: 12,
    refresh: vi.fn(),
    health:
      allOnline === null
        ? null
        : {
            all_online: allOnline,
            services: {
              paddle_ocr: {
                name: 'PaddleOCR',
                status: statuses.paddle_ocr ?? (allOnline ? 'online' : 'offline'),
              },
              has_ner: {
                name: 'HaS Text',
                status: statuses.has_ner ?? (allOnline ? 'online' : 'offline'),
              },
              has_image: {
                name: 'HaS Image',
                status: statuses.has_image ?? (allOnline ? 'online' : 'offline'),
              },
            },
          },
  });
}

describe('BatchHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18n.setState({ locale: 'en' });
    setBatchHubMock();
    setHealthMock(true);
  });

  it('opens the mixed-file batch flow from the single primary entry when services are ready', () => {
    const openBatch = vi.fn();
    const openPreview = vi.fn();
    setBatchHubMock({ openBatch, openPreview });
    setHealthMock(true);
    useI18n.setState({ locale: 'zh' });

    render(<BatchHub />);

    expect(
      screen.getByRole('button', { name: '\u5904\u7406\u591a\u4e2a\u6587\u4ef6' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('batch-launch-smart'));

    expect(openBatch).toHaveBeenCalledWith('smart');
    expect(openPreview).not.toHaveBeenCalled();
    expect(screen.queryByTestId('batch-hub-model-preview-alert')).toBeNull();
  });

  it('allows entering batch setup when model services are unavailable and keeps demo available', () => {
    const openBatch = vi.fn();
    const openPreview = vi.fn();
    setBatchHubMock({ openBatch, openPreview });
    setHealthMock(false, false, {
      paddle_ocr: 'offline',
      has_ner: 'offline',
      has_image: 'offline',
    });

    render(<BatchHub />);

    expect(screen.getByTestId('batch-hub-model-preview-alert')).toHaveTextContent(
      'recognition model services are offline or degraded',
    );

    const liveButton = screen.getByTestId('batch-launch-smart');
    expect(liveButton).toBeEnabled();
    expect(screen.queryByTestId('batch-launch-smart-blocked-reason')).toBeNull();

    fireEvent.click(liveButton);

    expect(openBatch).toHaveBeenCalledWith('smart');

    expect(screen.queryByTestId('batch-launch-smart-preview')).toBeNull();
    expect(openPreview).not.toHaveBeenCalled();
  });

  it('keeps text and image modes as optional same-type entries', () => {
    const openBatch = vi.fn();
    const openPreview = vi.fn();
    setBatchHubMock({ openBatch, openPreview });
    setHealthMock(false, false, {
      paddle_ocr: 'offline',
      has_ner: 'online',
      has_image: 'offline',
    });

    render(<BatchHub />);

    expect(screen.getByText('For same-type files (optional)')).toBeInTheDocument();
    expect(screen.getByTestId('batch-launch-smart')).toBeEnabled();
    expect(screen.getByTestId('batch-launch-text')).toBeEnabled();
    expect(screen.getByTestId('batch-launch-image')).toBeEnabled();
    expect(screen.queryByTestId('batch-launch-text-blocked-reason')).toBeNull();
    expect(screen.queryByTestId('batch-launch-image-blocked-reason')).toBeNull();

    fireEvent.click(screen.getByTestId('batch-launch-text'));

    expect(openBatch).toHaveBeenCalledWith('text');
    expect(openPreview).not.toHaveBeenCalled();
  });

  it('highlights mixed-file batch as the default journey', () => {
    const openBatch = vi.fn();
    const openPreview = vi.fn();
    setBatchHubMock({ openBatch, openPreview });
    setHealthMock(true);
    useI18n.setState({ locale: 'en' });

    render(<BatchHub />);

    expect(
      screen.getByRole('button', {
        name: 'Process multiple files',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('For same-type files (optional)')).toBeInTheDocument();
    expect(screen.getByText('Most users should start with mixed-file batches.')).toBeInTheDocument();
    expect(screen.getByText('Documents only')).toBeInTheDocument();
    expect(screen.getByText('Scans & images only')).toBeInTheDocument();
    expect(screen.queryByText(/Advanced/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('batch-launch-smart'));

    expect(openBatch).toHaveBeenCalledWith('smart');
    expect(openPreview).not.toHaveBeenCalled();
  });
});
