import type { RecognitionPreset } from '@/services/presetsApi';

export type PreviewEntityType = {
  id: string;
  name: string;
  color: string;
  regex_pattern?: string | null;
  use_llm?: boolean;
  enabled: boolean;
  order?: number;
  description?: string;
};

export type PreviewPipelineType = {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  order: number;
  description?: string;
};

export type PreviewPipeline = {
  mode: 'ocr_has' | 'has_image';
  name: string;
  description: string;
  enabled: boolean;
  types: PreviewPipelineType[];
};

type Translate = (key: string) => string;

export function buildPreviewEntityTypes(t: Translate): PreviewEntityType[] {
  return [
    {
      id: 'person_name',
      name: t('settings.preview.personName'),
      color: '#0f766e',
      regex_pattern: '[\\u4e00-\\u9fa5]{2,4}',
      enabled: true,
      order: 1,
    },
    {
      id: 'id_card',
      name: t('settings.preview.idCard'),
      color: '#0f766e',
      regex_pattern: '\\b\\d{17}[\\dXx]\\b',
      enabled: true,
      order: 2,
    },
    {
      id: 'bank_card',
      name: t('settings.preview.bankCard'),
      color: '#0f766e',
      regex_pattern: '\\b\\d{12,19}\\b',
      enabled: true,
      order: 3,
    },
    {
      id: 'company_name',
      name: t('settings.preview.companyName'),
      color: '#2563eb',
      use_llm: true,
      enabled: true,
      order: 4,
    },
    {
      id: 'project_name',
      name: t('settings.preview.projectName'),
      color: '#2563eb',
      use_llm: true,
      enabled: true,
      order: 5,
    },
    {
      id: 'address',
      name: t('settings.preview.address'),
      color: '#2563eb',
      use_llm: true,
      enabled: true,
      order: 6,
    },
  ];
}

export function buildPreviewPipelines(t: Translate): PreviewPipeline[] {
  return [
    {
      mode: 'ocr_has',
      name: t('settings.pipelineDisplayName.ocr'),
      description: t('settings.pipelineDescription.ocr'),
      enabled: true,
      types: [
        {
          id: 'seal_text',
          name: t('settings.preview.sealText'),
          color: '#2563eb',
          enabled: true,
          order: 1,
        },
        {
          id: 'handwritten_name',
          name: t('settings.preview.handwrittenName'),
          color: '#2563eb',
          enabled: true,
          order: 2,
        },
      ],
    },
    {
      mode: 'has_image',
      name: t('settings.pipelineDisplayName.image'),
      description: t('settings.pipelineDescription.image'),
      enabled: true,
      types: [
        {
          id: 'signature_region',
          name: t('settings.preview.signatureRegion'),
          color: '#dc2626',
          enabled: true,
          order: 1,
        },
        {
          id: 'portrait_face',
          name: t('settings.preview.portraitFace'),
          color: '#dc2626',
          enabled: true,
          order: 2,
        },
        {
          id: 'stamp_region',
          name: t('settings.preview.stampRegion'),
          color: '#dc2626',
          enabled: true,
          order: 3,
        },
      ],
    },
  ];
}

export function buildPreviewPresets(t: Translate): RecognitionPreset[] {
  const now = new Date().toISOString();

  return [
    {
      id: 'preview-contract-text',
      name: t('settings.preview.preset.contract'),
      kind: 'text',
      selectedEntityTypeIds: ['person_name', 'id_card', 'company_name', 'address'],
      ocrHasTypes: [],
      hasImageTypes: [],
      replacementMode: 'structured',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'preview-scan-vision',
      name: t('settings.preview.preset.scan'),
      kind: 'vision',
      selectedEntityTypeIds: [],
      ocrHasTypes: ['seal_text', 'handwritten_name'],
      hasImageTypes: ['signature_region', 'portrait_face', 'stamp_region'],
      replacementMode: 'structured',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'preview-mixed-full',
      name: t('settings.preview.preset.mixed'),
      kind: 'full',
      selectedEntityTypeIds: ['person_name', 'project_name', 'company_name'],
      ocrHasTypes: ['seal_text'],
      hasImageTypes: ['signature_region', 'stamp_region'],
      replacementMode: 'structured',
      created_at: now,
      updated_at: now,
    },
  ];
}
