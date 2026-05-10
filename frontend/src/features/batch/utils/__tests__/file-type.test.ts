// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { FileType } from '@/types';
import {
  isBatchFileAllowedForMode,
  isBatchImageMode,
  resolveBatchFileType,
  resolveBatchFileTypeFromName,
} from '../file-type';

describe('batch file type helpers', () => {
  it('keeps text-like uploads as text files', () => {
    expect(resolveBatchFileType('txt')).toBe(FileType.TXT);
    expect(resolveBatchFileType('md')).toBe(FileType.TXT);
    expect(resolveBatchFileTypeFromName('notes.txt')).toBe(FileType.TXT);
    expect(resolveBatchFileTypeFromName('brief.md')).toBe(FileType.TXT);
  });

  it('routes only image and scanned PDF files to image review mode', () => {
    expect(isBatchImageMode(resolveBatchFileType('image'))).toBe(true);
    expect(isBatchImageMode(resolveBatchFileType('pdf', true))).toBe(true);
    expect(isBatchImageMode(resolveBatchFileType('pdf', false))).toBe(false);
    expect(isBatchImageMode(resolveBatchFileType('txt'))).toBe(false);
  });

  it('filters obvious upload mismatches by batch mode while keeping PDFs flexible', () => {
    expect(isBatchFileAllowedForMode('text', FileType.DOCX)).toBe(true);
    expect(isBatchFileAllowedForMode('text', FileType.PDF)).toBe(true);
    expect(isBatchFileAllowedForMode('text', FileType.IMAGE)).toBe(false);
    expect(isBatchFileAllowedForMode('image', FileType.IMAGE)).toBe(true);
    expect(isBatchFileAllowedForMode('image', FileType.PDF)).toBe(true);
    expect(isBatchFileAllowedForMode('image', FileType.DOCX)).toBe(false);
    expect(isBatchFileAllowedForMode('smart', FileType.DOCX)).toBe(true);
    expect(isBatchFileAllowedForMode('smart', FileType.IMAGE)).toBe(true);
  });
});
