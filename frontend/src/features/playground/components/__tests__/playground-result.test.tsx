// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test-utils';

import { PlaygroundResult } from '../playground-result';

describe('PlaygroundResult', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses local result queries when jumping from a mapping row to text marks', () => {
    const { container } = render(
      <PlaygroundResult
        fileInfo={{
          file_id: 'file-1',
          filename: 'contract.txt',
          file_size: 100,
          file_type: 'txt',
        }}
        content="Alice signed with Alice."
        entities={[
          {
            id: 'e1',
            text: 'Alice',
            type: 'PERSON',
            start: 0,
            end: 5,
            selected: true,
            source: 'regex',
          },
        ]}
        entityMap={{ Alice: '<PERSON[001].name>' }}
        redactedCount={1}
        redactionReport={null}
        reportOpen={false}
        setReportOpen={vi.fn()}
        versionHistory={[]}
        versionHistoryOpen={false}
        setVersionHistoryOpen={vi.fn()}
        isImageMode={false}
        imageUrl=""
        currentPage={1}
        totalPages={1}
        onPageChange={vi.fn()}
        visibleBoxes={[]}
        visionTypes={[]}
        getVisionTypeConfig={() => ({ name: 'Custom', color: '#6366f1' })}
        onBackToEdit={vi.fn()}
        onReset={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    const globalQuerySpy = vi.spyOn(document, 'querySelectorAll');

    fireEvent.click(screen.getByTestId('playground-mapping-0'));

    expect(globalQuerySpy).not.toHaveBeenCalled();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(container.querySelector('.result-mark-orig.result-mark-active')).toHaveTextContent(
      'Alice',
    );
    expect(screen.getByTestId('playground-mapping-0')).toHaveTextContent('2x');
  });

  it('does not expose image download until the redacted preview is visible', () => {
    const { rerender } = render(
      <PlaygroundResult
        fileInfo={{
          file_id: 'image-1',
          filename: 'scan.png',
          file_size: 100,
          file_type: 'image',
        }}
        content=""
        entities={[]}
        entityMap={{}}
        redactedCount={1}
        redactionReport={null}
        reportOpen={false}
        setReportOpen={vi.fn()}
        versionHistory={[]}
        versionHistoryOpen={false}
        setVersionHistoryOpen={vi.fn()}
        isImageMode
        imageUrl="blob:original"
        redactedImageUrl=""
        currentPage={1}
        totalPages={1}
        onPageChange={vi.fn()}
        visibleBoxes={[]}
        visionTypes={[]}
        getVisionTypeConfig={() => ({ name: 'Custom', color: '#6366f1' })}
        onBackToEdit={vi.fn()}
        onReset={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('playground-download')).not.toBeInTheDocument();
    expect(screen.getAllByText('Preparing redacted preview...').length).toBeGreaterThan(0);

    rerender(
      <PlaygroundResult
        fileInfo={{
          file_id: 'image-1',
          filename: 'scan.png',
          file_size: 100,
          file_type: 'image',
        }}
        content=""
        entities={[]}
        entityMap={{}}
        redactedCount={1}
        redactionReport={null}
        reportOpen={false}
        setReportOpen={vi.fn()}
        versionHistory={[]}
        versionHistoryOpen={false}
        setVersionHistoryOpen={vi.fn()}
        isImageMode
        imageUrl="blob:original"
        redactedImageUrl="blob:redacted"
        currentPage={1}
        totalPages={1}
        onPageChange={vi.fn()}
        visibleBoxes={[]}
        visionTypes={[]}
        getVisionTypeConfig={() => ({ name: 'Custom', color: '#6366f1' })}
        onBackToEdit={vi.fn()}
        onReset={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByTestId('playground-download')).toBeInTheDocument();
  });
});
