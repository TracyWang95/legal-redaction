import React, { useState } from 'react';
import { useRedactionStore, useEntityStats } from '../../hooks/useRedaction';
import type { Entity } from '../../types';
import {
  CheckIcon,
  XMarkIcon,
  PencilIcon,
  PlusIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const ENTITY_TYPE_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  PERSON: { label: '人名', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  ORG: { label: '机构', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  ID_CARD: { label: '身份证', color: 'text-red-700', bgColor: 'bg-red-100' },
  PHONE: { label: '电话', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  ADDRESS: { label: '地址', color: 'text-violet-700', bgColor: 'bg-violet-100' },
  BANK_CARD: { label: '银行卡', color: 'text-pink-700', bgColor: 'bg-pink-100' },
  CASE_NUMBER: { label: '案号', color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  DATE: { label: '日期', color: 'text-teal-700', bgColor: 'bg-teal-100' },
  MONEY: { label: '金额', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  CUSTOM: { label: '自定义', color: 'text-gray-700', bgColor: 'bg-gray-100' },
};

export const EntityEditor: React.FC = () => {
  const {
    entities,
    toggleEntitySelection,
    selectAllEntities,
    deselectAllEntities,
    updateEntity,
  } = useRedactionStore();

  const stats = useEntityStats();
  const [filterType, setFilterType] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // 过滤后的实体列表
  const filteredEntities = filterType
    ? entities.filter((e) => e.type === filterType)
    : entities;

  // 按类型分组
  const groupedByType = entities.reduce((acc, entity) => {
    const type = entity.type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(entity);
    return acc;
  }, {} as Record<string, Entity[]>);

  const handleEditStart = (entity: Entity) => {
    setEditingId(entity.id);
    setEditValue(entity.replacement || entity.text);
  };

  const handleEditSave = (entity: Entity) => {
    updateEntity(entity.id, { replacement: editValue });
    setEditingId(null);
    setEditValue('');
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditValue('');
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">识别结果</h3>
        <p className="text-sm text-gray-500 mt-1">
          共识别 {stats.total} 个敏感信息，已选中 {stats.selected} 个
        </p>
      </div>

      {/* 快捷操作 */}
      <div className="p-3 border-b border-gray-200 flex items-center gap-2 flex-wrap">
        <button
          onClick={selectAllEntities}
          className="px-3 py-1.5 text-sm bg-primary-50 text-primary-700 rounded-md hover:bg-primary-100 transition-colors"
        >
          全选
        </button>
        <button
          onClick={deselectAllEntities}
          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
        >
          取消全选
        </button>
        
        <div className="flex-1" />
        
        {/* 类型筛选 */}
        <div className="relative">
          <select
            value={filterType || ''}
            onChange={(e) => setFilterType(e.target.value || null)}
            className="appearance-none pl-8 pr-4 py-1.5 text-sm bg-gray-100 border-0 rounded-md focus:ring-2 focus:ring-primary-500"
          >
            <option value="">全部类型</option>
            {Object.entries(ENTITY_TYPE_CONFIG).map(([type, config]) => (
              <option key={type} value={type}>
                {config.label} ({groupedByType[type]?.length || 0})
              </option>
            ))}
          </select>
          <FunnelIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        </div>
      </div>

      {/* 类型统计标签 */}
      <div className="p-3 border-b border-gray-200 flex flex-wrap gap-2">
        {Object.entries(stats.byType).map(([type, count]) => {
          const config = ENTITY_TYPE_CONFIG[type] || ENTITY_TYPE_CONFIG.CUSTOM;
          return (
            <button
              key={type}
              onClick={() => setFilterType(filterType === type ? null : type)}
              className={clsx(
                'px-2 py-1 text-xs rounded-full transition-all',
                config.bgColor,
                config.color,
                filterType === type && 'ring-2 ring-offset-1 ring-current'
              )}
            >
              {config.label} ({count})
            </button>
          );
        })}
      </div>

      {/* 实体列表 */}
      <div className="flex-1 overflow-auto p-3">
        {filteredEntities.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p>暂无识别结果</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredEntities.map((entity) => (
              <EntityItem
                key={entity.id}
                entity={entity}
                isEditing={editingId === entity.id}
                editValue={editValue}
                onToggle={() => toggleEntitySelection(entity.id)}
                onEditStart={() => handleEditStart(entity)}
                onEditChange={setEditValue}
                onEditSave={() => handleEditSave(entity)}
                onEditCancel={handleEditCancel}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// 实体项组件
interface EntityItemProps {
  entity: Entity;
  isEditing: boolean;
  editValue: string;
  onToggle: () => void;
  onEditStart: () => void;
  onEditChange: (value: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
}

const EntityItem: React.FC<EntityItemProps> = ({
  entity,
  isEditing,
  editValue,
  onToggle,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
}) => {
  const config = ENTITY_TYPE_CONFIG[entity.type] || ENTITY_TYPE_CONFIG.CUSTOM;

  return (
    <div
      className={clsx(
        'p-3 rounded-lg border transition-all',
        entity.selected
          ? 'bg-primary-50 border-primary-200'
          : 'bg-gray-50 border-gray-200'
      )}
    >
      <div className="flex items-start gap-3">
        {/* 选择框 */}
        <button
          onClick={onToggle}
          className={clsx(
            'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
            entity.selected
              ? 'bg-primary-600 border-primary-600 text-white'
              : 'border-gray-300 hover:border-primary-400'
          )}
        >
          {entity.selected && <CheckIcon className="w-3 h-3" />}
        </button>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* 类型标签 */}
            <span className={clsx('px-2 py-0.5 text-xs rounded-full', config.bgColor, config.color)}>
              {config.label}
            </span>
            
            {/* 置信度 */}
            {entity.confidence < 1 && (
              <span className="text-xs text-gray-400">
                {Math.round(entity.confidence * 100)}%
              </span>
            )}
            
            {/* 页码 */}
            {entity.page > 1 && (
              <span className="text-xs text-gray-400">
                第{entity.page}页
              </span>
            )}
          </div>

          {/* 原始文本 */}
          <p className="mt-1 text-sm font-medium text-gray-900 break-all">
            {entity.text}
          </p>

          {/* 替换文本编辑 */}
          {isEditing ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-gray-400">→</span>
              <input
                type="text"
                value={editValue}
                onChange={(e) => onEditChange(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="输入替换文本"
                autoFocus
              />
              <button
                onClick={onEditSave}
                className="p-1 text-green-600 hover:bg-green-50 rounded"
              >
                <CheckIcon className="w-4 h-4" />
              </button>
              <button
                onClick={onEditCancel}
                className="p-1 text-gray-400 hover:bg-gray-100 rounded"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          ) : entity.replacement ? (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className="text-gray-400">→</span>
              <span className="text-primary-700 font-medium">{entity.replacement}</span>
              <button
                onClick={onEditStart}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              >
                <PencilIcon className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={onEditStart}
              className="mt-1 text-xs text-gray-400 hover:text-primary-600 flex items-center gap-1"
            >
              <PlusIcon className="w-3 h-3" />
              自定义替换
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default EntityEditor;
