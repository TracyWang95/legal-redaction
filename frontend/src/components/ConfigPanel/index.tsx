import React from 'react';
import { useRedactionStore } from '../../hooks/useRedaction';
import { EntityType, ReplacementMode } from '../../types';
import { Switch } from '@headlessui/react';
import clsx from 'clsx';

const ENTITY_TYPE_CONFIG = [
  { type: EntityType.PERSON, label: '人名', description: '识别姓名' },
  { type: EntityType.ORG, label: '机构/公司', description: '识别组织名称' },
  { type: EntityType.ID_CARD, label: '身份证号', description: '18位身份证' },
  { type: EntityType.PHONE, label: '电话号码', description: '手机号/座机' },
  { type: EntityType.ADDRESS, label: '地址', description: '详细地址' },
  { type: EntityType.BANK_CARD, label: '银行卡号', description: '银行卡账号' },
  { type: EntityType.CASE_NUMBER, label: '案件编号', description: '法院案号' },
  { type: EntityType.DATE, label: '日期', description: '时间日期' },
  { type: EntityType.MONEY, label: '金额', description: '货币金额' },
];

const REPLACEMENT_MODES = [
  {
    value: ReplacementMode.SMART,
    label: '智能替换',
    description: '替换为语义化标识，如"当事人甲"、"公司A"',
  },
  {
    value: ReplacementMode.STRUCTURED,
    label: '结构化语义标签',
    description: '替换为结构化标签，保留层级语义与指代关系',
  },
  {
    value: ReplacementMode.MASK,
    label: '掩码替换',
    description: '用 *** 或部分隐藏，如"张**"、"138****1234"',
  },
  {
    value: ReplacementMode.CUSTOM,
    label: '自定义替换',
    description: '手动指定每个敏感信息的替换文本',
  },
];

export const ConfigPanel: React.FC = () => {
  const { config, toggleEntityType, setReplacementMode } = useRedactionStore();

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">脱敏配置</h3>
        <p className="text-sm text-gray-500 mt-1">配置要识别的实体类型和替换方式</p>
      </div>

      {/* 替换模式 */}
      <div className="p-4 border-b border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-3">替换模式</h4>
        <div className="space-y-2">
          {REPLACEMENT_MODES.map((mode) => (
            <label
              key={mode.value}
              className={clsx(
                'flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all',
                config.replacement_mode === mode.value
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <input
                type="radio"
                name="replacement_mode"
                value={mode.value}
                checked={config.replacement_mode === mode.value}
                onChange={() => setReplacementMode(mode.value)}
                className="mt-1 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <p className="font-medium text-gray-900">{mode.label}</p>
                <p className="text-sm text-gray-500">{mode.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* 实体类型 */}
      <div className="p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">识别的实体类型</h4>
        <div className="space-y-3">
          {ENTITY_TYPE_CONFIG.map((item) => (
            <div key={item.type} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500">{item.description}</p>
              </div>
              <Switch
                checked={config.entity_types.includes(item.type)}
                onChange={() => toggleEntityType(item.type)}
                className={clsx(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  config.entity_types.includes(item.type)
                    ? 'bg-primary-600'
                    : 'bg-gray-200'
                )}
              >
                <span
                  className={clsx(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    config.entity_types.includes(item.type)
                      ? 'translate-x-6'
                      : 'translate-x-1'
                  )}
                />
              </Switch>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConfigPanel;
