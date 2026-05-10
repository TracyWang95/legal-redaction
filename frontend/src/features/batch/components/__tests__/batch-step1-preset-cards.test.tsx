// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BatchStep1PresetCards } from '../batch-step1-preset-cards';
import type { RecognitionPreset } from '@/services/presetsApi';
import type { BatchWizardPersistedConfig } from '@/services/batchPipeline';

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = React.createContext<{
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    value?: string;
  }>({});

  return {
    Select: ({
      children,
      disabled,
      onValueChange,
      value,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onValueChange?: (value: string) => void;
      value?: string;
    }) => (
      <SelectContext.Provider value={{ disabled, onValueChange, value }}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const context = React.useContext(SelectContext);
      return (
        <button
          aria-selected={context.value === value}
          disabled={context.disabled}
          type="button"
          onClick={() => context.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
    SelectTrigger: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  };
});

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => undefined;
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined;
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => undefined;
  }
});

const fullIndustryPreset: RecognitionPreset = {
  id: 'industry_contract_legal_disclosure',
  name: 'Industry - Contract and legal disclosure',
  kind: 'full',
  selectedEntityTypeIds: ['PERSON'],
  ocrHasTypes: ['PERSON'],
  hasImageTypes: ['official_seal'],
  replacementMode: 'structured',
  created_at: '2026-05-05T00:00:00Z',
  updated_at: '2026-05-05T00:00:00Z',
  readonly: true,
};

const visionIndustryPreset: RecognitionPreset = {
  id: 'industry_image_heavy_certificates',
  name: 'Industry - Image-heavy certificates and forms',
  kind: 'vision',
  selectedEntityTypeIds: [],
  ocrHasTypes: ['PERSON'],
  hasImageTypes: ['face'],
  replacementMode: 'structured',
  created_at: '2026-05-05T00:00:00Z',
  updated_at: '2026-05-05T00:00:00Z',
  readonly: true,
};

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

function renderCards(overrides: Partial<React.ComponentProps<typeof BatchStep1PresetCards>> = {}) {
  const onBatchTextPresetChange = vi.fn();
  const onBatchVisionPresetChange = vi.fn();
  render(
    <BatchStep1PresetCards
      mode="smart"
      cfg={baseCfg}
      setCfg={vi.fn()}
      textPresets={[fullIndustryPreset]}
      visionPresets={[fullIndustryPreset, visionIndustryPreset]}
      onBatchTextPresetChange={onBatchTextPresetChange}
      onBatchVisionPresetChange={onBatchVisionPresetChange}
      textRedactionMode="structured"
      textModeLabel="Structured"
      imageRedactionMethod="mosaic"
      imageMethodLabel="Mosaic"
      imageMethodHint="Mosaic hint"
      imageRedactionStrength={75}
      imageFillColor="#000000"
      defaultTextSummary="Default text"
      defaultVisionSummary="Default vision"
      defaultVisionExcludedSummary=""
      {...overrides}
    />,
  );
  return { onBatchTextPresetChange, onBatchVisionPresetChange };
}

describe('BatchStep1PresetCards industry profiles', () => {
  it('shows a smart-mode industry profile selector for readonly presets', () => {
    renderCards();

    expect(screen.getByText('batchWizard.step1.industryPreset')).toBeInTheDocument();
    expect(screen.getByText('batchWizard.step1.industryPresetDesc')).toBeInTheDocument();
    expect(screen.getByTestId('industry-preset-select')).toBeInTheDocument();
  });

  it('uses Step 1 product copy for text redaction methods', () => {
    renderCards();

    expect(screen.getByText('batchWizard.step1.textMethodStructured')).toBeInTheDocument();
    expect(screen.getByText('batchWizard.step1.textMethodSmart')).toBeInTheDocument();
    expect(screen.getByText('batchWizard.step1.textMethodMask')).toBeInTheDocument();
    expect(screen.queryByText('mode.structured')).not.toBeInTheDocument();
  });

  it('selecting a full industry profile delegates to the full-preset text handler', async () => {
    const { onBatchTextPresetChange, onBatchVisionPresetChange } = renderCards();

    fireEvent.click(screen.getAllByText(/Contract and legal disclosure/)[0]);

    expect(onBatchTextPresetChange).toHaveBeenCalledWith('industry_contract_legal_disclosure');
    expect(onBatchVisionPresetChange).not.toHaveBeenCalled();
  });

  it('selecting a vision-only industry profile delegates to the vision handler', async () => {
    const { onBatchTextPresetChange, onBatchVisionPresetChange } = renderCards();

    fireEvent.click(screen.getAllByText(/Image-heavy certificates/)[0]);

    expect(onBatchTextPresetChange).not.toHaveBeenCalled();
    expect(onBatchVisionPresetChange).toHaveBeenCalledWith('industry_image_heavy_certificates');
  });

  it('does not show the industry selector outside smart mode', () => {
    renderCards({ mode: 'text' });

    expect(screen.queryByTestId('industry-preset-select')).not.toBeInTheDocument();
  });

  it('keeps the visible plan configuration cards on a white surface', () => {
    renderCards();

    expect(screen.getByTestId('step1-text-config-card').getAttribute('class')).toContain(
      '!bg-white',
    );
    expect(screen.getByTestId('step1-vision-config-card').getAttribute('class')).toContain(
      '!bg-white',
    );
  });
});
