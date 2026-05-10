// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { ACCEPTED_UPLOAD_FILE_TYPES } from '../fileUploadAccept';

describe('ACCEPTED_UPLOAD_FILE_TYPES', () => {
  it('covers the upload families supported by the backend', () => {
    const extensions = Object.values(ACCEPTED_UPLOAD_FILE_TYPES).flat();

    expect(extensions).toEqual(
      expect.arrayContaining([
        '.doc',
        '.docx',
        '.txt',
        '.md',
        '.html',
        '.pdf',
        '.jpg',
        '.png',
        '.webp',
        '.tif',
      ]),
    );
  });
});
