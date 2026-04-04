/**
 * Vision model settings — vision pipeline backends (PaddleOCR-VL, HaS Image, custom).
 * Replaces pages/VisionModelSettings.tsx with ShadCN components.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  useVisionModelConfig, BUILTIN_VISION_IDS, DEFAULT_MODEL_FORM,
  type ModelConfig,
} from './hooks/use-model-config';

export function VisionModel() {
  const {
    modelConfigs, loading, builtinLive, testingModelId, testResult,
    saveModelConfig, deleteModelConfig, testModelConfig, resetModelConfigs,
    liveForBuiltin, getProviderLabel,
  } = useVisionModelConfig();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ModelConfig>>({ ...DEFAULT_MODEL_FORM });

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...DEFAULT_MODEL_FORM, enabled: true });
    setShowModal(true);
  };

  const openEdit = (cfg: ModelConfig) => {
    setEditingId(cfg.id);
    setForm({ ...cfg });
    setShowModal(true);
  };

  const handleSave = async () => {
    const ok = await saveModelConfig(form, editingId);
    if (ok) {
      setShowModal(false);
      setEditingId(null);
      setForm({ ...DEFAULT_MODEL_FORM });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-7 h-7 border-2 border-muted border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-background">
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain p-4 sm:p-6 w-full max-w-5xl mx-auto">
        <div className="flex flex-col gap-5">
          {/* Info card */}
          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">视觉微服务</CardTitle>
              <CardDescription className="text-xs leading-relaxed mt-2">
                <strong className="font-medium text-foreground">PaddleOCR-VL</strong> 默认端口{' '}
                <strong>8082</strong>（<code className="text-xs bg-background px-1 py-0.5 rounded border">OCR_BASE_URL</code>），启动示例{' '}
                <code className="text-xs bg-background px-1 py-0.5 rounded border">scripts\start_paddle_ocr.ps1</code>。{' '}
                <strong className="font-medium text-foreground">HaS Image</strong> 默认端口 <strong>8081</strong>（
                <code className="text-xs bg-background px-1 py-0.5 rounded border">HAS_IMAGE_BASE_URL</code>），
                <code className="text-xs bg-background px-1 py-0.5 rounded border">has_image_server.py</code>，启动{' '}
                <code className="text-xs bg-background px-1 py-0.5 rounded border">scripts\start_has_image.bat</code>。
                下方列表为内置登记与自定义后端，均可「测试」连通性。
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2 pt-3 border-t">
                <Badge variant="outline">本地 HTTP</Badge>
                <Badge variant="outline">OpenAI 兼容</Badge>
                <Badge variant="outline">自定义 HTTP</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Backend list */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-base">推理后端</CardTitle>
                  <CardDescription className="text-xs">
                    PaddleOCR-VL 与 HaS Image 为内置登记；路由由后端环境变量决定，无需在此切换提供方。
                  </CardDescription>
                </div>
                <Button size="sm" onClick={openAdd} data-testid="add-vision-backend">
                  + 新增后端
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {modelConfigs.configs.map(cfg => (
                  <div key={cfg.id} className="px-5 py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{cfg.name}</span>
                        <Badge variant={
                          BUILTIN_VISION_IDS.has(cfg.id) || cfg.enabled ? 'secondary' : 'outline'
                        } className="text-xs">
                          {BUILTIN_VISION_IDS.has(cfg.id) || cfg.enabled ? '启用' : '禁用'}
                        </Badge>
                        {BUILTIN_VISION_IDS.has(cfg.id) && (() => {
                          const live = liveForBuiltin(cfg.id);
                          return live === 'online'
                            ? <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">在线</Badge>
                            : live === 'offline'
                              ? <Badge variant="destructive" className="text-xs">离线</Badge>
                              : builtinLive === null
                                ? <Badge variant="outline" className="text-xs">检测中...</Badge>
                                : <Badge variant="outline" className="text-xs">—</Badge>;
                        })()}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">{getProviderLabel(cfg.provider)}</Badge>
                        <span>|</span>
                        <span className="font-mono">{cfg.model_name}</span>
                        {cfg.base_url && (<><span>|</span><span className="truncate max-w-[200px]">{cfg.base_url}</span></>)}
                      </div>
                      {cfg.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{cfg.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm" variant="outline"
                        disabled={testingModelId === cfg.id}
                        onClick={() => void testModelConfig(cfg.id)}
                        data-testid={`test-model-${cfg.id}`}
                      >
                        {testingModelId === cfg.id ? '测试中...' : '测试'}
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(cfg)} data-testid={`edit-model-${cfg.id}`}>
                        <PencilIcon />
                      </Button>
                      <Button
                        size="icon" variant="ghost"
                        disabled={BUILTIN_VISION_IDS.has(cfg.id)}
                        className={cn(BUILTIN_VISION_IDS.has(cfg.id) && 'opacity-20 cursor-not-allowed')}
                        onClick={() => void deleteModelConfig(cfg.id)}
                        data-testid={`delete-model-${cfg.id}`}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </div>
                ))}
                {modelConfigs.configs.length === 0 && (
                  <p className="px-5 py-6 text-sm text-muted-foreground text-center">暂无推理后端配置</p>
                )}
              </div>

              {testResult && (
                <div className={cn(
                  'mx-5 mb-4 p-3 rounded-lg text-sm border',
                  testResult.success ? 'bg-green-50 text-green-800 border-green-100' : 'bg-red-50 text-red-800 border-red-100',
                )}>
                  {testResult.success ? '\u2713 ' : '\u2717 '}
                  {testResult.message}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reset */}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => void resetModelConfigs()} data-testid="reset-vision-models">
              重置为默认配置
            </Button>
          </div>
        </div>
      </div>

      {/* Add / Edit modal */}
      <Dialog open={showModal} onOpenChange={o => { if (!o) { setShowModal(false); setEditingId(null); } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑推理后端' : '新增推理后端'}</DialogTitle>
            <DialogDescription>配置视觉推理后端连接信息</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>显示名称 *</Label>
              <Input
                value={form.name ?? ''}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="如：HaS Image 本机 8081"
                data-testid="vision-model-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>类型 *</Label>
              <Select
                value={form.provider ?? 'local'}
                onValueChange={v => setForm(f => ({ ...f, provider: v as ModelConfig['provider'] }))}
              >
                <SelectTrigger data-testid="vision-model-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">本地 HTTP（HaS Image /health）</SelectItem>
                  <SelectItem value="openai">OpenAI 兼容（/v1/models）</SelectItem>
                  <SelectItem value="custom">自定义 HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>标识名 *</Label>
              <Input
                value={form.model_name ?? ''}
                onChange={e => setForm(f => ({ ...f, model_name: e.target.value }))}
                className="font-mono text-sm"
                placeholder={form.provider === 'local' ? 'HaS-Image-YOLO11' : 'gpt-4-vision-preview'}
                data-testid="vision-model-model-name"
              />
            </div>

            {(form.provider === 'local' || form.provider === 'openai' || form.provider === 'custom') && (
              <div className="space-y-1.5">
                <Label>服务基址（无尾斜杠）</Label>
                <Input
                  value={form.base_url ?? ''}
                  onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                  className="font-mono text-sm"
                  placeholder={form.provider === 'local' ? 'http://127.0.0.1:8081' : 'https://api.openai.com'}
                  data-testid="vision-model-base-url"
                />
              </div>
            )}

            {(form.provider === 'openai' || form.provider === 'custom') && (
              <div className="space-y-1.5">
                <Label>API Key（可选）</Label>
                <Input
                  type="password"
                  value={form.api_key ?? ''}
                  onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                  className="font-mono text-sm"
                  placeholder="sk-..."
                  data-testid="vision-model-api-key"
                />
              </div>
            )}

            {/* Generation params */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">扩展字段（HaS Image 不使用，可保留默认）</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Temperature</Label>
                  <Input type="number" step={0.1} min={0} max={2}
                    value={form.temperature ?? 0.8}
                    onChange={e => setForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))}
                    data-testid="vision-model-temp" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Top P</Label>
                  <Input type="number" step={0.1} min={0} max={1}
                    value={form.top_p ?? 0.6}
                    onChange={e => setForm(f => ({ ...f, top_p: parseFloat(e.target.value) }))}
                    data-testid="vision-model-top-p" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max Tokens</Label>
                  <Input type="number" step={256} min={1} max={32768}
                    value={form.max_tokens ?? 4096}
                    onChange={e => setForm(f => ({ ...f, max_tokens: parseInt(e.target.value) }))}
                    data-testid="vision-model-max-tokens" />
                </div>
              </div>
            </div>

            {/* Enabled */}
            <div className="flex items-center gap-3">
              <Switch
                checked={editingId && BUILTIN_VISION_IDS.has(editingId) ? true : (form.enabled ?? true)}
                disabled={!!editingId && BUILTIN_VISION_IDS.has(editingId)}
                onCheckedChange={v => setForm(f => ({ ...f, enabled: v }))}
                data-testid="vision-model-enabled"
              />
              <Label>
                启用此配置
                {editingId && BUILTIN_VISION_IDS.has(editingId) && (
                  <span className="text-muted-foreground">（内置 PaddleOCR / HaS Image 固定为启用）</span>
                )}
              </Label>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>备注说明</Label>
              <Textarea
                value={form.description ?? ''}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="可选，描述此配置的用途"
                data-testid="vision-model-desc"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowModal(false); setEditingId(null); }} data-testid="vision-model-cancel">
              取消
            </Button>
            <Button
              disabled={!form.name || !form.model_name}
              onClick={() => void handleSave()}
              data-testid="vision-model-save"
            >
              {editingId ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── inline icons ── */
function PencilIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
