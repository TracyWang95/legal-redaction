/**
 * Application header bar.
 * Shows page title (route-based), sidebar trigger, language toggle,
 * dark mode toggle, and service health status indicator.
 */
import { Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useI18n, useT } from '@/i18n';
import { useDarkMode } from '@/hooks/useDarkMode';
import { useServiceHealth } from '@/hooks/use-service-health';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';

export function AppHeader() {
  const t = useT();
  const location = useLocation();
  const { dark, toggle: toggleDark } = useDarkMode();
  const { locale, setLocale } = useI18n();
  const { health, checking } = useServiceHealth();

  const { title, sub } = getPageHeader(location.pathname, t);

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2">
        <SidebarTrigger className="md:hidden" />
        <div className="flex min-w-0 flex-col justify-center">
          <h1 className="text-base font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
          {sub && <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{sub}</p>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* Language toggle */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          aria-label="Switch language"
          data-testid="lang-toggle"
        >
          {locale === 'zh' ? 'EN' : '\u4e2d'}
        </Button>

        {/* Dark mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={toggleDark}
          aria-label={dark ? t('layout.darkMode.toLight') : t('layout.darkMode.toDark')}
          data-testid="dark-mode-toggle"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* Health status indicator */}
        <div className="flex items-center gap-1.5 text-[10px]" data-testid="health-indicator">
          <span
            className={cn('h-1.5 w-1.5 rounded-full', {
              'animate-pulse bg-gray-300': checking,
              'bg-emerald-500': !checking && health?.all_online,
              'bg-amber-400': !checking && health && !health.all_online,
              'bg-red-500': !checking && !health,
            })}
          />
          <span className="text-muted-foreground">
            {checking
              ? t('health.checking')
              : health?.all_online
                ? t('health.allOnline')
                : health
                  ? t('health.someOffline')
                  : t('health.backendDown')}
          </span>
        </div>
      </div>
    </header>
  );
}

/** Derive page title + optional subtitle from current pathname */
function getPageHeader(pathname: string, t: (key: string) => string): { title: string; sub?: string } {
  if (pathname === '/batch') return { title: t('page.batch.title'), sub: t('page.batch.sub') };
  if (pathname.startsWith('/batch/text')) return { title: t('page.batchText.title'), sub: t('page.batchText.sub') };
  if (pathname.startsWith('/batch/image')) return { title: t('page.batchImage.title'), sub: t('page.batchImage.sub') };
  if (pathname.startsWith('/batch/smart')) return { title: t('page.batchSmart.title'), sub: t('page.batchSmart.sub') };
  if (pathname.startsWith('/settings/redaction')) return { title: t('page.redactionList.title'), sub: t('page.redactionList.sub') };
  if (pathname === '/settings') return { title: t('page.recognitionSettings.title'), sub: t('page.recognitionSettings.sub') };
  if (pathname.startsWith('/jobs/')) return { title: t('page.jobDetail.title'), sub: t('page.jobDetail.sub') };
  if (pathname === '/jobs') return { title: t('page.jobs.title'), sub: t('page.jobs.sub') };

  const map: Record<string, { title: string; sub?: string }> = {
    '/': { title: t('nav.playground') },
    '/history': { title: t('page.history.title'), sub: t('page.history.sub') },
    '/model-settings/text': { title: t('page.textModel.title'), sub: t('page.textModel.sub') },
    '/model-settings/vision': { title: t('page.visionModel.title'), sub: t('page.visionModel.sub') },
  };
  return map[pathname] || { title: t('nav.playground') };
}
