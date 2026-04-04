/**
 * Create / edit entity type dialog — ShadCN Dialog + form fields with
 * regex validation preview and server-side regex testing.
 */
import { useState, useMemo } from 'react';
import { useT } from '@/i18n';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getRegexModalCheck } from '../hooks/use-entity-types';

interface EntityTypeForm {
  name: string;
  description: string;
  color: string;
  regex_pattern: string;
  use_llm: boolean;
  tag_template: string;
}

interface EntityTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<EntityTypeForm>;
  onSave: (form: EntityTypeForm) => void;
  mode: 'create' | 'edit';
}

const defaultForm: EntityTypeForm = {
  name: '', description: '', color: '#6B7280',
  regex_pattern: '', use_llm: true, tag_template: '',
};

export function EntityTypeDialog({
  open, onOpenChange, initial, onSave, mode,
}: EntityTypeDialogProps) {
  const t = useT();
  const [form, setForm] = useState<EntityTypeForm>({ ...defaultForm, ...initial });
  const [sampleText, setSampleText] = useState('');
  const [serverResult, setServerResult] = useState<{
    valid: boolean; matches: { text: string; start: number; end: number }[]; error: string;
  } | null>(null);
  const [serverTesting, setServerTesting] = useState(false);

  /* reset form when dialog opens with new initial */
  const resetOnOpen = (o: boolean) => {
    if (o) {
      setForm({ ...defaultForm, ...initial });
      setSampleText('');
      setServerResult(null);
    }
    onOpenChange(o);
  };

  const regexCheck = useMemo(
    () => getRegexModalCheck(form.regex_pattern, sampleText),
    [form.regex_pattern, sampleText],
  );

  const handleServerTest = async () => {
    if (!form.regex_pattern.trim()) return;
    setServerTesting(true);
    try {
      const res = await fetch('/api/v1/custom-types/regex-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: form.regex_pattern, test_text: sampleText }),
      });
      setServerResult(await res.json());
    } catch {
      setServerResult({ valid: false, matches: [], error: t('settings.requestFailed') });
    } finally {
      setServerTesting(false);
    }
  };

  const canSubmit = form.name.trim() &&
    (form.use_llm || (form.regex_pattern.trim() && regexCheck !== 'invalid_pattern'));

  return (
    <Dialog open={open} onOpenChange={resetOnOpen}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? (form.use_llm ? t('settings.addSemanticType') : t('settings.addRegexType'))
              : t('settings.editType')}
          </DialogTitle>
          <DialogDescription>
            {form.use_llm ? t('settings.addSemanticDesc') : t('settings.addRegexDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>{t('settings.nameLabel')} *</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={form.use_llm ? '如：项目负责人职务' : '如：合同签订日期'}
              data-testid="entity-type-name"
            />
          </div>

          {/* LLM toggle */}
          {mode === 'create' && (
            <div className="flex items-center gap-3">
              <Label>LLM</Label>
              <Switch
                checked={form.use_llm}
                onCheckedChange={v => setForm(f => ({ ...f, use_llm: v }))}
                data-testid="entity-type-llm-toggle"
              />
            </div>
          )}

          {/* Regex-specific fields */}
          {!form.use_llm && (
            <>
              <div className="space-y-1.5">
                <Label>{t('settings.regexLabel')} *</Label>
                <Textarea
                  value={form.regex_pattern}
                  onChange={e => setForm(f => ({ ...f, regex_pattern: e.target.value }))}
                  rows={3}
                  className="font-mono"
                  placeholder={'例如：\\d{4}-\\d{2}-\\d{2}'}
                  spellCheck={false}
                  data-testid="entity-type-regex"
                />
              </div>

              <div className="space-y-1.5">
                <Label>{t('settings.testMatchLabel')}</Label>
                <Textarea
                  value={sampleText}
                  onChange={e => setSampleText(e.target.value)}
                  rows={2}
                  placeholder={t('settings.testMatchPlaceholder')}
                  data-testid="entity-type-sample"
                />
              </div>

              {/* JS regex validation badge */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">{t('settings.regexValidation')}</Badge>
                {regexCheck === 'empty_pattern' && <span className="text-sm text-muted-foreground">{t('settings.regexEmpty')}</span>}
                {regexCheck === 'invalid_pattern' && <span className="text-sm font-medium text-destructive">{t('settings.regexInvalid')}</span>}
                {regexCheck === 'no_sample' && <span className="text-sm text-muted-foreground">{t('settings.regexReady')}</span>}
                {regexCheck === 'pass' && <span className="text-sm font-medium text-emerald-700">{t('settings.regexPass')}</span>}
                {regexCheck === 'fail' && <span className="text-sm font-medium text-destructive">{t('settings.regexFail')}</span>}
              </div>

              {/* Server-side regex tester */}
              <div className="space-y-2">
                <Label>{t('settings.testLabel')}</Label>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!form.regex_pattern.trim() || serverTesting}
                  onClick={() => void handleServerTest()}
                  data-testid="entity-type-test-regex"
                >
                  {serverTesting ? t('settings.testing') : t('settings.testRegex')}
                </Button>
                {serverResult && (
                  <div className="rounded-lg border px-3 py-2 text-sm">
                    {serverResult.valid ? (
                      <div>
                        <span className="font-medium text-emerald-700">
                          {t('settings.matchCount').replace('{n}', String(serverResult.matches.length))}
                        </span>
                        {serverResult.matches.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {serverResult.matches.map((m, i) => (
                              <span key={i} className="inline-block bg-yellow-100 text-yellow-900 border border-yellow-200 px-1.5 py-0.5 rounded text-xs font-mono">
                                {m.text}
                              </span>
                            ))}
                          </div>
                        )}
                        {serverResult.matches.length === 0 && (
                          <p className="text-xs text-muted-foreground mt-1">{t('settings.regexValidNoMatch')}</p>
                        )}
                      </div>
                    ) : (
                      <span className="font-medium text-destructive">{serverResult.error}</span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Semantic description */}
          {form.use_llm && (
            <div className="space-y-1.5">
              <Label>{t('settings.descLabel')}</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="简要说明这类信息在文档中的文字特征，便于模型识别"
                data-testid="entity-type-description"
              />
            </div>
          )}

          {/* Color */}
          <div className="space-y-1.5">
            <Label>Color</Label>
            <Input
              type="color"
              value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
              className="h-9 w-16 p-1"
              data-testid="entity-type-color"
            />
          </div>

          {/* Tag template */}
          <div className="space-y-1.5">
            <Label>Tag Template</Label>
            <Input
              value={form.tag_template}
              onChange={e => setForm(f => ({ ...f, tag_template: e.target.value }))}
              placeholder="可选"
              data-testid="entity-type-tag-template"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => resetOnOpen(false)} data-testid="entity-type-cancel">
            {t('settings.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => onSave(form)} data-testid="entity-type-save">
            {mode === 'create' ? t('settings.create') : t('settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
