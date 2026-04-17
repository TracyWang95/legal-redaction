// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { t } from '@/i18n';
import { authFetch, VISION_TIMEOUT } from '@/services/api-client';
import {
  getSelectionMarkStyle,
  getSelectionToneClasses,
  type SelectionTone,
} from '@/ui/selectionPalette';
import type { BoundingBox, Entity, VisionDetectionResponse } from './types';

export { clampPopoverInCanvas } from '@/utils/domSelection';

export async function safeJson<T = unknown>(res: Response): Promise<T> {
  try {
    return await res.json();
  } catch {
    throw new Error('Non-JSON response from server');
  }
}

export function previewEntityMarkStyle(entity: Entity): React.CSSProperties {
  const tone = sourceToTone(entity.source);
  const base = getSelectionMarkStyle(tone);
  if (!entity.selected) {
    return { ...base, opacity: 0.5, filter: 'saturate(0.55)' };
  }
  return base;
}

export function previewEntityHoverRingClass(source: Entity['source']): string {
  return getSelectionToneClasses(sourceToTone(source)).hoverRing;
}

export function getModePreview(mode: string, sampleEntity?: Entity) {
  const name = sampleEntity?.text || t('editor.sampleName');
  switch (mode) {
    case 'smart':
      return `${name} -> [${t('editor.sampleSmart')}]`;
    case 'mask':
      return `${name} -> ${name[0]}${'*'.repeat(Math.max(name.length - 1, 1))}`;
    case 'structured':
      return `${name} -> <${t('editor.sampleStructured')}>`;
    default:
      return '';
  }
}

export async function authBlobUrl(url: string, mime?: string): Promise<string> {
  const res = await authFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load file: ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const blob = mime ? new Blob([buf], { type: mime }) : new Blob([buf]);
  return URL.createObjectURL(blob);
}

export const VISION_FETCH_TIMEOUT_MS = VISION_TIMEOUT;

export async function runVisionDetection(
  fileId: string,
  ocrHasTypes: string[],
  hasImageTypes: string[],
  externalSignal?: AbortSignal,
  page = 1,
): Promise<{ boxes: BoundingBox[]; resultImage?: string }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), VISION_FETCH_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      window.clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort);
  }

  let res: Response;
  try {
    res = await authFetch(`/api/v1/redaction/${fileId}/vision?page=${page}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selected_ocr_has_types: ocrHasTypes,
        selected_has_image_types: hasImageTypes,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (externalSignal?.aborted) throw error;
      throw new Error(t('error.visionTimeout'));
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }

  if (!res.ok) {
    throw new Error(t('error.visionDetectionFailed'));
  }

  const data = await safeJson<VisionDetectionResponse>(res);
  const boxes = (data.bounding_boxes || []).map(
    (box: Record<string, unknown>, idx: number) =>
      ({
        ...box,
        id: box.id || `bbox_${idx}`,
        selected: true,
      }) as BoundingBox,
  );
  return { boxes, resultImage: data.result_image };
}

export function computeEntityStats(
  entities: Entity[],
): Record<string, { total: number; selected: number }> {
  const stats: Record<string, { total: number; selected: number }> = {};
  entities.forEach((entity) => {
    if (!stats[entity.type]) stats[entity.type] = { total: 0, selected: 0 };
    stats[entity.type].total += 1;
    if (entity.selected) stats[entity.type].selected += 1;
  });
  return stats;
}

function sourceToTone(source: Entity['source']): SelectionTone {
  switch (source) {
    case 'regex':
      return 'regex';
    case 'llm':
      return 'semantic';
    case 'manual':
    case 'has':
    default:
      return 'visual';
  }
}
