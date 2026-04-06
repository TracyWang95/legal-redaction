import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type PaginationRailProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
};

export function PaginationRail({
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  className,
}: PaginationRailProps) {
  const t = useT();

  if (totalItems <= 0) return null;

  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(totalItems, page * pageSize);

  return (
    <div
      className={cn(
        'surface-muted flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-border/70 px-3.5 py-2.5 shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {t('jobs.showRange')
            .replace('{start}', String(rangeStart))
            .replace('{end}', String(rangeEnd))
            .replace('{total}', String(totalItems))}
        </span>
        <span className="text-border">|</span>
        <span className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground">
          {page} / {totalPages}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          title={t('jobs.firstPage')}
          className="h-8 rounded-xl px-2.5"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-8 rounded-xl"
        >
          {t('jobs.prevPage')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-8 rounded-xl"
        >
          {t('jobs.nextPage')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          title={t('jobs.lastPage')}
          className="h-8 rounded-xl px-2.5"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
