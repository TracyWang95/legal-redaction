// 实体类型枚举
export enum EntityType {
  PERSON = 'PERSON',
  ORG = 'ORG',
  ID_CARD = 'ID_CARD',
  PHONE = 'PHONE',
  ADDRESS = 'ADDRESS',
  BANK_CARD = 'BANK_CARD',
  CASE_NUMBER = 'CASE_NUMBER',
  DATE = 'DATE',
  MONEY = 'MONEY',
  CUSTOM = 'CUSTOM',
}

// 文件类型枚举
export enum FileType {
  DOCX = 'docx',
  PDF = 'pdf',
  PDF_SCANNED = 'pdf_scanned',
  IMAGE = 'image',
}

// 替换模式枚举
export enum ReplacementMode {
  SMART = 'smart',
  MASK = 'mask',
  CUSTOM = 'custom',
  STRUCTURED = 'structured',
}

// 实体接口
export interface Entity {
  id: string;
  text: string;
  type: EntityType;
  start: number;
  end: number;
  page: number;
  confidence: number;
  replacement?: string;
  selected: boolean;
}

// 图片敏感区域边界框
export interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  type: EntityType;
  text?: string;
  selected: boolean;
}

// 文件信息
export interface FileInfo {
  file_id: string;
  filename: string;
  file_type: FileType;
  file_size: number;
  page_count: number;
  content?: string;
  pages?: string[];
  is_scanned?: boolean;
}

// 解析结果
export interface ParseResult {
  file_id: string;
  file_type: FileType;
  content: string;
  page_count: number;
  pages: string[];
  is_scanned: boolean;
}

// NER识别结果
export interface NERResult {
  file_id: string;
  entities: Entity[];
  entity_count: number;
  entity_summary: Record<string, number>;
}

// 视觉识别结果
export interface VisionResult {
  file_id: string;
  page: number;
  bounding_boxes: BoundingBox[];
}

// 脱敏配置
export interface RedactionConfig {
  replacement_mode: ReplacementMode;
  entity_types: EntityType[];
  custom_replacements: Record<string, string>;
}

// 脱敏请求
export interface RedactionRequest {
  file_id: string;
  entities: Entity[];
  bounding_boxes: BoundingBox[];
  config: RedactionConfig;
}

// 脱敏结果
export interface RedactionResult {
  file_id: string;
  output_file_id: string;
  redacted_count: number;
  entity_map: Record<string, string>;
  download_url: string;
}

// 对比数据
export interface CompareData {
  file_id: string;
  original_content: string;
  redacted_content: string;
  changes: Array<{
    original: string;
    replacement: string;
    count: number;
  }>;
}

// 实体类型配置
export interface EntityTypeConfig {
  value: EntityType;
  label: string;
  color: string;
}

// 替换模式配置
export interface ReplacementModeConfig {
  value: ReplacementMode;
  label: string;
  description: string;
}

// 应用状态
export type AppStage = 'upload' | 'preview' | 'edit' | 'compare';
