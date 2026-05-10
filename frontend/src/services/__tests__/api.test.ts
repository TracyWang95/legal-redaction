// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileApi, getBatchZipManifest } from '../api';

describe('fileApi.batchDownloadZip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches batch ZIP manifest summary from response headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['zip-bytes']), {
        status: 200,
        headers: {
          'X-Batch-Zip-Requested-Count': '3',
          'X-Batch-Zip-Included-Count': '2',
          'X-Batch-Zip-Skipped-Count': '1',
          'X-Batch-Zip-Redacted': 'true',
          'X-Batch-Zip-Skipped': JSON.stringify([
            { file_id: 'missing-file', reason: 'missing_redacted_output' },
          ]),
        },
      }),
    );

    const blob = await fileApi.batchDownloadZip(['ready-1', 'ready-2', 'missing-file'], true);

    expect(getBatchZipManifest(blob)).toEqual({
      requested_count: 3,
      included_count: 2,
      skipped_count: 1,
      redacted: true,
      skipped: [{ file_id: 'missing-file', reason: 'missing_redacted_output' }],
    });
  });

  it('sends the job id when a redacted batch export belongs to a job', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['zip-bytes']), { status: 200 }),
    );

    await fileApi.batchDownloadZip(['ready-1'], true, 'job-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/files/batch/download',
      expect.objectContaining({
        body: JSON.stringify({ file_ids: ['ready-1'], redacted: true, job_id: 'job-1' }),
      }),
    );
  });
});
