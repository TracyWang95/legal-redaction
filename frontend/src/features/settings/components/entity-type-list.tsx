/**
 * Entity type management table — ShadCN Table with color dot, name,
 * description, regex, LLM toggle, enabled switch, and row actions.
 */
import { useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  Table, TableHeader, TableBody, TableRow,
  TableHead, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { EntityTypeConfig } from '../hooks/use-entity-types';

interface EntityTypeListProps {
  types: EntityTypeConfig[];
  onEdit: (type: EntityTypeConfig) => void;
  onDelete: (id: string) => void;
  onAdd: (useLlm: boolean) => void;
  onReset: () => void;
  variant: 'regex' | 'llm';
}

export function EntityTypeList({
  types, onEdit, onDelete, onAdd, onReset, variant,
}: EntityTypeListProps) {
  const t = useT();
  const [filter] = useState('');

  const filtered = filter
    ? types.filter(tp =>
        tp.name.toLowerCase().includes(filter.toLowerCase()) ||
        tp.id.toLowerCase().includes(filter.toLowerCase()))
    : types;

  const isRegex = variant === 'regex';
  const borderColor = isRegex ? 'border-[#007AFF]/22' : 'border-[#34C759]/22';
  const headerBg = isRegex ? 'bg-[#007AFF]/[0.05]' : 'bg-[#34C759]/[0.06]';
  const dotColor = isRegex ? 'bg-[#007AFF]/90' : 'bg-[#34C759]/90';

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm', borderColor)}>
      <div className={cn('shrink-0 px-4 py-3 border-b flex items-center justify-between gap-2', borderColor, headerBg)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
          <span className="font-semibold text-sm truncate">
            {isRegex ? t('settings.regexRules') : t('settings.aiSemantic')}
          </span>
          <Badge variant="secondary" className="text-xs">{types.length}</Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={onReset}
            data-testid={`reset-${variant}-types`}
          >
            {isRegex ? t('settings.resetTextRules') : t('settings.resetTextRules')}
          </Button>
          <Button
            size="sm"
            onClick={() => onAdd(variant === 'llm')}
            data-testid={`add-${variant}-type`}
          >
            {t('settings.addNew')}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {filtered.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground text-center">
            {t('settings.noTypeConfig')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t('settings.nameLabel')}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {isRegex ? t('settings.regexLabel') : t('settings.descLabel')}
                </TableHead>
                <TableHead className="w-20 text-center">
                  {isRegex ? 'LLM' : t('settings.regex')}
                </TableHead>
                <TableHead className="w-24 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(tp => (
                <TableRow key={tp.id}>
                  <TableCell>
                    <span
                      className="inline-block w-3 h-3 rounded-full border"
                      style={{ backgroundColor: tp.color }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{tp.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{tp.id}</p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell max-w-[260px]">
                    {isRegex ? (
                      <code className="text-xs font-mono break-all line-clamp-2">
                        {tp.regex_pattern ?? '—'}
                      </code>
                    ) : (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {tp.description ?? '—'}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={!!tp.use_llm}
                      disabled
                      data-testid={`llm-switch-${tp.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onEdit(tp)}
                        data-testid={`edit-type-${tp.id}`}
                      >
                        <PencilIcon />
                      </Button>
                      {tp.id.startsWith('custom_') && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDelete(tp.id)}
                          data-testid={`delete-type-${tp.id}`}
                        >
                          <TrashIcon />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/* ---------- tiny inline SVG icons ---------- */
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
