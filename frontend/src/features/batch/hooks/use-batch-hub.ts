import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@/i18n';
import {
  createJob,
  listJobs,
  type JobSummary,
} from '@/services/jobsApi';
import { localizeErrorMessage } from '@/utils/localizeError';
import { resolveJobPrimaryNavigation } from '@/utils/jobPrimaryNavigation';
import {
  buildPreviewBatchRoute,
} from '../lib/batch-preview-fixtures';

function isActiveJob(status: string): boolean {
  return ['draft', 'queued', 'processing', 'running', 'awaiting_review', 'redacting'].includes(status);
}

export function useBatchHub() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobsUnavailable, setJobsUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await listJobs({ page: 1, page_size: 20 });
        if (!cancelled) {
          setJobsUnavailable(false);
          setRecentJobs(
            res.jobs
              .filter((job) => isActiveJob(job.status))
              .sort((left, right) => {
                const leftTime = left.updated_at ? Date.parse(left.updated_at) : 0;
                const rightTime = right.updated_at ? Date.parse(right.updated_at) : 0;
                return rightTime - leftTime;
              }),
          );
        }
      } catch {
        if (!cancelled) {
          setJobsUnavailable(true);
          setRecentJobs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeJobs = useMemo(() => recentJobs, [recentJobs]);

  const openPreview = useCallback(() => {
    nav(buildPreviewBatchRoute('smart', 1));
  }, [nav]);

  const startNewJob = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const j = await createJob({
        job_type: 'smart_batch',
        title: t('batchHub.batchTaskTitle').replace('{time}', new Date().toLocaleString()),
        config: {},
      });
      nav(`/batch/smart?jobId=${encodeURIComponent(j.id)}&step=1&new=1`);
    } catch (e) {
      setError(localizeErrorMessage(e, 'batchHub.createFailed'));
    } finally {
      setBusy(false);
    }
  }, [nav]);

  const continueJob = useCallback((job: JobSummary) => {
    const navTarget = resolveJobPrimaryNavigation({
      jobId: job.id,
      status: job.status,
      jobType: job.job_type,
      items: [],
      currentPage: 'other',
      navHints: job.nav_hints,
      jobConfig: job.config,
    });
    if (navTarget.kind === 'link') {
      nav(navTarget.to);
    } else {
      nav(`/jobs/${encodeURIComponent(job.id)}`);
    }
  }, [nav]);

  return {
    busy,
    error,
    loading,
    jobsUnavailable,
    activeJobs,
    startNewJob,
    continueJob,
    openPreview,
  };
}
