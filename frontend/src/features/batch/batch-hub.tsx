
import { Link } from 'react-router-dom';
import { ArrowRight, Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { BatchHubJobList } from './components/batch-hub-job-list';
import { useBatchHub } from './hooks/use-batch-hub';

export function BatchHub() {
  const t = useT();
  const {
    busy,
    error,
    loading,
    jobsUnavailable,
    activeJobs,
    startNewJob,
    continueJob,
    openPreview,
  } = useBatchHub();

  return (
    <div className="saas-page flex h-full min-h-0 overflow-y-auto bg-background">
      <div className="page-shell-narrow !max-w-[72rem]">
        <div className="page-stack gap-5 sm:gap-6">
          <section className="saas-hero relative overflow-hidden px-6 py-7 sm:px-8">
            <div className="flex flex-col gap-4">
              <span className="saas-kicker">{t('batchHub.kicker')}</span>
              <div className="page-section-heading gap-2">
                <h2 className="text-2xl font-semibold tracking-[-0.04em]" data-testid="batch-hub-title">
                  {t('batchHub.title')}
                </h2>
                <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
                  {t('batchHub.desc')}
                </p>
              </div>
            </div>
          </section>

          {error && (
            <Alert variant="destructive" data-testid="batch-hub-error">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button variant="outline" size="sm" onClick={openPreview}>
                  {t('batchHub.previewCta')}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {jobsUnavailable && (
            <Alert data-testid="batch-hub-preview-alert">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('batchHub.previewDesc')}</span>
                <Button variant="outline" size="sm" onClick={openPreview}>
                  {t('batchHub.previewCta')}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <button
            type="button"
            className="saas-panel group relative w-full p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/15 sm:p-7"
            onClick={() => void startNewJob()}
            data-testid="new-batch-btn"
            disabled={busy}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-[18px] bg-foreground text-background">
                  <Plus className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold tracking-[-0.01em]">
                    {t('batchHub.newTask')}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('batchHub.newTaskDesc')}
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 -translate-x-2 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </div>
          </button>

          <BatchHubJobList
            jobs={activeJobs}
            loading={loading}
            onContinue={continueJob}
          />

          <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
            {busy && <span>{t('batchHub.creating')}</span>}
            <Button variant="link" size="sm" className="h-auto px-0 text-xs" asChild>
              <Link to="/jobs">{t('batchHub.jobCenter')}</Link>
            </Button>
            <span className="text-border">&middot;</span>
            <Button variant="link" size="sm" className="h-auto px-0 text-xs" asChild>
              <Link to="/history">{t('batchHub.history')}</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
