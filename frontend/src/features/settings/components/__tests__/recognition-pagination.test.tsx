// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { EntityTypeList } from '../entity-type-list';
import { PipelineConfigPanel } from '../pipeline-config';
import type {
  EntityTypeConfig,
  PipelineConfig,
  PipelineTypeConfig,
} from '../../hooks/use-entity-types';

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => {
    const translations: Record<string, string> = {
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'history.itemsUnit': 'items',
      'history.perPage': 'per page',
      'jobs.showRange': '{start}-{end} of {total}',
      'settings.addNew': 'Add new',
      'settings.cardDescriptionLabel': 'Description',
      'settings.pipelineDisplayName.image': 'Image recognition',
      'settings.pipelineDisplayName.ocr': 'OCR recognition',
      'settings.pipelineDisplayName.vlm': 'Visual semantic recognition',
      'settings.regex': 'Regex',
      'settings.regexRules': 'Regex rules',
      'settings.resetTextRules': 'Reset text rules',
      'settings.resetVisionRules': 'Reset vision rules',
      'settings.semantic': 'Semantic',
    };
    return translations[key] ?? key;
  },
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void;
    value?: string;
  }>({});

  return {
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
      value?: string;
    }) => (
      <SelectContext.Provider value={{ onValueChange, value }}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const context = React.useContext(SelectContext);
      return (
        <button
          aria-selected={context.value === value}
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
    SelectValue: () => {
      const context = React.useContext(SelectContext);
      return <span>{context.value}</span>;
    },
  };
});

function makeEntityType(index: number): EntityTypeConfig {
  return {
    id: `entity-${index}`,
    name: `Entity ${index}`,
    color: '#2563eb',
    regex_pattern: `value-${index}`,
  };
}

function makePipelineType(index: number): PipelineTypeConfig {
  return {
    id: `pipeline-${index}`,
    name: `Pipeline ${index}`,
    color: '#2563eb',
    description: `Pipeline description ${index}`,
    enabled: true,
    order: index,
  };
}

describe('Recognition configuration pagination', () => {
  it('keeps recognition entity types fixed to 9 per page', () => {
    render(
      <EntityTypeList
        types={Array.from({ length: 30 }, (_, index) => makeEntityType(index + 1))}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        onReset={vi.fn()}
        variant="regex"
      />,
    );

    expect(screen.getByText('1-9 of 30')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '18 items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '27 items' })).not.toBeInTheDocument();
    expect(screen.getByText('Entity 9')).toBeInTheDocument();
    expect(screen.queryByText('Entity 10')).not.toBeInTheDocument();
  });

  it('keeps recognition pipeline ranges fixed to 9 per page', () => {
    const pipelines: PipelineConfig[] = [
      {
        mode: 'ocr_has',
        name: 'OCR recognition',
        description: '',
        enabled: true,
        types: Array.from({ length: 30 }, (_, index) => makePipelineType(index + 1)),
      },
      {
        mode: 'has_image',
        name: 'Image recognition',
        description: '',
        enabled: true,
        types: Array.from({ length: 5 }, (_, index) => ({
          ...makePipelineType(index + 1),
          id: `image-${index + 1}`,
          name: `Image ${index + 1}`,
        })),
      },
    ];

    render(
      <PipelineConfigPanel
        loading={false}
        pipelines={pipelines}
        onCreateType={vi.fn()}
        onUpdateType={vi.fn()}
        onDeleteType={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByText('1-9 of 30')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '18 items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '27 items' })).not.toBeInTheDocument();
    expect(screen.getByText('Pipeline 9')).toBeInTheDocument();
    expect(screen.queryByText('Pipeline 10')).not.toBeInTheDocument();
  });

});
