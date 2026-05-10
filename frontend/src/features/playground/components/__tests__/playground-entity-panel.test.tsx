// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test-utils';
import { PlaygroundEntityPanel } from '../playground-entity-panel';
import type { BoundingBox, Entity } from '../../types';

const noop = vi.fn();

function renderPanel(overrides: Partial<ComponentProps<typeof PlaygroundEntityPanel>> = {}) {
  return render(
    <PlaygroundEntityPanel
      isImageMode={false}
      isLoading={false}
      entities={[]}
      visibleBoxes={[]}
      selectedCount={0}
      replacementMode="structured"
      setReplacementMode={noop}
      clearPlaygroundTextPresetTracking={noop}
      onRerunNer={noop}
      onRedact={noop}
      onSelectAll={noop}
      onDeselectAll={noop}
      onToggleBox={noop}
      onEntityClick={noop}
      onRemoveEntity={noop}
      {...overrides}
    />,
  );
}

describe('PlaygroundEntityPanel', () => {
  it('shows actionable guidance when text recognition returns no entities', () => {
    const onRerunNer = vi.fn();
    renderPanel({ onRerunNer });

    expect(screen.getByTestId('playground-empty-detections')).toHaveTextContent(
      'No redaction-ready results',
    );
    expect(screen.getByText(/select text in the document/i)).toBeInTheDocument();
    expect(screen.getByTestId('playground-select-all')).toBeDisabled();
    expect(screen.getByTestId('playground-redact-disabled-reason')).toHaveTextContent(
      'There are no detection results to process',
    );
    fireEvent.click(screen.getByTestId('playground-disabled-rerun'));
    expect(onRerunNer).toHaveBeenCalledTimes(1);
  });

  it('shows image-specific empty guidance when no regions are detected', () => {
    renderPanel({ isImageMode: true });

    expect(screen.getByText(/draw a region directly on the preview image/i)).toBeInTheDocument();
  });

  it('explains why redaction is disabled when all detections are deselected', () => {
    const onSelectAll = vi.fn();
    const entity: Entity = {
      id: 'entity-1',
      text: 'Alice',
      type: 'PERSON',
      start: 0,
      end: 5,
      selected: false,
      source: 'regex',
    };
    renderPanel({ entities: [entity], selectedCount: 0, onSelectAll });

    expect(screen.getByTestId('playground-redact-btn')).toBeDisabled();
    expect(screen.getByTestId('playground-redact-disabled-reason')).toHaveTextContent(
      'All results are currently deselected',
    );
    fireEvent.click(screen.getByTestId('playground-disabled-select-all'));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('uses occurrence coverage counts for text review selection and redact action', () => {
    const entity: Entity = {
      id: 'entity-1',
      text: 'Alice',
      type: 'PERSON',
      start: 0,
      end: 5,
      selected: true,
      source: 'regex',
    };

    renderPanel({
      entities: [entity],
      selectedCount: 1,
      displaySelectedCount: 3,
      displayTotalCount: 3,
      displayStats: { PERSON: { selected: 3, total: 3 } },
    });

    expect(screen.getByTestId('playground-redact-btn')).toHaveTextContent('Start redaction (3)');
    expect(screen.getAllByText('3/3').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps total coverage count stable when some occurrences are deselected', () => {
    const entity: Entity = {
      id: 'entity-1',
      text: 'Alice',
      type: 'PERSON',
      start: 0,
      end: 5,
      selected: true,
      source: 'regex',
    };

    renderPanel({
      entities: [entity],
      selectedCount: 1,
      displaySelectedCount: 2,
      displayTotalCount: 3,
      displayStats: { PERSON: { selected: 2, total: 3 } },
    });

    expect(screen.getByText('2 selected out of 3')).toBeInTheDocument();
    expect(screen.getByTestId('playground-redact-btn')).toHaveTextContent('Start redaction (2)');
    expect(screen.getAllByText('2/3').length).toBeGreaterThanOrEqual(2);
  });

  it('does not show a disabled reason when image detections are selected', () => {
    const box: BoundingBox = {
      id: 'box-1',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      type: 'official_seal',
      selected: true,
      source: 'has_image',
    };
    renderPanel({ isImageMode: true, visibleBoxes: [box], selectedCount: 1 });

    expect(screen.getByText('Review selection')).toBeInTheDocument();
    expect(screen.getAllByText('Regions')).toHaveLength(1);
    expect(screen.queryByTestId('playground-redact-disabled-reason')).not.toBeInTheDocument();
    expect(screen.getByTestId('playground-redact-btn')).not.toBeDisabled();
  });
});
