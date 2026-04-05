import type { BoundingBox as EditorBox } from '@/components/ImageBBoxEditor';
import type { RecognitionPreset } from '@/services/presetsApi';
import type { BatchWizardPersistedConfig, BatchWizardMode } from '@/services/batchPipeline';
import { FileType } from '@/types';
import type { BatchRow, PipelineCfg, ReviewEntity, Step, TextEntityType } from '../types';

export const PREVIEW_BATCH_JOB_ID = 'preview-smart-batch';

const previewNow = '2026-04-05T18:10:00+08:00';

const previewImageSvg = encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f8fafc" />
        <stop offset="100%" stop-color="#e5edf5" />
      </linearGradient>
    </defs>
    <rect width="1200" height="900" rx="32" fill="url(#bg)" />
    <rect x="80" y="90" width="1040" height="120" rx="24" fill="#ffffff" stroke="#dbe3eb" stroke-width="2" />
    <rect x="80" y="250" width="1040" height="150" rx="24" fill="#ffffff" stroke="#dbe3eb" stroke-width="2" />
    <rect x="80" y="440" width="1040" height="310" rx="28" fill="#ffffff" stroke="#dbe3eb" stroke-width="2" />
    <rect x="150" y="505" width="240" height="86" rx="18" fill="#111827" opacity="0.08" />
    <rect x="680" y="520" width="190" height="72" rx="16" fill="#111827" opacity="0.08" />
    <rect x="870" y="610" width="130" height="60" rx="16" fill="#111827" opacity="0.08" />
    <rect x="438" y="144" width="210" height="32" rx="10" fill="#0f766e" opacity="0.16" />
    <rect x="202" y="310" width="320" height="32" rx="10" fill="#b45309" opacity="0.16" />
    <rect x="618" y="320" width="276" height="32" rx="10" fill="#7c3aed" opacity="0.16" />
  </svg>
`);

const previewImageRedactedSvg = encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f8fafc" />
        <stop offset="100%" stop-color="#e5edf5" />
      </linearGradient>
      <pattern id="mosaic" width="14" height="14" patternUnits="userSpaceOnUse">
        <rect width="14" height="14" fill="#111827" opacity="0.24" />
        <rect width="7" height="7" fill="#111827" opacity="0.14" />
        <rect x="7" y="7" width="7" height="7" fill="#111827" opacity="0.08" />
      </pattern>
    </defs>
    <rect width="1200" height="900" rx="32" fill="url(#bg)" />
    <rect x="80" y="90" width="1040" height="120" rx="24" fill="#ffffff" stroke="#dbe3eb" stroke-width="2" />
    <rect x="80" y="250" width="1040" height="150" rx="24" fill="#ffffff" stroke="#dbe3eb" stroke-width="2" />
    <rect x="80" y="440" width="1040" height="310" rx="28" fill="#ffffff" stroke="#dbe3eb" stroke-width="2" />
    <rect x="150" y="505" width="240" height="86" rx="18" fill="url(#mosaic)" />
    <rect x="680" y="520" width="190" height="72" rx="16" fill="url(#mosaic)" />
    <rect x="870" y="610" width="130" height="60" rx="16" fill="url(#mosaic)" />
  </svg>
`);

const previewRowsBase: BatchRow[] = [
  {
    file_id: 'preview-file-contract',
    original_filename: '合同审阅-样例-A.docx',
    file_size: 184320,
    file_type: FileType.DOCX,
    created_at: previewNow,
    has_output: false,
    entity_count: 4,
    analyzeStatus: 'pending',
    isImageMode: false,
    reviewConfirmed: false,
  },
  {
    file_id: 'preview-file-case',
    original_filename: '案件材料-样例-B.pdf',
    file_size: 912384,
    file_type: FileType.PDF,
    created_at: previewNow,
    has_output: false,
    entity_count: 3,
    analyzeStatus: 'pending',
    isImageMode: false,
    reviewConfirmed: false,
  },
  {
    file_id: 'preview-file-scan',
    original_filename: '扫描签章-样例-C.pdf',
    file_size: 1264032,
    file_type: FileType.PDF_SCANNED,
    created_at: previewNow,
    has_output: false,
    entity_count: 3,
    analyzeStatus: 'pending',
    isImageMode: true,
    reviewConfirmed: false,
  },
  {
    file_id: 'preview-file-photo',
    original_filename: '现场照片-样例-D.png',
    file_size: 742112,
    file_type: FileType.IMAGE,
    created_at: previewNow,
    has_output: false,
    entity_count: 2,
    analyzeStatus: 'pending',
    isImageMode: true,
    reviewConfirmed: false,
  },
];

