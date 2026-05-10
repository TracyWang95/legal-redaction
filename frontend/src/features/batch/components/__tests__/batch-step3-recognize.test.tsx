// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test-utils';
import type { ServicesHealth } from '@/hooks/use-service-health';
import { useI18n } from '@/i18n';
import type { BatchRow } from '../../types';
import { BatchStep3Recognize } from '../batch-step3-recognize';

const mockUseServiceHealth = vi.fn<() => { health: ServicesHealth | null }>(() => ({
  health: null,
}));

vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: () => mockUseServiceHealth(),
}));

function row(fileId: string, analyzeStatus: BatchRow['analyzeStatus']): BatchRow {
  return {
    file_id: fileId,
    original_filename: `${fileId}.pdf`,
    file_size: 100,
    file_type: 'pdf',
    created_at: '2026-01-01T00:00:00Z',
    has_output: false,
    entity_count: 0,
    analyzeStatus,
  } as BatchRow;
}

describe('BatchStep3Recognize', () => {
  beforeEach(() => {
    useI18n.setState({ locale: 'en' });
  });

  it('treats a reachable busy recognition service as available', () => {
    mockUseServiceHealth.mockReturnValueOnce({
      health: {
        all_online: false,
        services: {
          paddle_ocr: { name: 'PaddleOCR', status: 'busy' },
          has_ner: { name: 'HaS Text', status: 'online' },
          has_image: { name: 'HaS Image', status: 'online' },
        },
      },
    });

    render(
      <BatchStep3Recognize
        rows={[row('file-1', 'pending')]}
        activeJobId="job-1"
        failedRows={[]}
        goStep={vi.fn()}
        submitQueueToWorker={vi.fn()}
        requeueFailedItems={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('recognition-service-state')).not.toBeInTheDocument();
    expect(screen.getByTestId('submit-queue')).toBeEnabled();
    expect(screen.getByTestId('submit-queue')).toHaveTextContent('Submit to Queue');
  });

  it('blocks queue submission when a recognition service is unavailable', () => {
    const submitQueueToWorker = vi.fn();
    mockUseServiceHealth.mockReturnValueOnce({
      health: {
        all_online: false,
        services: {
          paddle_ocr: { name: 'PaddleOCR', status: 'offline' },
          has_ner: { name: 'HaS Text', status: 'offline' },
          has_image: { name: 'HaS Image', status: 'offline' },
        },
      },
    });

    render(
      <BatchStep3Recognize
        rows={[row('file-1', 'pending')]}
        activeJobId="job-1"
        failedRows={[]}
        goStep={vi.fn()}
        submitQueueToWorker={submitQueueToWorker}
        requeueFailedItems={vi.fn()}
      />,
    );

    expect(screen.getByTestId('recognition-service-state')).toBeInTheDocument();
    expect(screen.getByTestId('submit-queue')).toBeDisabled();
    expect(screen.getByTestId('submit-queue')).toHaveTextContent('Service Unavailable');
  });

  it('allows text recognition when only vision services are unavailable', () => {
    const submitQueueToWorker = vi.fn();
    mockUseServiceHealth.mockReturnValueOnce({
      health: {
        all_online: false,
        services: {
          paddle_ocr: { name: 'PaddleOCR', status: 'offline' },
          has_ner: { name: 'HaS Text', status: 'online' },
          has_image: { name: 'HaS Image', status: 'offline' },
        },
      },
    });

    render(
      <BatchStep3Recognize
        mode="text"
        rows={[row('file-1', 'pending')]}
        activeJobId="job-1"
        failedRows={[]}
        goStep={vi.fn()}
        submitQueueToWorker={submitQueueToWorker}
        requeueFailedItems={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('recognition-service-state')).toBeNull();
    expect(screen.getByTestId('submit-queue')).toBeEnabled();
  });

  it('shows active recognition progress while a file is still processing', () => {
    render(
      <BatchStep3Recognize
        rows={[
          row('file-1', 'analyzing'),
          row('file-2', 'pending'),
          row('file-3', 'pending'),
          row('file-4', 'pending'),
        ]}
        activeJobId="job-1"
        failedRows={[]}
        goStep={vi.fn()}
        submitQueueToWorker={vi.fn()}
        requeueFailedItems={vi.fn()}
      />,
    );

    expect(screen.getByText(/Processing 1\/4/)).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    expect(screen.getByTestId('recognition-progress')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByTestId('recognition-progress-block')).toHaveClass('bg-background');
  });

  it('shows page-level progress for long vision recognition items', () => {
    render(
      <BatchStep3Recognize
        rows={[
          {
            ...row('scan-contract', 'analyzing'),
            recognitionStage: 'vision',
            recognitionCurrent: 3,
            recognitionTotal: 6,
          },
        ]}
        activeJobId="job-1"
        failedRows={[]}
        goStep={vi.fn()}
        submitQueueToWorker={vi.fn()}
        requeueFailedItems={vi.fn()}
      />,
    );

    expect(screen.getByTestId('row-progress-scan-contract')).toHaveTextContent('Vision page 3/6');
  });

  it('localizes legacy backend recognition messages in Chinese mode', () => {
    useI18n.setState({ locale: 'zh' });

    render(
      <BatchStep3Recognize
        rows={[
          {
            ...row('text-ready', 'awaiting_review'),
            recognitionMessage: 'Text recognition complete',
          },
          {
            ...row('image-ready', 'awaiting_review'),
            recognitionMessage: 'Vision recognition complete',
          },
        ]}
        activeJobId="job-1"
        failedRows={[]}
        goStep={vi.fn()}
        submitQueueToWorker={vi.fn()}
        requeueFailedItems={vi.fn()}
      />,
    );

    expect(screen.getByTestId('row-progress-text-ready')).toHaveTextContent(
      '文本识别完成',
    );
    expect(screen.getByTestId('row-progress-image-ready')).toHaveTextContent(
      '视觉识别完成',
    );
  });

  it('allows review when ready rows exist and failed rows are settled', () => {
    const goStep = vi.fn();
    render(
      <BatchStep3Recognize
        rows={[
          row('ready-1', 'awaiting_review'),
          { ...row('failed-1', 'failed'), analyzeError: 'OCR timeout' },
        ]}
        activeJobId="job-1"
        failedRows={[row('failed-1', 'failed')]}
        goStep={goStep}
        submitQueueToWorker={vi.fn()}
        requeueFailedItems={vi.fn()}
      />,
    );

    expect(screen.getByTestId('recognition-partial-ready')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('step3-next'));
    expect(goStep).toHaveBeenCalledWith(4);
  });

  it('keeps review locked while any file is still processing', () => {
    const goStep = vi.fn();
    render(
      <BatchStep3Recognize
        rows={[
          row('ready-1', 'awaiting_review'),
          row('active-1', 'analyzing'),
          row('pending-1', 'pending'),
        ]}
        activeJobId="job-1"
        failedRows={[]}
        goStep={goStep}
        submitQueueToWorker={vi.fn()}
        requeueFailedItems={vi.fn()}
      />,
    );

    expect(screen.getByTestId('step3-next')).toBeDisabled();
    expect(screen.getByTestId('step3-next')).toHaveAttribute('data-reviewable', 'false');
    expect(screen.getByTestId('step3-next')).toHaveAttribute('data-reviewable-count', '1');
    fireEvent.click(screen.getByTestId('step3-next'));
    expect(goStep).not.toHaveBeenCalled();
  });

  it('filters the recognition list by failed status', () => {
    render(
      <BatchStep3Recognize
        rows={[
          row('ready-1', 'awaiting_review'),
          { ...row('failed-1', 'failed'), analyzeError: 'OCR timeout' },
        ]}
        activeJobId="job-1"
        failedRows={[row('failed-1', 'failed')]}
        goStep={vi.fn()}
        submitQueueToWorker={vi.fn()}
        requeueFailedItems={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('recognition-filter-failed'));
    expect(screen.getByText('failed-1.pdf')).toBeInTheDocument();
    expect(screen.queryByText('ready-1.pdf')).not.toBeInTheDocument();
  });

  it('uses a narrow-screen recognition row layout with the status badge isolated', () => {
    render(
      <BatchStep3Recognize
        rows={[row('long-file-name-that-should-not-overlap', 'awaiting_review')]}
        activeJobId="job-1"
        failedRows={[]}
        goStep={vi.fn()}
        submitQueueToWorker={vi.fn()}
        requeueFailedItems={vi.fn()}
      />,
    );

    const rowContainer = screen.getByTestId('recognition-row-long-file-name-that-should-not-overlap');
    expect(rowContainer.getAttribute('class')).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(rowContainer.getAttribute('class')).toContain(
      'md:grid-cols-[minmax(0,1.2fr)_minmax(0,13rem)_auto_minmax(0,12rem)]',
    );
  });
});
