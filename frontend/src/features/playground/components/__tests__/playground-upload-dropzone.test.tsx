// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test-utils';
import { PlaygroundUploadDropzone } from '../playground-upload-dropzone';

function makeDropzone(open = vi.fn()) {
  return {
    getRootProps: (props: Record<string, unknown>) => props,
    getInputProps: (props: Record<string, unknown>) => props,
    isDragActive: false,
    open,
  } as never;
}

describe('PlaygroundUploadDropzone', () => {
  it('does not open the file picker when service state blocks upload', () => {
    const open = vi.fn();
    render(
      <PlaygroundUploadDropzone
        dropzone={makeDropzone(open)}
        disabled
        disabledReason="Recognition service unavailable"
      />,
    );

    const dropzone = screen.getByTestId('playground-dropzone');
    fireEvent.click(dropzone);
    fireEvent.click(screen.getByRole('button', { name: 'Or click to choose a file' }));
    fireEvent.keyDown(dropzone, { key: 'Enter' });
    fireEvent.keyDown(dropzone, { key: ' ' });

    expect(dropzone).toHaveAttribute('aria-disabled', 'true');
    expect(dropzone).toHaveAttribute('tabindex', '-1');
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps the dropzone keyboard reachable when upload is available', () => {
    const open = vi.fn();
    render(<PlaygroundUploadDropzone dropzone={makeDropzone(open)} />);

    const dropzone = screen.getByTestId('playground-dropzone');

    expect(dropzone).toHaveAttribute('tabindex', '0');
    fireEvent.click(dropzone);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows an inline upload issue from rejected files', () => {
    render(
      <PlaygroundUploadDropzone
        dropzone={makeDropzone()}
        uploadIssue="demo.exe is not supported"
      />,
    );

    expect(screen.getByTestId('playground-upload-issue')).toHaveTextContent(
      'demo.exe is not supported',
    );
  });

  it('normalizes the file-type separator instead of rendering mojibake text', () => {
    const { container } = render(<PlaygroundUploadDropzone dropzone={makeDropzone()} />);

    expect(container).toHaveTextContent('Documents');
    expect(container).toHaveTextContent('PDFs');
    expect(container).toHaveTextContent('scans');
    expect(container).toHaveTextContent('images');
    expect(container).toHaveTextContent('\u00b7');
    expect(container).not.toHaveTextContent('路');
  });
});
