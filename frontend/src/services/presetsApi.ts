/**
 * 识别配置预设 API（与后端 /api/v1/presets 对齐）
 */
import { get, post, put, del } from './api-client';

export type ReplacementMode = 'structured' | 'smart' | 'mask';

/** text=仅文本；vision=仅图像视觉链；full=组合（旧数据默认） */
export type PresetKind = 'text' | 'vision' | 'full';

export interface RecognitionPreset {
  id: string;
  name: string;
  /** 缺省视为 full（旧数据） */
  kind?: PresetKind;
  selectedEntityTypeIds: string[];
  ocrHasTypes: string[];
  hasImageTypes: string[];
  replacementMode: ReplacementMode;
  created_at: string;
  updated_at: string;
}

export interface PresetPayload {
  name: string;
  kind: PresetKind;
  selectedEntityTypeIds: string[];
  ocrHasTypes: string[];
  hasImageTypes: string[];
  replacementMode: ReplacementMode;
}

/** 该预设是否包含可应用的文本链配置 */
export function presetAppliesText(p: RecognitionPreset): boolean {
  const k = p.kind ?? 'full';
  return k === 'text' || k === 'full';
}

/** 该预设是否包含可应用的视觉链配置 */
export function presetAppliesVision(p: RecognitionPreset): boolean {
  const k = p.kind ?? 'full';
  return k === 'vision' || k === 'full';
}

export async function fetchPresets(): Promise<RecognitionPreset[]> {
  const data = await get<any>('/presets');
  // 兼容分页响应 { presets: [...] } 和旧的直接数组格式
  return Array.isArray(data) ? data : Array.isArray(data?.presets) ? data.presets : [];
}

export async function createPreset(body: PresetPayload): Promise<RecognitionPreset> {
  return post<RecognitionPreset>('/presets', body);
}

export async function updatePreset(id: string, patch: Partial<PresetPayload>): Promise<RecognitionPreset> {
  return put<RecognitionPreset>(`/presets/${id}`, patch);
}

export async function deletePreset(id: string): Promise<void> {
  return del(`/presets/${id}`);
}
