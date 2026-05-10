// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test-utils';
import { PlaygroundUpload } from '../playground-upload';

const useServiceHealthMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: useServiceHealthMock,
}));

vi.mock('../playground-upload-config', () => ({
  TextTypeGroups: () => <div data-testid="text-type-groups" />,
  VisionPipelines: () => <div data-testid="vision-pipelines" />,
}));

vi.mock('../playground-upload-presets', () => ({
  PresetSelectors: () => <div data-testid="preset-selectors" />,
  PresetSaveDialog: () => null,
}));

function makeHealth(
  statuses: Partial<
    Record<'paddle_ocr' | 'has_ner' | 'has_image', 'online' | 'offline' | 'busy' | 'degraded'>
  >,
) {
  const services = {
    paddle_ocr: { name: 'PaddleOCR', status: statuses.paddle_ocr ?? 'online' },
    has_ner: { name: 'HaS Text', status: statuses.has_ner ?? 'online' },
    has_image: { name: 'HaS Image', status: statuses.has_image ?? 'online' },
  };

  return {
    all_online: Object.values(services).every((service) => service.status === 'online'),
    services,
  };
}

function makeCtx(open = vi.fn()) {
  return {
    dropzone: {
      getRootProps: (props: Record<string, unknown>) => props,
      getInputProps: (props: Record<string, unknown>) => props,
      isDragActive: false,
      open,
    },
    recognition: {
      typeTab: 'text',
      setTypeTab: vi.fn(),
      entityTypes: [],
      visionTypes: [],
      pipelines: [],
      selectedTypes: [],
      selectedOcrHasTypes: [],
      selectedHasImageTypes: [],
      textConfigState: 'ready',
      visionConfigState: 'ready',
    },
  } as never;
}

describe('PlaygroundUpload', () => {
  it('keeps the single-file upload surface instead of rendering a core feature grid', () => {
    useServiceHealthMock.mockReturnValue({
      health: makeHealth({}),
      checking: false,
      roundTripMs: 8,
      refresh: vi.fn(),
    });

    render(<PlaygroundUpload ctx={makeCtx()} />);

    expect(screen.getByText('Upload one file')).toBeInTheDocument();
    expect(screen.getByText('Drop a file here to upload')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Or click to choose a file' })).toBeInTheDocument();
    expect(screen.getByTestId('playground-type-panel')).toHaveTextContent('Recognition types');
    expect(screen.getByRole('tab', { name: /^Text/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Vision/i })).toBeInTheDocument();
    expect(screen.getByTestId('text-type-groups')).toBeInTheDocument();
    expect(screen.queryByTestId('start-workflow-demo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('start-playground')).not.toBeInTheDocument();
    expect(screen.queryByTestId('start-live-batch')).not.toBeInTheDocument();
    expect(screen.queryByTestId('start-history')).not.toBeInTheDocument();
    expect(screen.queryByText('Start Processing')).not.toBeInTheDocument();
    expect(screen.queryByText('Process Many Files')).not.toBeInTheDocument();
  });

  it('keeps upload available when model services are offline and shows affected services', () => {
    useServiceHealthMock.mockReturnValue({
      health: makeHealth({ paddle_ocr: 'offline', has_image: 'degraded' }),
      checking: false,
      roundTripMs: 8,
      refresh: vi.fn(),
    });

    render(<PlaygroundUpload ctx={makeCtx()} />);

    const hint = screen.getByTestId('playground-offline-hint');
    expect(hint).toHaveTextContent('PaddleOCR: Offline');
    expect(hint).toHaveTextContent('HaS Image: Degraded');
    expect(screen.getByTestId('playground-affected-services')).toHaveTextContent(
      'PaddleOCR: Offline, HaS Image: Degraded',
    );
    expect(hint).toHaveTextContent('npm run dev:models');
    expect(screen.getByTestId('playground-dropzone')).toHaveAttribute('aria-disabled', 'false');
  });

  it('keeps upload available without warning when a reachable model service reports busy', () => {
    useServiceHealthMock.mockReturnValue({
      health: makeHealth({ has_ner: 'busy' }),
      checking: false,
      roundTripMs: 12,
      refresh: vi.fn(),
    });

    render(<PlaygroundUpload ctx={makeCtx()} />);

    expect(screen.queryByTestId('playground-offline-hint')).not.toBeInTheDocument();
    expect(screen.getByTestId('playground-dropzone')).toHaveAttribute('aria-disabled', 'false');
  });

  it('keeps upload available while the health probe is still checking', () => {
    useServiceHealthMock.mockReturnValue({
      health: null,
      checking: true,
      roundTripMs: null,
      refresh: vi.fn(),
    });

    render(<PlaygroundUpload ctx={makeCtx()} />);

    expect(screen.getByTestId('playground-offline-hint')).toHaveTextContent(
      'Checking local service health',
    );
    expect(screen.getByTestId('playground-dropzone')).toHaveAttribute('aria-disabled', 'false');
  });

  it('blocks upload only when the backend health endpoint is unavailable after checking', () => {
    useServiceHealthMock.mockReturnValue({
      health: null,
      checking: false,
      roundTripMs: null,
      refresh: vi.fn(),
    });

    render(<PlaygroundUpload ctx={makeCtx()} />);

    expect(screen.getByTestId('playground-offline-hint')).toHaveTextContent(
      'The backend is offline',
    );
    expect(screen.getByTestId('playground-dropzone')).toHaveAttribute('aria-disabled', 'true');
  });
});
