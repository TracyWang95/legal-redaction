import { t } from '@/i18n';
import type { FileListItem } from '@/types';

export type Step = 1 | 2 | 3 | 4 | 5;

export interface PipelineCfg {
  mode: 'ocr_has' | 'has_image';
  name: string;
  description: string;
  enabled: boolean;
  types: { id: string; name: string; color: string; enabled: boolean; order?: number }[];
}

export interface TextEntityType {
  id: string;
  name: string;
  color: string;
  regex_pattern?: string | null;
  use_llm?: boolean;
  order?: number;
}

export interface BatchRow extends FileListItem {
  analyzeStatus:
    | 'pending'
    | 'parsing'
    | 'analyzing'
    | 'awaiting_review'
    | 'review_approved'
    | 'redacting'
    | 'completed'
    | 'failed';
  analyzeError?: string;
  isImageMode?: boolean;
  reviewConfirmed?: boolean;
}

export type ReviewEntity = {
  id: string;
  text: string;
  type: string;
  start: number;
  end: number;
  selected: boolean;
  page?: number;
  confidence?: number;
  source?: string;
  coref_id?: string | null;
  replacement?: string;
};

export const RECOGNITION_DONE_STATUSES: ReadonlySet<BatchRow['analyzeStatus']> = new Set([
  'awaiting_review',
  'review_approved',
  'redacting',
  'completed',
]);

export const ANALYZE_STATUS_LABEL: Record<BatchRow['analyzeStatus'], string> = {
  pending: '等待中',
  parsing: '解析中',
  analyzing: '识别中',
  awaiting_review: '待审阅',
  review_approved: '待脱敏',
  redacting: '脱敏中',
  completed: '已完成',
  failed: '失败',
};

export const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: t('batchWizard.step1') },
  { n: 2, label: t('batchWizard.step2') },
  { n: 3, label: t('batchWizard.step3') },
  { n: 4, label: t('batchWizard.step4') },
  { n: 5, label: t('batchWizard.step5') },
];