export const previewTextTypes: TextEntityType[] = [
  { id: 'PERSON', name: '当事人姓名', color: '#0f766e', use_llm: true, order: 1 },
  { id: 'ID_CARD', name: '身份证号', color: '#2563eb', regex_pattern: '\\b\\d{17}[\\dXx]\\b', order: 2 },
  { id: 'BANK_CARD', name: '银行卡号', color: '#b45309', regex_pattern: '\\b\\d{12,19}\\b', order: 3 },
  { id: 'CASE_NUMBER', name: '案件编号', color: '#7c3aed', use_llm: true, order: 4 },
];

export const previewPipelines: PipelineCfg[] = [
  {
    mode: 'ocr_has',
    name: 'OCR + HaS',
    description: '文字检测通道',
    enabled: true,
    types: [
      { id: 'seal_text', name: '公章文字', color: '#0f766e', enabled: true, order: 1 },
      { id: 'handwritten_name', name: '手写姓名', color: '#0ea5e9', enabled: true, order: 2 },
    ],
  },
  {
    mode: 'has_image',
    name: 'HaS Image',
    description: '视觉特征通道',
    enabled: true,
    types: [
      { id: 'signature', name: '签名区域', color: '#7c3aed', enabled: true, order: 1 },
      { id: 'stamp', name: '印章区域', color: '#b45309', enabled: true, order: 2 },
      { id: 'face', name: '人脸区域', color: '#dc2626', enabled: true, order: 3 },
    ],
  },
];

export const previewPresets: RecognitionPreset[] = [
  {
    id: 'preview-text-preset',
    name: '合同文本预设',
    kind: 'text',
    selectedEntityTypeIds: ['PERSON', 'ID_CARD', 'CASE_NUMBER'],
    ocrHasTypes: [],
    hasImageTypes: [],
    replacementMode: 'structured',
    created_at: previewNow,
    updated_at: previewNow,
  },
  {
    id: 'preview-vision-preset',
    name: '扫描图像预设',
    kind: 'vision',
    selectedEntityTypeIds: [],
    ocrHasTypes: ['seal_text', 'handwritten_name'],
    hasImageTypes: ['signature', 'stamp'],
    replacementMode: 'structured',
    created_at: previewNow,
    updated_at: previewNow,
  },
];

export const previewBatchConfig: BatchWizardPersistedConfig = {
  selectedEntityTypeIds: ['PERSON', 'ID_CARD', 'CASE_NUMBER'],
  ocrHasTypes: ['seal_text', 'handwritten_name'],
  hasImageTypes: ['signature', 'stamp'],
  replacementMode: 'structured',
  imageRedactionMethod: 'mosaic',
  imageRedactionStrength: 25,
  imageFillColor: '#000000',
  presetTextId: 'preview-text-preset',
  presetVisionId: 'preview-vision-preset',
  presetId: null,
  executionDefault: 'queue',
};

const previewTextEntities: ReviewEntity[] = [
  {
    id: 'preview-entity-person',
    text: '张宁',
    type: 'PERSON',
    start: 7,
    end: 9,
    selected: true,
    page: 1,
    confidence: 0.98,
    source: 'llm',
  },
  {
    id: 'preview-entity-id',
    text: '310101199201013422',
    type: 'ID_CARD',
    start: 19,
    end: 37,
    selected: true,
    page: 1,
    confidence: 0.99,
    source: 'regex',
  },
  {
    id: 'preview-entity-case',
    text: '沪民终字第2026-083号',
    type: 'CASE_NUMBER',
    start: 47,
    end: 62,
    selected: true,
    page: 1,
    confidence: 0.95,
    source: 'llm',
  },
];

