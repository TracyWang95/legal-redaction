// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { PipelineCheckboxGrid } from '../type-checkbox-grid';

const HAS_IMAGE_MODEL_IDS = [
  'face',
  'fingerprint',
  'palmprint',
  'id_card',
  'hk_macau_permit',
  'passport',
  'employee_badge',
  'license_plate',
  'bank_card',
  'physical_key',
  'receipt',
  'shipping_label',
  'official_seal',
  'whiteboard',
  'sticky_note',
  'mobile_screen',
  'monitor_screen',
  'medical_wristband',
  'qr_code',
  'barcode',
];

const makeHasImageType = (id: string, index: number) => ({
  id,
  name: id,
  color: '#7c3aed',
  enabled: true,
  order: index,
});

describe('PipelineCheckboxGrid', () => {
  it('shows paper as an opt-in HaS Image type when it is not part of the active defaults', () => {
    const onToggle = vi.fn();

    render(
      <PipelineCheckboxGrid
        pipeline={{
          mode: 'has_image',
          name: 'HaS Image',
          description: '',
          enabled: true,
          types: [
            { id: 'receipt', name: 'Receipt', color: '#2563eb', enabled: true, order: 10 },
            { id: 'qr_code', name: 'QR code', color: '#0d9488', enabled: true, order: 18 },
            { id: 'paper', name: 'Paper', color: '#64748b', enabled: false, order: 20 },
          ],
        }}
        selectedOcr={[]}
        selectedImg={['receipt']}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Receipt' })).toBeChecked();
    expect(screen.getByText('(3)')).toBeInTheDocument();
    expect(screen.getByTestId('settings-has-image-types-hint')).toHaveTextContent('fixed 21');
    expect(screen.getByTestId('settings-has-image-types-hint')).toHaveTextContent(
      'not HaS Image classes',
    );

    const paper = screen.getByRole('checkbox', { name: /Paper, opt-in/i });
    expect(paper).not.toBeChecked();
    expect(screen.getByText('Opt-in')).toBeInTheDocument();

    fireEvent.click(paper);

    expect(onToggle).toHaveBeenCalledWith('has_image', 'paper');
  });

  it('keeps all 21 fixed HaS Image classes visible while hiding OCR-only visual ids', () => {
    const onToggle = vi.fn();
    const fixedTypes = [
      ...HAS_IMAGE_MODEL_IDS.map((id, index) => makeHasImageType(id, index)),
      { id: 'paper', name: 'Paper', color: '#64748b', enabled: false, order: 21 },
      { id: 'signature', name: 'Signature', color: '#64748b', enabled: true, order: 22 },
      {
        id: 'custom_sensitive_region',
        name: 'Custom region',
        color: '#64748b',
        enabled: true,
        order: 23,
      },
    ];

    render(
      <PipelineCheckboxGrid
        pipeline={{
          mode: 'has_image',
          name: 'HaS Image',
          description: '',
          enabled: true,
          types: fixedTypes,
        }}
        selectedOcr={[]}
        selectedImg={fixedTypes.filter((type) => type.id !== 'paper').map((type) => type.id)}
        onToggle={onToggle}
      />,
    );

    const group = screen.getByRole('group', { name: 'Visual features (HaS Image)' });
    expect(group).toHaveAttribute('aria-describedby', 'settings-has-image-types-hint');
    expect(screen.getByText('(21)')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(21);
    expect(screen.queryByRole('checkbox', { name: 'Signature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Custom region' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Paper, opt-in/i })).not.toBeChecked();
  });
});
