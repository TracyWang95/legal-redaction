// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { PresetColumn } from '../preset-column';
import type { RecognitionPreset } from '@/services/presetsApi';

const defaultPreset: RecognitionPreset = {
  id: '__default_text__',
  name: 'Default text preset',
  kind: 'text',
  selectedEntityTypeIds: ['person_name'],
  ocrHasTypes: [],
  hasImageTypes: [],
  replacementMode: 'structured',
  created_at: '',
  updated_at: '',
};

const customPreset: RecognitionPreset = {
  id: 'custom-contract',
  name: 'Contract review',
  kind: 'text',
  selectedEntityTypeIds: ['person_name'],
  ocrHasTypes: [],
  hasImageTypes: [],
  replacementMode: 'structured',
  created_at: '',
  updated_at: '',
};

const fullIndustryPreset: RecognitionPreset = {
  id: 'industry-sample',
  name: 'Industry sample',
  kind: 'full',
  selectedEntityTypeIds: ['person_name'],
  ocrHasTypes: ['ocr_contract'],
  hasImageTypes: ['face'],
  vlmTypes: ['signature'],
  replacementMode: 'structured',
  created_at: '',
  updated_at: '',
};

describe('PresetColumn', () => {
  it('names row actions with the preset they affect', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <PresetColumn
        title="Text presets"
        defaultPreset={defaultPreset}
        presets={[customPreset]}
        entityTypes={[
          {
            id: 'person_name',
            name: 'Person name',
            color: '#2563eb',
            regex_pattern: '',
            use_llm: true,
            enabled: true,
          },
        ]}
        pipelines={[]}
        expanded={null}
        setExpanded={vi.fn()}
        colPrefix="text"
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole('button', { name: 'Preview Default text preset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview Contract review' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Contract review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Contract review' }));

    expect(onEdit).toHaveBeenCalledWith(customPreset);
    expect(onDelete).toHaveBeenCalledWith('custom-contract');
  });

  it('scopes full preset previews to the current column', () => {
    render(
      <PresetColumn
        title="Text presets"
        defaultPreset={defaultPreset}
        presets={[fullIndustryPreset]}
        entityTypes={[
          {
            id: 'person_name',
            name: 'Person name',
            color: '#2563eb',
            regex_pattern: '',
            use_llm: true,
            enabled: true,
          },
        ]}
        pipelines={[
          {
            mode: 'ocr_has',
            name: 'OCR',
            description: '',
            enabled: true,
            types: [
              {
                id: 'ocr_contract',
                name: 'OCR contract',
                color: '#2563eb',
                enabled: true,
                order: 10,
              },
            ],
          },
          {
            mode: 'has_image',
            name: 'YOLO',
            description: '',
            enabled: true,
            types: [
              {
                id: 'face',
                name: 'Face',
                color: '#2563eb',
                enabled: true,
                order: 10,
              },
            ],
          },
          {
            mode: 'vlm',
            name: 'VLM',
            description: '',
            enabled: true,
            types: [
              {
                id: 'signature',
                name: 'Signature',
                color: '#2563eb',
                enabled: true,
                order: 10,
              },
            ],
          },
        ]}
        expanded="text:industry-sample"
        setExpanded={vi.fn()}
        colPrefix="text"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Person name')).toBeInTheDocument();
    expect(screen.queryByText('OCR contract')).not.toBeInTheDocument();
    expect(screen.queryByText('Face')).not.toBeInTheDocument();
    expect(screen.queryByText('Signature')).not.toBeInTheDocument();
  });
});
