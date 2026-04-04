/**
 * History page — file processing history and comparison.
 */
import { t } from '@/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useHistory } from './hooks/use-history';
import { HistoryFilters } from './components/history-filters';
import { HistoryTable } from './components/history-table';
import type { FileListItem } from '@/types';

export function History() {
  const s = useHistory();

  const handleDownload = (row: FileListItem) => {
    const url = `/api/v1/files/${row.file_id}/download?redacted=${row.has_output}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = row.original_filename;
    a.click();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-muted/30 overflow-hidden" data-testid="history-page">
      <div className="flex-1 flex flex-col min-h-0 px-3 py-3 sm:px-5 sm:py-4 w-full max-w-[min(100%,1920px)] mx-auto">
        <HistoryFilters
          sourceTab={s.sourceTab}
          onSourceTabChange={s.changeSourceTab}
          dateFilter={s.dateFilter}
          onDateFilterChange={s.setDateFilter}
          fileTypeFilter={s.fileTypeFilter}
          onFileTypeFilterChange={s.setFileTypeFilter}
          statusFilter={s.statusFilter}
          onStatusFilterChange={s.setStatusFilter}
          hasActiveFilter={s.hasActiveFilter}
          onClearFilters={s.clearFilters}
          onRefresh={() => s.load(true, s.page, s.pageSize)}
          onCleanup={() => s.setCleanupConfirmOpen(true)}
          onDownloadOriginal={() => s.downloadZip(false)}
          onDownloadRedacted={() => s.downloadZip(true)}
          refreshing={s.refreshing}
          loading={s.initialLoading}
          zipLoading={s.zipLoading}
          hasSelection={s.selectedIds.length > 0}
          pageSize={s.pageSize}
          onPageSizeChange={s.changePageSize}
        />

        {s.msg && (
          <Alert variant={s.msg.tone === 'err' ? 'destructive' : 'default'} className="mb-3">
            <AlertDescription>{s.msg.text}</AlertDescription>
          </Alert>
        )}

        <Card className="flex-1 min-h-0 overflow-hidden">
          <CardContent className="p-0">
            <HistoryTable
              rows={s.filteredRows}
              loading={s.initialLoading}
              selected={s.selected}
              onToggle={s.toggle}
              allSelected={s.allSelected}
              onSelectAll={(checked) => {
                if (checked) s.setSelected(new Set(s.filteredRows.map(r => r.file_id)));
                else s.setSelected(new Set());
              }}
              onDownload={handleDownload}
              onDelete={(row) => s.remove(row.file_id)}
              onCompare={(row) => s.openCompareModal(row)}
            />
          </CardContent>
        </Card>

        {s.totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
            <span>
              {(s.page - 1) * s.pageSize + 1}–{Math.min(s.page * s.pageSize, s.total)} / {s.total}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={s.page <= 1} onClick={() => s.goPage(s.page - 1)}>
                ←
              </Button>
              <Button variant="outline" size="sm" disabled={s.page >= s.totalPages} onClick={() => s.goPage(s.page + 1)}>
                →
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={s.compareOpen} onOpenChange={(v) => { if (!v) s.closeCompareModal(); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('history.compareTitle')}</DialogTitle>
          </DialogHeader>
          {s.compareLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : s.compareErr ? (
            <p className="text-destructive text-sm">{s.compareErr}</p>
          ) : s.compareData ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="font-medium mb-2">{t('history.original')}</h4>
                <pre className="bg-muted p-3 rounded-lg whitespace-pre-wrap text-xs max-h-[50vh] overflow-y-auto">
                  {s.compareData.original_content}
                </pre>
              </div>
              <div>
                <h4 className="font-medium mb-2">{t('history.redacted')}</h4>
                <pre className="bg-muted p-3 rounded-lg whitespace-pre-wrap text-xs max-h-[50vh] overflow-y-auto">
                  {s.compareData.redacted_content}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={s.cleanupConfirmOpen}
        title={t('history.cleanupTitle')}
        message={t('history.cleanupMsg')}
        danger
        onConfirm={s.handleCleanup}
        onCancel={() => s.setCleanupConfirmOpen(false)}
      />
      {s.confirmDlg && (
        <ConfirmDialog
          open
          title={s.confirmDlg.title}
          message={s.confirmDlg.message}
          danger
          onConfirm={s.confirmDlg.onConfirm}
          onCancel={() => s.setConfirmDlg(null)}
        />
      )}
    </div>
  );
}
