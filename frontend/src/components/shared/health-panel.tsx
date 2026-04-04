/**
 * Service health status panel for the sidebar footer.
 * Shows OCR, NER, Vision service status + probe timing + GPU memory.
 */
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import type { ServicesHealth } from '@/hooks/use-service-health';

interface HealthPanelProps {
  health: ServicesHealth | null;
  checking: boolean;
  roundTripMs: number | null;
  onRefresh: () => void;
}

export function HealthPanel({ health, checking, roundTripMs, onRefresh }: HealthPanelProps) {
  const t = useT();

  return (
    <div className="px-3 py-2.5 rounded-xl bg-white/80 dark:bg-gray-800/80 border shadow-sm" data-testid="health-panel">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn('w-1.5 h-1.5 rounded-full', {
              'bg-gray-300 animate-pulse': checking,
              'bg-emerald-500': !checking && health?.all_online,
              'bg-amber-400': !checking && health && !health.all_online,
              'bg-red-500': !checking && !health,
            })}
          />
          <span className="text-[10px] font-semibold tracking-wide">{t('health.title')}</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="text-muted-foreground hover:text-foreground p-0.5"
          title={t('health.refreshTitle')}
          data-testid="health-refresh"
        >
          <RefreshCw className={cn('w-3 h-3', checking && 'animate-spin')} />
        </button>
      </div>

      {health ? (
        <div className="space-y-1.5 text-[10px]">
          <ServiceRow name={health.services.paddle_ocr.name} status={health.services.paddle_ocr.status} t={t} />
          <ServiceRow name={health.services.has_ner.name} status={health.services.has_ner.status} t={t} />
          <ServiceRow name={health.services.has_image.name} status={health.services.has_image.status} t={t} />

          <div className="text-[9px] text-muted-foreground pt-1.5 mt-0.5 border-t space-y-0.5 leading-snug pl-0.5">
            {typeof health.probe_ms === 'number' && (
              <p className="truncate">{t('health.backendProbe')} {health.probe_ms} ms</p>
            )}
            {roundTripMs != null && (
              <p className="truncate">{t('health.frontendRoundTrip')} {roundTripMs} ms</p>
            )}
            <p className="truncate">
              {t('health.gpuMemory')}{' '}
              {health.gpu_memory
                ? `${health.gpu_memory.used_mb} / ${health.gpu_memory.total_mb} MiB`
                : <span className="text-muted-foreground/50">{t('health.gpuNotDetected')}</span>}
            </p>
            {health.checked_at && (
              <p className="text-muted-foreground/60 break-all">
                {t('health.probeTime')} {new Date(health.checked_at).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-destructive">
          {checking ? t('health.detecting') : t('health.backendDown')}
        </div>
      )}
    </div>
  );
}

function ServiceRow({ name, status, t }: { name: string; status: string; t: (key: string) => string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground truncate mr-2" title={name}>{name}</span>
      <span className={cn('font-medium flex-shrink-0', status === 'online' ? 'text-emerald-500' : 'text-destructive')}>
        {status === 'online' ? t('health.online') : t('health.offline')}
      </span>
    </div>
  );
}
