import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import ImageBBoxEditor from '../components/ImageBBoxEditor';

// 类型定义
interface FileInfo {
  file_id: string;
  filename: string;
  file_size: number;
  file_type?: string;
  is_scanned?: boolean;
}

interface Entity {
  id: string;
  text: string;
  type: string;
  start: number;
  end: number;
  selected: boolean;
  source: 'regex' | 'llm' | 'manual' | 'has';
  coref_id?: string | null;
}

interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  type: string;
  text?: string | null;
  selected: boolean;
  source?: string;
}

interface EntityTypeConfig {
  id: string;
  name: string;
  color: string;
  description?: string;
  regex_pattern?: string | null;
  use_llm?: boolean;
  enabled?: boolean;
}

interface VisionTypeConfig {
  id: string;
  name: string;
  color: string;
  description?: string;
  enabled?: boolean;
}

interface PipelineConfig {
  mode: 'ocr_has' | 'glm_vision';
  name: string;
  description: string;
  enabled: boolean;
  types: VisionTypeConfig[];
}

type Stage = 'upload' | 'preview' | 'result';

// ============================================================
// 核心函数：执行图像识别
// ============================================================
async function runVisionDetection(
  fileId: string,
  ocrHasTypes: string[],
  glmVisionTypes: string[]
): Promise<{ boxes: BoundingBox[]; resultImage?: string }> {
  console.log('[Vision] 发送识别请求:', { ocrHasTypes, glmVisionTypes });
  
  const res = await fetch(`/api/v1/redaction/${fileId}/vision?page=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selected_ocr_has_types: ocrHasTypes,
      selected_glm_vision_types: glmVisionTypes,
    }),
  });
  
  if (!res.ok) {
    throw new Error('图像识别失败');
  }
  
  const data = await res.json();
  const boxes = (data.bounding_boxes || []).map((b: any, idx: number) => ({
    ...b,
    id: b.id || `bbox_${idx}`,
    selected: true,
  }));
  
  return { boxes, resultImage: data.result_image };
}

export const Playground: React.FC = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('upload');
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [content, setContent] = useState('');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [redactedContent, setRedactedContent] = useState('');
  const [redactedCount, setRedactedCount] = useState(0);
  const [entityMap, setEntityMap] = useState<Record<string, string>>({});
  
  // 实体类型配置
  const [entityTypes, setEntityTypes] = useState<EntityTypeConfig[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [visionTypes, setVisionTypes] = useState<VisionTypeConfig[]>([]);
  
  // 两个 Pipeline 独立选择 - 使用 ref 确保最新值可用
  const [selectedOcrHasTypes, setSelectedOcrHasTypes] = useState<string[]>([]);
  const [selectedGlmVisionTypes, setSelectedGlmVisionTypes] = useState<string[]>([]);
  const selectedOcrHasTypesRef = useRef(selectedOcrHasTypes);
  const selectedGlmVisionTypesRef = useRef(selectedGlmVisionTypes);
  
  // 同步更新 ref（立即同步，不等待 useEffect）
  const updateOcrHasTypes = useCallback((types: string[]) => {
    selectedOcrHasTypesRef.current = types;
    setSelectedOcrHasTypes(types);
    localStorage.setItem('ocrHasTypes', JSON.stringify(types));
  }, []);
  
  const updateGlmVisionTypes = useCallback((types: string[]) => {
    selectedGlmVisionTypesRef.current = types;
    setSelectedGlmVisionTypes(types);
    // 同步保存到 localStorage，解决闭包问题
    localStorage.setItem('glmVisionTypes', JSON.stringify(types));
  }, []);
  
  const [pipelines, setPipelines] = useState<PipelineConfig[]>([]);
  const [typeTab, setTypeTab] = useState<'text' | 'vision'>('text');
  const [hasMode, setHasMode] = useState<'auto' | 'ner' | 'hide'>('auto');
  const [replacementMode, setReplacementMode] = useState<'structured' | 'smart' | 'mask'>('structured');
  
  // 划词相关
  const [selectedText, setSelectedText] = useState<{ text: string; start: number; end: number } | null>(null);
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [selectedOverlapIds, setSelectedOverlapIds] = useState<string[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  
  const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[]>([]);
  const [undoStack, setUndoStack] = useState<Entity[][]>([]);
  const [redoStack, setRedoStack] = useState<Entity[][]>([]);
  const [imageUndoStack, setImageUndoStack] = useState<BoundingBox[][]>([]);
  const [imageRedoStack, setImageRedoStack] = useState<BoundingBox[][]>([]);
  const [imageRenderSize, setImageRenderSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [resultImage, setResultImage] = useState<string | null>(null);

  // 加载实体类型配置
  useEffect(() => {
    fetchEntityTypes();
    fetchVisionTypes();
  }, []);

  // 页面获得焦点时重新获取类型列表
  useEffect(() => {
    const handleFocus = () => {
      fetchEntityTypes();
      fetchVisionTypes();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  useEffect(() => {
    if (!selectedTypeId && entityTypes.length > 0) {
      setSelectedTypeId(entityTypes[0].id);
    }
  }, [entityTypes, selectedTypeId]);

  const fetchEntityTypes = async () => {
    try {
      const res = await fetch('/api/v1/custom-types?enabled_only=true');
      if (!res.ok) throw new Error('获取类型失败');
      const data = await res.json();
      const types = data.custom_types || [];
      setEntityTypes(types);
      setSelectedTypes(types.map((t: EntityTypeConfig) => t.id));
    } catch (err) {
      console.error('获取实体类型失败', err);
      setEntityTypes([
        { id: 'PERSON', name: '人名', color: '#3B82F6' },
        { id: 'ID_CARD', name: '身份证号', color: '#EF4444' },
        { id: 'PHONE', name: '电话号码', color: '#F97316' },
        { id: 'ADDRESS', name: '地址', color: '#6366F1' },
        { id: 'BANK_CARD', name: '银行卡号', color: '#EC4899' },
        { id: 'CASE_NUMBER', name: '案件编号', color: '#8B5CF6' },
      ]);
      setSelectedTypes(['PERSON', 'ID_CARD', 'PHONE', 'ADDRESS', 'BANK_CARD', 'CASE_NUMBER']);
    }
  };

  const fetchVisionTypes = async () => {
    try {
      const res = await fetch('/api/v1/vision-pipelines');
      if (!res.ok) throw new Error('获取Pipeline配置失败');
      const data: PipelineConfig[] = await res.json();
      const normalizedPipelines = data.map(p =>
        p.mode === 'glm_vision'
          ? {
              ...p,
              name: 'GLM Vision (本地)',
              description: '使用本地 GLM-4.6V-Flash-Q4_K_M.gguf + mmproj-F16.gguf 识别视觉信息。',
            }
          : p
      );
      setPipelines(normalizedPipelines);
      
      const allTypes: VisionTypeConfig[] = [];
      const ocrHasTypeIds: string[] = [];
      
      normalizedPipelines.forEach(pipeline => {
        if (pipeline.enabled) {
          pipeline.types.forEach(t => {
            if (t.enabled) {
              allTypes.push(t);
              if (pipeline.mode === 'ocr_has') {
                ocrHasTypeIds.push(t.id);
              }
              // GLM Vision 默认不选中，用户需手动勾选
            }
          });
        }
      });
      
      setVisionTypes(allTypes);
      const savedOcrHasTypes = localStorage.getItem('ocrHasTypes');
      if (savedOcrHasTypes) {
        try {
          const parsed = JSON.parse(savedOcrHasTypes);
          updateOcrHasTypes(parsed.filter((id: string) => ocrHasTypeIds.includes(id)));
        } catch {
          updateOcrHasTypes(ocrHasTypeIds);
        }
      } else {
        updateOcrHasTypes(ocrHasTypeIds);
      }
      // GLM 默认不选中，但从 localStorage 恢复用户之前的选择
      const savedGlmTypes = localStorage.getItem('glmVisionTypes');
      if (savedGlmTypes) {
        try {
          const parsed = JSON.parse(savedGlmTypes);
          updateGlmVisionTypes(parsed);
        } catch {
          updateGlmVisionTypes([]);
        }
      } else {
        updateGlmVisionTypes([]);
      }
    } catch (err) {
      console.error('获取图像类型失败', err);
      setVisionTypes([
        { id: 'PERSON', name: '人名/签名', color: '#3B82F6' },
        { id: 'ID_CARD', name: '身份证号', color: '#EF4444' },
        { id: 'PHONE', name: '电话号码', color: '#F97316' },
      ]);
      updateOcrHasTypes(['PERSON', 'ID_CARD', 'PHONE']);
      updateGlmVisionTypes([]);
    }
  };

  const sortedEntityTypes = [...entityTypes].sort((a, b) => {
    const aRegex = a.regex_pattern ? 1 : 0;
    const bRegex = b.regex_pattern ? 1 : 0;
    if (aRegex !== bRegex) return bRegex - aRegex;
    return a.name.localeCompare(b.name);
  });

  const getTypeConfig = (typeId: string): { name: string; color: string } => {
    const config = entityTypes.find(t => t.id === typeId);
    return config || { name: typeId, color: '#6B7280' };
  };

  const getVisionTypeConfig = (typeId: string): { name: string; color: string } => {
    const config = visionTypes.find(t => t.id === typeId);
    return config || { name: typeId, color: '#6B7280' };
  };

  // 切换类型选择
  const toggleVisionType = (typeId: string, pipelineMode: 'ocr_has' | 'glm_vision') => {
    if (pipelineMode === 'ocr_has') {
      const isActive = selectedOcrHasTypes.includes(typeId);
      const next = isActive 
        ? selectedOcrHasTypes.filter(t => t !== typeId) 
        : [...selectedOcrHasTypes, typeId];
      updateOcrHasTypes(next);
      setBoundingBoxes(boxes =>
        boxes.map(b => b.type === typeId ? { ...b, selected: !isActive } : b)
      );
    } else {
      const isActive = selectedGlmVisionTypes.includes(typeId);
      const next = isActive 
        ? selectedGlmVisionTypes.filter(t => t !== typeId) 
        : [...selectedGlmVisionTypes, typeId];
      updateGlmVisionTypes(next);
      setBoundingBoxes(boxes =>
        boxes.map(b => b.type === typeId ? { ...b, selected: !isActive } : b)
      );
    }
  };

  const applyEntities = (next: Entity[]) => {
    setUndoStack(prev => [...prev, entities]);
    setRedoStack([]);
    setEntities(next);
  };

  const undo = () => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const nextPrev = [...prev];
      const last = nextPrev.pop()!;
      setRedoStack(r => [...r, entities]);
      setEntities(last);
      return nextPrev;
    });
  };

  const redo = () => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const nextPrev = [...prev];
      const last = nextPrev.pop()!;
      setUndoStack(u => [...u, entities]);
      setEntities(last);
      return nextPrev;
    });
  };

  const resetImageHistory = useCallback(() => {
    setImageUndoStack([]);
    setImageRedoStack([]);
  }, []);

  const undoImage = useCallback(() => {
    setImageUndoStack(prev => {
      if (prev.length === 0) return prev;
      const nextPrev = [...prev];
      const last = nextPrev.pop()!;
      setImageRedoStack(r => [...r, boundingBoxes]);
      setBoundingBoxes(last);
      return nextPrev;
    });
  }, [boundingBoxes]);

  const redoImage = useCallback(() => {
    setImageRedoStack(prev => {
      if (prev.length === 0) return prev;
      const nextPrev = [...prev];
      const last = nextPrev.pop()!;
      setImageUndoStack(u => [...u, boundingBoxes]);
      setBoundingBoxes(last);
      return nextPrev;
    });
  }, [boundingBoxes]);

  // Toast
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const colors = {
      success: 'bg-green-600',
      error: 'bg-red-600',
      info: 'bg-blue-600',
    };
    const toast = document.createElement('div');
    toast.className = `fixed bottom-5 right-5 px-4 py-2.5 rounded-lg ${colors[type]} text-white text-sm font-medium shadow-lg z-50 transition-opacity`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, 2500);
  };

  // ============================================================
  // 文件上传处理 - 只负责上传和解析，不触发识别
  // ============================================================
  
  // 待处理的文件信息（上传解析完成后设置，触发 useEffect 进行识别）
  const [pendingFile, setPendingFile] = useState<{
    fileId: string;
    fileType: string;
    isScanned: boolean;
    content: string;
  } | null>(null);
  
  const handleFileDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    setIsLoading(true);
    
    try {
      // 1. 上传文件
      setLoadingMessage('正在上传文件...');
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadRes = await fetch('/api/v1/files/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('文件上传失败');
      const uploadData = await uploadRes.json();
      
      const newFileInfo = {
        file_id: uploadData.file_id,
        filename: uploadData.filename,
        file_size: uploadData.file_size,
        file_type: uploadData.file_type,
      };
      
      // 2. 解析文件
      setLoadingMessage('正在解析文件...');
      const parseRes = await fetch(`/api/v1/files/${uploadData.file_id}/parse`);
      if (!parseRes.ok) throw new Error('文件解析失败');
      const parseData = await parseRes.json();
      
      const isScanned = parseData.is_scanned || false;
      const parsedContent = parseData.content || '';
      
      // 更新状态
      setFileInfo({ ...newFileInfo, is_scanned: isScanned });
      setContent(parsedContent);
      setBoundingBoxes([]);
      resetImageHistory();
      setEntities([]);
      
      // 3. 设置待处理文件，触发 useEffect 进行识别
      // useEffect 中可以直接读取最新的 state
      setPendingFile({
        fileId: uploadData.file_id,
        fileType: uploadData.file_type,
        isScanned,
        content: parsedContent,
      });
      
    } catch (err) {
      showToast(err instanceof Error ? err.message : '处理失败', 'error');
      setIsLoading(false);
      setLoadingMessage('');
    }
    // 注意：isLoading 和 loadingMessage 在 useEffect 中清理
  };
  
  // ============================================================
  // 文件上传后自动识别 - 使用 useEffect 确保读取最新的 state
  // 关键：只依赖 pendingFile，但使用 ref 读取最新的类型选择
  // ============================================================
  
  // 使用 ref 存储最新的类型选择，避免 useEffect 依赖问题
  const latestOcrHasTypesRef = useRef(selectedOcrHasTypes);
  const latestGlmVisionTypesRef = useRef(selectedGlmVisionTypes);
  const latestSelectedTypesRef = useRef(selectedTypes);
  const latestHasModeRef = useRef(hasMode);
  
  // 每次 state 变化时同步更新 ref
  latestOcrHasTypesRef.current = selectedOcrHasTypes;
  latestGlmVisionTypesRef.current = selectedGlmVisionTypes;
  latestSelectedTypesRef.current = selectedTypes;
  latestHasModeRef.current = hasMode;
  
  useEffect(() => {
    if (!pendingFile) return;
    
    const { fileId, fileType, isScanned, content } = pendingFile;
    
    // 立即清除 pendingFile，防止重复触发
    setPendingFile(null);
    
    const doRecognition = async () => {
      try {
        const isImage = fileType === 'image' || isScanned;
        
        if (isImage) {
          setLoadingMessage('正在进行图像识别...');
          
          // 从 localStorage 读取 GLM 类型（最可靠的方式，绕过 React 闭包问题）
          const ocrTypes = latestOcrHasTypesRef.current;
          let glmTypes: string[] = [];
          try {
            const savedGlmTypes = localStorage.getItem('glmVisionTypes');
            if (savedGlmTypes) {
              glmTypes = JSON.parse(savedGlmTypes);
            }
          } catch {
            glmTypes = [];
          }
          
          console.log('[Recognition] 图像模式，开始识别');
          console.log('[Recognition] OCR+HaS 类型:', ocrTypes);
          console.log('[Recognition] GLM Vision 类型 (from localStorage):', glmTypes);
          
          const result = await runVisionDetection(fileId, ocrTypes, glmTypes);
          
          setBoundingBoxes(result.boxes);
          resetImageHistory();
          if (result.resultImage) {
            setResultImage(result.resultImage);
          }
          showToast(`识别到 ${result.boxes.length} 个敏感区域`, 'success');
        } else if (content) {
          setLoadingMessage('AI正在识别敏感信息...');
          const nerRes = await fetch(`/api/v1/files/${fileId}/ner/hybrid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              entity_type_ids: latestSelectedTypesRef.current, 
              has_mode: latestHasModeRef.current 
            }),
          });
          
          if (nerRes.ok) {
            const nerData = await nerRes.json();
            const entitiesWithSource = (nerData.entities || []).map((e: any, idx: number) => ({
              ...e,
              id: e.id || `entity_${idx}`,
              selected: true,
              source: e.source || 'llm',
            }));
            setEntities(entitiesWithSource);
            setUndoStack([]);
            setRedoStack([]);
            showToast(`识别到 ${entitiesWithSource.length} 处敏感信息`, 'success');
          }
        }
        
        setStage('preview');
      } catch (err) {
        showToast(err instanceof Error ? err.message : '识别失败', 'error');
      } finally {
        setIsLoading(false);
        setLoadingMessage('');
      }
    };
    
    doRecognition();
  }, [pendingFile]); // 只依赖 pendingFile，类型选择通过 ref 获取

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFileDrop,
    accept: {
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxFiles: 1,
  });

  // 处理文本选择
  const handleTextSelect = () => {
    if (isImageMode) return;
    const selection = window.getSelection();
    if (!selection || !contentRef.current) {
      setSelectedText(null);
      setSelectionPos(null);
      setSelectedOverlapIds([]);
      return;
    }
    if (selection.isCollapsed) {
      if (selectedText && selectionPos) {
        return;
      }
      setSelectedText(null);
      setSelectionPos(null);
      setSelectedOverlapIds([]);
      return;
    }
    
    const text = selection.toString().trim();
    if (!text || text.length < 2) {
      setSelectedText(null);
      setSelectionPos(null);
      setSelectedOverlapIds([]);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      setSelectedText(null);
      setSelectionPos(null);
      setSelectedOverlapIds([]);
      return;
    }
    
    const offsets = getSelectionOffsets(range, contentRef.current);
    const start = offsets?.start ?? content.indexOf(text);
    const end = offsets?.end ?? (start + text.length);
    if (start < 0 || end < 0) {
      setSelectedText(null);
      setSelectionPos(null);
      setSelectedOverlapIds([]);
      return;
    }
    
    const overlaps = entities.filter(e =>
      (e.start <= start && e.end > start) || (e.start < end && e.end >= end)
    );
    
    const rect = range.getBoundingClientRect();
    setSelectionPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
    setSelectedOverlapIds(overlaps.map(e => e.id));
    if (!selectedTypeId) {
      const firstType = entityTypes.find(t => selectedTypes.includes(t.id))?.id || entityTypes[0]?.id;
      if (firstType) setSelectedTypeId(firstType);
    }
    
    setSelectedText({ text, start, end });
  };

  const getSelectionOffsets = (range: Range, root: HTMLElement) => {
    let start = -1;
    let end = -1;
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const textLength = node.textContent?.length || 0;
      if (node === range.startContainer) {
        start = offset + range.startOffset;
      }
      if (node === range.endContainer) {
        end = offset + range.endOffset;
        break;
      }
      offset += textLength;
    }
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    return { start, end };
  };

  // 添加手动实体
  const addManualEntity = (typeId: string) => {
    if (!selectedText) return;
    const newEntity: Entity = {
      id: `manual_${Date.now()}`,
      text: selectedText.text,
      type: typeId,
      start: selectedText.start,
      end: selectedText.end,
      selected: true,
      source: 'manual',
    };

    const next = entities
      .filter(e => !selectedOverlapIds.includes(e.id))
      .concat(newEntity)
      .sort((a, b) => a.start - b.start);
    applyEntities(next);

    if (selectedOverlapIds.length > 0) {
      showToast('已更新标记', 'success');
    } else {
      const config = getTypeConfig(typeId);
      showToast(`已添加: ${config.name}`, 'success');
    }
    
    setSelectedText(null);
    setSelectionPos(null);
    setSelectedOverlapIds([]);
    window.getSelection()?.removeAllRanges();
  };

  const removeSelectedEntities = () => {
    if (selectedOverlapIds.length === 0) return;
    applyEntities(entities.filter(e => !selectedOverlapIds.includes(e.id)));
    setSelectedText(null);
    setSelectionPos(null);
    setSelectedOverlapIds([]);
    window.getSelection()?.removeAllRanges();
    showToast('已删除标记', 'info');
  };

  // 重新识别
  const handleRerunNer = async () => {
    if (!fileInfo) return;
    setIsLoading(true);
    setLoadingMessage('重新识别中...');
    
    try {
      if (isImageMode) {
        console.log('[Rerun] OCR+HaS 类型:', selectedOcrHasTypes);
        console.log('[Rerun] GLM Vision 类型:', selectedGlmVisionTypes);
        
        const result = await runVisionDetection(
          fileInfo.file_id,
          selectedOcrHasTypes,
          selectedGlmVisionTypes
        );
        
        setBoundingBoxes(result.boxes);
        resetImageHistory();
        if (result.resultImage) {
          setResultImage(result.resultImage);
        }
        showToast(`重新识别完成：${result.boxes.length} 个区域`, 'success');
      } else {
        const nerRes = await fetch(`/api/v1/files/${fileInfo.file_id}/ner/hybrid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type_ids: selectedTypes, has_mode: hasMode }),
        });
        if (!nerRes.ok) throw new Error('重新识别失败');
        const nerData = await nerRes.json();
        const entitiesWithSource = (nerData.entities || []).map((e: any, idx: number) => ({
          ...e,
          id: e.id || `entity_${idx}`,
          selected: true,
          source: e.source || 'llm',
        }));
        setEntities(entitiesWithSource);
        setUndoStack([]);
        setRedoStack([]);
        showToast(`重新识别完成：${entitiesWithSource.length} 处`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '重新识别失败', 'error');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // 删除实体
  const removeEntity = (id: string) => {
    applyEntities(entities.filter(e => e.id !== id));
    showToast('已删除', 'info');
  };

  // 切换选中
  const toggleEntity = (id: string) => {
    applyEntities(entities.map(e => 
      e.id === id ? { ...e, selected: !e.selected } : e
    ));
  };

  // 执行脱敏
  const handleRedact = async () => {
    if (!fileInfo) return;
    setIsLoading(true);
    setLoadingMessage('正在执行脱敏...');
    
    try {
      const selectedEntities = entities.filter(e => e.selected);
      const selectedBoxes = boundingBoxes.filter(b => b.selected);
      
      const res = await fetch('/api/v1/redaction/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileInfo.file_id,
          entities: selectedEntities,
          bounding_boxes: selectedBoxes,
          config: { replacement_mode: replacementMode, entity_types: [], custom_replacements: {} },
        }),
      });
      
      if (!res.ok) throw new Error('脱敏处理失败');
      
      const result = await res.json();
      setEntityMap(result.entity_map || {});
      setRedactedCount(result.redacted_count || 0);
      
      const compareRes = await fetch(`/api/v1/redaction/${fileInfo.file_id}/compare`);
      if (compareRes.ok) {
        const compareData = await compareRes.json();
        setRedactedContent(compareData.redacted_content || '');
      }
      
      setStage('result');
      showToast(`完成，共处理 ${result.redacted_count} 处`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '脱敏失败', 'error');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handleReset = () => {
    setStage('upload');
    setFileInfo(null);
    setContent('');
    setEntities([]);
    setRedactedContent('');
    setRedactedCount(0);
    setEntityMap({});
    setSelectedText(null);
    setSelectionPos(null);
    setSelectedOverlapIds([]);
    setUndoStack([]);
    setRedoStack([]);
    setBoundingBoxes([]);
    resetImageHistory();
    setResultImage(null);
  };

  const isImageMode = !!fileInfo && (fileInfo.file_type === 'image' || fileInfo.is_scanned);
  const imageUrl = fileInfo ? `/api/v1/files/${fileInfo.file_id}/download` : '';
  const canUndo = isImageMode ? imageUndoStack.length > 0 : undoStack.length > 0;
  const canRedo = isImageMode ? imageRedoStack.length > 0 : redoStack.length > 0;
  const handleUndo = () => (isImageMode ? undoImage() : undo());
  const handleRedo = () => (isImageMode ? redoImage() : redo());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const modKey = isMac ? e.metaKey : e.ctrlKey;
      if (!modKey) return;

      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRedo, handleUndo]);

  useEffect(() => {
    setTypeTab(isImageMode ? 'vision' : 'text');
  }, [isImageMode]);

  useEffect(() => {
    const updateImageSize = () => {
      if (!imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      setImageRenderSize({ width: rect.width, height: rect.height });
      setImageNaturalSize({ width: imgRef.current.naturalWidth, height: imgRef.current.naturalHeight });
    };
    updateImageSize();
    window.addEventListener('resize', updateImageSize);
    return () => window.removeEventListener('resize', updateImageSize);
  }, [imageUrl]);

  const allSelectedVisionTypes = [...selectedOcrHasTypes, ...selectedGlmVisionTypes];
  const visibleBoxes = boundingBoxes;
  const mergeVisibleBoxes = useCallback((nextBoxes: BoundingBox[], prevBoxes: BoundingBox[] = []) => {
    const ids = new Set([...nextBoxes, ...prevBoxes].map(b => b.id));
    const otherBoxes = boundingBoxes.filter(b => !ids.has(b.id));
    return [...otherBoxes, ...nextBoxes];
  }, [boundingBoxes]);

  const toggleBox = (id: string) => {
    setBoundingBoxes(prev => prev.map(b => b.id === id ? { ...b, selected: !b.selected } : b));
  };

  const selectAll = () => {
    if (isImageMode) {
      setBoundingBoxes(prev => prev.map(b => ({
        ...b,
        selected: allSelectedVisionTypes.includes(b.type),
      })));
    } else {
      setEntities(prev => prev.map(e => ({ ...e, selected: true })));
    }
  };

  const deselectAll = () => {
    if (isImageMode) {
      setBoundingBoxes(prev => prev.map(b => ({ ...b, selected: false })));
    } else {
      setEntities(prev => prev.map(e => ({ ...e, selected: false })));
    }
  };

  const selectedCount = isImageMode
    ? visibleBoxes.filter(b => b.selected).length
    : entities.filter(e => e.selected).length;

  // 渲染带下划线标记的内容
  const renderMarkedContent = () => {
    if (!content) return <p className="text-gray-400">暂无内容</p>;
    
    const sorted = [...entities].sort((a, b) => a.start - b.start);
    const segments: React.ReactNode[] = [];
    let lastEnd = 0;

    sorted.forEach((entity) => {
      if (entity.start < lastEnd) {
        return;
      }
      if (entity.start > lastEnd) {
        segments.push(
          <span key={`t-${lastEnd}`}>{content.slice(lastEnd, entity.start)}</span>
        );
      }
      
      const config = getTypeConfig(entity.type);
      const sourceLabel = entity.source === 'regex' ? '正则' : entity.source === 'manual' ? '手动' : 'AI';
      
      segments.push(
        <span
          key={entity.id}
          onClick={() => toggleEntity(entity.id)}
          className={`cursor-pointer transition-all border-b-2 hover:bg-opacity-20 ${
            entity.selected ? '' : 'opacity-40'
          }`}
          style={{
            borderColor: entity.selected ? config.color : '#9ca3af',
            backgroundColor: entity.selected ? `${config.color}15` : 'transparent',
          }}
          title={`${config.name} [${sourceLabel}] - 点击切换`}
        >
          {content.slice(entity.start, entity.end)}
        </span>
      );
      lastEnd = entity.end;
    });

    if (lastEnd < content.length) {
      segments.push(<span key="end">{content.slice(lastEnd)}</span>);
    }

    return segments;
  };

  // 统计
  const getStats = () => {
    const stats: Record<string, { total: number; selected: number }> = {};
    entities.forEach(e => {
      if (!stats[e.type]) stats[e.type] = { total: 0, selected: 0 };
      stats[e.type].total++;
      if (e.selected) stats[e.type].selected++;
    });
    return stats;
  };
  const stats = getStats();

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 上传阶段 */}
      {stage === 'upload' && (
        <div className="flex-1 flex gap-6 p-6">
          {/* 上传区域 */}
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-lg">
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all bg-white ${
                  isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
                }`}
              >
                <input {...getInputProps()} />
                <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-blue-100 flex items-center justify-center">
                  <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                  </svg>
                </div>
                <p className="text-base font-medium text-gray-700 mb-1">拖拽文件到此处上传</p>
                <p className="text-sm text-gray-400 mb-4">支持 .doc .docx .pdf .jpg .png</p>
              </div>
            </div>
          </div>
          
          {/* 类型配置 */}
          <div className="w-64 bg-white rounded-xl border border-gray-200 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">识别类型</h3>
              <p className="text-xs text-gray-500">选择要识别的敏感信息类型</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setTypeTab('text')}
                  className={`text-xs px-2 py-1 rounded border ${
                    typeTab === 'text'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  文本
                </button>
                <button
                  onClick={() => setTypeTab('vision')}
                  className={`text-xs px-2 py-1 rounded border ${
                    typeTab === 'vision'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500'
                  }`}
                  title="仅图片/扫描件生效"
                >
                  图像
                </button>
              </div>
              {typeTab === 'text' && (
                <div className="mt-3">
                  <label className="text-xs text-gray-500">HaS 模式</label>
                  <select
                    value={hasMode}
                    onChange={(e) => setHasMode(e.target.value as 'auto' | 'ner' | 'hide')}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="auto">自动融合（推荐）</option>
                    <option value="ner">NER（快速）</option>
                    <option value="hide">Hide（指代增强）</option>
                  </select>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto p-3">
              {typeTab === 'vision' ? (
                pipelines.length === 0 ? (
                  <p className="text-sm text-gray-400 p-2">加载中...</p>
                ) : (
                  <div className="space-y-4">
                    {pipelines.map(pipeline => {
                      const isGlmVision = pipeline.mode === 'glm_vision';
                      const displayName = isGlmVision ? 'GLM Vision (本地)' : pipeline.name;
                      return (
                        <div key={pipeline.mode}>
                          <div className={`flex items-center gap-2 mb-2 px-2 py-1 rounded-lg ${
                            pipeline.mode === 'ocr_has' ? 'bg-blue-50' : 'bg-purple-50'
                          }`}>
                            <span className={`text-xs font-medium ${
                              pipeline.mode === 'ocr_has' ? 'text-blue-700' : 'text-purple-700'
                            }`}>
                              {pipeline.mode === 'ocr_has' ? '📝 ' : '🖥️ '}{displayName}
                            </span>
                            {!pipeline.enabled && (
                              <span className="text-xs text-gray-400">(已禁用)</span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 gap-1">
                          {pipeline.types.filter(t => t.enabled).map(type => {
                            const active = pipeline.mode === 'ocr_has' 
                              ? selectedOcrHasTypes.includes(type.id)
                              : selectedGlmVisionTypes.includes(type.id);
                            return (
                              <button
                                key={type.id}
                                onClick={() => toggleVisionType(type.id, pipeline.mode as 'ocr_has' | 'glm_vision')}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all text-left ${
                                  active
                                    ? pipeline.mode === 'ocr_has' 
                                      ? 'border-blue-500 bg-blue-50' 
                                      : 'border-purple-500 bg-purple-50'
                                    : 'border-gray-200 bg-gray-50 opacity-50'
                                }`}
                              >
                                <input 
                                  type="checkbox" 
                                  checked={active} 
                                  onChange={() => {}}
                                  className={`w-3.5 h-3.5 rounded ${
                                    pipeline.mode === 'ocr_has' ? 'accent-blue-500' : 'accent-purple-500'
                                  }`}
                                />
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: type.color }} />
                                <span className={`text-sm flex-1 ${active ? 'text-gray-700' : 'text-gray-400'}`}>{type.name}</span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : sortedEntityTypes.length === 0 ? (
                <p className="text-sm text-gray-400 p-2">加载中...</p>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {sortedEntityTypes.map(type => {
                    const active = selectedTypes.includes(type.id);
                    return (
                      <button
                        key={type.id}
                        onClick={() => {
                          setSelectedTypes(prev =>
                            active ? prev.filter(t => t !== type.id) : [...prev, type.id]
                          );
                        }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-left ${
                          active
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: type.color }} />
                        <span className="text-sm text-gray-700 flex-1">{type.name}</span>
                        {type.regex_pattern && <span className="text-[10px] text-orange-500">正则</span>}
                        {type.use_llm && <span className="text-[10px] text-purple-500">AI</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-3 border-t border-gray-100 text-xs text-gray-500">
              {typeTab === 'vision'
                ? `已选 ${selectedOcrHasTypes.length + selectedGlmVisionTypes.length} / ${visionTypes.length} 种类型`
                : `已选 ${selectedTypes.length} / ${entityTypes.length} 种类型`}
            </div>
          </div>
        </div>
      )}

      {/* 预览编辑阶段 */}
      {stage === 'preview' && (
        <div className="flex-1 flex gap-4 p-4 overflow-hidden">
          {/* 文档内容 */}
          <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">{fileInfo?.filename}</h3>
                <p className="text-xs text-gray-500">选中文字后弹出快捷操作 | 点击标记切换选中</p>
              </div>
              <button onClick={handleReset} className="text-xs text-gray-500 hover:text-blue-600">重新上传</button>
            </div>
            <div
              ref={contentRef}
              onMouseUp={handleTextSelect}
              onKeyUp={handleTextSelect}
              className="flex-1 overflow-auto p-5 select-text"
            >
              {isImageMode ? (
                <div className="relative max-w-full">
                  {fileInfo && (
                    <ImageBBoxEditor
                      imageSrc={imageUrl}
                      boxes={visibleBoxes}
                      onBoxesChange={(newBoxes) => {
                        setBoundingBoxes(mergeVisibleBoxes(newBoxes));
                      }}
                      onBoxesCommit={(prevBoxes, nextBoxes) => {
                        const prevAll = mergeVisibleBoxes(prevBoxes, nextBoxes);
                        const nextAll = mergeVisibleBoxes(nextBoxes, prevBoxes);
                        setImageUndoStack(prev => [...prev, prevAll]);
                        setImageRedoStack([]);
                        setBoundingBoxes(nextAll);
                      }}
                      getTypeConfig={getVisionTypeConfig}
                      availableTypes={visionTypes.map(t => ({ id: t.id, name: t.name, color: t.color }))}
                      defaultType={visionTypes[0]?.id || 'CUSTOM'}
                    />
                  )}
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-sm text-gray-800 leading-7">
                  {renderMarkedContent()}
                </div>
              )}
              {!isImageMode && selectedText && selectionPos && (
                <div
                  className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[220px]"
                  style={{
                    left: selectionPos.x,
                    top: selectionPos.y,
                    transform: 'translate(-50%, -100%)',
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                >
                  <div className="text-[10px] text-gray-500 mb-1">选中文本</div>
                  <div className="text-xs text-gray-800 bg-gray-50 rounded px-2 py-1 mb-2 max-w-[260px] truncate">
                    {selectedText.text}
                  </div>
                  <div className="text-[10px] text-gray-500 mb-1">类型</div>
                  <select
                    value={selectedTypeId}
                    onChange={(e) => setSelectedTypeId(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {entityTypes.filter(t => selectedTypes.includes(t.id)).map(type => (
                      <option key={type.id} value={type.id}>{type.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => addManualEntity(selectedTypeId)}
                      className="flex-1 text-xs bg-blue-600 text-white rounded px-2 py-1"
                    >
                      {selectedOverlapIds.length > 0 ? '更新标记' : '添加标记'}
                    </button>
                    {selectedOverlapIds.length > 0 && (
                      <button
                        onClick={removeSelectedEntities}
                        className="text-xs text-red-600 border border-red-200 rounded px-2 py-1"
                      >
                        删除
                      </button>
                    )}
                    <button
                      onClick={() => { setSelectedText(null); setSelectionPos(null); setSelectedOverlapIds([]); }}
                      className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-1"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右侧面板 */}
          <div className="w-72 flex flex-col gap-4 overflow-hidden">
            {/* 类型配置 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-700">识别类型</h3>
                <button
                  onClick={() => navigate('/settings')}
                  className="text-[10px] text-blue-600 hover:text-blue-700"
                >
                  去管理
                </button>
              </div>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setTypeTab('text')}
                  className={`text-xs px-2 py-1 rounded border ${
                    typeTab === 'text'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  文本
                </button>
                <button
                  onClick={() => setTypeTab('vision')}
                  className={`text-xs px-2 py-1 rounded border ${
                    typeTab === 'vision'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500'
                  }`}
                  title="仅图片/扫描件生效"
                >
                  图像
                </button>
              </div>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={handleUndo}
                  disabled={!canUndo}
                  className={`text-xs px-2 py-1 rounded border ${
                    !canUndo
                      ? 'border-gray-200 text-gray-300'
                      : 'border-gray-300 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  撤销
                </button>
                <button
                  onClick={handleRedo}
                  disabled={!canRedo}
                  className={`text-xs px-2 py-1 rounded border ${
                    !canRedo
                      ? 'border-gray-200 text-gray-300'
                      : 'border-gray-300 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  重做
                </button>
              </div>
              {typeTab === 'vision' && (
                <div className="mb-3 p-2 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg">
                  <p className="text-[10px] text-gray-600">
                    <span className="font-medium">自动双识别：</span>
                    OCR+HaS（PaddleOCR-VL-1.5 + Qwen3-0.6B）+ GLM Vision（本地，GLM-4.6V-Flash-Q4_K_M.gguf + mmproj-F16.gguf）
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    在设置中配置启用的类型
                  </p>
                </div>
              )}
              <div className="max-h-56 overflow-auto">
                {typeTab === 'vision' ? (
                  <div className="space-y-3">
                    {pipelines.map(pipeline => {
                      const isGlmVision = pipeline.mode === 'glm_vision';
                      const displayName = isGlmVision ? '🖥️ GLM Vision (本地)' : '📝 OCR+HaS';
                      return (
                        <div key={pipeline.mode}>
                          <div className={`text-[10px] font-medium mb-1 ${
                            pipeline.mode === 'ocr_has' ? 'text-blue-600' : 'text-purple-600'
                          }`}>
                            {displayName}
                          </div>
                          <div className="grid grid-cols-1 gap-1">
                          {pipeline.types.filter(t => t.enabled).map(type => {
                            const active = pipeline.mode === 'ocr_has' 
                              ? selectedOcrHasTypes.includes(type.id)
                              : selectedGlmVisionTypes.includes(type.id);
                            return (
                              <button
                                key={type.id}
                                onClick={() => toggleVisionType(type.id, pipeline.mode as 'ocr_has' | 'glm_vision')}
                                className={`flex items-center gap-1.5 text-xs rounded-lg border px-2 py-1 text-left ${
                                  active
                                    ? pipeline.mode === 'ocr_has'
                                      ? 'border-blue-500 bg-blue-50'
                                      : 'border-purple-500 bg-purple-50'
                                    : 'border-gray-200 bg-gray-50 opacity-50'
                                }`}
                              >
                                <input 
                                  type="checkbox" 
                                  checked={active} 
                                  onChange={() => {}}
                                  className={`w-3 h-3 rounded ${
                                    pipeline.mode === 'ocr_has' ? 'accent-blue-500' : 'accent-purple-500'
                                  }`}
                                />
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: type.color }} />
                                <span className={`flex-1 ${active ? 'text-gray-600' : 'text-gray-400'}`}>{type.name}</span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  sortedEntityTypes.map(type => {
                    const active = selectedTypes.includes(type.id);
                    return (
                      <button
                        key={type.id}
                        onClick={() => {
                          setSelectedTypes(prev =>
                            active ? prev.filter(t => t !== type.id) : [...prev, type.id]
                          );
                        }}
                        className={`flex items-center gap-2 text-xs rounded-lg border px-2 py-2 text-left ${
                          active
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: type.color }} />
                        <span className="flex-1 text-gray-600">{type.name}</span>
                        {type.regex_pattern && <span className="text-[10px] text-orange-500">正则</span>}
                        {type.use_llm && <span className="text-[10px] text-purple-500">AI</span>}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleRerunNer}
                  className="flex-1 text-xs bg-blue-600 text-white rounded-lg py-1.5"
                >
                  重新识别
                </button>
                <button
                  onClick={() => {
                    if (typeTab === 'vision') {
                      const ocrHasIds = pipelines.find(p => p.mode === 'ocr_has')?.types.filter(t => t.enabled).map(t => t.id) || [];
                      const glmIds = pipelines.find(p => p.mode === 'glm_vision')?.types.filter(t => t.enabled).map(t => t.id) || [];
                      updateOcrHasTypes(ocrHasIds);
                      updateGlmVisionTypes(glmIds);
                      setBoundingBoxes(prev => prev.map(b => ({ ...b, selected: true })));
                    } else {
                      setSelectedTypes(entityTypes.map(t => t.id));
                    }
                  }}
                  className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2"
                >
                  全选
                </button>
              </div>
              {typeTab === 'text' && (
                <p className="text-[10px] text-gray-400 mt-2">
                  正则类默认已启用，按需勾选后点"重新识别"
                </p>
              )}
            </div>

            {/* 划词添加提示 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs text-gray-500">
              在正文中选中文本，会弹出快捷操作浮层，可直接修改/新增标记。
            </div>

            {/* 统计 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 text-sm">识别结果</h3>
                <span className="text-xs text-gray-500">
                  {selectedCount}/{isImageMode ? visibleBoxes.length : entities.length}
                </span>
              </div>
              <div className="flex gap-2 mb-3">
                <button onClick={selectAll} className="flex-1 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100">全选</button>
                <button onClick={deselectAll} className="flex-1 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">取消</button>
              </div>
              {!isImageMode && (
                <>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">脱敏方式</label>
                    <select
                      value={replacementMode}
                      onChange={(e) => setReplacementMode(e.target.value as 'structured' | 'smart' | 'mask')}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="structured">结构化语义标签（推荐）</option>
                      <option value="smart">智能替换</option>
                      <option value="mask">掩码替换</option>
                    </select>
                  </div>
                  {Object.keys(stats).length > 0 && (
                    <div className="space-y-1.5">
                      {Object.entries(stats).map(([typeId, count]) => {
                        const config = getTypeConfig(typeId);
                        return (
                          <div key={typeId} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                              <span className="text-gray-600">{config.name}</span>
                            </div>
                            <span className="text-gray-900 font-medium">{count.selected}/{count.total}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 实体列表 */}
            <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col min-h-0">
              <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-700">
                {isImageMode ? '区域列表' : '实体列表'}
              </div>
              <div className="flex-1 overflow-auto divide-y divide-gray-50">
                {isImageMode ? (
                  visibleBoxes.length === 0 ? (
                    <p className="p-4 text-center text-sm text-gray-400">暂无识别结果</p>
                  ) : (
                    visibleBoxes.map(box => (
                      <div
                        key={box.id}
                        className={`px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-gray-50 ${!box.selected ? 'opacity-50' : ''}`}
                        onClick={() => toggleBox(box.id)}
                      >
                        <input
                          type="checkbox"
                          checked={box.selected}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 rounded"
                        />
                        <span className={`px-1 py-0.5 rounded text-[9px] font-bold text-white ${
                          box.source === 'ocr_has' ? 'bg-blue-500' : 
                          box.source === 'glm_vision' ? 'bg-purple-500' : 'bg-gray-400'
                        }`}>
                          {box.source === 'ocr_has' ? 'OCR' : box.source === 'glm_vision' ? 'VLM' : '手动'}
                        </span>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getVisionTypeConfig(box.type).color }} />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-500">{getVisionTypeConfig(box.type).name}</span>
                          <p className={`text-sm truncate ${box.selected ? 'text-gray-900' : 'text-gray-400'}`}>
                            {box.text || '图像区域'}
                          </p>
                        </div>
                      </div>
                    ))
                  )
                ) : (
                  entities.length === 0 ? (
                    <p className="p-4 text-center text-sm text-gray-400">暂无识别结果</p>
                  ) : (
                    entities.map(entity => {
                      const config = getTypeConfig(entity.type);
                      return (
                        <div
                          key={entity.id}
                          className={`px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-gray-50 ${!entity.selected ? 'opacity-50' : ''}`}
                          onClick={() => toggleEntity(entity.id)}
                        >
                          <input
                            type="checkbox"
                            checked={entity.selected}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded"
                          />
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: config.color }} />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs text-gray-500">{config.name}</span>
                            <p className={`text-sm truncate ${entity.selected ? 'text-gray-900' : 'text-gray-400'}`}>
                              {entity.text}
                            </p>
                            {entity.coref_id && (
                              <p className="text-[10px] text-gray-400 mt-0.5">指代组: {entity.coref_id}</p>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-400">
                            {entity.source === 'regex' ? '正则' : entity.source === 'manual' ? '手动' : 'AI'}
                          </span>
                          <button
                            onClick={e => { e.stopPropagation(); removeEntity(entity.id); }}
                            className="p-1 text-gray-300 hover:text-red-500"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
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
              disabled={selectedCount === 0}
              className={`py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                selectedCount > 0
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              开始脱敏 ({selectedCount})
            </button>
          </div>
        </div>
      )}

      {/* 结果阶段 */}
      {stage === 'result' && (
        <div className="flex-1 overflow-auto p-6">
          <div className="bg-green-600 rounded-xl p-5 text-white flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-semibold">脱敏完成</p>
                <p className="text-sm text-green-100">共处理 {redactedCount} 处敏感信息</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStage('preview')}
                className="px-4 py-2 bg-white/20 rounded-lg text-sm hover:bg-white/30"
              >
                返回编辑
              </button>
              <button onClick={handleReset} className="px-4 py-2 bg-white/20 rounded-lg text-sm hover:bg-white/30">
                处理新文件
              </button>
              {fileInfo && (
                <a
                  href={`/api/v1/files/${fileInfo.file_id}/download?redacted=true`}
                  download
                  className="px-4 py-2 bg-white text-green-600 rounded-lg text-sm font-medium hover:bg-green-50"
                >
                  下载脱敏文件
                </a>
              )}
            </div>
          </div>

          {isImageMode ? (
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700">
                  原始图片 (可编辑区域)
                </div>
                <div className="p-4">
                  {fileInfo && (
                    <ImageBBoxEditor
                      imageSrc={`/api/v1/files/${fileInfo.file_id}/download`}
                      boxes={visibleBoxes}
                      onBoxesChange={(newBoxes) => {
                        setBoundingBoxes(mergeVisibleBoxes(newBoxes));
                      }}
                      onBoxesCommit={(prevBoxes, nextBoxes) => {
                        const prevAll = mergeVisibleBoxes(prevBoxes, nextBoxes);
                        const nextAll = mergeVisibleBoxes(nextBoxes, prevBoxes);
                        setImageUndoStack(prev => [...prev, prevAll]);
                        setImageRedoStack([]);
                        setBoundingBoxes(nextAll);
                      }}
                      getTypeConfig={getVisionTypeConfig}
                      availableTypes={visionTypes.map(t => ({ id: t.id, name: t.name, color: t.color }))}
                      defaultType={visionTypes[0]?.id || 'CUSTOM'}
                    />
                  )}
                </div>
              </div>
              <div className="bg-white rounded-xl border-2 border-green-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-green-100 bg-green-50 text-sm font-semibold text-green-700">
                  脱敏后图片
                </div>
                <div className="p-4">
                  {fileInfo && (
                    <img
                      src={`/api/v1/files/${fileInfo.file_id}/download?redacted=true`}
                      alt="redacted"
                      className="max-w-full max-h-[600px] h-auto object-contain"
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700">
                  原始文档
                </div>
                <div className="p-4 max-h-96 overflow-auto">
                  <pre className="whitespace-pre-wrap text-sm text-gray-600">{content}</pre>
                </div>
              </div>
              <div className="bg-white rounded-xl border-2 border-green-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-green-100 bg-green-50 text-sm font-semibold text-green-700">
                  脱敏后文档
                </div>
                <div className="p-4 max-h-96 overflow-auto">
                  <pre className="whitespace-pre-wrap text-sm text-gray-600">{redactedContent || content}</pre>
                </div>
              </div>
            </div>
          )}

          {Object.keys(entityMap).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">脱敏映射表</span>
                <span className="text-xs text-gray-500">{Object.keys(entityMap).length} 条</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-60 overflow-auto">
                {Object.entries(entityMap).map(([orig, repl], i) => (
                  <div key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                    <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded font-mono">{orig}</span>
                    <span className="text-gray-400">→</span>
                    <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded font-mono">{repl}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-600">{loadingMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Playground;
