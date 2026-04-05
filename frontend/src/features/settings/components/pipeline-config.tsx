import { useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { PipelineConfig, PipelineTypeConfig } from '../hooks/use-entity-types';

interface PipelineConfigPanelProps {
  pipelines: PipelineConfig[];
  onCreateType: (mode: 'ocr_has' | 'has_image', name: string, desc: string) => Promise<boolean>;
  onUpdateType: (
    mode: string,
    typeId: string,
    update: Partial<PipelineTypeConfig> & { name: string; description?: string },
  ) => Promise<boolean>;
  onDeleteType: (mode: string, typeId: string) => void;
  onReset: () => void;
}

export function PipelineConfigPanel({
  pipelines,
  onCreateType,
  onUpdateType,
  onDeleteType,
  onReset,
}: PipelineConfigPanelProps) {
  const t = useT();
  const [activeSub, setActiveSub] = useState<'ocr_has' | 'has_image'>('ocr_has');
  const [dialogMode, setDialogMode] = useState<'ocr_has' | 'has_image' | null>(null);
  const [editing, setEditing] = useState<{ mode: string; type: PipelineTypeConfig } | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const ocrPipeline = pipelines.find(pipeline => pipeline.mode === 'ocr_has');
  const imagePipeline = pipelines.find(pipeline => pipeline.mode === 'has_image');
  const activePipeline = pipelines.find(pipeline => pipeline.mode === activeSub);

  const openCreate = (mode: 'ocr_has' | 'has_image') => {
    setEditing(null);
    setForm({ name: '', description: '' });
    setDialogMode(mode);
  };

  const openEdit = (mode: string, type: PipelineTypeConfig) => {
    setEditing({ mode, type: { ...type } });
    setForm({ name: type.name, description: type.description ?? '' });
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

  const imageModeActive = activeSub === 'has_image';
  const borderColor = imageModeActive ? 'border-[#AF52DE]/25' : 'border-[#34C759]/22';
  const headerBg = imageModeActive ? 'bg-[#AF52DE]/[0.06]' : 'bg-[#34C759]/[0.05]';
  const dotColor = imageModeActive ? 'bg-[#AF52DE]/90' : 'bg-[#34C759]/90';
  const displayName = imageModeActive
    ? t('settings.pipelineDisplayName.image')
    : (activePipeline?.name ?? t('settings.pipelineDisplayName.ocr'));

  return (
    <div className="flex flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex w-fit gap-1 rounded-md border bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setActiveSub('ocr_has')}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors',
              activeSub === 'ocr_has'
                ? 'bg-background text-foreground shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-testid="pipeline-tab-ocr"
          >
            {ocrPipeline?.name ?? t('settings.pipelineDisplayName.ocr')}
            <span className="ml-1 text-muted-foreground">({ocrPipeline?.types.length ?? 0})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSub('has_image')}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium transition-colors',
              activeSub === 'has_image'
                ? 'bg-background text-foreground shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-testid="pipeline-tab-image"
          >
            {imagePipeline?.name ?? t('settings.pipelineDisplayName.image')}
            <span className="ml-1 text-muted-foreground">({imagePipeline?.types.length ?? 0})</span>
          </button>
        </div>
        <Button size="sm" variant="ghost" onClick={onReset} data-testid="reset-pipelines">
          {t('settings.resetVisionRules')}
        </Button>
      </div>

      {!activePipeline ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('settings.loadingPipeline')}
        </p>
      ) : (
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm', borderColor)}>
          <div className={cn('flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3', borderColor, headerBg)}>
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', dotColor)} />
              <span className="truncate text-sm font-semibold">{displayName}</span>
              <Badge variant="secondary" className="text-xs">
                {activePipeline.types.length}
              </Badge>
            </div>
            <Button size="sm" onClick={() => openCreate(activeSub)} data-testid="add-pipeline-type">
              {t('settings.addNew')}
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 overflow-y-auto p-2">
            {activePipeline.types.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('settings.noTypeConfig')}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {activePipeline.types.map(type => (
                  <div
                    key={type.id}
                    className={cn(
                      'flex items-start gap-2 rounded-md border px-2 py-1.5 shadow-sm',
                      imageModeActive
                        ? 'border-[#AF52DE]/22 bg-[#AF52DE]/[0.07]'
                        : 'border-[#34C759]/22 bg-[#34C759]/[0.06]',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <span
                            className={cn(
                              'block truncate text-xs font-medium leading-tight',
                              imageModeActive ? 'text-[#5c2d7a]' : 'text-[#0d5c2f]',
                            )}
                          >
                            {type.name}
                          </span>
                          <span
                            className={cn(
                              'block truncate text-[10px]',
                              imageModeActive ? 'text-[#AF52DE]/85' : 'text-[#34C759]/85',
                            )}
                          >
                            {type.id}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => openEdit(activePipeline.mode, type)}
                            data-testid={`edit-pipeline-${type.id}`}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => onDeleteType(activePipeline.mode, type.id)}
                            data-testid={`delete-pipeline-${type.id}`}
                          >
                            <TrashIcon />
                          </Button>
                        </div>
                      </div>
                      {type.description && (
                        <p
                          className={cn(
                            'mt-0.5 line-clamp-2 text-[10px] leading-snug',
                            imageModeActive ? 'text-[#6b2d7a]/90' : 'text-[#166534]/90',
                          )}
                        >
                          {type.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={dialogMode !== null}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            setDialogMode(null);
            setEditing(null);
          }
        }}
      >
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
                onChange={e => setForm(current => ({ ...current, name: e.target.value }))}
                placeholder={dialogMode === 'ocr_has'
                  ? t('settings.pipelineNamePlaceholder.ocr')
                  : t('settings.pipelineNamePlaceholder.image')}
                data-testid="pipeline-type-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('settings.descLabel')}</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(current => ({ ...current, description: e.target.value }))}
                rows={3}
                data-testid="pipeline-type-desc"
              />
            </div>

            <p className="text-xs text-muted-foreground">{t('settings.saveHint')}</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogMode(null);
                setEditing(null);
              }}
              data-testid="pipeline-type-cancel"
            >
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
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
