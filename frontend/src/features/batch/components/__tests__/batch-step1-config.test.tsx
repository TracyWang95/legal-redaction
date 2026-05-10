// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test-utils';
import { useI18n } from '@/i18n';
import { BatchStep1Config } from '../batch-step1-config';
import type { BatchWizardPersistedConfig } from '@/services/batchPipeline';

const baseCfg: BatchWizardPersistedConfig = {
  selectedEntityTypeIds: [],
  ocrHasTypes: [],
  hasImageTypes: [],
  replacementMode: 'structured',
  imageRedactionMethod: 'mosaic',
  imageRedactionStrength: 75,
  imageFillColor: '#000000',
  presetTextId: null,
  presetVisionId: null,
  executionDefault: 'queue',
};

const contextMocks = vi.hoisted(() => ({
  useBatchWizardContext: vi.fn(),
}));

vi.mock('../../batch-wizard-context', () => ({
  useBatchWizardContext: contextMocks.useBatchWizardContext,
}));

function renderStep1Config(
  overrides: Partial<BatchWizardPersistedConfig> = {},
  contextOverrides: Record<string, unknown> = {},
) {
  const setCfg = vi.fn();
  const cfg = { ...baseCfg, ...overrides };
  const context = {
    mode: 'smart' as const,
    cfg,
    setCfg,
    configLoaded: true,
    jobConfigLocked: false,
    textTypes: [],
    pipelines: [],
    textPresets: [],
    visionPresets: [],
    presetLoadError: null,
    presetReloading: false,
    retryLoadPresets: vi.fn(),
    onBatchTextPresetChange: vi.fn(),
    onBatchVisionPresetChange: vi.fn(),
    confirmStep1: true,
    setConfirmStep1: vi.fn(),
    isStep1Complete: true,
    jobPriority: 0,
    setJobPriority: vi.fn(),
    advanceToUploadStep: vi.fn(),
    ...contextOverrides,
  };

  contextMocks.useBatchWizardContext.mockReturnValue(context);

  render(<BatchStep1Config />);
  return { setCfg };
}

describe('BatchStep1Config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18n.setState({ locale: 'en' });
  });

  it('forces queue execution default on first render when another mode is stored', async () => {
    const { setCfg } = renderStep1Config({ executionDefault: 'local' });

    await waitFor(() => {
      expect(setCfg).toHaveBeenCalledTimes(1);
    });

    const updater = setCfg.mock.calls[0][0] as (c: BatchWizardPersistedConfig) => BatchWizardPersistedConfig;
    expect(updater({ ...baseCfg, executionDefault: 'local' }).executionDefault).toBe('queue');
  });

  it('keeps queue execution default when already queue', async () => {
    const { setCfg } = renderStep1Config({ executionDefault: 'queue' });

    await waitFor(() => {
      expect(setCfg).not.toHaveBeenCalled();
    });
  });

  it('shows single-file-first guidance before batch setup', () => {
    renderStep1Config();
    expect(screen.getByTestId('batch-step1-single-file-hint')).toHaveTextContent(
      'Create a mixed-file batch after validating the recognition list on one file.',
    );
  });

  it('shows VLM selections alongside OCR and visual area selections', () => {
    renderStep1Config(
      {
        ocrHasTypes: ['PERSON'],
        hasImageTypes: ['face'],
        vlmTypes: ['signature'],
      },
      {
        pipelines: [
          {
            mode: 'ocr_has',
            name: 'OCR',
            description: '',
            enabled: true,
            types: [{ id: 'PERSON', name: 'Name', color: '#2563eb', enabled: true }],
          },
          {
            mode: 'has_image',
            name: 'Image',
            description: '',
            enabled: true,
            types: [{ id: 'face', name: 'Face', color: '#dc2626', enabled: true }],
          },
          {
            mode: 'vlm',
            name: 'VLM',
            description: '',
            enabled: true,
            types: [{ id: 'signature', name: 'Signature', color: '#7c3aed', enabled: true }],
          },
        ],
      },
    );

    expect(screen.getByText('Visual semantic features')).toBeInTheDocument();
    expect(screen.getByText(/Signature/)).toBeInTheDocument();
  });
});
