// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { keepPreviousData } from '@tanstack/react-query';
import { QUERY_GC_TIME_MS, QUERY_STALE_TIME_MS } from '@/constants/timing';
import { queryClient } from '../query-client';

describe('queryClient defaults', () => {
  it('keeps inactive data and uses previous query data as a placeholder', () => {
    const queries = queryClient.getDefaultOptions().queries;
    expect(queries?.staleTime).toBe(QUERY_STALE_TIME_MS);
    expect(queries?.gcTime).toBe(QUERY_GC_TIME_MS);
    expect(queries?.placeholderData).toBe(keepPreviousData);
  });
});
