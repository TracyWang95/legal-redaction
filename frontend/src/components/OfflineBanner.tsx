import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useT } from '@/i18n';

export function OfflineBanner() {
  const t = useT();
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[9999] flex justify-center px-4">
      <div className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-amber-500/20 bg-[rgba(255,251,235,0.96)] px-4 py-2 text-sm font-medium text-amber-900 shadow-[0_20px_50px_-30px_rgba(180,83,9,0.45)] backdrop-blur-xl dark:bg-[rgba(56,34,12,0.96)] dark:text-amber-100">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span className="truncate">{t('offline.banner')}</span>
      </div>
    </div>
  );
}
