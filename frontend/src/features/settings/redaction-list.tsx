/**
 * Redaction list settings — full entity type management with presets.
 * Replaces pages/RedactionListSettings.tsx.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
/* Select is used via native <select> for bridge dropdowns */
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import { showToast } from '@/components/Toast';
import {
  fetchPresets, createPreset, updatePreset, deletePreset,
  type RecognitionPreset, type PresetPayload, type PresetKind,
  presetAppliesText, presetAppliesVision,
} from '@/services/presetsApi';
import { buildDefaultPipelineTypeIds, buildDefaultTextTypeIds } from '@/services/defaultRedactionPreset';
import {
  getActivePresetTextId, getActivePresetVisionId,
  setActivePresetTextId, setActivePresetVisionId,
} from '@/services/activePresetBridge';
import { selectableCardClass, selectableCheckboxClass, type SelectionVariant } from '@/ui/selectionClasses';
import type { EntityTypeConfig, PipelineConfig } from './hooks/use-entity-types';

/* ── helpers ── */
function presetKindLabel(k?: PresetKind): string {
  return k === 'text' ? '文本' : k === 'vision' ? '图像' : '组合';
}

function sortPresets(ps: RecognitionPreset[]): RecognitionPreset[] {
  return [...ps].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : Number.MAX_SAFE_INTEGER;
    const tb = b.created_at ? Date.parse(b.created_at) : Number.MAX_SAFE_INTEGER;
    return (Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER) - (Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER);
  });
}

