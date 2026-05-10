// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { normalizeHealthPayload } from '../use-service-health';

describe('normalizeHealthPayload', () => {
  it('treats reachable busy model services as online', () => {
    const health = normalizeHealthPayload({
      all_online: false,
      gpu_memory: { used_mb: 15_974, total_mb: 16_384 },
      services: {
        paddle_ocr: { name: 'PaddleOCR', status: 'online' },
        has_ner: { name: 'HaS Text', status: 'busy', detail: { runtime_mode: 'unknown' } },
        has_image: { name: 'HaS Image', status: 'online' },
      },
    });

    expect(health.all_online).toBe(true);
    expect(health.services.has_ner.status).toBe('online');
    expect(health.services.has_ner.detail).toEqual({ runtime_mode: 'unknown' });
    expect(health.gpu_memory).toEqual({ used_mb: 15_974, total_mb: 16_384 });
  });

  it('preserves truly unreachable service states', () => {
    const health = normalizeHealthPayload({
      all_online: true,
      services: {
        paddle_ocr: { name: 'PaddleOCR', status: 'offline' },
        has_ner: { name: 'HaS Text', status: 'online' },
        has_image: { name: 'HaS Image', status: 'degraded' },
      },
    });

    expect(health.all_online).toBe(false);
    expect(health.services.paddle_ocr.status).toBe('offline');
    expect(health.services.has_image.status).toBe('degraded');
  });

  it('preserves only explicit runtime modes from service detail', () => {
    const health = normalizeHealthPayload({
      services: {
        paddle_ocr: { name: 'PaddleOCR', status: 'online' },
        has_ner: { name: 'HaS Text', status: 'online', detail: { runtime_mode: 'gpu' } },
        has_image: { name: 'HaS Image', status: 'online', detail: { runtime_mode: 'cuda' } },
      },
    });

    expect(health.services.has_ner.detail).toEqual({ runtime_mode: 'gpu' });
    expect(health.services.has_image.detail).toBeUndefined();
  });

  it('preserves GPU contract fields used by service health display', () => {
    const health = normalizeHealthPayload({
      services: {
        paddle_ocr: {
          name: 'PaddleOCR',
          status: 'online',
          detail: {
            runtime: 'paddleocr',
            runtime_mode: 'gpu',
            gpu_available: true,
            device: 'gpu:0',
            gpu_only_mode: true,
            cpu_fallback_risk: false,
          },
        },
        has_ner: {
          name: 'HaS Text',
          status: 'degraded',
          detail: {
            runtime: 'llama.cpp server',
            runtime_mode: 'cpu',
            gpu_only_mode: false,
            cpu_fallback_risk: true,
          },
        },
        has_image: { name: 'HaS Image', status: 'online' },
      },
    });

    expect(health.services.paddle_ocr.detail).toEqual({
      runtime: 'paddleocr',
      runtime_mode: 'gpu',
      gpu_available: true,
      device: 'gpu:0',
      gpu_only_mode: true,
      cpu_fallback_risk: false,
    });
    expect(health.services.has_ner.detail).toEqual({
      runtime: 'llama.cpp server',
      runtime_mode: 'cpu',
      gpu_only_mode: false,
      cpu_fallback_risk: true,
    });
  });
});
