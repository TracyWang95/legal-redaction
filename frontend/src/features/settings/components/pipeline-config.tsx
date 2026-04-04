/**
 * Vision pipeline configuration — list of pipeline types grouped by mode
 * (ocr_has / has_image) with enable/disable switches and CRUD actions.
 */
import { useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PipelineConfig, PipelineTypeConfig } from '../hooks/use-entity-types';

interface PipelineConfigPanelProps {
  pipelines: PipelineConfig[];
  onCreateType: (mode: 'ocr_has' | 'has_image', name: string, desc: string) => Promise<boolean>;
  onUpdateType: (mode: string, typeId: string, update: Partial<PipelineTypeConfig> & { name: string; description?: string }) => Promise<boolean>;
  onDeleteType: (mode: string, typeId: string) => void;
  onReset: () => void;
}

export function PipelineConfigPanel({
  pipelines, onCreateType, onUpdateType, onDeleteType, onReset,
}: PipelineConfigPanelProps) {
  const t = useT();
  const [activeSub, setActiveSub] = useState<'ocr_has' | 'has_image'>('ocr_has');
  const [dialogMode, setDialogMode] = useState<'ocr_has' | 'has_image' | null>(null);
  const [editing, setEditing] = useState<{ mode: string; type: PipelineTypeConfig } | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const pipeOcr = pipelines.find(p => p.mode === 'ocr_has');
  const pipeImg = pipelines.find(p => p.mode === 'has_image');
  const pipeline = pipelines.find(p => p.mode === activeSub);

  const openCreate = (mode: 'ocr_has' | 'has_image') => {
    setEditing(null);
    setForm({ name: '', description: '' });
    setDialogMode(mode);
  };

  const openEdit = (mode: string, tp: PipelineTypeConfig) => {
    setEditing({ mode, type: { ...tp } });
    setForm({ name: tp.name, description: tp.description ?? '' });
    setDialogMode(mode as 'ocr_has' | 'has_image');
  };

  const handleSave = async () => {
    if (!dialogMode || !form.name.trim()) return;
    if (editing) {
      await onUpdateType(editing.mode, editing.type.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        examples: editing.type.examples || [],
        color: editing.type.color || '#6B7280',
        enabled: editing.type.enabled,
        order: editing.type.order,
      });
    } else {
      await onCreateType(dialogMode, form.name, form.description);
    }
    setDialogMode(null);
    setEditing(null);
    setForm({ name: '', description: '' });
  };

  const isImg = activeSub === 'has_image';
  const borderColor = isImg ? 'border-[#AF52DE]/25' : 'border-[#34C759]/22';
  const headerBg = isImg ? 'bg-[#AF52DE]/[0.06]' : 'bg-[#34C759]/[0.05]';
  const dotColor = isImg ? 'bg-[#AF52DE]/90' : 'bg-[#34C759]/90';
  const displayName = isImg ? 'HaS Image' : (pipeline?.name ?? 'OCR+HaS');

  return (
    <div className="flex flex-col gap-2 overflow-hidden">
      {/* Sub-tab switcher */}
      <div className="shrink-0 flex items-center justify-between gap-2">
        <div className="flex gap-1 p-0.5 bg-muted rounded-md border w-fit">
          <button
            type="button"
            onClick={() => setActiveSub('ocr_has')}
            className={cn('px-2 py-1 text-xs font-medium rounded transition-colors',
              activeSub === 'ocr_has' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground')}
            data-testid="pipeline-tab-ocr"
          >
            {pipeOcr?.name ?? 'OCR+HaS'}
            <span className="ml-1 text-muted-foreground">({pipeOcr?.types.length ?? 0})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSub('has_image')}
            className={cn('px-2 py-1 text-xs font-medium rounded transition-colors',
              activeSub === 'has_image' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground')}
            data-testid="pipeline-tab-image"
          >
            {pipeImg?.name ?? 'HaS Image'}
            <span className="ml-1 text-muted-foreground">({pipeImg?.types.length ?? 0})</span>
          </button>
        </div>
        <Button size="sm" variant="ghost" onClick={onReset} data-testid="reset-pipelines">
          {t('settings.resetVisionRules')}
        </Button>
      </div>

      {/* Pipeline card */}
      {!pipeline ? (
        <p className="py-6 text-sm text-muted-foreground text-center">{t('settings.loadingPipeline')}</p>
      ) : (
        <div className={cn('flex-1 min-h-0 flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm', borderColor)}>
          <div className={cn('shrink-0 px-4 py-3 border-b flex items-center justify-between gap-2', borderColor, headerBg)}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
              <span className="font-semibold text-sm truncate">{displayName}</span>
              <Badge variant="secondary" className="text-xs">{pipeline.types.length}</Badge>
            </div>
            <Button size="sm" onClick={() => openCreate(activeSub)} data-testid="add-pipeline-type">
              {t('settings.addNew')}
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {pipeline.types.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground text-center">{t('settings.noTypeConfig')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5">
                {pipeline.types.map(tp => (
                  <div key={tp.id} className={cn(
                    'rounded-md px-2 py-1.5 flex gap-2 items-start border shadow-sm',
                    isImg ? 'border-[#AF52DE]/22 bg-[#AF52DE]/[0.07]' : 'border-[#34C759]/22 bg-[#34C759]/[0.06]',
                  )}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <span className={cn('font-medium text-xs leading-tight block truncate',
                            isImg ? 'text-[#5c2d7a]' : 'text-[#0d5c2f]')}>{tp.name}</span>
                          <span className={cn('text-[10px] truncate block',
                            isImg ? 'text-[#AF52DE]/85' : 'text-[#34C759]/85')}>{tp.id}</span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button size="icon" variant="ghost" className="h-6 w-6"
                            onClick={() => openEdit(pipeline.mode, tp)}
                            data-testid={`edit-pipeline-${tp.id}`}>
                            <PencilIcon />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => onDeleteType(pipeline.mode, tp.id)}
                            data-testid={`delete-pipeline-${tp.id}`}>
                            <TrashIcon />
                          </Button>
                        </div>
                      </div>
                      {tp.description && (
                        <p className={cn('text-[10px] mt-0.5 line-clamp-2 leading-snug',
                          isImg ? 'text-[#6b2d7a]/90' : 'text-[#166534]/90')}>{tp.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={o => { if (!o) { setDialogMode(null); setEditing(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t('settings.editType') : t('settings.addType')}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'ocr_has' ? t('settings.pipelineTypeDescOcr') : t('settings.pipelineTypeDescImg')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('settings.nameLabel')} *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={dialogMode === 'ocr_has' ? '如：合同甲方名称' : '如：人脸区域'}
                data-testid="pipeline-type-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('settings.descLabel')}</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                data-testid="pipeline-type-desc"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.saveHint')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogMode(null); setEditing(null); }} data-testid="pipeline-type-cancel">
              {t('settings.cancel')}
            </Button>
            <Button disabled={!form.name.trim()} onClick={() => void handleSave()} data-testid="pipeline-type-save">
              {editing ? t('settings.save') : t('settings.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
