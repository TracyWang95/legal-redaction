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

interface VisionTypeConfig {
  id: string;
  name: string;
  description?: string;
  examples?: string[];
  color: string;
  enabled?: boolean;
  order?: number;
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
  const [visionTypes, setVisionTypes] = useState<VisionTypeConfig[]>([]);
  const [pipelines, setPipelines] = useState<PipelineConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'text' | 'vision'>('text');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<EntityTypeConfig>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddVisionModal, setShowAddVisionModal] = useState(false);
  const [showAddPipelineTypeModal, setShowAddPipelineTypeModal] = useState<'ocr_has' | 'glm_vision' | null>(null);
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
  const [newVisionType, setNewVisionType] = useState({
    name: '',
    description: '',
    examples: '',
    color: '#6B7280',
  });
  const [editingVisionId, setEditingVisionId] = useState<string | null>(null);
  const [editVisionForm, setEditVisionForm] = useState<Partial<VisionTypeConfig>>({});

  useEffect(() => {
    fetchEntityTypes();
    fetchVisionTypes();
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

  const fetchVisionTypes = async () => {
    try {
      const res = await fetch('/api/v1/vision-types?enabled_only=false');
      if (!res.ok) throw new Error('获取失败');
      const data = await res.json();
      setVisionTypes(data || []);
    } catch (err) {
      console.error('获取图像类型失败', err);
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
              name: 'GLM Vision (本地)',
              description: '使用本地 GLM-4.6V-Flash-Q4_K_M.gguf + mmproj-F16.gguf 识别视觉信息。',
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

  const resetVisionTypes = async () => {
    if (!confirm('确定要重置图像识别类型为默认配置吗？')) return;
    try {
      const res = await fetch('/api/v1/vision-types/reset', { method: 'POST' });
      if (res.ok) {
        fetchVisionTypes();
      }
    } catch (err) {
      console.error('重置图像类型失败', err);
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

  const startVisionEdit = (type: VisionTypeConfig) => {
    setEditingVisionId(type.id);
    setEditVisionForm({
      name: type.name,
      description: type.description || '',
      color: type.color,
    });
  };

  const saveVisionEdit = async () => {
    if (!editingVisionId) return;
    try {
      const res = await fetch(`/api/v1/vision-types/${editingVisionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editVisionForm),
      });
      if (res.ok) {
        setEditingVisionId(null);
        fetchVisionTypes();
      }
    } catch (err) {
      console.error('保存图像类型失败', err);
    }
  };

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

  const createVisionType = async () => {
    try {
      const res = await fetch('/api/v1/vision-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newVisionType.name,
          description: newVisionType.description,
          examples: newVisionType.examples.split(/[,，;；]/).map(s => s.trim()).filter(Boolean),
          color: newVisionType.color,
        }),
      });
      if (res.ok) {
        setNewVisionType({ name: '', description: '', examples: '', color: '#6B7280' });
        setShowAddVisionModal(false);
        fetchVisionTypes();
      }
    } catch (err) {
      console.error('创建图像类型失败', err);
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
    <div className="h-full flex flex-col bg-gray-50 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">系统设置</h1>
          <p className="text-sm text-gray-500">配置敏感信息识别类型</p>
        </div>
        <div className="flex gap-3">
          {activeTab === 'text' && (
            <>
              <button
                onClick={resetToDefault}
                className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                重置默认
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                + 新增类型
              </button>
            </>
          )}
          {activeTab === 'vision' && (
            <>
              <button
                onClick={resetVisionTypes}
                className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                重置默认
              </button>
              <button
                onClick={() => setShowAddVisionModal(true)}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                + 新增类型
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 space-y-6">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('text')}
              className={`px-3 py-1.5 text-sm rounded-lg border ${
                activeTab === 'text'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600'
              }`}
            >
              文本识别配置
            </button>
            <button
              onClick={() => setActiveTab('vision')}
              className={`px-3 py-1.5 text-sm rounded-lg border ${
                activeTab === 'vision'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600'
              }`}
            >
              图像识别配置
            </button>
          </div>

          {activeTab === 'text' && (
          <>
          {/* 正则识别类型 */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">正则识别类型</h2>
                <p className="text-xs text-gray-500">使用正则表达式精确匹配，准确率高</p>
              </div>
              <span className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded">⚡ 正则优先</span>
            </div>
            <div className="divide-y divide-gray-100">
              {regexTypes.map(type => (
                <div key={type.id} className="px-5 py-4">
                  {editingId === type.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <input
                          type="text"
                          value={editForm.name || ''}
                          onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                          placeholder="名称"
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        />
                        <input
                          type="color"
                          value={editForm.color || '#6B7280'}
                          onChange={e => setEditForm({ ...editForm, color: e.target.value })}
                          className="w-full h-10 rounded-lg cursor-pointer"
                        />
                      </div>
                      <input
                        type="text"
                        value={editForm.regex_pattern || ''}
                        onChange={e => setEditForm({ ...editForm, regex_pattern: e.target.value })}
                        placeholder="正则表达式"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-sm text-gray-600">取消</button>
                        <button onClick={saveEdit} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg">保存</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: type.color }} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{type.name}</span>
                          <span className="text-xs text-gray-400">{type.id}</span>
                        </div>
                        {type.regex_pattern && (
                          <code className="text-xs text-gray-500 font-mono truncate block mt-1 max-w-lg">
                            {type.regex_pattern}
                          </code>
                        )}
                      </div>
                      <button onClick={() => startEdit(type)} className="p-1.5 text-gray-400 hover:text-blue-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* AI识别类型 */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">AI语义识别类型</h2>
                <p className="text-xs text-gray-500">使用大语言模型进行语义识别</p>
              </div>
              <span className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded">🤖 LLM识别</span>
            </div>
            <div className="divide-y divide-gray-100">
              {llmTypes.map(type => (
                <div key={type.id} className="px-5 py-4">
                  {editingId === type.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <input
                          type="text"
                          value={editForm.name || ''}
                          onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                          placeholder="名称"
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        />
                        <input
                          type="color"
                          value={editForm.color || '#6B7280'}
                          onChange={e => setEditForm({ ...editForm, color: e.target.value })}
                          className="w-full h-10 rounded-lg cursor-pointer"
                        />
                      </div>
                      <textarea
                        value={editForm.description || ''}
                        onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                        placeholder="语义描述（用于指导AI识别）"
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                      <input
                        type="text"
                        value={editForm.tag_template || ''}
                        onChange={e => setEditForm({ ...editForm, tag_template: e.target.value })}
                        placeholder="结构化标签模板，如 <组织[{index}].企业.完整名称>"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-sm text-gray-600">取消</button>
                        <button onClick={saveEdit} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg">保存</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-4">
                      <span className="w-4 h-4 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: type.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{type.name}</span>
                          <span className="text-xs text-gray-400">{type.id}</span>
                        </div>
                        {type.description && (
                          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{type.description}</p>
                        )}
                        {type.examples && type.examples.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {type.examples.slice(0, 3).map((ex, i) => (
                              <span key={i} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">{ex}</span>
                            ))}
                          </div>
                        )}
                      {type.tag_template && (
                        <p className="text-xs text-gray-400 mt-2 font-mono">{type.tag_template}</p>
                      )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => startEdit(type)} className="p-1.5 text-gray-400 hover:text-blue-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {type.id.startsWith('custom_') && (
                          <button onClick={() => deleteType(type.id)} className="p-1.5 text-gray-400 hover:text-red-600">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          </>
          )}

          {activeTab === 'vision' && (
          <div className="space-y-6">
            {/* Pipeline 说明 */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100">
              <h3 className="font-medium text-gray-900 mb-2">图像识别双 Pipeline</h3>
              <p className="text-sm text-gray-600">
                两个 Pipeline 并行运行，结果合并：
                <span className="font-medium text-blue-700"> OCR+HaS（PaddleOCR-VL-1.5 + Qwen3-0.6B）</span>识别文字类信息（人名、组织等）；
                <span className="font-medium text-purple-700"> GLM Vision（本地）</span>识别视觉类信息（签名、公章等），模型：
                <span className="font-medium text-purple-700"> GLM-4.6V-Flash-Q4_K_M.gguf + mmproj-F16.gguf</span>。
              </p>
            </div>

            {/* Pipeline 配置列表 */}
            {pipelines.map(pipeline => {
              const isGlmVision = pipeline.mode === 'glm_vision';
              const displayName = isGlmVision ? 'GLM Vision (本地)' : pipeline.name;
              const displayDesc = isGlmVision
                ? '使用本地 GLM-4.6V-Flash-Q4_K_M.gguf + mmproj-F16.gguf 识别视觉信息（签名、公章等）。'
                : pipeline.description;
              return (
              <div key={pipeline.mode} className={`bg-white rounded-xl border-2 ${
                pipeline.mode === 'ocr_has' ? 'border-blue-200' : 'border-purple-200'
              }`}>
                <div className={`px-5 py-4 border-b flex items-center justify-between ${
                  pipeline.mode === 'ocr_has' ? 'bg-blue-50 border-blue-100' : 'bg-purple-50 border-purple-100'
                }`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-900">{displayName}</h2>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        pipeline.mode === 'ocr_has' 
                          ? 'bg-blue-100 text-blue-700' 
                          : 'bg-purple-100 text-purple-700'
                      }`}>
                        {pipeline.mode === 'ocr_has' ? '📝 本地' : '🖥️ 本地'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{displayDesc}</p>
                  </div>
                  <button
                    onClick={() => setShowAddPipelineTypeModal(pipeline.mode)}
                    className={`px-3 py-1.5 text-xs rounded-lg ${
                      pipeline.mode === 'ocr_has'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                  >
                    + 新增类型
                  </button>
                </div>
                
                <div className="divide-y divide-gray-100">
                  {pipeline.types.map(type => (
                    <div key={type.id} className="px-5 py-3 flex items-center gap-4">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: type.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 text-sm">{type.name}</span>
                          <span className="text-xs text-gray-400">{type.id}</span>
                        </div>
                        {type.description && (
                          <p className="text-xs text-gray-500 mt-0.5">{type.description}</p>
                        )}
                      </div>
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

      {/* 新增图像类型弹窗 */}
      {showAddVisionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">新增图像类型</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称 *</label>
                <input
                  type="text"
                  value={newVisionType.name}
                  onChange={e => setNewVisionType({ ...newVisionType, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder="如：实验室名称"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <input
                  type="text"
                  value={newVisionType.description}
                  onChange={e => setNewVisionType({ ...newVisionType, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder="描述图像中该类信息的特征"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">示例（逗号分隔）</label>
                <input
                  type="text"
                  value={newVisionType.examples}
                  onChange={e => setNewVisionType({ ...newVisionType, examples: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder="示例1, 示例2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">颜色</label>
                <input
                  type="color"
                  value={newVisionType.color}
                  onChange={e => setNewVisionType({ ...newVisionType, color: e.target.value })}
                  className="w-full h-10 rounded-lg cursor-pointer"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddVisionModal(false)}
                className="px-4 py-2 text-sm text-gray-600"
              >
                取消
              </button>
              <button
                onClick={createVisionType}
                disabled={!newVisionType.name}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增 Pipeline 类型弹窗 */}
      {showAddPipelineTypeModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              新增类型 - {showAddPipelineTypeModal === 'ocr_has' ? 'OCR+HaS' : 'GLM Vision'}
            </h3>
            <div className="space-y-4">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <input
                  type="text"
                  value={newPipelineType.description}
                  onChange={e => setNewPipelineType({ ...newPipelineType, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg"
                  placeholder={showAddPipelineTypeModal === 'ocr_has' ? '描述文字特征' : '描述视觉特征'}
                />
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
                  setNewPipelineType({ id: '', name: '', description: '', color: '#6B7280' });
                }}
                className="px-4 py-2 text-sm text-gray-600"
              >
                取消
              </button>
              <button
                onClick={createPipelineType}
                disabled={!newPipelineType.name}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${
                  showAddPipelineTypeModal === 'ocr_has'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Settings;
