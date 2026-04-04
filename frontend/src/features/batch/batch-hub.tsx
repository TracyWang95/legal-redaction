/**
 * BatchHub — entry page for batch processing.
 * Allows creating new batch jobs and resuming active ones.
 *
 * Refactored from pages/BatchHub.tsx (195 lines → 3 files):
 *   - features/batch/batch-hub.tsx (this file, ~65 lines)
 *   - features/batch/hooks/use-batch-hub.ts (business logic)
 *   - features/batch/components/batch-hub-job-list.tsx (job list UI)
 */
import { Link } from 'react-router-dom';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBatchHub } from './hooks/use-batch-hub';
import { BatchHubJobList } from './components/batch-hub-job-list';

export function BatchHub() {
  const { busy, error, loading, recentByType, startNewJob, continueJob } = useBatchHub();

  return (
    <div className="h-full min-h-0 flex flex-col bg-muted/30 px-3 py-4 sm:px-6 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold" data-testid="batch-hub-title">
            {t('batchHub.title')}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('batchHub.desc')}
          </p>
        </div>

        {/* Error alert */}
        {error && (
          <Alert variant="destructive" data-testid="batch-hub-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* New task button */}
        <Card
          className="cursor-pointer hover:border-primary/20 transition-colors"
          onClick={() => void startNewJob('smart_batch')}
          data-testid="new-batch-btn"
          role="button"
          tabIndex={0}
          aria-disabled={busy}
        >
          <CardContent className="p-5">
            <div className="text-sm font-semibold">
              {t('batchHub.newTask')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('batchHub.newTaskDesc')}
            </p>
          </CardContent>
        </Card>

        {/* Recent active jobs */}
        <BatchHubJobList
          jobs={recentByType}
          loading={loading}
          onContinue={continueJob}
        />

        {/* Footer links */}
        <p className="text-xs text-muted-foreground">
          {busy ? t('batchHub.creating') : ' '}
          <Button variant="link" size="sm" className="text-xs px-0 ml-2 h-auto" asChild>
            <Link to="/jobs">{t('batchHub.jobCenter')}</Link>
          </Button>
          <span className="mx-1">&middot;</span>
          <Button variant="link" size="sm" className="text-xs px-0 h-auto" asChild>
            <Link to="/history">{t('batchHub.history')}</Link>
          </Button>
        </p>
      </div>
    </div>
  );
}
