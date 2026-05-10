// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils';
import type ImageBBoxEditor from '@/components/ImageBBoxEditor';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineCfg } from '../../types';
import { ReviewImageContent } from '../review-image-content';

const imageBBoxEditorRender = vi.hoisted(() => vi.fn());

vi.mock('@/components/ImageBBoxEditor', () => ({
  default: (props: ComponentProps<typeof ImageBBoxEditor>) => {
    imageBBoxEditorRender(props);
    return <div data-testid="mock-image-bbox-editor" />;
  },
}));

describe('ReviewImageContent', () => {
  beforeEach(() => {
    imageBBoxEditorRender.mockClear();
  });

  it('exposes mobile tabs for original image, redacted preview, and region list', () => {
    render(
      <ReviewImageContent
        reviewBoxes={[]}
        visibleReviewBoxes={[]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={0}
        totalReviewBoxCount={0}
        currentReviewVisionQuality={null}
        pipelines={[]}
        onReviewPageChange={vi.fn()}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={vi.fn()}
      />,
    );

    const original = screen.getByTestId('review-image-tab-original');
    const preview = screen.getByTestId('review-image-tab-preview');
    const regions = screen.getByTestId('review-image-tab-regions');

    expect(screen.getByRole('tablist', { name: 'Image review panels' })).toBeInTheDocument();
    expect(original).toHaveAttribute('role', 'tab');
    expect(original).toHaveAttribute('aria-selected', 'true');
    expect(original).toHaveClass('bg-primary');
    fireEvent.click(preview);
    expect(preview).toHaveAttribute('aria-selected', 'true');
    expect(preview).toHaveClass('bg-primary');
    expect(screen.getByText('Redacted preview is not ready yet')).toBeInTheDocument();
    fireEvent.click(regions);
    expect(regions).toHaveAttribute('aria-selected', 'true');
    expect(regions).toHaveClass('bg-primary');
    expect(screen.getByTestId('review-image-empty-regions')).toHaveTextContent(
      'No detection regions',
    );
    expect(screen.queryByTestId('review-image-source-summary')).not.toBeInTheDocument();
  });

  it('exposes stable review page pagination test ids', () => {
    const onReviewPageChange = vi.fn();

    render(
      <ReviewImageContent
        reviewBoxes={[]}
        visibleReviewBoxes={[]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={2}
        reviewTotalPages={3}
        selectedReviewBoxCount={0}
        totalReviewBoxCount={0}
        currentReviewVisionQuality={null}
        pipelines={[]}
        onReviewPageChange={onReviewPageChange}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={vi.fn()}
      />,
    );

    expect(screen.getByTestId('review-page-prev')).toHaveClass('min-w-11');
    expect(screen.getByTestId('review-page-next')).toHaveClass('min-w-11');
    fireEvent.click(screen.getByTestId('review-page-prev'));
    fireEvent.click(screen.getByTestId('review-page-next'));
    expect(onReviewPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onReviewPageChange).toHaveBeenNthCalledWith(2, 3);
  });

  it('shows review hints, source detail, and confidence for review boxes', () => {
    render(
      <ReviewImageContent
        reviewBoxes={[
          {
            id: 'seal-1',
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.2,
            type: 'official_seal',
            selected: true,
            source: 'has_image',
            source_detail: 'red_seal_fallback',
            confidence: 0.44,
            warnings: ['fallback_detector'],
          },
        ]}
        visibleReviewBoxes={[
          {
            id: 'seal-1',
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.2,
            type: 'official_seal',
            selected: true,
            source: 'has_image',
            source_detail: 'red_seal_fallback',
            confidence: 0.44,
            warnings: ['fallback_detector'],
          },
        ]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={1}
        totalReviewBoxCount={1}
        currentReviewVisionQuality={null}
        pipelines={[
          {
            mode: 'has_image',
            name: 'HaS Image',
            description: '',
            enabled: true,
            types: [
              { id: 'official_seal', name: 'Official seal', color: '#ef4444', enabled: true },
            ],
          },
        ]}
        onReviewPageChange={vi.fn()}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={vi.fn()}
      />,
    );

    expect(screen.getByTestId('review-image-quality-summary')).toHaveTextContent(
      'Review hints on this page',
    );
    expect(screen.getByTestId('review-image-quality-summary')).not.toHaveTextContent(
      'Visual hints only',
    );
    expect(screen.getByTestId('review-image-selection-summary')).toHaveTextContent('selected');
    expect(screen.getByTestId('bbox-quality-seal-1')).toHaveTextContent('Low confidence');
    expect(screen.getByTestId('bbox-quality-seal-1')).toHaveTextContent('Fallback detector');
    expect(screen.getByText(/Confidence 44%/)).toBeInTheDocument();
    expect(screen.getByTestId('bbox-source-seal-1')).toHaveTextContent(
      'Source Fallback detector: Red Seal',
    );
    expect(screen.getByTestId('bbox-source-seal-1')).toHaveAttribute(
      'title',
      'Detected by a fallback detector; review visually before keeping.',
    );
    expect(screen.getByTestId('bbox-quality-seal-1-fallback')).toHaveAttribute(
      'title',
      'Detected by a fallback rule, not the HaS Image model.',
    );
    expect(
      screen.getByRole('checkbox', { name: 'Toggle detection region Official seal seal-1' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Official seal.*30×20%.*Confidence 44%.*Source Fallback detector: Red Seal.*Review hints.*selected/,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('exposes deselected review regions as toggle buttons for assistive tech', () => {
    const toggleReviewBoxSelected = vi.fn();

    render(
      <ReviewImageContent
        reviewBoxes={[
          {
            id: 'face-1',
            x: 0.1,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'portrait_face',
            selected: false,
            source: 'has_image',
          },
        ]}
        visibleReviewBoxes={[
          {
            id: 'face-1',
            x: 0.1,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'portrait_face',
            selected: false,
            source: 'has_image',
          },
        ]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={0}
        totalReviewBoxCount={1}
        currentReviewVisionQuality={null}
        pipelines={[
          {
            mode: 'has_image',
            name: 'HaS Image',
            description: '',
            enabled: true,
            types: [
              { id: 'portrait_face', name: 'Portrait face', color: '#6366f1', enabled: true },
            ],
          },
        ]}
        onReviewPageChange={vi.fn()}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={toggleReviewBoxSelected}
      />,
    );

    const region = screen.getByRole('button', {
      name: /Portrait face.*20×10%.*Deselected/,
    });

    expect(region).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(region, { key: 'Enter' });
    expect(toggleReviewBoxSelected).toHaveBeenCalledWith('face-1');
  });

  it('distinguishes HaS Image, OCR+HaS, and fallback detector sources', () => {
    render(
      <ReviewImageContent
        reviewBoxes={[
          {
            id: 'face-1',
            x: 0.1,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'portrait_face',
            selected: true,
            source: 'has_image',
            source_detail: 'has_image',
          },
          {
            id: 'ocr-1',
            x: 0.3,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'printed_text',
            selected: true,
            source: 'ocr_has',
            source_detail: 'ocr_has',
          },
          {
            id: 'fallback-1',
            x: 0.5,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'official_seal',
            selected: true,
            source: 'has_image',
            source_detail: 'red_seal_fallback',
            warnings: ['fallback_detector'],
          },
        ]}
        visibleReviewBoxes={[
          {
            id: 'face-1',
            x: 0.1,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'portrait_face',
            selected: true,
            source: 'has_image',
            source_detail: 'has_image',
          },
          {
            id: 'ocr-1',
            x: 0.3,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'printed_text',
            selected: true,
            source: 'ocr_has',
            source_detail: 'ocr_has',
          },
          {
            id: 'fallback-1',
            x: 0.5,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'official_seal',
            selected: true,
            source: 'has_image',
            source_detail: 'red_seal_fallback',
            warnings: ['fallback_detector'],
          },
        ]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={3}
        totalReviewBoxCount={3}
        currentReviewVisionQuality={null}
        pipelines={[
          {
            mode: 'has_image',
            name: 'HaS Image',
            description: '',
            enabled: true,
            types: [
              { id: 'portrait_face', name: 'Portrait face', color: '#6366f1', enabled: true },
              { id: 'official_seal', name: 'Official seal', color: '#ef4444', enabled: true },
            ],
          },
          {
            mode: 'ocr_has',
            name: 'OCR+HaS',
            description: '',
            enabled: true,
            types: [{ id: 'printed_text', name: 'Printed text', color: '#0ea5e9', enabled: true }],
          },
        ]}
        onReviewPageChange={vi.fn()}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={vi.fn()}
      />,
    );

    expect(screen.getByTestId('bbox-source-face-1')).toHaveTextContent(
      'Source HaS Image model',
    );
    expect(screen.getByTestId('bbox-source-face-1')).toHaveAttribute(
      'title',
      'Detected by the HaS Image model pipeline.',
    );
    expect(screen.getByTestId('bbox-source-ocr-1')).toHaveTextContent('Source OCR+HaS');
    expect(screen.getByTestId('bbox-source-fallback-1')).toHaveTextContent(
      'Source Fallback detector: Red Seal',
    );
    expect(screen.getByTestId('bbox-source-fallback-1')).not.toHaveTextContent(
      'HaS Image model',
    );
  });

  it('summarizes current page source counts with accessible chip labels', () => {
    render(
      <ReviewImageContent
        reviewBoxes={[
          {
            id: 'face-1',
            x: 0.1,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'portrait_face',
            selected: true,
            source: 'has_image',
          },
          {
            id: 'ocr-1',
            x: 0.3,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'printed_text',
            selected: true,
            source: 'ocr_has',
          },
          {
            id: 'table-1',
            x: 0.5,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'printed_text',
            selected: true,
            source: 'ocr_has',
            source_detail: 'table_structure',
          },
          {
            id: 'fallback-1',
            x: 0.7,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'official_seal',
            selected: true,
            source: 'has_image',
            source_detail: 'red_seal_fallback',
            warnings: ['fallback_detector'],
          },
          {
            id: 'page-2-face',
            x: 0.1,
            y: 0.4,
            width: 0.2,
            height: 0.1,
            type: 'portrait_face',
            selected: true,
            source: 'has_image',
          },
        ]}
        visibleReviewBoxes={[
          {
            id: 'face-1',
            x: 0.1,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'portrait_face',
            selected: true,
            source: 'has_image',
          },
          {
            id: 'ocr-1',
            x: 0.3,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'printed_text',
            selected: true,
            source: 'ocr_has',
          },
          {
            id: 'table-1',
            x: 0.5,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'printed_text',
            selected: true,
            source: 'ocr_has',
            source_detail: 'table_structure',
          },
          {
            id: 'fallback-1',
            x: 0.7,
            y: 0.2,
            width: 0.2,
            height: 0.1,
            type: 'official_seal',
            selected: true,
            source: 'has_image',
            source_detail: 'red_seal_fallback',
            warnings: ['fallback_detector'],
          },
        ]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={2}
        selectedReviewBoxCount={4}
        totalReviewBoxCount={5}
        currentReviewVisionQuality={null}
        pipelines={[
          {
            mode: 'has_image',
            name: 'HaS Image',
            description: '',
            enabled: true,
            types: [
              { id: 'portrait_face', name: 'Portrait face', color: '#6366f1', enabled: true },
              { id: 'official_seal', name: 'Official seal', color: '#ef4444', enabled: true },
            ],
          },
          {
            mode: 'ocr_has',
            name: 'OCR+HaS',
            description: '',
            enabled: true,
            types: [{ id: 'printed_text', name: 'Printed text', color: '#0ea5e9', enabled: true }],
          },
        ]}
        onReviewPageChange={vi.fn()}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('status', { name: 'Current page source summary' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('review-image-source-summary-hasImage')).toHaveTextContent(
      'HaS Image model 1',
    );
    expect(screen.getByTestId('review-image-source-summary-fallback')).toHaveTextContent(
      'Fallback detector 1',
    );
    expect(screen.getByTestId('review-image-source-summary-ocrHas')).toHaveTextContent(
      'OCR+HaS 1',
    );
    expect(screen.getByTestId('review-image-source-summary-table')).toHaveTextContent('Table 1');
    expect(screen.getByTestId('review-image-source-summary-fallback')).toHaveAttribute(
      'title',
      'Fallback detector: 1 detection regions on the current page.',
    );
    expect(screen.getByTestId('review-image-source-summary-fallback')).toHaveAttribute(
      'aria-label',
      'Fallback detector: 1 detection regions on the current page.',
    );
    expect(screen.getByTestId('review-image-source-summary-fallback')).not.toHaveTextContent(
      'HaS Image model',
    );
  });

  it('labels edge and seam seal boxes for focused visual review', () => {
    render(
      <ReviewImageContent
        reviewBoxes={[
          {
            id: 'seam-seal-1',
            x: 0.945,
            y: 0.45,
            width: 0.04,
            height: 0.13,
            type: 'official_seal',
            selected: true,
            source: 'has_image',
            confidence: 0.9,
          },
        ]}
        visibleReviewBoxes={[
          {
            id: 'seam-seal-1',
            x: 0.945,
            y: 0.45,
            width: 0.04,
            height: 0.13,
            type: 'official_seal',
            selected: true,
            source: 'has_image',
            confidence: 0.9,
          },
        ]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={1}
        totalReviewBoxCount={1}
        currentReviewVisionQuality={null}
        pipelines={[
          {
            mode: 'has_image',
            name: 'HaS Image',
            description: '',
            enabled: true,
            types: [
              { id: 'official_seal', name: 'Official seal', color: '#ef4444', enabled: true },
            ],
          },
        ]}
        onReviewPageChange={vi.fn()}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={vi.fn()}
      />,
    );

    expect(screen.getByTestId('bbox-quality-seam-seal-1')).toHaveTextContent('Edge seal');
    expect(screen.getByTestId('bbox-quality-seam-seal-1')).toHaveTextContent('Seam seal');
  });

  it('keeps fallback, table, edge, and seam hint chips in a stable scan order', () => {
    render(
      <ReviewImageContent
        reviewBoxes={[
          {
            id: 'risk-seal-1',
            x: 0.01,
            y: 0.03,
            width: 0.04,
            height: 0.13,
            type: 'official_seal',
            selected: true,
            source: 'ocr_has',
            source_detail: 'table_structure_fallback',
            confidence: 0.42,
            warnings: ['fallback_detector'],
          },
        ]}
        visibleReviewBoxes={[
          {
            id: 'risk-seal-1',
            x: 0.01,
            y: 0.03,
            width: 0.04,
            height: 0.13,
            type: 'official_seal',
            selected: true,
            source: 'ocr_has',
            source_detail: 'table_structure_fallback',
            confidence: 0.42,
            warnings: ['fallback_detector'],
          },
        ]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={1}
        totalReviewBoxCount={1}
        currentReviewVisionQuality={null}
        pipelines={[
          {
            mode: 'has_image',
            name: 'HaS Image',
            description: '',
            enabled: true,
            types: [
              { id: 'official_seal', name: 'Official seal', color: '#ef4444', enabled: true },
            ],
          },
        ]}
        onReviewPageChange={vi.fn()}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={vi.fn()}
      />,
    );

    const chipText = Array.from(
      screen.getByTestId('bbox-quality-risk-seal-1').querySelectorAll('span'),
    ).map((chip) => chip.textContent);

    expect(chipText).toEqual([
      'Fallback detector',
      'Table inference',
      'Edge seal',
      'Seam seal',
      'Low confidence',
      'Warning',
    ]);
    expect(screen.getByTestId('bbox-quality-risk-seal-1-tableStructure')).toHaveAttribute(
      'title',
      'Detected from table structure inference; check table boundaries and merged cells.',
    );
    expect(screen.getByTestId('bbox-quality-risk-seal-1-edgeSeal')).toHaveAttribute(
      'aria-label',
      'Edge seal. Seal touches a page edge; check for clipping or partial coverage.',
    );
  });

  it('shows page-level pipeline status and warnings', () => {
    render(
      <ReviewImageContent
        reviewBoxes={[]}
        visibleReviewBoxes={[]}
        reviewOrigImageBlobUrl=""
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={0}
        totalReviewBoxCount={0}
        currentReviewVisionQuality={{
          warnings: ['has_image failed: unavailable'],
          pipeline_status: {
            ocr_has: { ran: true, failed: false, skipped: false, region_count: 2 },
            has_image: {
              ran: true,
              failed: true,
              skipped: false,
              region_count: 0,
              error: 'unavailable',
            },
          },
        }}
        pipelines={[]}
        onReviewPageChange={vi.fn()}
        setVisibleReviewBoxes={vi.fn()}
        handleReviewBoxesCommit={vi.fn()}
        toggleReviewBoxSelected={vi.fn()}
      />,
    );

    expect(screen.getByTestId('review-image-pipeline-quality')).toHaveTextContent('OCR+HaS ran 2');
    expect(screen.getByTestId('review-image-pipeline-quality')).toHaveTextContent(
      'HaS Image failed 0',
    );
    expect(screen.getByTestId('review-image-pipeline-quality')).toHaveTextContent(
      'has_image failed: unavailable',
    );
  });

  it('keeps ImageBBoxEditor type props stable across unrelated review state changes', () => {
    const reviewBoxes = [
      {
        id: 'face-1',
        x: 0.1,
        y: 0.2,
        width: 0.2,
        height: 0.1,
        type: 'portrait_face',
        selected: true,
        source: 'has_image' as const,
      },
    ];
    const pipelines: PipelineCfg[] = [
      {
        mode: 'has_image',
        name: 'HaS Image',
        description: '',
        enabled: true,
        types: [
          { id: 'portrait_face', name: 'Portrait face', color: '#6366f1', enabled: true },
          { id: 'disabled_type', name: 'Disabled type', color: '#64748b', enabled: false },
        ],
      },
    ];
    const setVisibleReviewBoxes = vi.fn();
    const handleReviewBoxesCommit = vi.fn();
    const toggleReviewBoxSelected = vi.fn();
    const onReviewPageChange = vi.fn();

    const { rerender } = render(
      <ReviewImageContent
        reviewBoxes={reviewBoxes}
        visibleReviewBoxes={reviewBoxes}
        reviewOrigImageBlobUrl="blob:page-1"
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={1}
        totalReviewBoxCount={1}
        currentReviewVisionQuality={null}
        pipelines={pipelines}
        onReviewPageChange={onReviewPageChange}
        setVisibleReviewBoxes={setVisibleReviewBoxes}
        handleReviewBoxesCommit={handleReviewBoxesCommit}
        toggleReviewBoxSelected={toggleReviewBoxSelected}
      />,
    );

    const firstProps = imageBBoxEditorRender.mock.calls[
      imageBBoxEditorRender.mock.calls.length - 1
    ]?.[0] as ComponentProps<typeof ImageBBoxEditor>;
    expect(firstProps.availableTypes).toEqual([
      { id: 'portrait_face', name: 'Portrait face', color: '#6366f1', enabled: true },
    ]);
    expect(firstProps.getTypeConfig('portrait_face')).toEqual({
      name: 'Portrait face',
      color: '#6366F1',
    });

    rerender(
      <ReviewImageContent
        reviewBoxes={reviewBoxes}
        visibleReviewBoxes={reviewBoxes}
        reviewOrigImageBlobUrl="blob:page-1"
        reviewImagePreviewSrc=""
        reviewImagePreviewLoading={false}
        reviewCurrentPage={1}
        reviewTotalPages={1}
        selectedReviewBoxCount={0}
        totalReviewBoxCount={1}
        currentReviewVisionQuality={null}
        pipelines={pipelines}
        onReviewPageChange={onReviewPageChange}
        setVisibleReviewBoxes={setVisibleReviewBoxes}
        handleReviewBoxesCommit={handleReviewBoxesCommit}
        toggleReviewBoxSelected={toggleReviewBoxSelected}
      />,
    );

    const nextProps = imageBBoxEditorRender.mock.calls[
      imageBBoxEditorRender.mock.calls.length - 1
    ]?.[0] as ComponentProps<typeof ImageBBoxEditor>;
    expect(nextProps.availableTypes).toBe(firstProps.availableTypes);
    expect(nextProps.getTypeConfig).toBe(firstProps.getTypeConfig);
  });
});