const previewCaseEntities: ReviewEntity[] = [
  {
    id: 'preview-entity-bank',
    text: '6214850200123456789',
    type: 'BANK_CARD',
    start: 28,
    end: 47,
    selected: true,
    page: 1,
    confidence: 0.97,
    source: 'regex',
  },
  {
    id: 'preview-entity-person-2',
    text: '王敏',
    type: 'PERSON',
    start: 58,
    end: 60,
    selected: true,
    page: 1,
    confidence: 0.92,
    source: 'llm',
  },
];

const previewImageBoxes: EditorBox[] = [
  {
    id: 'preview-box-signature',
    x: 0.125,
    y: 0.46,
    width: 0.2,
    height: 0.095,
    type: 'signature',
    text: '签名',
    selected: true,
    source: 'has_image',
    confidence: 0.96,
  },
  {
    id: 'preview-box-stamp',
    x: 0.565,
    y: 0.48,
    width: 0.16,
    height: 0.08,
    type: 'stamp',
    text: '公章',
    selected: true,
    source: 'has_image',
    confidence: 0.94,
  },
  {
    id: 'preview-box-face',
    x: 0.725,
    y: 0.6,
    width: 0.11,
    height: 0.07,
    type: 'face',
    text: '头像',
    selected: false,
    source: 'has_image',
    confidence: 0.9,
  },
];

export function buildPreviewBatchRoute(mode: BatchWizardMode = 'smart', step: Step = 1): string {
  return `/batch/${mode}?preview=1&jobId=${encodeURIComponent(PREVIEW_BATCH_JOB_ID)}&step=${step}`;
}

export function isPreviewBatchJobId(jobId: string | null | undefined): boolean {
  return jobId === PREVIEW_BATCH_JOB_ID;
}

export function buildPreviewBatchRows(step: Step): BatchRow[] {
  if (step >= 5) {
    return previewRowsBase.map((row) => ({
      ...row,
      analyzeStatus: 'completed',
      reviewConfirmed: true,
      has_output: true,
    }));
  }

  if (step >= 4) {
    return previewRowsBase.map((row, index) => ({
      ...row,
      analyzeStatus: index === 0 ? 'completed' : 'awaiting_review',
      reviewConfirmed: index === 0,
      has_output: index === 0,
    }));
  }

  if (step >= 3) {
    return previewRowsBase.map((row, index) => ({
      ...row,
      analyzeStatus: index === 3 ? 'analyzing' : 'awaiting_review',
      reviewConfirmed: false,
      has_output: false,
    }));
  }

  return previewRowsBase.map((row) => ({ ...row }));
}

export function getPreviewReviewPayload(fileId: string): {
  content: string;
  entities: ReviewEntity[];
  boxes: EditorBox[];
  imageSrc: string;
  previewSrc: string;
} {
  if (fileId === 'preview-file-contract') {
    return {
      content: '合同主体张宁，身份证号为310101199201013422，关联案件编号沪民终字第2026-083号，需要在导出前统一处理。',
      entities: previewTextEntities,
      boxes: [],
      imageSrc: '',
      previewSrc: '',
    };
  }

  if (fileId === 'preview-file-case') {
    return {
      content: '回款账户6214850200123456789已写入附件，复核人员王敏需要确认最终脱敏结果。',
      entities: previewCaseEntities,
      boxes: [],
      imageSrc: '',
      previewSrc: '',
    };
  }

  return {
    content: '',
    entities: [],
    boxes: previewImageBoxes,
    imageSrc: `data:image/svg+xml;charset=UTF-8,${previewImageSvg}`,
    previewSrc: `data:image/svg+xml;charset=UTF-8,${previewImageRedactedSvg}`,
  };
}

export function buildPreviewDownloadBlob(redacted: boolean, rows: BatchRow[]): Blob {
  const lines = [
    redacted ? '批量脱敏预览导出' : '批量原件预览导出',
    '',
    ...rows.map((row) => `- ${row.original_filename}`),
  ];
  return new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
}
