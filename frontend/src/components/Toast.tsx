import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { Toaster, toast } from 'sonner';

type ToastType = 'success' | 'error' | 'info';

function useHtmlTheme(): 'light' | 'dark' {
  const readTheme = () =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light';

  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    setTheme(readTheme());
    return () => observer.disconnect();
  }, []);

  return theme;
}

const TOAST_ICON: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const TOAST_CLASS: Record<ToastType, string> = {
  success: 'border-emerald-500/18 bg-[rgba(255,255,255,0.96)] text-foreground dark:bg-[rgba(19,23,34,0.96)]',
  error: 'border-red-500/18 bg-[rgba(255,255,255,0.96)] text-foreground dark:bg-[rgba(19,23,34,0.96)]',
  info: 'border-border bg-[rgba(255,255,255,0.96)] text-foreground dark:bg-[rgba(19,23,34,0.96)]',
};

const TOAST_ICON_CLASS: Record<ToastType, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-muted-foreground',
};

export function showToast(message: string, type: ToastType = 'info') {
  const Icon = TOAST_ICON[type];

  toast(message, {
    duration: 3500,
    className: [
      'rounded-2xl border px-4 py-3 shadow-[0_28px_70px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl',
      TOAST_CLASS[type],
    ].join(' '),
    descriptionClassName: 'text-sm text-muted-foreground',
    icon: <Icon className={TOAST_ICON_CLASS[type]} />,
  });
}

export function ToastContainer() {
  const theme = useHtmlTheme();

  return (
    <Toaster
      position="bottom-right"
      theme={theme}
      gap={10}
      closeButton
      richColors={false}
      toastOptions={{
        classNames: {
          toast:
            'group rounded-2xl border border-border bg-[rgba(255,255,255,0.96)] text-foreground shadow-[0_28px_70px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:bg-[rgba(19,23,34,0.96)]',
          title: 'text-sm font-medium text-foreground',
          closeButton:
            'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
        },
      }}
    />
  );
}
