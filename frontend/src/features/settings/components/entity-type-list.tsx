import { useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSelectionToneClasses, type SelectionTone } from '@/ui/selectionPalette';
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
  types,
  onEdit,
  onDelete,
  onAdd,
  onReset,
  variant,
}: EntityTypeListProps) {
  const t = useT();
  const [filter] = useState('');

  const filtered = filter
    ? types.filter(type =>
        type.name.toLowerCase().includes(filter.toLowerCase()) ||
        type.id.toLowerCase().includes(filter.toLowerCase()))
    : types;

  const isRegex = variant === 'regex';
  const tone: SelectionTone = isRegex ? 'regex' : 'ner';
  const toneClasses = getSelectionToneClasses(tone);

  return (
    <div
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-border/70 bg-card shadow-[var(--shadow-control)]', toneClasses.headerSurface)}
      data-testid={`entity-type-list-${variant}`}
    >
      <div className={cn('flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4 py-3.5', toneClasses.headerSurface)}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', toneClasses.dot)} />
          <span className="truncate text-sm font-semibold tracking-[-0.02em]">
            {isRegex ? t('settings.regexRules') : t('settings.aiSemantic')}
          </span>
          <Badge variant="secondary" className={cn('text-xs', toneClasses.badgeText)}>
            {types.length}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onReset}
            data-testid={`reset-${variant}-types`}
          >
            {t('settings.resetTextRules')}
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

      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
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
              {filtered.map(type => (
                <TableRow key={type.id}>
                  <TableCell>
                    <span
                      className="inline-block size-3 rounded-full border"
                      style={{ backgroundColor: type.color }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{type.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{type.id}</p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[260px] md:table-cell">
                    {isRegex ? (
                      <code className="line-clamp-2 break-all text-xs font-mono">
                        {type.regex_pattern ?? '-'}
                      </code>
                    ) : (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {type.description ?? '-'}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={!!type.use_llm}
                      disabled
                      data-testid={`llm-switch-${type.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onEdit(type)}
                        data-testid={`edit-type-${type.id}`}
                      >
                        <PencilIcon />
                      </Button>
                      {type.id.startsWith('custom_') && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDelete(type.id)}
                          data-testid={`delete-type-${type.id}`}
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

function PencilIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}
