// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, within } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { TextTypeGroups, VisionPipelines } from '../playground-upload-config';

const HAS_IMAGE_TYPES = [
  { id: 'face', name: 'Face', color: '#ef4444', enabled: true, order: 0 },
  { id: 'fingerprint', name: 'Fingerprint', color: '#f97316', enabled: true, order: 1 },
  { id: 'palmprint', name: 'Palmprint', color: '#f59e0b', enabled: true, order: 2 },
  { id: 'id_card', name: 'ID card', color: '#eab308', enabled: true, order: 3 },
  { id: 'hk_macau_permit', name: 'HK/Macau permit', color: '#84cc16', enabled: true, order: 4 },
  { id: 'passport', name: 'Passport', color: '#22c55e', enabled: true, order: 5 },
  { id: 'employee_badge', name: 'Employee badge', color: '#14b8a6', enabled: true, order: 6 },
  { id: 'license_plate', name: 'License plate', color: '#06b6d4', enabled: true, order: 7 },
  { id: 'bank_card', name: 'Bank card', color: '#0ea5e9', enabled: true, order: 8 },
  { id: 'physical_key', name: 'Physical key', color: '#3b82f6', enabled: true, order: 9 },
  { id: 'receipt', name: 'Receipt', color: '#6366f1', enabled: true, order: 10 },
  { id: 'shipping_label', name: 'Shipping label', color: '#8b5cf6', enabled: true, order: 11 },
  { id: 'official_seal', name: 'Official seal', color: '#a855f7', enabled: true, order: 12 },
  { id: 'whiteboard', name: 'Whiteboard', color: '#d946ef', enabled: true, order: 13 },
  { id: 'sticky_note', name: 'Sticky note', color: '#ec4899', enabled: true, order: 14 },
  { id: 'mobile_screen', name: 'Mobile screen', color: '#f43f5e', enabled: true, order: 15 },
  { id: 'monitor_screen', name: 'Monitor screen', color: '#64748b', enabled: true, order: 16 },
  {
    id: 'medical_wristband',
    name: 'Medical wristband',
    color: '#78716c',
    enabled: true,
    order: 17,
  },
  { id: 'qr_code', name: 'QR code', color: '#0d9488', enabled: true, order: 18 },
  { id: 'barcode', name: 'Barcode', color: '#059669', enabled: true, order: 19 },
  { id: 'paper', name: 'Paper', color: '#7c3aed', enabled: false, order: 120 },
];

const FALLBACK_ONLY_TYPES = [
  { id: 'signature', name: 'Signature', color: '#dc2626', enabled: true, order: 200 },
  { id: 'handwriting', name: 'Handwriting', color: '#b91c1c', enabled: true, order: 201 },
  {
    id: 'custom_sensitive_region',
    name: 'Custom region',
    color: '#991b1b',
    enabled: true,
    order: 202,
  },
];

function makeRecognition(overrides: Record<string, unknown> = {}) {
  return {
    visionConfigState: 'ready',
    pipelines: [
      {
        mode: 'has_image',
        name: 'HaS Image',
        description: '',
        enabled: true,
        types: [...HAS_IMAGE_TYPES, ...FALLBACK_ONLY_TYPES],
      },
    ],
    selectedOcrHasTypes: [],
    selectedHasImageTypes: [],
    updateOcrHasTypes: vi.fn(),
    updateHasImageTypes: vi.fn(),
    toggleVisionType: vi.fn(),
    clearPlaygroundVisionPresetTracking: vi.fn(),
    ...overrides,
  } as never;
}

describe('VisionPipelines', () => {
  it('shows loading placeholder when vision config is loading', () => {
    render(
      <VisionPipelines
        rec={makeRecognition({ visionConfigState: 'loading', visionTypes: [], pipelines: [] })}
      />,
    );

    expect(screen.getByTestId('playground-vision-config-loading')).toBeInTheDocument();
  });

  it('shows loading placeholder when text config is loading', () => {
    render(
      <TextTypeGroups
        rec={makeRecognition({
          textConfigState: 'loading',
          playgroundTextGroups: [{ key: 'regex', label: 'Regex', tone: 'regex', types: [] }],
        })}
      />,
    );

    expect(screen.getByTestId('playground-text-config-loading')).toBeInTheDocument();
  });

  it('keeps HaS Image fixed to model classes and excludes page-container fallbacks', () => {
    const updateHasImageTypes = vi.fn();
    const clearPlaygroundVisionPresetTracking = vi.fn();

    render(
      <VisionPipelines
        rec={makeRecognition({
          updateHasImageTypes,
          clearPlaygroundVisionPresetTracking,
        })}
      />,
    );

    const pipeline = screen.getByTestId('playground-pipeline-has_image');
    expect(screen.getByText('Visual regions')).toBeInTheDocument();
    expect(screen.getAllByText('HaS Image').length).toBeGreaterThan(0);
    expect(pipeline).toHaveTextContent('20');
    expect(pipeline).toHaveTextContent('Showing 1-4 of 20');
    expect(within(pipeline).getAllByRole('checkbox')).toHaveLength(4);
    expect(
      within(pipeline).queryByRole('checkbox', { name: /Paper, opt-in/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Signature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Handwriting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Custom region' })).not.toBeInTheDocument();

    fireEvent.click(within(pipeline).getByRole('button', { name: 'Next' }));

    expect(pipeline).toHaveTextContent('Showing 5-8 of 20');
    expect(within(pipeline).getAllByRole('checkbox')).toHaveLength(4);
    expect(
      within(pipeline).queryByRole('checkbox', { name: /Paper, opt-in/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(pipeline).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(pipeline).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(pipeline).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(pipeline).getByRole('button', { name: 'Next' }));

    expect(pipeline).toHaveTextContent('Showing 17-20 of 20');
    expect(within(pipeline).getAllByRole('checkbox')).toHaveLength(4);
    expect(
      within(pipeline).queryByRole('checkbox', { name: /Paper, opt-in/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select Recommended' }));

    expect(clearPlaygroundVisionPresetTracking).toHaveBeenCalledTimes(1);
    expect(updateHasImageTypes).toHaveBeenCalledWith(
      HAS_IMAGE_TYPES.filter((type) => type.id !== 'paper').map((type) => type.id),
    );
  });
});
