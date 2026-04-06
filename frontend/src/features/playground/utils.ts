
import { authFetch } from '@/services/api-client';
import { getSelectionMarkStyle, getSelectionToneClasses, type SelectionTone } from '@/ui/selectionPalette';
import type { Entity, BoundingBox } from './types';

// Re-export from shared module so existing `import { clampPopoverInCanvas } from './utils'` still works.
export { clampPopoverInCanvas } from '@/utils/domSelection';

export async function safeJson<T = any>(res: Response): Promise<T> {
  try {
    return await res.json();
  } catch {
    throw new Error('服务端返回了非 JSON 响应');
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
  const name = sampleEntity?.text || '张三';
  switch (mode) {
    case 'smart':
      return `${name} → [当事人一]`;
    case 'mask':
      return `${name} → ${name[0]}${'*'.repeat(Math.max(name.length - 1, 1))}`;
    case 'structured':
      return `${name} → <人物[001].个人.姓名>`;
    default:
      return '';
  }
}

export async function authBlobUrl(url: string, mime?: string): Promise<string> {
  const token = localStorage.getItem('auth_token');
  if (!token) return url;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`加载文件失败: ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const blob = mime ? new Blob([buf], { type: mime }) : new Blob([buf]);
  return URL.createObjectURL(blob);
}

/** Vision detection timeout */
export const VISION_FETCH_TIMEOUT_MS = 400_000;

export async function runVisionDetection(
  fileId: string,
  ocrHasTypes: string[],
  hasImageTypes: string[]
): Promise<{ boxes: BoundingBox[]; resultImage?: string }> {
  if (import.meta.env.DEV) {
    console.log('[Vision] 发送识别请求:', { ocrHasTypes, hasImageTypes });
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), VISION_FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await authFetch(`/api/v1/redaction/${fileId}/vision?page=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selected_ocr_has_types: ocrHasTypes,
        selected_has_image_types: hasImageTypes,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(
        '图像识别超时（超过 3 分钟）。若 Paddle 在 CPU 上跑会很慢，可换更小图片或安装 paddle GPU 版加速。'
      );
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error('图像识别失败');
  }

  const data = await safeJson(res);
  const boxes = (data.bounding_boxes || []).map((b: Record<string, unknown>, idx: number) => ({
    ...b,
    id: b.id || `bbox_${idx}`,
    selected: true,
  }));
  return { boxes, resultImage: data.result_image };
}

/** Compute entity type statistics */
export function computeEntityStats(entities: Entity[]): Record<string, { total: number; selected: number }> {
  const stats: Record<string, { total: number; selected: number }> = {};
  entities.forEach(e => {
    if (!stats[e.type]) stats[e.type] = { total: 0, selected: 0 };
    stats[e.type].total++;
    if (e.selected) stats[e.type].selected++;
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
