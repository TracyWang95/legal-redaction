import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../i18n';
import { SkeletonCard } from '../components/Skeleton';
import {
  deleteJob,
  getJob,
  listJobs,
  requeueFailed,
  type JobDetail,
  type JobItemRow,
  type JobProgress,
  type JobSummary,
  type JobTypeApi,
} from '../services/jobsApi';
import { buildBatchWorkbenchUrl, resolveJobPrimaryNavigation } from '../utils/jobPrimaryNavigation';
import {
  formatAggregateJobStatus,
  getAggregateJobStatusMeta,
  type JobStatusTone,
} from '../utils/jobStatusLabels';
import { resolveRedactionState, REDACTION_STATE_LABEL, REDACTION_STATE_CLASS, BADGE_BASE } from '../utils/redactionState';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DELETABLE_STATUSES = new Set(['draft', 'awaiting_review', 'completed', 'failed', 'cancelled']);
const ACTIVE_STATUSES = new Set(['queued', 'running', 'redacting', 'processing']);

function pathLabel(_jobType: JobTypeApi): string {
  return t('jobs.batchTask');
}

function executionLabel(config: Record<string, unknown>): string {
  return String(config.preferred_execution ?? 'queue') === 'local' ? t('jobs.localExec') : t('jobs.queueExec');
}

function canDeleteJob(status: string): boolean {
  return DELETABLE_STATUSES.has(status);
}

const ACTION_BTN_BASE = 'inline-flex items-center justify-center text-xs font-medium rounded-lg px-3 py-1.5 min-w-[60px] text-center transition-colors';

function outlineActionClass(tone: 'neutral' | 'info' | 'danger' = 'neutral'): string {
  if (tone === 'info') {
    return `${ACTION_BTN_BASE} border border-[#007AFF]/20 bg-[#007AFF]/[0.06] text-[#0a4a8c] hover:bg-[#007AFF]/[0.10]`;
  }
  if (tone === 'danger') {
    return `${ACTION_BTN_BASE} border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50`;
  }
  return `${ACTION_BTN_BASE} border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-[#1d1d1f] dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700`;
}


function primaryActionClass(_status: string): string {
  return `${ACTION_BTN_BASE} border border-[#007AFF]/30 bg-[#007AFF]/[0.08] text-[#0a4a8c] dark:text-[#5aafff] dark:border-[#5aafff]/30 dark:bg-[#5aafff]/[0.08] hover:bg-[#007AFF]/[0.14] dark:hover:bg-[#5aafff]/[0.14]`;
}

function toneClass(tone: JobStatusTone): string {
  if (tone === 'success') return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/10';
  if (tone === 'danger') return 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-600/10';
  if (tone === 'warning') return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/10';
  if (tone === 'review') return 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/10';
  if (tone === 'brand') return 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/10';
  if (tone === 'muted') return 'bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-500/10';
  return 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-500/10';
}

function statusToneClass(status: string): string {
  return toneClass(getAggregateJobStatusMeta(status).tone);
}

function typeToneClass(_jobType: JobTypeApi): string {
  return 'bg-violet-50 text-violet-700';
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('jobs.updatedAtUnknown');
  const locale = (typeof window !== 'undefined' && localStorage.getItem('locale')) || 'zh';
  return date.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN');
}

function jobsPollSignature(jobs: JobSummary[]): string {
  return jobs
    .map(job => {
      const ids = job.config?.entity_type_ids;
      const entityTypes =
        Array.isArray(ids) && ids.every((x): x is string => typeof x === 'string')
          ? [...ids].sort().join(',')
          : '';
      return [
        job.id,
        job.status,
        job.updated_at,
        job.title ?? '',
        job.progress.total_items,
        job.progress.awaiting_review,
        job.progress.completed,
        job.progress.failed,
        job.nav_hints?.item_count ?? '',
        job.nav_hints?.wizard_furthest_step ?? '',
        job.nav_hints?.batch_step1_configured === true ? '1' : '0',
        job.nav_hints?.first_awaiting_review_item_id ?? '',
        entityTypes,
      ].join('\x1e');
    })
    .join('\x1f');
}



