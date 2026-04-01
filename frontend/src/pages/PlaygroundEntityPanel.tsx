import React from 'react';
import {
  selectableCheckboxClass,
  type SelectionVariant,
} from '../ui/selectionClasses';
import {
  getEntityTypeName,
  getEntityGroup,
  ENTITY_GROUPS,
} from '../config/entityTypes';
import type {
  Entity,
  BoundingBox,
} from './playground-types';
import { getModePreview, computeEntityStats } from './playground-utils';

export interface PlaygroundEntityPanelProps {
  isImageMode: boolean;
  isLoading: boolean;
  entities: Entity[];
  visibleBoxes: BoundingBox[];
  selectedCount: number;
  // Actions
  handleRerunNer: () => void;
  handleRedact: () => void;
  selectAll: () => void;
  deselectAll: () => void;
  toggleBox: (id: string) => void;
  handleEntityClick: (entity: Entity, event: React.MouseEvent) => void;
  removeEntity: (id: string) => void;
  // Replacement mode
  replacementMode: 'structured' | 'smart' | 'mask';
  setReplacementMode: (mode: 'structured' | 'smart' | 'mask') => void;
  clearPlaygroundTextPresetTracking: () => void;
}

export const PlaygroundEntityPanel: React.FC<PlaygroundEntityPanelProps> = ({
  isImageMode,
  isLoading,
  entities,
  visibleBoxes,
  selectedCount,
  handleRerunNer,
  handleRedact,
  selectAll,
  deselectAll,
  toggleBox,
  handleEntityClick,
  removeEntity,
  replacementMode,
  setReplacementMode,
  clearPlaygroundTextPresetTracking,
}) => {
  const stats = React.useMemo(() => computeEntityStats(entities), [entities]);

  return (
    <div className="w-full min-w-0 max-w-full lg:max-w-[320px] lg:w-[300px] flex-shrink-0 flex flex-col gap-2 min-h-0 self-stretch overflow-y-auto overflow-x-hidden pr-1">
      <div className="playground-side-card bg-white/95 rounded-2xl border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.05)] p-3">
        <div className="flex flex-col gap-2 min-w-0">
          <button
            type="button"
            onClick={handleRerunNer}
            disabled={isLoading}
            className={`w-full text-xs font-medium bg-black text-white rounded-lg py-2.5 px-2 hover:bg-zinc-900 transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isLoading ? '识别中...' : '重新识别'}
          </button>
          <p className="text-2xs text-[#a3a3a3] leading-snug break-words">
            类型与预设请在「识别项配置」或上传页选择；此处仅重新跑识别。
          </p>
        </div>
      </div>

      {/* 交互说明 */}
      <div className="playground-side-hint bg-gradient-to-br from-gray-50 to-white rounded-xl border border-[#e5e5e5] p-3">
        <div className="text-xs font-semibold text-[#1d1d1f] mb-2">💡 操作说明</div>
        <div className="space-y-2 text-xs text-[#737373]">
          {isImageMode ? (
            <>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-2xs font-bold flex-shrink-0">框</span>
                <span>拖拽框选 → 添加敏感区域</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded bg-violet-100 text-violet-700 flex items-center justify-center text-2xs font-bold flex-shrink-0">点</span>
                <span>点击区域 → 切换脱敏状态</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded bg-violet-100 text-violet-700 flex items-center justify-center text-2xs font-bold flex-shrink-0">点</span>
                <span>点击高亮文字 → 弹出菜单 → 确认移除</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded bg-gray-100 text-[#1d1d1f] flex items-center justify-center text-2xs flex-shrink-0">选</span>
                <span>划选文字 → 选择类型 → 添加标记</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 统计 */}
      <div className="bg-white/95 rounded-2xl border border-black/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.05)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#1d1d1f]">识别结果</h3>
          <span className="text-xs text-[#737373] font-medium">
            {selectedCount}/{isImageMode ? visibleBoxes.length : entities.length}
          </span>
        </div>
        <div className="flex gap-2 mb-3">
          <button onClick={selectAll} className="flex-1 py-1.5 text-xs font-medium text-[#1d1d1f] bg-[#f5f5f5] rounded-lg hover:bg-[#e5e5e5] transition-colors">全选</button>
          <button onClick={deselectAll} className="flex-1 py-1.5 text-xs font-medium text-[#737373] bg-white border border-[#e5e5e5] rounded-lg hover:bg-[#fafafa] dark:bg-gray-900 transition-colors">取消</button>
        </div>
        {!isImageMode && (
          <>
            <div className="mb-3">
              <label className="block text-caption text-[#737373] mb-1.5 font-medium">脱敏方式</label>
              {(() => {
                const sampleEntity = entities.find(e => e.text && e.text.length > 0);
                const modes: { value: 'structured' | 'smart' | 'mask'; label: string; badge?: string }[] = [
                  { value: 'structured', label: '结构化语义标签', badge: '推荐' },
                  { value: 'smart', label: '智能替换' },
                  { value: 'mask', label: '掩码替换' },
                ];
                return (
                  <div className="space-y-1.5">
                    {modes.map(m => (
                      <label
                        key={m.value}
                        className={`flex flex-col px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          replacementMode === m.value
                            ? 'border-[#1d1d1f] bg-[#fafafa] dark:bg-gray-900'
                            : 'border-[#e5e5e5] bg-white hover:border-[#d4d4d4]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="replacementMode"
                            value={m.value}
                            checked={replacementMode === m.value}
                            onChange={() => {
                              clearPlaygroundTextPresetTracking();
                              setReplacementMode(m.value);
                            }}
                            className="accent-[#1d1d1f]"
                          />
                          <span className="text-sm font-medium text-[#1d1d1f]">{m.label}</span>
                          {m.badge && (
                            <span className="text-2xs px-1.5 py-0.5 rounded bg-[#1d1d1f] text-white leading-none">{m.badge}</span>
                          )}
                        </div>
                        <span className="text-2xs text-[#a3a3a3] mt-0.5 font-mono ml-6">
                          {getModePreview(m.value, sampleEntity)}
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })()}
            </div>
            {Object.keys(stats).length > 0 && (
              <div className="space-y-2">
                {/* 按分组统计 */}
                {ENTITY_GROUPS.map(group => {
                  const groupStats = Object.entries(stats).filter(([typeId]) => {
                    return group.types.some(t => t.id === typeId);
                  });

                  if (groupStats.length === 0) return null;

                  const totalInGroup = groupStats.reduce((sum, [, c]) => sum + c.total, 0);
                  const selectedInGroup = groupStats.reduce((sum, [, c]) => sum + c.selected, 0);

                  return (
                    <div key={group.id} className="rounded-lg overflow-hidden border border-gray-200">
                      <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-100 border-b border-gray-200">
                        <span className="text-caption font-semibold text-[#262626]">
                          {group.label}
                        </span>
                        <span className="text-caption font-medium text-[#737373] tabular-nums">
                          {selectedInGroup}/{totalInGroup}
                        </span>
                      </div>
                      <div className="px-2.5 py-1.5 space-y-0.5 bg-white">
                        {groupStats.map(([typeId, count]) => (
                          <div key={typeId} className="flex items-center justify-between text-caption">
                            <span className="text-[#737373]">{getEntityTypeName(typeId)}</span>
                            <span className="text-[#1d1d1f] tabular-nums">{count.selected}/{count.total}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* 实体列表 - 按分组显示 */}
      <div className="flex-1 bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_8px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col min-h-0">
        <div className="px-4 py-2.5 border-b border-[#f0f0f0] bg-[#fafafa] dark:bg-gray-900 flex items-center justify-between">
          <span className="text-sm font-semibold text-[#1d1d1f]">
            {isImageMode ? '区域列表' : '识别结果'}
          </span>
          <span className="text-xs text-[#737373]">
            点击可编辑/移除
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {isImageMode ? (
            visibleBoxes.length === 0 ? (
              <p className="p-4 text-center text-md text-[#a3a3a3]">暂无识别结果</p>
            ) : (
              visibleBoxes.map(box => {
                const group = getEntityGroup(box.type);
                const v: SelectionVariant = box.source === 'has_image' ? 'yolo' : 'ner';
                return (
                  <div
                    key={box.id}
                    className="px-3 py-2.5 flex items-center gap-2 cursor-pointer border-b border-gray-50 transition-all hover:bg-gray-50"
                    onClick={() => toggleBox(box.id)}
                  >
                    <input
                      type="checkbox"
                      checked={box.selected}
                      onChange={() => {}}
                      className={selectableCheckboxClass(v, 'md')}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-caption font-medium px-1.5 py-0.5 rounded bg-gray-100 text-[#1d1d1f]">
                          {group?.label} · {getEntityTypeName(box.type)}
                        </span>
                        <span className="px-1 py-0.5 rounded text-2xs font-medium text-[#1d1d1f] bg-gray-200">
                          {box.source === 'ocr_has' ? 'OCR' : box.source === 'has_image' ? '图像' : '手动'}
                        </span>
                      </div>
                      <p className="text-md truncate text-[#1d1d1f]">
                        {box.text || '图像区域'}
                      </p>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            entities.length === 0 ? (
              <p className="p-4 text-center text-md text-[#a3a3a3]">暂无识别结果</p>
            ) : (
              // 按分组显示
              ENTITY_GROUPS.map(group => {
                const groupEntities = entities.filter(e =>
                  group.types.some(t => t.id === e.type)
                );

                if (groupEntities.length === 0) return null;

                return (
                  <div key={group.id}>
                    {/* 分组标题 */}
                    <div className="px-3 py-2 flex items-center justify-between sticky top-0 z-10 bg-gray-100 border-b border-gray-200">
                      <span className="text-xs font-semibold text-[#262626]">
                        {group.label}
                      </span>
                      <span className="text-caption font-medium text-[#737373] tabular-nums">
                        {groupEntities.length}
                      </span>
                    </div>
                    {/* 该分组下的实体 */}
                    {groupEntities.map(entity => {
                      return (
                        <div
                          key={entity.id}
                          className="px-3 py-2.5 flex items-center gap-2 cursor-pointer border-b border-gray-50 transition-all hover:bg-gray-50"
                          onClick={(e) => handleEntityClick(entity, e)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-caption font-medium px-1.5 py-0.5 rounded bg-gray-100 text-[#1d1d1f]">
                                {getEntityTypeName(entity.type)}
                              </span>
                              <span className="text-2xs text-[#a3a3a3]">
                                {entity.source === 'regex' ? '正则' : entity.source === 'manual' ? '手动' : 'AI'}
                              </span>
                            </div>
                            <p className="text-md truncate text-[#1d1d1f]">
                              {entity.text}
                            </p>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); removeEntity(entity.id); }}
                            className="p-1 text-[#d4d4d4] hover:text-violet-600 flex-shrink-0"
                            aria-label="移除此标注"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <button
        onClick={handleRedact}
        disabled={selectedCount === 0 || isLoading}
            className={`py-3 rounded-xl text-md font-semibold flex items-center justify-center gap-2 transition-all ${
          selectedCount > 0 && !isLoading
            ? 'bg-black text-white hover:bg-zinc-900'
            : 'bg-[#f0f0f0] text-[#a3a3a3] cursor-not-allowed'
        } ${isLoading ? 'opacity-50' : ''}`}
      >
        {isLoading ? '处理中...' : `开始脱敏 (${selectedCount})`}
      </button>
    </div>
  );
};
