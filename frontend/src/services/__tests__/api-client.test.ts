// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { normalizeApiPrefix } from '../api-client';

describe('normalizeApiPrefix', () => {
  it('keeps the default same-origin API prefix for empty values', () => {
    expect(normalizeApiPrefix('')).toBe('/api/v1');
    expect(normalizeApiPrefix('   ')).toBe('/api/v1');
  });

  it('normalizes relative prefixes for same-origin deployments', () => {
    expect(normalizeApiPrefix('api/v1/')).toBe('/api/v1');
    expect(normalizeApiPrefix('/api/v1/')).toBe('/api/v1');
  });

  it('preserves absolute API origins for local dev without the Vite proxy', () => {
    expect(normalizeApiPrefix('http://127.0.0.1:8000/api/v1/')).toBe(
      'http://127.0.0.1:8000/api/v1',
    );
    expect(normalizeApiPrefix('https://example.test/api/v1/')).toBe(
      'https://example.test/api/v1',
    );
  });
});
