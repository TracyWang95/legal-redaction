import { cn } from '@/lib/utils';
import { Skeleton as UISkeleton } from '@/components/ui/skeleton';

interface SkeletonProps {
  className?: string;
  lines?: number;
}

export function Skeleton({ className = '', lines = 1 }: SkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <UISkeleton
          key={index}
          className="h-4 rounded-full bg-muted/80"
          style={{ width: `${Math.max(40, 100 - index * 15)}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-border/70 bg-card/80 p-5 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.16)]', className)}>
      <div className="flex flex-col gap-3">
        <UISkeleton className="h-4 w-3/4 rounded-full bg-muted/80" />
        <UISkeleton className="h-3 w-1/2 rounded-full bg-muted/70" />
        <UISkeleton className="h-3 w-2/3 rounded-full bg-muted/70" />
      </div>
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  cols = 3,
  className = '',
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-border/70 bg-card/70 px-4', className)}>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className={cn(
            'flex gap-4 py-3',
            rowIndex < rows - 1 && 'border-b border-border/50',
          )}
        >
          {Array.from({ length: cols }).map((_, colIndex) => (
            <UISkeleton
              key={colIndex}
              className="h-4 flex-1 rounded-full bg-muted/70"
              style={{ maxWidth: colIndex === 0 ? '40%' : '20%' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
