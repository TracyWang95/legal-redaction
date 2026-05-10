// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test-utils';
import { StartPage } from '../start-page';

const healthMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: healthMock,
}));

describe('StartPage', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    healthMock.mockReset();
  });

  it('shows the personal workflow actions and keeps demo batch available when the backend is offline', () => {
    healthMock.mockReturnValue({
      health: null,
      checking: false,
      roundTripMs: null,
      refresh: refreshMock,
    });

    render(<StartPage />);

    expect(screen.getByTestId('start-playground')).toHaveAttribute('href', '/single');
    expect(screen.getByTestId('start-history')).toHaveAttribute('href', '/history');
    expect(screen.getByTestId('start-jobs')).toHaveAttribute('href', '/jobs');
    expect(screen.getByTestId('start-workflow-demo')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('start.workflow.badge.singleFirst');
    expect(document.body).toHaveTextContent('start.workflow.step.upload.title');
    expect(document.body).toHaveTextContent('start.workflow.step.recognize.title');
    expect(document.body).toHaveTextContent('start.workflow.step.review.title');
    expect(document.body).toHaveTextContent('start.workflow.step.export.title');
    expect(screen.getByTestId('start-live-state')).toHaveTextContent('start.state.backendDown');
    expect(document.body).toHaveTextContent('start.services.backendDown');
    expect(screen.getByTestId('start-live-batch')).toBeDisabled();
    expect(screen.getByTestId('start-live-blocked-reason')).toHaveTextContent(
      'batchHub.liveDisabledBackend',
    );
    expect(screen.getByTestId('start-demo-batch')).toHaveAttribute(
      'href',
      expect.stringContaining('preview=1'),
    );
    expect(screen.queryByTestId('start-real-eval-state')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('D:\\ceshi');
    expect(document.body).not.toHaveTextContent('npm run eval:ceshi');
  });

  it('opens live batch when all local services are online', () => {
    healthMock.mockReturnValue({
      health: {
        all_online: true,
        services: {
          paddle_ocr: { name: 'PaddleOCR', status: 'online' },
          has_ner: { name: 'HaS Text', status: 'online' },
          has_image: { name: 'HaS Image', status: 'online' },
        },
      },
      checking: false,
      roundTripMs: 42,
      refresh: refreshMock,
    });

    render(<StartPage />);

    expect(screen.getByTestId('start-live-state')).toHaveTextContent('start.state.liveReady');
    expect(screen.getByTestId('start-live-batch')).toHaveAttribute('href', '/batch');
    expect(screen.getByText('PaddleOCR')).toBeInTheDocument();
    expect(screen.getByText('HaS Text')).toBeInTheDocument();
    expect(screen.getByText('HaS Image')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('start.services.allOnline');
    expect(screen.getByTestId('start-history')).toHaveAttribute('href', '/history');
    expect(screen.getByTestId('start-jobs')).toHaveAttribute('href', '/jobs');
    expect(screen.queryByTestId('start-demo-batch')).not.toBeInTheDocument();
    expect(screen.queryByTestId('start-real-eval-command')).not.toBeInTheDocument();
  });

  it('keeps live batch available when at least one recognition mode can run', () => {
    healthMock.mockReturnValue({
      health: {
        all_online: false,
        services: {
          paddle_ocr: { name: 'PaddleOCR', status: 'offline' },
          has_ner: { name: 'HaS Text', status: 'online' },
          has_image: { name: 'HaS Image', status: 'offline' },
        },
      },
      checking: false,
      roundTripMs: 42,
      refresh: refreshMock,
    });

    render(<StartPage />);

    expect(screen.getByTestId('start-live-state')).toHaveTextContent('start.state.modelLimited');
    expect(screen.getByTestId('start-live-batch')).toHaveAttribute('href', '/batch');
    expect(document.body).toHaveTextContent('start.services.needsAction');
  });
});