function buildProgressHeadline(progress: JobProgress, navHints?: { redacted_count?: number | null; awaiting_review_count?: number | null } | null): string {
  const redacted = navHints?.redacted_count ?? progress.completed;
  const awaiting = navHints?.awaiting_review_count ?? progress.awaiting_review;
  const parts = [t('jobs.headlineRedacted').replace('{n}', String(redacted)), t('jobs.headlineAwaiting').replace('{n}', String(awaiting))];
  if (progress.failed > 0) parts.push(t('jobs.abnormal').replace('{n}', String(progress.failed)));
  return parts.join(' ·');
}

function buildProgressSummary(progress: JobProgress, itemCount: number, finishedCount: number): string {
  if (itemCount <= 0) return t('jobs.noFilesInJob');
  if (finishedCount >= itemCount) return t('jobs.allFilesProcessed');

  const waiting = progress.pending + progress.queued;
  const processing = progress.parsing + progress.ner + progress.vision;
  const review = progress.awaiting_review;
  const generating = progress.review_approved + progress.redacting;
  const failed = progress.failed;
  const cancelled = progress.cancelled ?? 0;

  const parts = [
    waiting > 0 ? t('jobs.pending').replace('{n}', String(waiting)) : null,
    processing > 0 ? t('jobs.recognizing').replace('{n}', String(processing)) : null,
    review > 0 ? t('jobs.awaitingReviewCount').replace('{n}', String(review)) : null,
    generating > 0 ? t('jobs.generating').replace('{n}', String(generating)) : null,
    failed > 0 ? t('jobs.abnormal').replace('{n}', String(failed)) : null,
    cancelled > 0 ? t('jobs.cancelledCount').replace('{n}', String(cancelled)) : null,
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return finishedCount > 0 ? t('jobs.completedCount').replace('{n}', String(finishedCount)) : t('jobs.waitingProcessing');
  }

  return parts.slice(0, 3).join(' ·');
}

