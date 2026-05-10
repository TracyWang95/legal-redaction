// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { FileType } from '@/types';
import { BatchStep2Upload } from '../batch-step2-upload';
import type { BatchRow } from '../../types';

const baseRow: BatchRow = {
  file_id: 'file-1',
  original_filename: 'contract.pdf',
  file_size: 100,
  file_type: FileType.PDF,
  created_at: '2026-01-01T00:00:00Z',
  has_output: false,
  entity_count: 0,
  analyzeStatus: 'pending',
};

const getInputProps = <T extends object>(props?: T): T => props ?? ({} as T);

describe('BatchStep2Upload', () => {
  it('shows upload issues without removing successful queue items', () => {
    const clearUploadIssues = vi.fn();

    render(
      <BatchStep2Upload
        mode="smart"
        activeJobId="job-1"
        rows={[baseRow]}
        loading={false}
        isDragActive={false}
        getRootProps={() => ({})}
        getInputProps={getInputProps}
        uploadIssues={[
          {
            id: 'issue-1',
            filename: 'malware.exe',
            reason: 'This file type is not supported by the current uploader.',
          },
        ]}
        clearUploadIssues={clearUploadIssues}
        goStep={vi.fn()}
        removeRow={vi.fn()}
        clearRows={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toBe(screen.getByTestId('upload-issues'));
    expect(screen.getByTestId('upload-issues')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('malware.exe')).toBeInTheDocument();
    expect(screen.getByText('contract.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('upload-issues-dismiss'));
    expect(clearUploadIssues).toHaveBeenCalled();
  });

  it('shows active batch upload progress', () => {
    render(
      <BatchStep2Upload
        mode="smart"
        activeJobId="job-1"
        rows={[]}
        loading={true}
        isDragActive={false}
        getRootProps={() => ({})}
        getInputProps={getInputProps}
        uploadIssues={[]}
        uploadProgress={{
          total: 10,
          completed: 4,
          failed: 1,
          inFlight: 3,
          currentFile: 'invoice.pdf',
        }}
        clearUploadIssues={vi.fn()}
        goStep={vi.fn()}
        removeRow={vi.fn()}
        clearRows={vi.fn()}
      />,
    );

    expect(screen.getByTestId('upload-progress')).toBeInTheDocument();
    expect(screen.getByText('4/10 complete')).toBeInTheDocument();
    expect(screen.getByText('3 uploading, 1 failed')).toBeInTheDocument();
    expect(screen.getByTestId('upload-current-file')).toHaveTextContent('invoice.pdf');
  });

  it('blocks recognition while uploads are still running', () => {
    const goStep = vi.fn();

    render(
      <BatchStep2Upload
        mode="smart"
        activeJobId="job-1"
        rows={[baseRow]}
        loading={true}
        isDragActive={false}
        getRootProps={() => ({})}
        getInputProps={getInputProps}
        uploadIssues={[]}
        uploadProgress={{ total: 2, completed: 1, failed: 0, inFlight: 1 }}
        clearUploadIssues={vi.fn()}
        goStep={goStep}
        removeRow={vi.fn()}
        clearRows={vi.fn()}
      />,
    );

    const next = screen.getByTestId('step2-next');
    expect(next).toBeDisabled();
    expect(screen.getByTestId('step2-next-disabled-reason')).toHaveTextContent(
      'Wait for uploads to finish before recognizing.',
    );

    fireEvent.click(next);
    expect(goStep).not.toHaveBeenCalled();
  });

  it('shows file size in the upload queue', () => {
    render(
      <BatchStep2Upload
        mode="smart"
        activeJobId="job-1"
        rows={[{ ...baseRow, file_size: 1536 }]}
        loading={false}
        isDragActive={false}
        getRootProps={() => ({})}
        getInputProps={getInputProps}
        uploadIssues={[]}
        clearUploadIssues={vi.fn()}
        goStep={vi.fn()}
        removeRow={vi.fn()}
        clearRows={vi.fn()}
      />,
    );

    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('uses a narrow-screen queue row layout that keeps file metadata from overlapping', () => {
    render(
      <BatchStep2Upload
        mode="smart"
        activeJobId="job-1"
        rows={[
          {
            ...baseRow,
            original_filename: 'very-long-contract-name-that-should-stay-truncated.pdf',
          },
        ]}
        loading={false}
        isDragActive={false}
        getRootProps={() => ({})}
        getInputProps={getInputProps}
        uploadIssues={[]}
        clearUploadIssues={vi.fn()}
        goStep={vi.fn()}
        removeRow={vi.fn()}
        clearRows={vi.fn()}
      />,
    );

    const row = screen.getByTestId('step2-row-file-1');
    expect(row.getAttribute('class')).toContain('grid-cols-[minmax(0,1fr)_1.75rem]');
    expect(row.getAttribute('class')).toContain(
      'sm:grid-cols-[minmax(0,1fr)_5rem_4.5rem_1.75rem]',
    );
  });
});
