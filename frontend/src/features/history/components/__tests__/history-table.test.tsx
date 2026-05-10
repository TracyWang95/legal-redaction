// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FileType, type FileListItem } from '@/types';
import { HistoryTable } from '../history-table';

vi.mock('@/i18n', () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));

function renderTable(
  row: FileListItem,
  options: {
    loading?: boolean;
    refreshing?: boolean;
    tableLoading?: boolean;
    pageSize?: number;
    keepRowsWhileLoading?: boolean;
  } = {},
) {
  return render(
    <MemoryRouter>
      <HistoryTable
        rows={options.loading && !options.keepRowsWhileLoading ? [] : [row]}
        loading={options.loading ?? false}
        refreshing={options.refreshing}
        tableLoading={options.tableLoading}
        pageSize={options.pageSize ?? 10}
        selected={new Set()}
        onToggle={vi.fn()}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
        onCompare={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function renderEmptyTable(pageSize = 10) {
  return render(
    <MemoryRouter>
      <HistoryTable
        rows={[]}
        loading={false}
        pageSize={pageSize}
        selected={new Set()}
        onToggle={vi.fn()}
        allSelected={false}
        onSelectAll={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
        onCompare={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function expectedRowHeight(pageSize: number): number {
  const safePageSize = Math.min(Math.max(Math.round(pageSize), 10), 20);
  return (600 - (safePageSize - 1)) / safePageSize;
}

describe('HistoryTable batch review shortcut', () => {
  it('wraps the wide table in an explicit horizontal scroll container', () => {
    renderTable({
      file_id: 'file-1',
      original_filename: 'contract.pdf',
      file_size: 100,
      file_type: FileType.PDF,
      created_at: '2026-05-02T10:00:00Z',
      has_output: true,
      entity_count: 3,
      upload_source: 'batch',
    });

    expect(screen.getByTestId('history-table')).toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('history-table')).toHaveStyle({
      height: '0px',
      minHeight: '0px',
    });
    expect(screen.getByTestId('history-table')).toHaveStyle({
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
    });
  });

  it('links awaiting-review batch files back to step 4', () => {
    renderTable({
      file_id: 'file-1',
      original_filename: 'contract.pdf',
      file_size: 100,
      file_type: FileType.PDF,
      created_at: '2026-05-02T10:00:00Z',
      has_output: false,
      entity_count: 3,
      upload_source: 'batch',
      job_id: 'job-1',
      item_id: 'item-2',
      item_status: 'awaiting_review',
      job_embed: {
        status: 'awaiting_review',
        job_type: 'smart_batch',
        first_awaiting_review_item_id: 'item-1',
        wizard_furthest_step: 3,
        batch_step1_configured: true,
        items: [
          { id: 'item-1', status: 'awaiting_review' },
          { id: 'item-2', status: 'awaiting_review' },
        ],
        progress: {
          total_items: 2,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: 2,
          review_approved: 0,
          redacting: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
        },
      },
    });

    const link = screen.getByTestId('continue-review-file-1');
    expect(link).toHaveAttribute('href', '/batch/smart?jobId=job-1&step=4&itemId=item-2');
  });

  it('does not show a row-level review shortcut for failed batch files', () => {
    renderTable({
      file_id: 'file-failed',
      original_filename: 'failed.png',
      file_size: 100,
      file_type: FileType.IMAGE,
      created_at: '2026-05-02T10:00:00Z',
      has_output: false,
      entity_count: 0,
      upload_source: 'batch',
      job_id: 'job-1',
      item_id: 'item-failed',
      item_status: 'failed',
      job_embed: {
        status: 'awaiting_review',
        job_type: 'smart_batch',
        first_awaiting_review_item_id: 'item-ready',
        wizard_furthest_step: 3,
        batch_step1_configured: true,
        items: [{ id: 'item-ready', status: 'awaiting_review' }],
        progress: {
          total_items: 2,
          pending: 0,
          processing: 0,
          queued: 0,
          parsing: 0,
          ner: 0,
          vision: 0,
          awaiting_review: 1,
          review_approved: 0,
          redacting: 0,
          completed: 0,
          failed: 1,
          cancelled: 0,
        },
      },
    });

    expect(screen.queryByTestId('continue-review-file-failed')).not.toBeInTheDocument();
  });

  it('renders batch files as an expanded peer tree with group selection', () => {
    const onToggleBatchCollapse = vi.fn();
    const onSelectGroup = vi.fn();
    const rows: FileListItem[] = [
      {
        file_id: 'single-file',
        original_filename: 'single.txt',
        file_size: 100,
        file_type: FileType.TXT,
        created_at: '2026-05-02T10:00:00Z',
        has_output: true,
        entity_count: 1,
        upload_source: 'playground',
      },
      {
        file_id: 'batch-file-1',
        original_filename: 'batch-a.pdf',
        file_size: 100,
        file_type: FileType.PDF,
        created_at: '2026-05-02T10:00:00Z',
        has_output: true,
        entity_count: 2,
        upload_source: 'batch',
        batch_group_id: 'batch-1',
        batch_group_count: 2,
      },
      {
        file_id: 'batch-file-2',
        original_filename: 'batch-b.pdf',
        file_size: 100,
        file_type: FileType.PDF,
        created_at: '2026-05-02T10:00:00Z',
        has_output: true,
        entity_count: 3,
        upload_source: 'batch',
        batch_group_id: 'batch-1',
        batch_group_count: 2,
      },
    ];

    const { rerender } = render(
      <MemoryRouter>
        <HistoryTable
          rows={rows}
          loading={false}
          pageSize={10}
          selected={new Set()}
          onToggle={vi.fn()}
          allSelected={false}
          onSelectAll={vi.fn()}
          expandedBatchIds={new Set(['batch-1'])}
          onToggleBatchCollapse={onToggleBatchCollapse}
          onSelectGroup={onSelectGroup}
          onDownload={vi.fn()}
          onDelete={vi.fn()}
          onCompare={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('history-row-single-file')).toBeInTheDocument();
    expect(screen.getByTestId('history-batch-row-batch-1')).toBeInTheDocument();
    expect(screen.getByTestId('history-batch-file-kind-batch-1')).toHaveTextContent(
      'history.fileKindText',
    );
    expect(screen.getByTestId('history-row-batch-file-1')).toBeInTheDocument();
    expect(screen.getByTestId('history-row-batch-file-2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('history-batch-toggle-batch-1'));
    expect(onToggleBatchCollapse).toHaveBeenCalledWith('batch-1');

    rerender(
      <MemoryRouter>
        <HistoryTable
          rows={rows}
          loading={false}
          pageSize={10}
          selected={new Set()}
          onToggle={vi.fn()}
          allSelected={false}
          onSelectAll={vi.fn()}
          expandedBatchIds={new Set()}
          onToggleBatchCollapse={onToggleBatchCollapse}
          onSelectGroup={onSelectGroup}
          onDownload={vi.fn()}
          onDelete={vi.fn()}
          onCompare={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('history-row-batch-file-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-row-batch-file-2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('history-batch-select-batch-1'));
    expect(onSelectGroup).toHaveBeenCalledWith(['batch-file-1', 'batch-file-2'], true);
  });

  it('labels a batch group with reviewable files as awaiting review', () => {
    render(
      <MemoryRouter>
        <HistoryTable
          rows={[
            {
              file_id: 'batch-ready',
              original_filename: 'ready.pdf',
              file_size: 100,
              file_type: FileType.PDF,
              created_at: '2026-05-02T10:00:00Z',
              has_output: false,
              entity_count: 2,
              upload_source: 'batch',
              batch_group_id: 'batch-status',
              batch_group_count: 2,
              item_status: 'awaiting_review',
            },
            {
              file_id: 'batch-failed',
              original_filename: 'failed.png',
              file_size: 100,
              file_type: FileType.IMAGE,
              created_at: '2026-05-02T10:01:00Z',
              has_output: false,
              entity_count: 0,
              upload_source: 'batch',
              batch_group_id: 'batch-status',
              batch_group_count: 2,
              item_status: 'failed',
            },
          ]}
          loading={false}
          pageSize={10}
          selected={new Set()}
          onToggle={vi.fn()}
          allSelected={false}
          onSelectAll={vi.fn()}
          expandedBatchIds={new Set(['batch-status'])}
          onToggleBatchCollapse={vi.fn()}
          onSelectGroup={vi.fn()}
          onDownload={vi.fn()}
          onDelete={vi.fn()}
          onCompare={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('history-batch-row-batch-status')).toHaveTextContent(
      'job.status.awaiting_review',
    );
  });

  it('labels batch file type as mixed when documents and images are grouped together', () => {
    render(
      <MemoryRouter>
        <HistoryTable
          rows={[
            {
              file_id: 'batch-doc',
              original_filename: 'batch-doc.pdf',
              file_size: 100,
              file_type: FileType.PDF,
              created_at: '2026-05-02T10:00:00Z',
              has_output: true,
              entity_count: 2,
              upload_source: 'batch',
              batch_group_id: 'batch-mixed',
              batch_group_count: 2,
            },
            {
              file_id: 'batch-image',
              original_filename: 'batch-image.png',
              file_size: 100,
              file_type: FileType.IMAGE,
              created_at: '2026-05-02T10:01:00Z',
              has_output: true,
              entity_count: 1,
              upload_source: 'batch',
              batch_group_id: 'batch-mixed',
              batch_group_count: 2,
            },
          ]}
          loading={false}
          pageSize={20}
          selected={new Set()}
          onToggle={vi.fn()}
          allSelected={false}
          onSelectAll={vi.fn()}
          expandedBatchIds={new Set(['batch-mixed'])}
          onToggleBatchCollapse={vi.fn()}
          onSelectGroup={vi.fn()}
          onDownload={vi.fn()}
          onDelete={vi.fn()}
          onCompare={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('history-batch-file-kind-batch-mixed')).toHaveTextContent(
      'history.fileKindMixed',
    );
  });

  it('labels batch file type as image when every grouped file is an image', () => {
    render(
      <MemoryRouter>
        <HistoryTable
          rows={[
            {
              file_id: 'batch-image-a',
              original_filename: 'batch-image-a.png',
              file_size: 100,
              file_type: FileType.IMAGE,
              created_at: '2026-05-02T10:00:00Z',
              has_output: true,
              entity_count: 2,
              upload_source: 'batch',
              batch_group_id: 'batch-image-only',
              batch_group_count: 2,
            },
            {
              file_id: 'batch-image-b',
              original_filename: 'batch-image-b.jpg',
              file_size: 100,
              file_type: FileType.IMAGE,
              created_at: '2026-05-02T10:01:00Z',
              has_output: true,
              entity_count: 1,
              upload_source: 'batch',
              batch_group_id: 'batch-image-only',
              batch_group_count: 2,
            },
          ]}
          loading={false}
          pageSize={20}
          selected={new Set()}
          onToggle={vi.fn()}
          allSelected={false}
          onSelectAll={vi.fn()}
          expandedBatchIds={new Set(['batch-image-only'])}
          onToggleBatchCollapse={vi.fn()}
          onSelectGroup={vi.fn()}
          onDownload={vi.fn()}
          onDelete={vi.fn()}
          onCompare={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('history-batch-file-kind-batch-image-only')).toHaveTextContent(
      'history.fileKindImage',
    );
  });

  it('shows a clear redacted state when output exists without repeating export', () => {
    renderTable({
      file_id: 'file-export',
      original_filename: 'redacted.pdf',
      file_size: 100,
      file_type: FileType.PDF,
      created_at: '2026-05-02T10:00:00Z',
      has_output: true,
      entity_count: 3,
      upload_source: 'playground',
    });

    expect(screen.getByTestId('history-status-file-export')).toHaveTextContent(
      'redactionState.redacted',
    );
    expect(screen.queryByTestId('history-status-detail-file-export')).not.toBeInTheDocument();
  });

  it('shows a processing state while file status is still active', () => {
    renderTable({
      file_id: 'file-processing',
      original_filename: 'processing.pdf',
      file_size: 120,
      file_type: FileType.PDF,
      created_at: '2026-05-02T10:00:00Z',
      has_output: false,
      entity_count: 3,
      upload_source: 'playground',
      item_status: 'processing',
    });

    expect(screen.getByTestId('history-status-file-processing')).toHaveTextContent(
      'job.status.processing',
    );
    expect(screen.getByTestId('history-status-detail-file-processing')).toHaveTextContent(
      'jobs.processingEllipsis',
    );
  });

  it('keeps the table shell visible during the first load', () => {
    renderTable(
      {
        file_id: 'file-loading',
        original_filename: 'loading.pdf',
        file_size: 100,
        file_type: FileType.PDF,
        created_at: '2026-05-02T10:00:00Z',
        has_output: false,
        entity_count: 0,
        upload_source: 'playground',
      },
      { loading: true },
    );

    expect(screen.getByTestId('history-table')).toBeInTheDocument();
    expect(screen.getByText('history.col.filename')).toBeInTheDocument();
    expect(screen.queryByText('emptyState.noFiles')).not.toBeInTheDocument();
  });

  it('keeps the same stable scroll body for empty result pages', () => {
    renderEmptyTable();

    expect(screen.getByTestId('history-table')).toHaveClass(
      'flex-1',
      'overflow-x-auto',
      'overflow-y-auto',
    );
    expect(screen.getByTestId('history-table')).toHaveStyle({
      height: '0px',
      minHeight: '0px',
    });
    expect(screen.getByTestId('history-table-empty')).toHaveTextContent('emptyState.noFiles');
    expect(screen.queryByTestId('history-table-grid')).not.toBeInTheDocument();
  });

  it('uses a non-layout refresh overlay while preserving table rows', () => {
    renderTable(
      {
        file_id: 'file-refreshing',
        original_filename: 'refreshing.pdf',
        file_size: 100,
        file_type: FileType.PDF,
        created_at: '2026-05-02T10:00:00Z',
        has_output: true,
        entity_count: 1,
        upload_source: 'playground',
      },
      { refreshing: true },
    );

    expect(screen.queryByTestId('history-table-refresh-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('history-row-file-refreshing')).toBeInTheDocument();
  });

  it('keeps the internal refresh indicator hidden during page changes', () => {
    renderTable(
      {
        file_id: 'file-page-change',
        original_filename: 'page-change.pdf',
        file_size: 100,
        file_type: FileType.PDF,
        created_at: '2026-05-02T10:00:00Z',
        has_output: true,
        entity_count: 1,
        upload_source: 'playground',
      },
      { tableLoading: true },
    );

    expect(screen.queryByTestId('history-table-refresh-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-table')).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps existing rows mounted if loading is raised with cached data', () => {
    renderTable(
      {
        file_id: 'file-cached-loading',
        original_filename: 'cached-loading.pdf',
        file_size: 100,
        file_type: FileType.PDF,
        created_at: '2026-05-02T10:00:00Z',
        has_output: true,
        entity_count: 1,
        upload_source: 'playground',
      },
      { loading: true, keepRowsWhileLoading: true },
    );

    expect(screen.queryByTestId('history-table-refresh-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('history-row-file-cached-loading')).toBeInTheDocument();
    expect(screen.queryByText('emptyState.noFiles')).not.toBeInTheDocument();
  });

  it('keeps page-size table density stable and tightens from 20 rows upward', () => {
    const row: FileListItem = {
      file_id: 'file-density',
      original_filename: 'density.pdf',
      file_size: 100,
      file_type: FileType.PDF,
      created_at: '2026-05-02T10:00:00Z',
      has_output: true,
      entity_count: 1,
      upload_source: 'playground',
    };
    const { container, rerender } = renderTable(row, { pageSize: 10 });
    const rowElement10 = container.querySelector(
      '[data-testid="history-row-file-density"]',
    ) as HTMLElement;
    expect(rowElement10).not.toBeNull();
    expect(parseFloat(rowElement10.style.height)).toBeCloseTo(expectedRowHeight(10), 3);

    rerender(
      <MemoryRouter>
        <HistoryTable
          rows={[row]}
          loading={false}
          tableLoading={false}
          pageSize={20}
          selected={new Set()}
          onToggle={vi.fn()}
          allSelected={false}
          onSelectAll={vi.fn()}
          onDownload={vi.fn()}
          onDelete={vi.fn()}
          onCompare={vi.fn()}
        />
      </MemoryRouter>,
    );

    const rowElement20 = container.querySelector(
      '[data-testid="history-row-file-density"]',
    ) as HTMLElement;
    expect(rowElement20).not.toBeNull();
    expect(parseFloat(rowElement20.style.height)).toBeCloseTo(expectedRowHeight(20), 3);

    expect(screen.getByTestId('history-table')).toHaveStyle({
      height: '0px',
      minHeight: '0px',
    });
  });

  it('keeps the body height stable for 10 and 20 rows', () => {
    const row: FileListItem = {
      file_id: 'file-height',
      original_filename: 'height.pdf',
      file_size: 100,
      file_type: FileType.PDF,
      created_at: '2026-05-02T10:00:00Z',
      has_output: true,
      entity_count: 1,
      upload_source: 'batch',
    };
    const { rerender } = renderTable(row, { pageSize: 10 });

    expect(screen.getByTestId('history-table')).toHaveStyle({
      minHeight: '0px',
    });

    rerender(
      <MemoryRouter>
        <HistoryTable
          rows={[row]}
          loading={false}
          tableLoading={false}
          pageSize={20}
          selected={new Set()}
          onToggle={vi.fn()}
          allSelected={false}
          onSelectAll={vi.fn()}
          onDownload={vi.fn()}
          onDelete={vi.fn()}
          onCompare={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('history-table')).toHaveStyle({
      minHeight: '0px',
    });
  });
});