export const Jobs: React.FC = () => {
  const [tab, setTab] = useState<JobTypeApi | 'all'>('all');
  const [rows, setRows] = useState<JobSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [jumpPage, setJumpPage] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(() => new Set());
  const [jobDetails, setJobDetails] = useState<Record<string, JobDetail>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<Set<string>>(() => new Set());

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(
    async (opts?: { targetPage?: number; targetPageSize?: number }) => {
      const targetPage = opts?.targetPage ?? page;
      const targetPageSize = opts?.targetPageSize ?? pageSize;
      const hasRows = rows.length > 0;
      if (hasRows) setRefreshing(true);
      else setLoading(true);
      setErr(null);

      try {
        const jobType = tab === 'all' ? undefined : tab;
        let result = await listJobs({ job_type: jobType, page: targetPage, page_size: targetPageSize });
        const resolvedTotalPages = Math.max(1, Math.ceil(result.total / result.page_size));
        if (targetPage > resolvedTotalPages && result.total > 0) {
          result = await listJobs({ job_type: jobType, page: resolvedTotalPages, page_size: targetPageSize });
        }
        setRows(prev => (jobsPollSignature(prev) === jobsPollSignature(result.jobs) ? prev : result.jobs));
        setTotal(prev => (prev === result.total ? prev : result.total));
        setPage(prev => (prev === result.page ? prev : result.page));
        setPageSize(prev => (prev === result.page_size ? prev : result.page_size));
        return result;
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('jobs.loadFailed'));
        if (!hasRows) setRows([]);
        return null;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, pageSize, rows.length, tab]
  );

  const fetchJobDetails = useCallback(async (jobIds: string[]) => {
    const ids = [...new Set(jobIds)].filter(Boolean);
    if (ids.length === 0) return;
    setDetailLoadingIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
    const results = await Promise.allSettled(ids.map(async id => ({ id, detail: await getJob(id) })));
    const patch: Record<string, JobDetail> = {};
    let firstError: string | null = null;
    results.forEach(result => {
      if (result.status === 'fulfilled') patch[result.value.id] = result.value.detail;
      else if (!firstError) firstError = result.reason instanceof Error ? result.reason.message : t('jobs.expandFailed');
    });
    if (Object.keys(patch).length > 0) {
      setJobDetails(prev => ({ ...prev, ...patch }));
      // Back-propagate fresh counts into the job list rows so that
      // the collapsed headline is accurate without another list fetch.
      setRows(prev => prev.map((job): JobSummary => {
        const detail = patch[job.id];
        if (!detail?.items) return job;
        let r = 0, a = 0;
        for (const it of detail.items) {
          if (it.has_output) r++; else if (['awaiting_review','review_approved','completed'].includes(it.status)) a++;
        }
        return {
          ...job,
          nav_hints: { ...job.nav_hints, redacted_count: r, awaiting_review_count: a } as JobSummary['nav_hints'],
        };
      }));
    }
    if (firstError) setErr(firstError);
    setDetailLoadingIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh list every 10s when there are active (non-terminal) jobs,
  // so progress numbers stay in sync without manual page reload.
  useEffect(() => {
    const hasActiveJobs = rows.some(j =>
      !['completed', 'failed', 'cancelled', 'draft'].includes(j.status)
    );
    if (!hasActiveJobs) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(tick, 10_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [rows, load]);

  const refreshList = useCallback(async () => {
    const result = await load({ targetPage: page });
    if (!result) return;
    const expandedVisibleIds = [...expandedJobIds].filter(id => result.jobs.some(job => job.id === id));
    if (expandedVisibleIds.length > 0) await fetchJobDetails(expandedVisibleIds);
  }, [expandedJobIds, fetchJobDetails, load, page]);

  const goPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === page) return;
    setPage(clamped);
    setJumpPage('');
  };

  const changePageSize = (next: number) => {
    if (next === pageSize) return;
    setPageSize(next);
    setPage(1);
    setJumpPage('');
  };

  const changeTab = (next: JobTypeApi | 'all') => {
    if (next === tab) return;
    setTab(next);
    setPage(1);
    setJumpPage('');
  };

  const toggleExpand = useCallback(
    async (job: JobSummary) => {
      const itemCount = job.nav_hints?.item_count ?? job.progress.total_items;
      if (itemCount <= 0) return;
      const opening = !expandedJobIds.has(job.id);
      setExpandedJobIds(prev => {
        const next = new Set(prev);
        if (opening) next.add(job.id);
        else next.delete(job.id);
        return next;
      });
      if (opening && !jobDetails[job.id] && !detailLoadingIds.has(job.id)) await fetchJobDetails([job.id]);
    },
    [detailLoadingIds, expandedJobIds, fetchJobDetails, jobDetails]
  );

  const onDelete = useCallback(
    async (job: JobSummary) => {
      if (!canDeleteJob(job.status) || deletingJobId) return;
      const title = job.title?.trim() || t('jobs.unnamedTask');
      const confirmed = window.confirm(
        t('jobs.confirmDelete').replace('{title}', title)
      );
      if (!confirmed) return;
      setDeletingJobId(job.id);
      setNotice(null);
      setErr(null);
      try {
        await deleteJob(job.id);
        setExpandedJobIds(prev => {
          const next = new Set(prev);
          next.delete(job.id);
          return next;
        });
        setJobDetails(prev => {
          const next = { ...prev };
          delete next[job.id];
          return next;
        });
        setNotice(t('jobs.deletedNotice').replace('{title}', title));
        const nextPage = rows.length === 1 && page > 1 ? page - 1 : page;
        if (nextPage !== page) setPage(nextPage);
        else await refreshList();
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('jobs.deleteFailed'));
      } finally {
        setDeletingJobId(null);
      }
    },
    [deletingJobId, page, refreshList, rows.length]
  );

  const [requeueingJobId, setRequeuingJobId] = useState<string | null>(null);
  const onRequeueFailed = useCallback(
    async (job: JobSummary) => {
      if (job.progress.failed <= 0 || requeueingJobId) return;
      setRequeuingJobId(job.id);
      setNotice(null);
      setErr(null);
      try {
        await requeueFailed(job.id);
        setNotice(t('jobs.requeuedNotice').replace('{n}', String(job.progress.failed)));
        await refreshList();
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('jobs.requeueFailed'));
      } finally {
        setRequeuingJobId(null);
      }
    },
    [requeueingJobId, refreshList]
  );

  const visibleRows = useMemo(() => rows, [rows]);
  const tableBusy = loading || refreshing || deletingJobId !== null;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(page * pageSize, total);

  const pageMetrics = useMemo(
    () =>
      visibleRows.reduce(
        (acc, job) => {
          if (job.status === 'draft') acc.draft += 1;
          else if (ACTIVE_STATUSES.has(job.status)) acc.processing += 1;
          else if (job.status === 'awaiting_review') acc.awaitingReview += 1;
          else if (job.status === 'completed') acc.completed += 1;
          else if (job.status === 'failed' || job.status === 'cancelled') acc.risk += 1;
          return acc;
        },
        { draft: 0, processing: 0, awaitingReview: 0, completed: 0, risk: 0 }
      ),
    [visibleRows]
  );

  const stopEvent = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="jobs-root flex-1 min-h-0 min-w-0 flex flex-col bg-[#f5f5f7] dark:bg-gray-900 overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 min-w-0 px-3 py-3 sm:px-5 sm:py-4 w-full max-w-[min(100%,1920px)] mx-auto items-stretch">
        <div className="flex flex-wrap items-center gap-2 mb-3 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            {(
              [
                { k: 'all' as const, label: t('jobs.tab.all') },
              ] as const
            ).map(({ k, label }) => (
              <button
                key={k}
                type="button"
                onClick={() => changeTab(k)}
                className={`text-2xs sm:text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                  tab === k
                    ? 'border-[#1d1d1f] bg-[#1d1d1f] text-white'
                    : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void refreshList()}
              disabled={tableBusy}
              className={outlineActionClass('neutral')}
              title={t('jobs.refreshTitle')}
            >
              {refreshing ? t('jobs.refreshing') : t('jobs.clickRefresh')}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('确定要清空所有任务记录、上传文件和脱敏产物吗？此操作不可撤销。')) return;
                try {
                  const res = await fetch('/api/v1/safety/cleanup', { method: 'POST' });
                  if (!res.ok) throw new Error('清空失败');
                  const data = await res.json();
                  alert(`已清空 ${data.files_removed} 个文件和 ${data.jobs_removed} 条任务`);
                  void refreshList();
                } catch { alert('清空失败'); }
              }}
              className={outlineActionClass('neutral') + ' !border-red-200 !text-red-600 hover:!bg-red-50'}
            >
              一键清空
            </button>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{t('jobs.thisPage').replace('{n}', String(visibleRows.length))}</span>
            <span className="text-gray-300">|</span>
            <span>{t('jobs.toConfigure').replace('{n}', String(pageMetrics.draft))}</span>
            <span className="text-gray-300">|</span>
            <span>{t('jobs.processing').replace('{n}', String(pageMetrics.processing))}</span>
            <span className="text-gray-300">|</span>
            <span>{t('jobs.awaitingReviewMetric').replace('{n}', String(pageMetrics.awaitingReview))}</span>
            <span className="text-gray-300">|</span>
            <span>{t('jobs.completedMetric').replace('{n}', String(pageMetrics.completed))}</span>
            <span className="text-gray-300">|</span>
            <span>{t('jobs.abnormalMetric').replace('{n}', String(pageMetrics.risk))}</span>
          </div>
        </div>

        {notice && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm px-3 py-2 flex-shrink-0">
            {notice}
          </div>
        )}
        {err && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 text-red-900 text-sm px-3 py-2 flex-shrink-0">
            {err}
          </div>
        )}

        <div className="jobs-surface w-full flex flex-col flex-1 min-h-0 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm dark:shadow-gray-900/30 overflow-hidden overflow-x-auto">
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{t('jobs.taskRecords')}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{t('jobs.totalAndPage').replace('{total}', String(total)).replace('{page}', String(page)).replace('{totalPages}', String(totalPages))}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-2xs text-gray-500 dark:text-gray-400">
              <span>{t('jobs.expandHint')}</span>
              <span className="text-gray-300">|</span>
              <span className="text-amber-700">{t('jobs.cancelBeforeDelete')}</span>
            </div>
          </div>

          {visibleRows.length > 0 && (
            <div className="jobs-table-head px-4 py-2 border-b border-gray-50 dark:border-gray-700 bg-[#fafafa] dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 font-medium flex-shrink-0">
              <span className="jobs-tree-cell" />
              <span className="jobs-task-cell">{t('jobs.task')}</span>
              <span className="jobs-exec-cell">{t('jobs.execMethod')}</span>
              <span className="jobs-progress-cell">{t('jobs.progress')}</span>
              <span className="jobs-status-cell">{t('jobs.currentStatus')}</span>
              <span className="jobs-updated-cell">{t('jobs.updatedAt')}</span>
              <span className="jobs-actions-cell jobs-head-actions">
                <span className="jobs-action-head">主操作</span>
                <span className="jobs-action-head">详情</span>
                <span className="jobs-action-head">删除</span>
              </span>
            </div>
          )}

          <div className="relative flex-1 min-h-0 overflow-y-auto flex flex-col">
            {refreshing && visibleRows.length > 0 && (
              <div className="absolute inset-0 bg-white/60 dark:bg-gray-800/60 flex items-center justify-center z-10 backdrop-blur-[1px]">
                <div className="w-7 h-7 border-2 border-[#e5e5e5] border-t-[#1d1d1f] rounded-full animate-spin" />
              </div>
            )}

            {loading && visibleRows.length === 0 ? (
              <div className="px-4 py-6 space-y-3">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">{t('jobs.noRecords')}</p>
                  <p className="text-xs text-gray-400">{t('jobs.noRecordsHint')}</p>
                </div>
                <Link to="/batch" className={outlineActionClass('neutral')}>
                  {t('jobs.gotoBatch')}
                </Link>
              </div>
            ) : (
              <ul className="flex w-full flex-col divide-y divide-gray-100 dark:divide-gray-700">
                {visibleRows.map((job, index) => {
                  const primary = resolveJobPrimaryNavigation({
                    jobId: job.id,
                    status: job.status,
                    jobType: job.job_type,
                    items: [],
                    currentPage: 'other',
                    navHints: job.nav_hints,
                    jobConfig: job.config,
                  });
                  const detailHref = `/jobs/${encodeURIComponent(job.id)}`;
                  const showPrimaryAction = primary.kind === 'link' && primary.to !== detailHref;
                  const showWorkbenchShortcut = ACTIVE_STATUSES.has(job.status);
                  const deleteBlocked = !canDeleteJob(job.status);
                  const stripe = index % 2 === 1 ? 'bg-[#fafafa] dark:bg-gray-900' : 'bg-white dark:bg-gray-800';
                  const itemCount = job.nav_hints?.item_count ?? job.progress.total_items;
                  const finishedCount = job.progress.completed + job.progress.failed + (job.progress.cancelled ?? 0);
                  const progressPercent = itemCount > 0 ? Math.min(100, Math.round((finishedCount / itemCount) * 100)) : 0;
                  // 展开后用 detail items 重新计算三态，保证和展开列表一致
                  const detailForHeadline = jobDetails[job.id];
                  const liveHints = detailForHeadline?.items ? (() => {
                    let r = 0, a = 0;
                    for (const it of detailForHeadline.items) {
                      if (it.has_output) r++; else if (['awaiting_review','review_approved','completed'].includes(it.status)) a++;
                    }
                    return { redacted_count: r, awaiting_review_count: a };
                  })() : job.nav_hints;
                  const progressHeadline = buildProgressHeadline(job.progress, liveHints);
                  const progressSummary = buildProgressSummary(job.progress, itemCount, finishedCount);
                  const expanded = expandedJobIds.has(job.id);
                  const detail = jobDetails[job.id];
                  const detailLoading = detailLoadingIds.has(job.id);
                  const expandable = itemCount > 0;
                  return (
                    <li key={job.id}>
                      <div
                        className={`${stripe} transition-colors ${expandable ? 'cursor-pointer hover:bg-gray-50/90 dark:hover:bg-gray-700/50' : 'hover:bg-gray-50/70 dark:hover:bg-gray-700/30'}`}
                        onClick={expandable ? () => void toggleExpand(job) : undefined}
                      >
                        <div className="jobs-row-main px-3 sm:px-4 py-2.5">
                          <div className="jobs-tree-cell jobs-expand-cell">
                            {itemCount > 0 ? (
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  void toggleExpand(job);
                                }}
                                className="w-6 h-6 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center"
                                title={expanded ? t('jobs.collapseFiles') : t('jobs.expandFiles')}
                                aria-expanded={expanded}
                              >
                                <svg
                                  className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            ) : (
                              <span className="w-6 h-6 rounded-md bg-gray-100 text-gray-300 flex items-center justify-center text-xs">·</span>
                            )}
                          </div>

                          <div className="jobs-task-cell min-w-0">
                            <div className="flex flex-nowrap items-center gap-2 min-w-0">
                              <span className={`jobs-task-badge text-2xs font-semibold px-1.5 py-0.5 rounded ${typeToneClass(job.job_type)}`}>
                                {pathLabel(job.job_type)}
                              </span>
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate" title={job.title || t('jobs.unnamedTask')}>
                                {job.title || t('jobs.unnamedTask')}
                              </p>
                            </div>
                            <p className="text-caption text-gray-500 mt-0.5">ID {job.id.slice(0, 8)}... <span className="hidden sm:inline">· {t('jobs.itemCount').replace('{n}', String(itemCount))}</span></p>
                            <p className="text-caption text-gray-400 mt-0.5 md:hidden">{t('jobs.updatedAtLabel').replace('{time}', formatUpdatedAt(job.updated_at))}</p>
                          </div>

                          <div className="jobs-exec-cell flex items-center gap-2">
                            <span className="text-xs text-gray-400 md:hidden">{t('jobs.execMethod')}</span>
                            <span className="inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-2xs whitespace-nowrap">
                              {executionLabel(job.config)}
                            </span>
                          </div>

                          <div className="jobs-progress-cell min-w-0">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-gray-700 tabular-nums truncate">
                                  {progressHeadline}
                                </span>
                                <span className="text-caption text-gray-400 tabular-nums shrink-0">{progressPercent}%</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    job.status === 'failed'
                                      ? 'bg-red-400'
                                      : job.status === 'completed'
                                        ? 'bg-emerald-500'
                                        : 'bg-[#1d1d1f]'
                                  }`}
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                              <p className="text-caption text-gray-400 truncate">{progressSummary}</p>
                            </div>
                          </div>

                          <div className="jobs-status-cell flex items-center gap-2">
                            <span className="text-xs text-gray-400 md:hidden">{t('jobs.currentStatus')}</span>
                            <span
                              className={`${BADGE_BASE} ${statusToneClass(job.status)}`}
                              title={getAggregateJobStatusMeta(job.status).description}
                            >
                              {formatAggregateJobStatus(job.status)}
                            </span>
                          </div>

                          <div className="jobs-updated-cell hidden md:block text-caption text-gray-400 tabular-nums whitespace-nowrap">
                            {formatUpdatedAt(job.updated_at)}
                          </div>

                          <div className="jobs-actions-cell" onClick={stopEvent}>
                            {/* 主操作 */}
                            {showPrimaryAction ? (
                              <Link to={primary.to} onClick={stopEvent} className={`${primaryActionClass(job.status)} w-full whitespace-nowrap`}>
                                {primary.label}
                              </Link>
                            ) : showWorkbenchShortcut ? (
                              <Link to={buildBatchWorkbenchUrl(job.id, job.job_type, 3)} onClick={stopEvent}
                                className={`${outlineActionClass('neutral')} w-full whitespace-nowrap`}>
                                {t('jobs.openWorkbench')}
                              </Link>
                            ) : job.progress.failed > 0 ? (
                              <button type="button" disabled={requeueingJobId === job.id}
                                onClick={event => { event.stopPropagation(); void onRequeueFailed(job); }}
                                className={`${ACTION_BTN_BASE} w-full whitespace-nowrap border border-amber-200 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50`}>
                                {requeueingJobId === job.id ? t('jobs.processingEllipsis') : t('jobs.requeueBtn').replace('{n}', String(job.progress.failed))}
                              </button>
                            ) : <span className="jobs-action-placeholder" />}
                            {/* 详情 */}
                            <Link to={detailHref} onClick={stopEvent} className={`${outlineActionClass('neutral')} w-full whitespace-nowrap`}>
                              {job.status === 'completed' ? '详情' : t('jobs.viewDetail')}
                            </Link>
                            {/* 删除 */}
                            {!deleteBlocked ? (
                              <button type="button" disabled={deletingJobId === job.id}
                                onClick={event => { event.stopPropagation(); void onDelete(job); }}
                                className={`${ACTION_BTN_BASE} w-full whitespace-nowrap border border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-red-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50`}>
                                {deletingJobId === job.id ? t('jobs.deletingEllipsis') : t('jobs.deleteTask')}
                              </button>
                            ) : <span className="jobs-action-placeholder" />}
                          </div>
                        </div>

                        {expanded && (
                          <div className="border-t border-gray-100 dark:border-gray-700" onClick={stopEvent}>
                            {detailLoading ? (
                              <div className="px-3 sm:px-4 py-4 text-xs text-gray-400 flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-[#e5e5e5] border-t-[#1d1d1f] rounded-full animate-spin" />
                                {t('jobs.loadingFileDetail')}
                              </div>
                            ) : detail && detail.items.length > 0 ? (
                              <div className="py-0.5 animate-fadeIn">
                                {detail.items.map((item: JobItemRow, itemIndex: number) => {
                                  const rs = resolveRedactionState(Boolean(item.has_output), item.status);
                                  const isLast = itemIndex === detail.items.length - 1;
                                  return (
                                  /* 子行复用 jobs-row-main grid，列宽与父行对齐 */
                                  <div key={item.id}
                                    className={`jobs-row-main jobs-child-row px-3 sm:px-4 py-1.5 ${!isLast ? 'border-b border-gray-50 dark:border-gray-800' : ''}`}
                                  >
                                    {/* col1: 树线 */}
                                    <span className="text-gray-300 dark:text-gray-600 text-xs text-center select-none" aria-hidden>
                                      {isLast ? '└' : '├'}
                                    </span>
                                    {/* col2: 文件名 */}
                                    <div className="jobs-task-cell jobs-child-task min-w-0">
                                      <p className="text-xs text-gray-600 dark:text-gray-300 truncate" title={item.filename || item.file_id}>
                                        {item.filename || item.file_id}
                                      </p>
                                      <p className="text-2xs text-gray-400 dark:text-gray-500">
                                        {item.file_type ? String(item.file_type).toUpperCase() : '—'} · {t('jobs.recognize').replace('{n}', String(item.entity_count ?? 0))}
                                      </p>
                                    </div>
                                    {/* col3: 执行方式列（空） */}
                                    <span />
                                    {/* col4: 进度列（空） */}
                                    <span />
                                    {/* col5: 状态 badge */}
                                    <div className="jobs-status-cell flex items-center">
                                      <span className={`${BADGE_BASE} ${REDACTION_STATE_CLASS[rs]}`}>
                                        {REDACTION_STATE_LABEL[rs]}
                                      </span>
                                    </div>
                                    {/* col6: 更新时间 */}
                                    <span className="jobs-updated-cell text-caption text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
                                      {formatUpdatedAt(item.updated_at)}
                                    </span>
                                    {/* col7: 操作列（空） */}
                                    <span />
                                  </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="px-3 sm:px-4 py-4 text-xs text-gray-400">{t('jobs.noFileDetail')}</div>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {total > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2 bg-[#fafafa] dark:bg-gray-900 flex-shrink-0">
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>{t('jobs.showRange').replace('{start}', String(rangeStart)).replace('{end}', String(rangeEnd)).replace('{total}', String(total))}</span>
                <span className="text-gray-300">|</span>
                <span>{t('jobs.perPage')}</span>
                <select
                  value={pageSize}
                  onChange={e => changePageSize(Number(e.target.value))}
                  className="border border-gray-200 dark:border-gray-600 rounded-lg px-1.5 py-1 bg-white dark:bg-gray-800 text-[#0a0a0a] dark:text-gray-100 text-xs"
                >
                  {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>
                      {size} {t('jobs.itemsUnit')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1 || tableBusy}
                  onClick={() => goPage(1)}
                  className="px-2 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                  title={t('jobs.firstPage')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={page <= 1 || tableBusy}
                  onClick={() => goPage(page - 1)}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                >
                  {t('jobs.prevPage')}
                </button>
                <div className="flex items-center gap-1 px-1">
                  <input
                    type="text"
                    value={jumpPage}
                    onChange={e => setJumpPage(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={e => {
                      if (e.key !== 'Enter') return;
                      const next = Number.parseInt(jumpPage, 10);
                      if (next >= 1 && next <= totalPages) {
                        goPage(next);
                        setJumpPage('');
                      }
                    }}
                    placeholder={String(page)}
                    className="w-10 text-center text-xs border border-gray-200 rounded-lg py-1 bg-white focus:border-gray-400 focus:outline-none"
                  />
                  <span className="text-xs text-gray-400">/ {totalPages}</span>
                </div>
                <button
                  type="button"
                  disabled={page >= totalPages || tableBusy}
                  onClick={() => goPage(page + 1)}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                >
                  {t('jobs.nextPage')}
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || tableBusy}
                  onClick={() => goPage(totalPages)}
                  className="px-2 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                  title={t('jobs.lastPage')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
