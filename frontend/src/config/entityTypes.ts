// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { t } from '@/i18n';

export interface EntityTypeConfig {
  id: string;
  name: string;
  description?: string;
}

export interface EntityGroup {
  id: string;
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
  types: EntityTypeConfig[];
}

export const ENTITY_PALETTE = {
  personal: { color: '#9333EA', bgColor: '#FAF5FF', textColor: '#6B21A8' },
  org: { color: '#0284C7', bgColor: '#F0F9FF', textColor: '#075985' },
  contact: { color: '#059669', bgColor: '#ECFDF5', textColor: '#065F46' },
  time: { color: '#6366F1', bgColor: '#EEF2FF', textColor: '#4338CA' },
} as const;

export const ENTITY_FALLBACK_STYLE = {
  color: '#0284C7',
  bgColor: '#F0F9FF',
  textColor: '#075985',
} as const;

const ENTITY_TYPE_ALIASES: Record<string, string> = {
  DRIVER_LICENSE: 'ID_CARD',
  MILITARY_ID: 'ID_CARD',
  QQ_WECHAT_ID: 'USERNAME_PASSWORD',
  PAYMENT_ACCOUNT: 'BANK_ACCOUNT',
  MONEY: 'AMOUNT',
  MAC_ADDRESS: 'DEVICE_ID',
  URL: 'URL_WEBSITE',
  WEBSITE: 'URL_WEBSITE',
  LINK: 'URL_WEBSITE',
  DATETIME: 'DATE',
  DATE_TIME: 'DATE',
  BIRTH_DATE: 'DATE',
  RACE_ETHNICITY: 'ETHNICITY',
  COMPANY: 'COMPANY_NAME',
  CONTRACT_ID: 'CASE_NUMBER',
  CONTRACT_NO: 'CASE_NUMBER',
  CONTRACT_NUMBER: 'CASE_NUMBER',
  MEDICAL_RECORD: 'HEALTH_INFO',
  LEGAL_PARTY: 'PERSON',
  LAWYER: 'PERSON',
  JUDGE: 'PERSON',
  WITNESS: 'PERSON',
  seal: 'official_seal',
  stamp: 'official_seal',
};

export function normalizeEntityTypeId(typeId: string): string {
  const trimmed = typeId.trim();
  return ENTITY_TYPE_ALIASES[trimmed] ?? trimmed;
}

function defineTypes(
  entries: Array<[id: string, name: string, description?: string]>,
): EntityTypeConfig[] {
  return entries.map(([id, name, description]) => ({ id, name, description }));
}

export const ENTITY_GROUPS: EntityGroup[] = [
  {
    id: 'identity',
    label: '身份',
    ...ENTITY_PALETTE.personal,
    types: defineTypes([
      ['PERSON', '姓名'],
      ['ID_CARD', '身份证号'],
      ['PASSPORT', '护照号'],
      ['SOCIAL_SECURITY', '社保号'],
      ['BIOMETRIC', '生物特征'],
    ]),
  },
  {
    id: 'contact',
    label: '联系',
    ...ENTITY_PALETTE.contact,
    types: defineTypes([
      ['PHONE', '电话'],
      ['EMAIL', '邮箱'],
      ['ADDRESS', '地址'],
      ['GPS_LOCATION', '位置'],
    ]),
  },
  {
    id: 'account',
    label: '账号',
    ...ENTITY_PALETTE.org,
    types: defineTypes([
      ['USERNAME_PASSWORD', '登录账号'],
      ['AUTH_SECRET', '密码'],
      ['BANK_CARD', '银行卡号'],
      ['BANK_ACCOUNT', '银行账号'],
    ]),
  },
  {
    id: 'network',
    label: '网络',
    ...ENTITY_PALETTE.contact,
    types: defineTypes([
      ['DEVICE_ID', '设备号'],
      ['IP_ADDRESS', 'IP地址'],
      ['URL_WEBSITE', '网址'],
    ]),
  },
  {
    id: 'business',
    label: '业务',
    ...ENTITY_PALETTE.time,
    types: defineTypes([
      ['ORG', '单位'],
      ['DATE', '日期'],
      ['TIME', '时间'],
      ['AMOUNT', '金额'],
      ['COMPANY_NAME', '公司名称'],
      ['INSTITUTION_NAME', '机构名称'],
      ['GOVERNMENT_AGENCY', '机关单位'],
      ['WORK_UNIT', '工作单位'],
      ['DEPARTMENT_NAME', '部门名称'],
      ['PROJECT_NAME', '项目名称'],
      ['CREDIT_CODE', '统一社会信用代码'],
      ['TAX_ID', '税号'],
      ['CASE_NUMBER', '编号'],
      ['LICENSE_PLATE', '车牌号'],
      ['VIN', '车架号'],
    ]),
  },
  {
    id: 'profile',
    label: '画像',
    ...ENTITY_PALETTE.personal,
    types: defineTypes([
      ['AGE', '年龄'],
      ['GENDER', '性别'],
      ['NATIONALITY', '国籍'],
      ['ETHNICITY', '民族'],
      ['MARITAL_STATUS', '婚姻状态'],
      ['HEALTH_INFO', '健康信息'],
      ['RELIGION', '宗教信仰'],
      ['POLITICAL', '政治面貌'],
      ['SEXUAL_ORIENTATION', '性取向'],
      ['CRIMINAL_RECORD', '法律记录'],
    ]),
  },
  {
    id: 'visual',
    label: '视觉元素',
    ...ENTITY_PALETTE.time,
    types: defineTypes([
      ['SEAL', '印章'],
      ['SIGNATURE', '签名'],
      ['FINGERPRINT', '指纹'],
      ['PHOTO', '照片'],
      ['QR_CODE', '二维码'],
      ['HANDWRITING', '手写内容'],
    ]),
  },
];

