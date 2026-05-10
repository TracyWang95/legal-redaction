// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test-utils';
import { useI18n } from '@/i18n';
import { PlaygroundResultActionBar, RedactionReportSection } from '../playground-result-action-bar';

beforeEach(() => {
  useI18n.getState().setLocale('en');
});

afterEach(() => {
  useI18n.getState().setLocale('en');
});

describe('RedactionReportSection', () => {
  it('renders audit totals and distributions from the backend report', () => {
    render(
      <RedactionReportSection
        open
        onToggle={vi.fn()}
        report={{
          total_entities: 5,
          redacted_entities: 3,
          coverage_rate: 60,
          entity_type_distribution: { PERSON: 2, ORG: 1 },
          source_distribution: { regex: 2, has: 1 },
          confidence_distribution: { high: 2, medium: 1, low: 0 },
          redaction_mode: 'structured',
        }}
      />,
    );

    const report = screen.getByTestId('playground-quality-report');
    expect(report).toHaveTextContent('5');
    expect(report).toHaveTextContent('3');
    expect(screen.getByText('Unprocessed entities')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(screen.getByText('Source distribution')).toBeInTheDocument();
    expect(screen.getByText('Regex')).toBeInTheDocument();
    expect(screen.getByText('HaS')).toBeInTheDocument();
    expect(screen.getByText('structured')).toBeInTheDocument();
  });

  it('keeps the report collapsed until toggled', () => {
    const onToggle = vi.fn();
    render(
      <RedactionReportSection
        open={false}
        onToggle={onToggle}
        report={{ total_entities: 1, redacted_entities: 1 }}
      />,
    );

    expect(screen.queryByTestId('playground-quality-report')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /quality report/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('PlaygroundResultActionBar', () => {
  it('shows review-ready workflow guidance and handles action clicks', () => {
    const onBackToEdit = vi.fn();
    const onReset = vi.fn();
    const onDownload = vi.fn();

    render(
      <PlaygroundResultActionBar
        fileInfo={{ file_id: 'file-1', filename: 'contract.txt', file_size: 42, file_type: 'txt' }}
        redactedCount={3}
        onBackToEdit={onBackToEdit}
        onReset={onReset}
        onDownload={onDownload}
      />,
    );

    expect(screen.getByText('3 sensitive items redacted')).toBeInTheDocument();
    expect(screen.getByText('Recognize')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.getByText('Review the result first, then export when it looks correct.')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('playground-back-edit'));
    expect(onBackToEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Download/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /New file/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('hides export action when no file info is available', () => {
    render(
      <PlaygroundResultActionBar
        fileInfo={null}
        redactedCount={0}
        onBackToEdit={vi.fn()}
        onReset={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('playground-download')).not.toBeInTheDocument();
    expect(screen.getByText('0 sensitive items redacted')).toBeInTheDocument();
  });

  it('holds export action until a visual result is ready', () => {
    render(
      <PlaygroundResultActionBar
        fileInfo={{ file_id: 'image-1', filename: 'scan.png', file_size: 42, file_type: 'image' }}
        redactedCount={3}
        resultReady={false}
        canDownload={false}
        onBackToEdit={vi.fn()}
        onReset={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('playground-download')).not.toBeInTheDocument();
    expect(screen.getByText('Preparing redacted preview...')).toBeInTheDocument();
  });
});