export function RedactionList() {
  const [entityTypes, setEntityTypes] = useState<EntityTypeConfig[]>([]);
  const [pipelines, setPipelines] = useState<PipelineConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [presets, setPresets] = useState<RecognitionPreset[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetForm, setPresetForm] = useState<PresetPayload>({
    name: '', kind: 'full', selectedEntityTypeIds: [],
    ocrHasTypes: [], hasImageTypes: [], replacementMode: 'structured',
  });
  const [saving, setSaving] = useState(false);
  const [bridgeText, setBridgeText] = useState(() => getActivePresetTextId() ?? '');
  const [bridgeVision, setBridgeVision] = useState(() => getActivePresetVisionId() ?? '');
  const [expanded, setExpanded] = useState<string | null>(null);

  /* ── fetch data ── */
  const reloadPresets = useCallback(async () => {
    try { setPresets(await fetchPresets()); } catch { setPresets([]); }
  }, []);

  const fetchEntityTypes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchWithTimeout('/api/v1/custom-types?enabled_only=false', { timeoutMs: 25000 });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setEntityTypes(data.custom_types || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/v1/vision-pipelines', { timeoutMs: 25000 });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setPipelines((data || []).map((p: PipelineConfig) =>
        p.mode === 'has_image' ? { ...p, name: 'HaS Image', description: '使用视觉语言模型识别签名、印章、手写等视觉信息。' } : p
      ));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchEntityTypes(); fetchPipelines(); void reloadPresets(); }, [fetchEntityTypes, fetchPipelines, reloadPresets]);

  useEffect(() => {
    const on = () => { setBridgeText(getActivePresetTextId() ?? ''); setBridgeVision(getActivePresetVisionId() ?? ''); };
    window.addEventListener('datainfra-redaction-active-preset', on);
    return () => window.removeEventListener('datainfra-redaction-active-preset', on);
  }, []);

  /* ── derived data ── */
  const textPresets = useMemo(() => sortPresets(presets.filter(presetAppliesText)), [presets]);
  const visionPresets = useMemo(() => sortPresets(presets.filter(presetAppliesVision)), [presets]);
  const regexTypes = useMemo(() => entityTypes.filter(tp => tp.enabled !== false && tp.regex_pattern), [entityTypes]);
  const semanticTypes = useMemo(() => entityTypes.filter(tp => tp.enabled !== false && tp.use_llm && !tp.regex_pattern), [entityTypes]);

  const defaultTextPreset = useMemo<RecognitionPreset>(() => ({
    id: '__default_text__', name: '默认文本脱敏配置清单', kind: 'text',
    selectedEntityTypeIds: buildDefaultTextTypeIds(entityTypes),
    ocrHasTypes: [], hasImageTypes: [], replacementMode: 'structured',
    created_at: '', updated_at: '',
  }), [entityTypes]);

  const defaultVisionPreset = useMemo<RecognitionPreset>(() => ({
    id: '__default_vision__', name: '默认图像脱敏配置清单', kind: 'vision',
    selectedEntityTypeIds: [],
    ocrHasTypes: buildDefaultPipelineTypeIds(pipelines, 'ocr_has'),
    hasImageTypes: buildDefaultPipelineTypeIds(pipelines, 'has_image'),
    replacementMode: 'structured', created_at: '', updated_at: '',
  }), [pipelines]);

  const summaryTextLabel = useMemo(() => {
    if (!bridgeText) return '默认';
    return textPresets.find(p => p.id === bridgeText)?.name ?? '默认';
  }, [bridgeText, textPresets]);

  const summaryVisionLabel = useMemo(() => {
    if (!bridgeVision) return '默认';
    return visionPresets.find(p => p.id === bridgeVision)?.name ?? '默认';
  }, [bridgeVision, visionPresets]);

  /* ── sync bridge ── */
  useEffect(() => {
    if (bridgeText && !textPresets.some(p => p.id === bridgeText)) { setBridgeText(''); setActivePresetTextId(null); }
  }, [bridgeText, textPresets]);

  useEffect(() => {
    if (bridgeVision && !visionPresets.some(p => p.id === bridgeVision)) { setBridgeVision(''); setActivePresetVisionId(null); }
  }, [bridgeVision, visionPresets]);

  /* ── preset CRUD ── */
  const buildDefaultForm = useCallback((kind: PresetKind = 'full'): PresetPayload => {
    const textIds = buildDefaultTextTypeIds(entityTypes);
    const ocrIds = buildDefaultPipelineTypeIds(pipelines, 'ocr_has');
    const hiIds = buildDefaultPipelineTypeIds(pipelines, 'has_image');
    if (kind === 'text') return { name: '', kind: 'text', selectedEntityTypeIds: textIds, ocrHasTypes: [], hasImageTypes: [], replacementMode: 'structured' };
    if (kind === 'vision') return { name: '', kind: 'vision', selectedEntityTypeIds: [], ocrHasTypes: ocrIds, hasImageTypes: hiIds, replacementMode: 'structured' };
    return { name: '', kind: 'full', selectedEntityTypeIds: textIds, ocrHasTypes: ocrIds, hasImageTypes: hiIds, replacementMode: 'structured' };
  }, [entityTypes, pipelines]);

  const openNew = (kind: PresetKind) => { setExpanded(null); setEditingPresetId(null); setPresetForm(buildDefaultForm(kind)); setModalOpen(true); };
  const openEdit = (p: RecognitionPreset) => {
    setExpanded(null); setEditingPresetId(p.id);
    setPresetForm({ name: p.name, kind: p.kind ?? 'full', selectedEntityTypeIds: [...p.selectedEntityTypeIds], ocrHasTypes: [...p.ocrHasTypes], hasImageTypes: [...p.hasImageTypes], replacementMode: p.replacementMode });
    setModalOpen(true);
  };

  const saveModal = async () => {
    if (!presetForm.name.trim()) { showToast('请填写预设名称', 'error'); return; }
    const norm: PresetPayload = presetForm.kind === 'text'
      ? { ...presetForm, ocrHasTypes: [], hasImageTypes: [], replacementMode: 'structured' }
      : presetForm.kind === 'vision'
        ? { ...presetForm, selectedEntityTypeIds: [], replacementMode: 'structured' }
        : presetForm;
    setSaving(true);
    try {
      if (editingPresetId) { await updatePreset(editingPresetId, norm); }
      else {
        const c = await createPreset(norm);
        if (norm.kind === 'text' || norm.kind === 'full') { setActivePresetTextId(c.id); setBridgeText(c.id); }
        if (norm.kind === 'vision' || norm.kind === 'full') { setActivePresetVisionId(c.id); setBridgeVision(c.id); }
      }
      setModalOpen(false);
      await reloadPresets();
    } catch (e) { showToast(e instanceof Error ? e.message : '保存失败', 'error'); }
    finally { setSaving(false); }
  };

  const removePreset = async (id: string) => {
    if (!confirm('确定删除该预设？')) return;
    try {
      await deletePreset(id);
      setExpanded(k => (k === `text:${id}` || k === `vision:${id}` ? null : k));
      await reloadPresets();
      if (bridgeText === id) { setBridgeText(''); setActivePresetTextId(null); }
      if (bridgeVision === id) { setBridgeVision(''); setActivePresetVisionId(null); }
    } catch (e) { showToast(e instanceof Error ? e.message : '删除失败', 'error'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-7 h-7 border-2 border-muted border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-background">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-3 py-2 sm:px-4 sm:py-3 w-full max-w-[min(100%,1920px)] mx-auto gap-3">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-sm">脱敏清单配置</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  共用 <code className="text-xs bg-muted px-1 rounded">/api/v1/presets</code>；选用同步 Playground / 批量向导（新会话）。
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => openNew('text')} data-testid="new-text-preset">
                  + 新建文本配置清单
                </Button>
                <Button size="sm" variant="outline" onClick={() => openNew('vision')} data-testid="new-vision-preset">
                  + 新建图像配置清单
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary */}
            <div className="text-xs rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">当前选用</p>
              <p><span className="text-muted-foreground">文本链：</span><span className="font-medium">{summaryTextLabel}</span></p>
              <p className="mt-0.5"><span className="text-muted-foreground">图像链：</span><span className="font-medium">{summaryVisionLabel}</span></p>
            </div>

            {/* Bridge selectors */}
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">选用 - 文本链</Label>
                <select
                  className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs"
                  value={bridgeText}
                  onChange={e => { setBridgeText(e.target.value); setActivePresetTextId(e.target.value || null); }}
                  data-testid="bridge-text-select"
                >
                  <option value="">默认（系统预设全选，不含自定义）</option>
                  {textPresets.map(p => <option key={p.id} value={p.id}>{p.name}{p.kind === 'full' ? '（组合）' : ''}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">选用 - 图像链</Label>
                <select
                  className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs"
                  value={bridgeVision}
                  onChange={e => { setBridgeVision(e.target.value); setActivePresetVisionId(e.target.value || null); }}
                  data-testid="bridge-vision-select"
                >
                  <option value="">默认（系统预设全选，不含自定义）</option>
                  {visionPresets.map(p => <option key={p.id} value={p.id}>{p.name}{p.kind === 'full' ? '（组合）' : ''}</option>)}
                </select>
              </div>
            </div>

            {/* Preset lists */}
            <div className="grid gap-2 md:grid-cols-2">
              <PresetColumn
                title="文本脱敏配置清单"
                defaultPreset={defaultTextPreset}
                presets={textPresets}
                entityTypes={entityTypes}
                pipelines={pipelines}
                expanded={expanded}
                setExpanded={setExpanded}
                colPrefix="text"
                onEdit={openEdit}
                onDelete={removePreset}
              />
              <PresetColumn
                title="图像脱敏配置清单"
                defaultPreset={defaultVisionPreset}
                presets={visionPresets}
                entityTypes={entityTypes}
                pipelines={pipelines}
                expanded={expanded}
                setExpanded={setExpanded}
                colPrefix="vision"
                onEdit={openEdit}
                onDelete={removePreset}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Preset create/edit modal ── */}
      {modalOpen && (
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="sm:max-w-[56rem] max-h-[92vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>
                {editingPresetId
                  ? `编辑${presetKindLabel(presetForm.kind)}脱敏配置清单`
                  : `新建${presetKindLabel(presetForm.kind)}脱敏配置清单`}
              </DialogTitle>
              <DialogDescription>配置脱敏预设的识别项选择</DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-5 py-2">
                <div className="space-y-1.5">
                  <Label>名称 *</Label>
                  <Input
                    value={presetForm.name}
                    onChange={e => setPresetForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="如：合同默认、仅人名与金额"
                    data-testid="preset-name"
                  />
                </div>

                {(presetForm.kind === 'text' || presetForm.kind === 'full') && (
                  <>
                    <TypeCheckboxGrid
                      title="正则规则"
                      types={regexTypes}
                      selectedIds={presetForm.selectedEntityTypeIds}
                      onToggle={id => setPresetForm(f => ({
                        ...f,
                        selectedEntityTypeIds: f.selectedEntityTypeIds.includes(id)
                          ? f.selectedEntityTypeIds.filter(x => x !== id)
                          : [...f.selectedEntityTypeIds, id],
                      }))}
                      variant="regex"
                    />
                    <TypeCheckboxGrid
                      title="AI 语义（HaS）"
                      types={semanticTypes}
                      selectedIds={presetForm.selectedEntityTypeIds}
                      onToggle={id => setPresetForm(f => ({
                        ...f,
                        selectedEntityTypeIds: f.selectedEntityTypeIds.includes(id)
                          ? f.selectedEntityTypeIds.filter(x => x !== id)
                          : [...f.selectedEntityTypeIds, id],
                      }))}
                      variant="ner"
                    />
                  </>
                )}

                {(presetForm.kind === 'vision' || presetForm.kind === 'full') &&
                  pipelines.filter(p => p.enabled).map(p => (
                    <PipelineCheckboxGrid
                      key={p.mode}
                      pipeline={p}
                      selectedOcr={presetForm.ocrHasTypes}
                      selectedImg={presetForm.hasImageTypes}
                      onToggle={(mode, id) => setPresetForm(f => {
                        if (mode === 'ocr_has') {
                          const next = f.ocrHasTypes.includes(id) ? f.ocrHasTypes.filter(x => x !== id) : [...f.ocrHasTypes, id];
                          return { ...f, ocrHasTypes: next };
                        }
                        const next = f.hasImageTypes.includes(id) ? f.hasImageTypes.filter(x => x !== id) : [...f.hasImageTypes, id];
                        return { ...f, hasImageTypes: next };
                      })}
                    />
                  ))
                }
              </div>
            </ScrollArea>
            <DialogFooter className="border-t pt-4">
              <Button variant="outline" onClick={() => setModalOpen(false)} data-testid="preset-cancel">取消</Button>
              <Button disabled={saving} onClick={() => void saveModal()} data-testid="preset-save">
                {saving ? '处理中...' : editingPresetId ? '保存修改' : '创建'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ── sub-components ── */

function PresetColumn({ title, defaultPreset, presets, entityTypes, pipelines, expanded, setExpanded, colPrefix, onEdit, onDelete }: {
  title: string; defaultPreset: RecognitionPreset; presets: RecognitionPreset[];
  entityTypes: EntityTypeConfig[]; pipelines: PipelineConfig[];
  expanded: string | null; setExpanded: (fn: (k: string | null) => string | null) => void;
  colPrefix: string; onEdit: (p: RecognitionPreset) => void; onDelete: (id: string) => void;
}) {
  const defKey = `${colPrefix}:__default__`;
  return (
    <div className="flex flex-col min-h-0">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{title}</h4>
      <ul className="divide-y divide-border overflow-y-auto rounded-md border text-xs max-h-[min(55vh,520px)]">
        <li className="bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5">
            <div>
              <span className="font-medium">{defaultPreset.name}</span>
              <Badge variant="secondary" className="ml-2 text-[0.65rem]">系统默认</Badge>
            </div>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setExpanded(c => c === defKey ? null : defKey)}>
              {expanded === defKey ? '收起' : '预览'}
            </Button>
          </div>
          {expanded === defKey && (
            <PresetPreview p={defaultPreset} entityTypes={entityTypes} pipelines={pipelines} />
          )}
        </li>
        {presets.map(p => {
          const rk = `${colPrefix}:${p.id}`;
          return (
            <li key={p.id} className="bg-muted/30">
              <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5">
                <span className="font-medium">{p.name}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setExpanded(c => c === rk ? null : rk)}>
                    {expanded === rk ? '收起' : '预览'}
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => onEdit(p)}>编辑</Button>
                  <Button size="sm" variant="outline" className="h-6 text-xs text-destructive" onClick={() => void onDelete(p.id)}>删除</Button>
                </div>
              </div>
              {expanded === rk && <PresetPreview p={p} entityTypes={entityTypes} pipelines={pipelines} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PresetPreview({ p, entityTypes, pipelines }: { p: RecognitionPreset; entityTypes: EntityTypeConfig[]; pipelines: PipelineConfig[] }) {
  const ocrPipe = pipelines.find(pl => pl.mode === 'ocr_has');
  const imgPipe = pipelines.find(pl => pl.mode === 'has_image');
  const chip = 'inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-medium bg-background';
  return (
    <div className="border-t px-2 pb-3 pt-2 space-y-2">
      {presetAppliesText(p) && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">正则 ({p.selectedEntityTypeIds.filter(id => entityTypes.find(t => t.id === id)?.regex_pattern).length})</p>
          <div className="flex flex-wrap gap-1">
            {p.selectedEntityTypeIds.filter(id => entityTypes.find(t => t.id === id)?.regex_pattern).map(id => (
              <span key={id} className={chip}>{entityTypes.find(t => t.id === id)?.name ?? id}</span>
            ))}
          </div>
        </div>
      )}
      {presetAppliesVision(p) && (
        <>
          {p.ocrHasTypes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">OCR+HaS ({p.ocrHasTypes.length})</p>
              <div className="flex flex-wrap gap-1">
                {p.ocrHasTypes.map(id => <span key={id} className={chip}>{ocrPipe?.types.find(t => t.id === id)?.name ?? id}</span>)}
              </div>
            </div>
          )}
          {p.hasImageTypes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">HaS Image ({p.hasImageTypes.length})</p>
              <div className="flex flex-wrap gap-1">
                {p.hasImageTypes.map(id => <span key={id} className={chip}>{imgPipe?.types.find(t => t.id === id)?.name ?? id}</span>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TypeCheckboxGrid({ title, types, selectedIds, onToggle, variant }: {
  title: string; types: EntityTypeConfig[]; selectedIds: string[];
  onToggle: (id: string) => void; variant: SelectionVariant;
}) {
  return (
    <div>
      <p className="text-sm font-semibold mb-2 pl-2 border-l-[3px] border-muted-foreground/30">{title} <span className="text-xs text-muted-foreground">({types.length})</span></p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-[min(40vh,360px)] overflow-y-auto border rounded-xl p-3 bg-muted/20">
        {types.map(tp => {
          const checked = selectedIds.includes(tp.id);
          return (
            <label key={tp.id} className={cn('flex items-center gap-2 text-xs px-2.5 py-2 cursor-pointer transition-colors', selectableCardClass(checked, variant))}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(tp.id)} className={selectableCheckboxClass(variant, 'md')} />
              <span className="truncate">{tp.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PipelineCheckboxGrid({ pipeline, selectedOcr, selectedImg, onToggle }: {
  pipeline: PipelineConfig; selectedOcr: string[]; selectedImg: string[];
  onToggle: (mode: string, id: string) => void;
}) {
  const v: SelectionVariant = pipeline.mode === 'ocr_has' ? 'ner' : 'yolo';
  const selected = pipeline.mode === 'ocr_has' ? selectedOcr : selectedImg;
  return (
    <div>
      <p className={cn('text-sm font-semibold mb-2 pl-2 border-l-[3px]', pipeline.mode === 'ocr_has' ? 'border-[#34C759]' : 'border-[#AF52DE]')}>
        {pipeline.mode === 'ocr_has' ? '图片类文本（OCR+HaS）' : '图像特征（HaS Image）'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-[min(48vh,420px)] overflow-y-auto border rounded-xl p-3 bg-muted/20">
        {pipeline.types.filter(tp => tp.enabled).map(tp => {
          const active = selected.includes(tp.id);
          return (
            <label key={tp.id} className={cn('flex items-center gap-2 text-xs px-2.5 py-2 cursor-pointer transition-colors', selectableCardClass(active, v))}>
              <input type="checkbox" checked={active} onChange={() => onToggle(pipeline.mode, tp.id)} className={selectableCheckboxClass(v, 'md')} />
              <span className="truncate">{tp.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