export const ALL_ENTITY_TYPES: EntityTypeConfig[] = ENTITY_GROUPS.flatMap((group) => group.types);

const HAS_IMAGE_TYPE_IDS = new Set([
  'face',
  'fingerprint',
  'palmprint',
  'id_card',
  'hk_macau_permit',
  'passport',
  'employee_badge',
  'license_plate',
  'bank_card',
  'physical_key',
  'receipt',
  'shipping_label',
  'official_seal',
  'whiteboard',
  'sticky_note',
  'mobile_screen',
  'monitor_screen',
  'medical_wristband',
  'qr_code',
  'barcode',
  'paper',
]);

function prettifyTypeId(typeId: string) {
  return typeId
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getEntityGroup(typeId: string): EntityGroup | undefined {
  const canonicalTypeId = normalizeEntityTypeId(typeId);
  if (HAS_IMAGE_TYPE_IDS.has(canonicalTypeId)) {
    return ENTITY_GROUPS.find((group) => group.id === 'visual');
  }
  return ENTITY_GROUPS.find((group) => group.types.some((type) => type.id === canonicalTypeId));
}

export function getEntityGroupLabel(groupId: string): string {
  const key = `entityGroup.${groupId}`;
  const translated = t(key);
  if (translated !== key) return translated;

  const group = ENTITY_GROUPS.find((item) => item.id === groupId);
  return group?.label || groupId;
}

export function getEntityTypeConfig(typeId: string): EntityTypeConfig | undefined {
  const canonicalTypeId = normalizeEntityTypeId(typeId);
  return ALL_ENTITY_TYPES.find((type) => type.id === canonicalTypeId);
}

export function getEntityColor(typeId: string): string {
  const group = getEntityGroup(typeId);
  return group?.color ?? ENTITY_FALLBACK_STYLE.color;
}

export function getEntityBgColor(typeId: string): string {
  const group = getEntityGroup(typeId);
  return group?.bgColor ?? ENTITY_FALLBACK_STYLE.bgColor;
}

export function getEntityTextColor(typeId: string): string {
  const group = getEntityGroup(typeId);
  return group?.textColor ?? ENTITY_FALLBACK_STYLE.textColor;
}

export function getEntityTypeName(typeId: string): string {
  const canonicalTypeId = normalizeEntityTypeId(typeId);
  const key = `entity.${canonicalTypeId}`;
  const translated = t(key);
  if (translated !== key) return translated;

  const config = getEntityTypeConfig(canonicalTypeId);
  return config?.name || prettifyTypeId(canonicalTypeId);
}

export function getEntityRiskConfig(typeId: string) {
  const group = getEntityGroup(typeId);
  return {
    color: group?.color ?? ENTITY_FALLBACK_STYLE.color,
    bgColor: group?.bgColor ?? ENTITY_FALLBACK_STYLE.bgColor,
    textColor: group?.textColor ?? ENTITY_FALLBACK_STYLE.textColor,
    groupLabel: group ? getEntityGroupLabel(group.id) : t('entityGroup.other'),
    groupId: group?.id || 'other',
    icon: '',
    riskLevel: 'MEDIUM' as const,
  };
}
