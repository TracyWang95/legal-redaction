
import { useT } from '@/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useHistory } from './hooks/use-history';
import { HistoryFilters } from './components/history-filters';
import { HistoryTable } from './components/history-table';
import { PAGE_SIZE_OPTIONS } from './hooks/use-history';

export function History() {
  const t = useT();
  const s = useHistory();

  return (
    <div className="saas-page flex min-h-0 flex-1 flex-col overflow-hidden bg-background" data-testid="history-page">
      <div className="mx-auto flex w-full max-w-[min(100%,2048px)] flex-1 min-h-0 flex-col px-3 py-4 pb-5 sm:px-5 sm:py-5 sm:pb-6 2xl:px-8 2xl:pb-8">
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
        />

        {s.msg && (
          <Alert variant={s.msg.tone === 'err' ? 'destructive' : 'default'} className="mb-3">
            <AlertDescription>{s.msg.text}</AlertDescription>
          </Alert>
        )}

        <Card className="flex min-h-0 max-h-[min(54rem,calc(100vh-23rem))] flex-1 flex-col overflow-hidden">
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <HistoryTable
              rows={s.filteredRows}
              loading={s.initialLoading}
              selected={s.selected}
              onToggle={s.toggle}
              allSelected={s.allSelected}
              onSelectAll={(checked) => {
                if (checked) s.setSelected(new Set(s.filteredRows.map((row) => row.file_id)));
                else s.setSelected(new Set());
              }}
              onDownload={(row) => void s.downloadRow(row)}
              onDelete={(row) => s.remove(row.file_id)}
              onCompare={(row) => s.openCompareModal(row)}
            />
            {(s.total > 0 || s.totalPages > 1) && (
              <div className="shrink-0 border-t border-border/70 bg-background/96 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/90">
                <div className="surface-muted flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border/70 px-4 py-3 text-sm text-muted-foreground shadow-[var(--shadow-sm)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      {s.total === 0 ? 0 : (s.page - 1) * s.pageSize + 1} - {Math.min(s.page * s.pageSize, s.total)} / {s.total}
                    </span>
                    <span className="text-border">|</span>
                    <span className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground">
                      {s.page} / {s.totalPages}
                    </span>
                    <span className="text-border">|</span>
                    <span>{t('history.perPage')}</span>
                    <Select value={String(s.pageSize)} onValueChange={(value) => s.changePageSize(Number(value))}>
                      <SelectTrigger className="h-8 min-w-[92px] rounded-xl text-xs" data-testid="history-footer-page-size">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option} {t('history.itemsUnit')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={s.page <= 1} onClick={() => s.goPage(1)} className="h-8 rounded-xl px-2.5">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                      </svg>
                    </Button>
                    <Button variant="outline" size="sm" disabled={s.page <= 1} onClick={() => s.goPage(s.page - 1)} className="h-8 rounded-xl">
                      {t('history.prevPage')}
                    </Button>
                    <Button variant="outline" size="sm" disabled={s.page >= s.totalPages} onClick={() => s.goPage(s.page + 1)} className="h-8 rounded-xl">
                      {t('history.nextPage')}
                    </Button>
                    <Button variant="outline" size="sm" disabled={s.page >= s.totalPages} onClick={() => s.goPage(s.totalPages)} className="h-8 rounded-xl px-2.5">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={s.compareOpen} onOpenChange={(open) => { if (!open) s.closeCompareModal(); }}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('history.compareTitle')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('history.beforeRedaction')} / {t('history.afterRedaction')}
            </DialogDescription>
          </DialogHeader>
          {s.compareLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : s.compareErr ? (
            <p className="text-sm text-destructive">{s.compareErr}</p>
          ) : s.compareData ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <h4 className="mb-2 font-medium">{t('history.beforeRedaction')}</h4>
                <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
                  {s.compareData.original_content}
                </pre>
              </div>
              <div>
                <h4 className="mb-2 font-medium">{t('history.afterRedaction')}</h4>
                <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
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
