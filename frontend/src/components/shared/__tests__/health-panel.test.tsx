// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test-utils';
import type { ServicesHealth } from '@/hooks/use-service-health';
import { HealthPanel } from '../health-panel';

function health(overrides: Partial<ServicesHealth['services']> = {}): ServicesHealth {
  const services = {
    paddle_ocr: { name: 'PaddleOCR', status: 'degraded' },
    has_ner: { name: 'HaS Text', status: 'offline' },
    has_image: { name: 'HaS Image', status: 'online' },
    ...overrides,
  } satisfies ServicesHealth['services'];

  return {
    all_online: Object.values(services).every((service) => service.status === 'online'),
    gpu_memory: { used_mb: 12_288, total_mb: 16_384 },
    services,
  };
}

describe('HealthPanel', () => {
  it('shows a compact service status without internal service details when everything is ready', () => {
    render(
      <HealthPanel
        health={health({
          paddle_ocr: { name: 'PaddleOCR', status: 'online' },
          has_ner: { name: 'HaS Text', status: 'online' },
          has_image: { name: 'HaS Image', status: 'online' },
        })}
        checking={false}
        roundTripMs={12}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId('health-panel')).toHaveTextContent('Services');
    expect(screen.getByTestId('health-panel')).toHaveTextContent('Ready');
    expect(screen.queryByText('PaddleOCR')).not.toBeInTheDocument();
    expect(screen.queryByText('HaS Text')).not.toBeInTheDocument();
    expect(screen.queryByText('HaS Image')).not.toBeInTheDocument();
    expect(screen.queryByText('GPU')).not.toBeInTheDocument();
    expect(screen.queryByText('Service Status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Backend probe/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ready for live processing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upload files, run recognition/i)).not.toBeInTheDocument();
  });

  it('shows all model service states when recognition is unavailable', () => {
    render(<HealthPanel health={health()} checking={false} roundTripMs={12} onRefresh={vi.fn()} />);

    expect(screen.getByTestId('health-panel')).toHaveTextContent('Needs attention');
    expect(screen.queryByText('Degraded')).not.toBeInTheDocument();
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    expect(screen.queryByText('PaddleOCR')).not.toBeInTheDocument();
    expect(screen.queryByText('HaS Text')).not.toBeInTheDocument();
    expect(screen.queryByText('HaS Image')).not.toBeInTheDocument();
    expect(screen.queryByText(/Affects OCR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Affects text semantic recognition/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Scanned PDFs and images may miss text/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Semantic text labels may be missing/)).not.toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Open model settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh services' })).toBeInTheDocument();
  });

  it('explains what is blocked when the backend health endpoint is unavailable', () => {
    render(<HealthPanel health={null} checking={false} roundTripMs={null} onRefresh={vi.fn()} />);

    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    expect(screen.queryByText(/Technical status:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Backend disconnected/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open model settings' })).not.toBeInTheDocument();
  });

  it('shows a reachable busy model service as online', () => {
    render(
      <HealthPanel
        health={health({
          paddle_ocr: { name: 'PaddleOCR', status: 'online' },
          has_ner: { name: 'HaS Text', status: 'busy', detail: { runtime_mode: 'unknown' } },
          has_image: { name: 'HaS Image', status: 'online' },
        })}
        checking={false}
        roundTripMs={12}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByTestId('health-panel')).toHaveTextContent('Ready - Runtime unknown');
    expect(screen.queryByText(/upload or review while the queue clears/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/expect immediate recognition results/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Busy')).not.toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
    expect(screen.queryByText('CPU')).not.toBeInTheDocument();
  });

  it('treats transient model state strings as non-blocking', () => {
    const busyLikeState = {
      name: 'HaS Text',
      status: 'loading',
      detail: { runtime_mode: 'unknown' },
    } as unknown as ServicesHealth['services']['has_ner'];

    render(
      <HealthPanel
        health={health({
          paddle_ocr: { name: 'PaddleOCR', status: 'online' },
          has_ner: busyLikeState,
          has_image: { name: 'HaS Image', status: 'online' },
        })}
        checking={false}
        roundTripMs={12}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByTestId('health-panel')).toHaveTextContent('Ready - Runtime unknown');
    expect(screen.queryByText('Loading')).not.toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
  });

  it.each([
    ['gpu', 'GPU'],
    ['cpu', 'CPU'],
  ] as const)('shows HaS Text %s runtime as a compact label', (runtimeMode, label) => {
    render(
      <HealthPanel
        health={health({
          paddle_ocr: { name: 'PaddleOCR', status: 'online' },
          has_ner: { name: 'HaS Text', status: 'online', detail: { runtime_mode: runtimeMode } },
          has_image: { name: 'HaS Image', status: 'online' },
        })}
        checking={false}
        roundTripMs={12}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId('health-panel')).toHaveTextContent(`Ready - ${label}`);
    expect(screen.queryByText('HaS Text')).not.toBeInTheDocument();
  });

  it('surfaces HaS Text CPU fallback risk as a degraded compact label', () => {
    render(
      <HealthPanel
        health={health({
          paddle_ocr: { name: 'PaddleOCR', status: 'online' },
          has_ner: {
            name: 'HaS Text',
            status: 'degraded',
            detail: { runtime_mode: 'cpu', cpu_fallback_risk: true },
          },
          has_image: { name: 'HaS Image', status: 'online' },
        })}
        checking={false}
        roundTripMs={12}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId('health-panel')).toHaveTextContent(
      'Degraded - CPU fallback risk',
    );
    expect(screen.queryByText('CPU')).not.toBeInTheDocument();
  });

  it('does not surface GPU load as a sidebar service warning', () => {
    render(
      <HealthPanel
        health={{
          ...health({
            paddle_ocr: { name: 'PaddleOCR', status: 'online' },
            has_ner: { name: 'HaS Text', status: 'online' },
            has_image: { name: 'HaS Image', status: 'online' },
          }),
          gpu_memory: { used_mb: 15_974, total_mb: 16_384 },
        }}
        checking={false}
        roundTripMs={12}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText('GPU')).not.toBeInTheDocument();
    expect(screen.queryByText('97.5%')).not.toBeInTheDocument();
    expect(screen.queryByText('Busy')).not.toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
  });
});
