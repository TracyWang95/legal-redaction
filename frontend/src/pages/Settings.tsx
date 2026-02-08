import React, { useState, useEffect } from 'react';

interface EntityTypeConfig {
  id: string;
  name: string;
  description?: string;
  examples?: string[];
  color: string;
  regex_pattern?: string | null;
  use_llm?: boolean;
  enabled?: boolean;
  order?: number;
  tag_template?: string | null;
}

interface PipelineTypeConfig {
  id: string;
  name: string;
  description?: string;
  examples?: string[];
  color: string;
  enabled: boolean;
  order: number;
}

interface PipelineConfig {
  mode: 'ocr_has' | 'glm_vision';
  name: string;
  description: string;
  enabled: boolean;
  types: PipelineTypeConfig[];
}

export const Settings: React.FC = () => {
  const [entityTypes, setEntityTypes] = useState<EntityTypeConfig[]>([]);
  const [pipelines, setPipelines] = useState<PipelineConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'text' | 'vision'>('text');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EntityTypeConfig>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddPipelineTypeModal, setShowAddPipelineTypeModal] = useState<'ocr_has' | 'glm_vision' | null>(null);
  const [editingPipelineType, setEditingPipelineType] = useState<{ mode: string; type: PipelineTypeConfig } | null>(null);
  const [newPipelineType, setNewPipelineType] = useState({
    id: '',
    name: '',
    description: '',
    color: '#6B7280',
  });
  const [newType, setNewType] = useState({
    name: '',
    description: '',
    examples: '',
    color: '#6B7280',
    regex_pattern: '',
    use_llm: true,
    tag_template: '',
  });

  useEffect(() => {
    fetchEntityTypes();
    fetchPipelines();
  }, []);

  const fetchEntityTypes = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/custom-types?enabled_only=false');
      if (!res.ok) throw new Error('获取失败');
      const data = await res.json();
      setEntityTypes(data.custom_types || []);
    } catch (err) {
      console.error('获取实体类型失败', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPipelines = async () => {
    try {
      const res = await fetch('/api/v1/vision-pipelines');
      if (!res.ok) throw new Error('获取失败');
      const data = await res.json();
      const normalizedPipelines = (data || []).map((p: PipelineConfig) =>
        p.mode === 'glm_vision'
          ? {
              ...p,
              name: 'GLM Vision',
              description: '使用视觉语言模型识别签名、印章、手写等视觉信息。',
            }
          : p
      );
      setPipelines(normalizedPipelines);
    } catch (err) {
      console.error('获取Pipeline配置失败', err);
    }
  };

  const resetPipelines = async () => {
    if (!confirm('确定要重置所有Pipeline配置为默认吗？')) return;
    try {
      const res = await fetch('/api/v1/vision-pipelines/reset', { method: 'POST' });
      if (res.ok) {
        fetchPipelines();
      }
    } catch (err) {
      console.error('重置Pipeline配置失败', err);
    }
  };

  const createPipelineType = async () => {
    if (!showAddPipelineTypeModal || !newPipelineType.name) return;
    try {
      const typeId = newPipelineType.id || `custom_${Date.now()}`;
      const res = await fetch(`/api/v1/vision-pipelines/${showAddPipelineTypeModal}/types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: typeId,
          name: newPipelineType.name,
          description: newPipelineType.description || null,
          examples: [],
          color: newPipelineType.color,
          enabled: true,
          order: 100,
        }),
      });
      if (res.ok) {
        setShowAddPipelineTypeModal(null);
        setNewPipelineType({ id: '', name: '', description: '', color: '#6B7280' });
        fetchPipelines();
      } else {
        const data = await res.json();
        alert(data.detail || '创建失败');
      }
    } catch (err) {
      console.error('创建Pipeline类型失败', err);
    }
  };

  const deletePipelineType = async (mode: string, typeId: string) => {
    if (!confirm('确定要删除此类型吗？')) return;
    try {
      const res = await fetch(`/api/v1/vision-pipelines/${mode}/types/${typeId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchPipelines();
      } else {
        const data = await res.json();
        alert(data.detail || '删除失败');
      }
    } catch (err) {
      console.error('删除Pipeline类型失败', err);
    }
  };

  const startEditPipelineType = (mode: string, type: PipelineTypeConfig) => {
    setEditingPipelineType({ mode, type: { ...type } });
    setNewPipelineType({
      id: type.id,
      name: type.name,
      description: type.description || '',
      color: type.color,
    });
    setShowAddPipelineTypeModal(mode as 'ocr_has' | 'glm_vision');
  };

  const updatePipelineType = async () => {
    if (!editingPipelineType || !newPipelineType.name) return;
    try {
      const res = await fetch(`/api/v1/vision-pipelines/${editingPipelineType.mode}/types/${editingPipelineType.type.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingPipelineType.type.id,
          name: newPipelineType.name,
          description: newPipelineType.description || null,
          examples: editingPipelineType.type.examples || [],
          color: newPipelineType.color,
          enabled: editingPipelineType.type.enabled,
          order: editingPipelineType.type.order,
        }),
      });
      if (res.ok) {
        setShowAddPipelineTypeModal(null);
        setEditingPipelineType(null);
        setNewPipelineType({ id: '', name: '', description: '', color: '#6B7280' });
        fetchPipelines();
      } else {
        const data = await res.json();
        alert(data.detail || '更新失败');
      }
    } catch (err) {
      console.error('更新Pipeline类型失败', err);
    }
  };

  const startEdit = (type: EntityTypeConfig) => {
    setEditingId(type.id);
    setEditForm({
      name: type.name,
      description: type.description || '',
      color: type.color,
      regex_pattern: type.regex_pattern || '',
      use_llm: type.use_llm ?? true,
      tag_template: type.tag_template || '',
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const res = await fetch(`/api/v1/custom-types/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditingId(null);
        fetchEntityTypes();
      }
    } catch (err) {
      console.error('保存失败', err);
    }
  };
  void saveEdit; // 预留：文本类型编辑功能

  const createType = async () => {
    try {
      const res = await fetch('/api/v1/custom-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newType.name,
          description: newType.description,
          examples: newType.examples.split(/[,，;；]/).map(s => s.trim()).filter(Boolean),
          color: newType.color,
          regex_pattern: newType.regex_pattern || null,
          use_llm: newType.use_llm,
          tag_template: newType.tag_template || null,
        }),
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewType({ name: '', description: '', examples: '', color: '#6B7280', regex_pattern: '', use_llm: true, tag_template: '' });
        fetchEntityTypes();
      }
    } catch (err) {
      console.error('创建失败', err);
    }
  };

  const deleteType = async (id: string) => {
    if (!confirm('确定要删除此类型吗？')) return;
    try {
      const res = await fetch(`/api/v1/custom-types/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchEntityTypes();
      } else {
        const data = await res.json();
        alert(data.detail || '删除失败');
      }
    } catch (err) {
      console.error('删除失败', err);
    }
  };

  const resetToDefault = async () => {
    if (!confirm('确定要重置为默认配置吗？这将覆盖所有自定义修改。')) return;
    try {
      const res = await fetch('/api/v1/custom-types/reset', { method: 'POST' });
      if (res.ok) {
        fetchEntityTypes();
      }
    } catch (err) {
      console.error('重置失败', err);
    }
  };

  // 分类：正则类型和AI类型
  const regexTypes = entityTypes.filter(t => t.regex_pattern);
  const llmTypes = entityTypes.filter(t => t.use_llm);

  return (
    <div className="h-full flex flex-col bg-[#fafafa] p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[17px] font-semibold text-[#0a0a0a] tracking-[-0.01em]">识别项配置</h2>
          <p className="text-[13px] text-[#737373] mt-0.5">配置需要识别的敏感信息类型</p>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-7 h-7 border-2 border-[#e5e5e5] border-t-[#0a0a0a] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 space-y-6 overflow-auto">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('text')}
              className={`px-4 py-2 text-[13px] font-medium rounded-lg border transition-colors ${
                activeTab === 'text'
                  ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white'
                  : 'border-[#e5e5e5] text-[#737373] hover:bg-[#f5f5f5]'
              }`}
            >
              文本识别规则
            </button>
            <button
              onClick={() => setActiveTab('vision')}
              className={`px-4 py-2 text-[13px] font-medium rounded-lg border transition-colors ${
                activeTab === 'vision'
                  ? 'border-[#0a0a0a] bg-[#0a0a0a] text-white'
                  : 'border-[#e5e5e5] text-[#737373] hover:bg-[#f5f5f5]'
              }`}
            >
              图像识别规则
            </button>
          </div>

          {activeTab === 'text' && (
          <div className="space-y-6">
            {/* 文本识别说明 */}
            <div className="bg-[#f5f5f7] rounded-xl p-4">
              <h3 className="font-medium text-gray-900 text-sm mb-1">文本识别双引擎</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#007AFF]" />正则识别</span>（精确匹配固定格式）+
                <span className="inline-flex items-center gap-1 ml-1"><span className="w-1.5 h-1.5 rounded-full bg-[#34C759]" />AI语义识别</span>（HaS本地模型语义理解）
              </p>
            </div>

            {/* 正则识别类型 */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#007AFF]" />
                    <h2 className="font-semibold text-gray-900 text-[15px]">正则识别</h2>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">正则表达式精确匹配，适合固定格式数据</p>
                </div>
                <button
                  onClick={() => {
                    setNewType({ name: '', description: '', examples: '', color: '#6B7280', regex_pattern: '', use_llm: false, tag_template: '' });
                    setShowAddModal(true);
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[#007AFF] text-white hover:bg-[#0066d6]"
                >
                  + 新增类型
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {regexTypes.map(type => (
                  <div key={type.id} className="px-5 py-3 flex items-center gap-4">
                    <span className="w-2 h-2 rounded-full flex-shrink-0 bg-[#007AFF]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 text-sm">{type.name}</span>
                        <span className="text-xs text-gray-400">{type.id}</span>
                      </div>
                      {type.regex_pattern && (
                        <code className="text-xs text-gray-500 mt-0.5 font-mono block truncate max-w-md">
                          {type.regex_pattern}
                        </code>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(type)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title="编辑"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {type.id.startsWith('custom_') && (
                        <button
                          onClick={() => deleteType(type.id)}
                          className="p-1 text-gray-400 hover:text-red-500"
                          title="删除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {regexTypes.length === 0 && (
                  <p className="px-5 py-4 text-sm text-gray-400 text-center">暂无类型配置</p>
                )}
              </div>
            </div>

            {/* AI语义识别类型 */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#34C759]" />
                    <h2 className="font-semibold text-gray-900 text-[15px]">AI 语义识别</h2>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">HaS 本地大语言模型语义识别，适合无固定格式的信息</p>
                </div>
                <button
                  onClick={() => {
                    setNewType({ name: '', description: '', examples: '', color: '#6B7280', regex_pattern: '', use_llm: true, tag_template: '' });
                    setShowAddModal(true);
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg bg-[#34C759] text-white hover:bg-[#28a745]"
                >
                  + 新增类型
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {llmTypes.map(type => (
                  <div key={type.id} className="px-5 py-3 flex items-center gap-4">
                    <span className="w-2 h-2 rounded-full flex-shrink-0 bg-[#34C759]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 text-sm">{type.name}</span>
                        <span className="text-xs text-gray-400">{type.id}</span>
                      </div>
                      {type.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{type.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(type)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title="编辑"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {type.id.startsWith('custom_') && (
                        <button
                          onClick={() => deleteType(type.id)}
                          className="p-1 text-gray-400 hover:text-red-500"
                          title="删除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {llmTypes.length === 0 && (
                  <p className="px-5 py-4 text-sm text-gray-400 text-center">暂无类型配置</p>
                )}
              </div>
            </div>

            {/* 重置按钮 */}
            <div className="flex justify-end">
              <button
                onClick={resetToDefault}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                重置为默认配置
              </button>
            </div>
          </div>
          )}

          {activeTab === 'vision' && (
          <div className="space-y-6">
            {/* Pipeline 说明 */}
            <div className="bg-[#f5f5f7] rounded-xl p-4">
              <h3 className="font-medium text-gray-900 text-sm mb-1">图像识别双 Pipeline</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                两路并行，结果合并：
                <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />OCR+HaS</span>（文字类）+
                <span className="inline-flex items-center gap-1 ml-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" />GLM Vision</span>（视觉类）
              </p>
            </div>

            {/* Pipeline 配置列表 */}
            {pipelines.map(pipeline => {
              const isGlmVision = pipeline.mode === 'glm_vision';
              const displayName = isGlmVision ? 'GLM Vision' : pipeline.name;
              const displayDesc = isGlmVision
                ? '使用视觉语言模型识别签名、印章、手写等视觉信息。'
                : pipeline.description;
              return (
              <div key={pipeline.mode} className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${pipeline.mode === 'ocr_has' ? 'bg-blue-500' : 'bg-orange-500'}`} />
                      <h2 className="font-semibold text-gray-900 text-[15px]">{displayName}</h2>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{displayDesc}</p>
                  </div>
                  <button
                    onClick={() => setShowAddPipelineTypeModal(pipeline.mode)}
                    className={`px-3 py-1.5 text-xs rounded-lg text-white ${
                      pipeline.mode === 'ocr_has'
                        ? 'bg-blue-500 hover:bg-blue-600'
                        : 'bg-orange-500 hover:bg-orange-600'
                    }`}
                  >
                    + 新增类型
                  </button>
                </div>
                
                <div className="divide-y divide-gray-50">
                  {pipeline.types.map(type => (
                    <div key={type.id} className="px-5 py-3 flex items-center gap-4">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pipeline.mode === 'ocr_has' ? 'bg-blue-500' : 'bg-orange-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 text-sm">{type.name}</span>
                          <span className="text-xs text-gray-400">{type.id}</span>
                        </div>
                        {type.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{type.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditPipelineType(pipeline.mode, type)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                          title="编辑"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deletePipelineType(pipeline.mode, type.id)}
                          className="p-1 text-gray-400 hover:text-red-500"
                          title="删除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                  {pipeline.types.length === 0 && (
                    <p className="px-5 py-4 text-sm text-gray-400 text-center">暂无类型配置</p>
                  )}
                </div>
              </div>
            );
            })}

            {/* 重置按钮 */}
            <div className="flex justify-end">
              <button
                onClick={resetPipelines}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                重置为默认配置
              </button>
            </div>
          </div>
          )}

        </div>
      )}

      {/* 新增弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">新增实体类型</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
                <input
                  type="text"
                  value={newType.name}
                  onChange={e => setNewType({ ...newType, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder="如：合同金额"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">语义描述</label>
                <textarea
                  value={newType.description}
                  onChange={e => setNewType({ ...newType, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder="描述这类信息的特征，帮助AI更准确识别"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">标签模板</label>
                <input
                  type="text"
                  value={newType.tag_template}
                  onChange={e => setNewType({ ...newType, tag_template: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg font-mono text-sm"
                  placeholder="<组织[{index}].企业.完整名称>"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">示例（逗号分隔）</label>
                <input
                  type="text"
                  value={newType.examples}
                  onChange={e => setNewType({ ...newType, examples: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder="示例1, 示例2, 示例3"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">颜色</label>
                  <input
                    type="color"
                    value={newType.color}
                    onChange={e => setNewType({ ...newType, color: e.target.value })}
                    className="w-full h-10 rounded-lg cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">识别方式</label>
                  <select
                    value={newType.use_llm ? 'llm' : 'regex'}
                    onChange={e => setNewType({ ...newType, use_llm: e.target.value === 'llm' })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  >
                    <option value="llm">AI语义识别</option>
                    <option value="regex">正则匹配</option>
                  </select>
                </div>
              </div>
              {!newType.use_llm && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">正则表达式</label>
                  <input
                    type="text"
                    value={newType.regex_pattern}
                    onChange={e => setNewType({ ...newType, regex_pattern: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg font-mono text-sm"
                    placeholder="\d{4}-\d{2}-\d{2}"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-gray-600"
              >
                取消
              </button>
              <button
                onClick={createType}
                disabled={!newType.name}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增/编辑 Pipeline 类型弹窗 */}
      {showAddPipelineTypeModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {editingPipelineType ? '编辑类型' : '新增类型'} - {showAddPipelineTypeModal === 'ocr_has' ? 'OCR+HaS' : 'GLM Vision'}
            </h3>
            <div className="space-y-4">
              {!editingPipelineType && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型 ID *</label>
                  <input
                    type="text"
                    value={newPipelineType.id}
                    onChange={e => setNewPipelineType({ ...newPipelineType, id: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg font-mono text-sm"
                    placeholder="如：LAB_NAME"
                  />
                  <p className="text-xs text-gray-400 mt-1">唯一标识，留空则自动生成</p>
                </div>
              )}
              {editingPipelineType && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型 ID</label>
                  <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg font-mono text-sm text-gray-500">
                    {editingPipelineType.type.id}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
                <input
                  type="text"
                  value={newPipelineType.name}
                  onChange={e => setNewPipelineType({ ...newPipelineType, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder="如：实验室名称"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述/提示词</label>
                <textarea
                  value={newPipelineType.description}
                  onChange={e => setNewPipelineType({ ...newPipelineType, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  placeholder={showAddPipelineTypeModal === 'ocr_has' ? '描述文字特征，帮助 AI 更准确识别' : '描述视觉特征，如：认证标志、Logo、徽章等'}
                />
                <p className="text-xs text-gray-400 mt-1">详细描述有助于提高识别准确率</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">颜色</label>
                <input
                  type="color"
                  value={newPipelineType.color}
                  onChange={e => setNewPipelineType({ ...newPipelineType, color: e.target.value })}
                  className="w-full h-10 rounded-lg cursor-pointer"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddPipelineTypeModal(null);
                  setEditingPipelineType(null);
                  setNewPipelineType({ id: '', name: '', description: '', color: '#6B7280' });
                }}
                className="px-4 py-2 text-sm text-gray-600"
              >
                取消
              </button>
              <button
                onClick={editingPipelineType ? updatePipelineType : createPipelineType}
                disabled={!newPipelineType.name}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${
                  showAddPipelineTypeModal === 'ocr_has'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-orange-600 hover:bg-orange-700'
                }`}
              >
                {editingPipelineType ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Settings;
