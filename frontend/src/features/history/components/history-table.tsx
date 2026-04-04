/**
 * History file list table.
 */
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import type { FileListItem } from '@/types';
import { resolveRedactionState, REDACTION_STATE_LABEL, REDACTION_STATE_CLASS, BADGE_BASE } from '@/utils/redactionState';
import { Download, Trash2, ArrowLeftRight } from 'lucide-react';

interface HistoryTableProps {
  rows: FileListItem[];
  loading: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  allSelected: boolean;
  onSelectAll: (checked: boolean) => void;
  onDownload: (row: FileListItem) => void;
  onDelete: (row: FileListItem) => void;
  onCompare: (row: FileListItem) => void;
}

export function HistoryTable({
  rows, loading, selected, onToggle, allSelected, onSelectAll,
  onDownload, onDelete, onCompare,
}: HistoryTableProps) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyState title={t('emptyState.noFiles')} description={t('emptyState.noFilesDesc')} />;
  }

  return (
    <div className="overflow-x-auto" data-testid="history-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="p-3 w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) => onSelectAll(!!v)}
                data-testid="history-select-all"
              />
            </th>
            <th className="p-3">{t('history.filename')}</th>
            <th className="p-3 hidden sm:table-cell">{t('history.fileType')}</th>
            <th className="p-3 hidden md:table-cell">{t('history.entities')}</th>
            <th className="p-3 hidden md:table-cell">{t('history.status')}</th>
            <th className="p-3 hidden lg:table-cell">{t('history.date')}</th>
            <th className="p-3 text-right">{t('history.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const state = resolveRedactionState(row.has_output, row.item_status);
            return (
              <tr
                key={row.file_id}
                className="border-b hover:bg-muted/50 transition-colors"
                data-testid={`history-row-${row.file_id}`}
              >
                <td className="p-3">
                  <Checkbox
                    checked={selected.has(row.file_id)}
                    onCheckedChange={() => onToggle(row.file_id)}
                  />
                </td>
                <td className="p-3 max-w-[200px] truncate font-medium">
                  {row.original_filename}
                </td>
                <td className="p-3 hidden sm:table-cell">
                  <Badge variant="secondary" className="text-[10px]">
                    {row.file_type}
                  </Badge>
                </td>
                <td className="p-3 hidden md:table-cell tabular-nums">
                  {row.entity_count}
                </td>
                <td className="p-3 hidden md:table-cell">
                  <Badge className={cn(BADGE_BASE, REDACTION_STATE_CLASS[state])}>
                    {REDACTION_STATE_LABEL[state]}
                  </Badge>
                </td>
                <td className="p-3 hidden lg:table-cell text-muted-foreground text-xs">
                  {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                </td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-1">
                    {row.has_output && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onCompare(row)}
                        title={t('history.compare')}
                        data-testid={`compare-${row.file_id}`}
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onDownload(row)}
                      title={t('history.download')}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => onDelete(row)}
                      title={t('history.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
