import type { Page, Route } from '@playwright/test';

type MockEntityType = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  examples: string[];
  color: string;
  regex_pattern?: string | null;
  use_llm: boolean;
  enabled: boolean;
  order: number;
  tag_template?: string | null;
  risk_level: number;
};

type MockPreset = {
  id: string;
  name: string;
  kind: 'text' | 'vision' | 'full';
  selectedEntityTypeIds: string[];
  ocrHasTypes: string[];
  hasImageTypes: string[];
  replacementMode: 'structured' | 'smart' | 'mask';
  created_at: string;
  updated_at: string;
};

type MockFile = Record<string, unknown>;
type MockJob = Record<string, unknown> & { id?: string; job_id?: string; items?: MockJobItem[] };
type MockJobItem = Record<string, unknown> & {
  id: string;
  job_id: string;
  file_id: string;
  status: string;
  filename?: string;
  file_type?: string;
  has_output?: boolean;
  entity_count?: number;
};

type MockApiOptions = {
  files?: MockFile[];
  jobs?: MockJob[];
  entityTypes?: MockEntityType[];
  pipelines?: typeof pipelines;
  servicesOnline?: boolean;
};

export type MockApiContractState = {
  createdJobs: Array<Record<string, unknown>>;
  updatedJobs: Array<{ jobId: string; body: Record<string, unknown> }>;
  uploads: Array<{
    job_id: string | null;
    upload_source: string | null;
    batch_group_id: string | null;
    raw: string;
  }>;
  submittedJobs: string[];
  reviewDrafts: Array<{ jobId: string; itemId: string; body: Record<string, unknown> }>;
  reviewCommits: Array<{ jobId: string; itemId: string; body: Record<string, unknown> }>;
  exportReportRequests: Array<{ jobId: string; fileIds: string[] }>;
  batchDownloadRequests: Array<Record<string, unknown>>;
};

const initialEntityTypes: MockEntityType[] = [
  {
    id: 'PERSON',
    name: 'Person',
    category: 'direct',
    description: 'Names in contracts and correspondence',
    examples: ['Alice Wang'],
    color: '#2563eb',
    regex_pattern: null,
    use_llm: true,
    enabled: true,
    order: 1,
    tag_template: 'PERSON_{n}',
    risk_level: 5,
  },
  {
    id: 'CASE_NUMBER',
    name: 'Case Number',
    category: 'direct',
    description: 'Legal case numbers',
    examples: ['CASE-2026-001'],
    color: '#dc2626',
    regex_pattern: 'CASE-\\d{4}-\\d{3}',
    use_llm: false,
    enabled: true,
    order: 2,
    tag_template: 'CASE_{n}',
    risk_level: 4,
  },
];

const pipelines = [
  {
    mode: 'ocr_has',
    name: 'OCR HaS',
    description: 'OCR visual text detection',
    enabled: true,
    types: [
      {
        id: 'STAMP',
        name: 'Stamp',
        color: '#7c3aed',
        description: 'Company or official stamps',
        enabled: true,
        order: 1,
      },
    ],
  },
  {
    mode: 'has_image',
    name: 'HaS Image',
    description: 'Image object detection',
    enabled: true,
    types: [
      {
        id: 'FACE',
        name: 'Face',
        color: '#059669',
        description: 'Human faces',
        enabled: true,
        order: 1,
      },
    ],
  },
];

const legacyJobs = [
  {
    id: 'job-legacy',
    type: 'text',
    name: 'Legacy import',
    status: 'awaiting_review',
    item_count: '3',
    completed_count: 1,
    failed_count: 1,
    created_at: new Date('2026-04-05T09:30:00Z').toISOString(),
    updated_at: new Date('2026-04-05T09:45:00Z').toISOString(),
    config: { execution_mode: 'local' },
  },
];

const initialPresets: MockPreset[] = [
  {
    id: 'preset-default-text',
    name: 'Default text preset',
    kind: 'text',
    selectedEntityTypeIds: ['PERSON', 'CASE_NUMBER'],
    ocrHasTypes: [],
    hasImageTypes: [],
    replacementMode: 'structured',
    created_at: new Date('2026-04-05T09:00:00Z').toISOString(),
    updated_at: new Date('2026-04-05T09:00:00Z').toISOString(),
  },
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function text(route: Route, body: string, status = 200, contentType = 'text/plain') {
  return route.fulfill({
    status,
    contentType,
    body,
  });
}

async function parseJsonBody(route: Route): Promise<Record<string, unknown>> {
  const raw = route.request().postData();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso() {
  return new Date('2026-04-05T10:00:00Z').toISOString();
}

function paginationParams(url: URL, fallbackPageSize: number) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const pageSize = Math.max(
    1,
    Number(url.searchParams.get('page_size') ?? fallbackPageSize) || fallbackPageSize,
  );
  return { page, pageSize };
}

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function extractMultipartField(raw: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = raw.match(new RegExp(`name="${escaped}"\\r?\\n\\r?\\n([\\s\\S]*?)(?:\\r?\\n--|$)`));
  return match ? match[1].trim() : null;
}

function filenameFromMultipart(raw: string): string {
  const match = raw.match(/filename="([^"]+)"/);
  return match?.[1] || 'uploaded.txt';
}

function fileTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(lower)) return 'image';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(txt|md|rtf|html?)$/.test(lower)) return 'txt';
  if (lower.endsWith('.doc')) return 'doc';
  return 'docx';
}

function makeProgress(items: MockJobItem[]) {
  return {
    total_items: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    processing: items.filter((item) => item.status === 'processing').length,
    queued: items.filter((item) => item.status === 'queued').length,
    parsing: items.filter((item) => item.status === 'parsing').length,
    ner: items.filter((item) => item.status === 'ner').length,
    vision: items.filter((item) => item.status === 'vision').length,
    awaiting_review: items.filter((item) => item.status === 'awaiting_review').length,
    review_approved: items.filter((item) => item.status === 'review_approved').length,
    redacting: items.filter((item) => item.status === 'redacting').length,
    completed: items.filter((item) => item.status === 'completed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
  };
}

function normalizeMockJob(job: MockJob): MockJob {
  const items = Array.isArray(job.items) ? job.items : [];
  const id = String(job.id ?? job.job_id ?? 'job-mock');
  return {
    id,
    job_id: id,
    job_type: job.job_type ?? job.type ?? 'smart_batch',
    title: job.title ?? job.name ?? 'Mock batch job',
    status: job.status ?? 'draft',
    skip_item_review: job.skip_item_review ?? false,
    config: job.config ?? {},
    created_at: job.created_at ?? nowIso(),
    updated_at: job.updated_at ?? nowIso(),
    progress: job.progress ?? makeProgress(items),
    nav_hints: job.nav_hints ?? {
      item_count: items.length,
      first_awaiting_review_item_id:
        items.find((item) => item.status === 'awaiting_review')?.id ?? null,
      wizard_furthest_step: items.length ? 4 : 2,
      batch_step1_configured: true,
      awaiting_review_count: items.filter((item) => item.status === 'awaiting_review').length,
      redacted_count: items.filter((item) => item.has_output).length,
    },
    ...job,
    items,
  };
}

function buildFileInfo(file: MockFile): MockFile {
  const fileId = String(file.file_id ?? file.id);
  const filename = String(file.original_filename ?? file.filename ?? `${fileId}.txt`);
  const fileType = String(file.file_type ?? fileTypeFromFilename(filename));
  const isImage = fileType === 'image' || fileType === 'pdf_scanned';
  return {
    id: fileId,
    file_id: fileId,
    original_filename: filename,
    filename,
    file_type: fileType,
    file_size: Number(file.file_size ?? 512),
    created_at: file.created_at ?? nowIso(),
    page_count: file.page_count ?? 1,
    content:
      file.content ??
      'Contract between Alice Wang and Example Corp. Case CASE-2026-001 requires review.',
    pages: file.pages ?? [
      'Contract between Alice Wang and Example Corp. Case CASE-2026-001 requires review.',
    ],
    entities:
      file.entities ??
      (isImage
        ? []
        : [
            {
              id: `${fileId}-entity-1`,
              text: 'Alice Wang',
              type: 'PERSON',
              start: 17,
              end: 27,
              page: 1,
              confidence: 0.97,
              source: 'has',
              selected: true,
            },
          ]),
    bounding_boxes:
      file.bounding_boxes ??
      (isImage
        ? {
            1: [
              {
                id: `${fileId}-box-1`,
                x: 0.12,
                y: 0.18,
                width: 0.28,
                height: 0.2,
                page: 1,
                type: 'official_seal',
                selected: true,
                confidence: 0.91,
                source: 'has_image',
                source_detail: 'has_image',
                warnings: [],
              },
            ],
          }
        : {}),
    vision_quality:
      file.vision_quality ??
      (isImage
        ? {
            1: {
              warnings: [],
              pipeline_status: {
                has_image: {
                  ran: true,
                  skipped: false,
                  failed: false,
                  region_count: 1,
                  error: null,
                },
              },
            },
          }
        : {}),
    ...file,
  };
}

function buildExportReport(job: MockJob, selectedFileIds: string[], files: MockFile[]) {
  const items = Array.isArray(job.items) ? job.items : [];
  const selectedItems = items.filter((item) => selectedFileIds.includes(item.file_id));
  const selectedFiles = selectedItems.length || selectedFileIds.length;
  const redactedSelected = selectedItems.filter((item) => item.has_output).length;
  const detectedEntities = selectedItems.reduce(
    (sum, item) => sum + Number(item.entity_count ?? 0),
    0,
  );
  return {
    generated_at: nowIso(),
    job: {
      id: job.id,
      status: job.status,
      job_type: job.job_type,
      skip_item_review: job.skip_item_review ?? false,
      config: job.config ?? {},
    },
    summary: {
      total_files: items.length,
      selected_files: selectedFiles,
      redacted_selected_files: redactedSelected,
      unredacted_selected_files: Math.max(0, selectedFiles - redactedSelected),
      review_confirmed_selected_files: selectedItems.filter((item) => item.reviewed_at).length,
      failed_selected_files: selectedItems.filter((item) => item.status === 'failed').length,
      detected_entities: detectedEntities,
      redaction_coverage: selectedFiles ? redactedSelected / selectedFiles : 0,
      action_required_files: Math.max(0, selectedFiles - redactedSelected),
      ready_for_delivery: selectedFiles > 0 && redactedSelected === selectedFiles,
      by_status: Object.fromEntries(
        ['awaiting_review', 'completed', 'failed'].map((status) => [
          status,
          selectedItems.filter((item) => item.status === status).length,
        ]),
      ),
      zip_redacted_included_files: redactedSelected,
      zip_redacted_skipped_files: Math.max(0, selectedFiles - redactedSelected),
      visual_review_issue_files: 0,
      visual_review_issue_count: 0,
      visual_review_by_issue: {},
    },
    redacted_zip: {
      included_count: redactedSelected,
      skipped_count: Math.max(0, selectedFiles - redactedSelected),
      skipped: selectedItems
        .filter((item) => !item.has_output)
        .map((item) => ({ file_id: item.file_id, reason: 'missing_redacted_output' })),
    },
    files: selectedItems.map((item) => {
      const file = files.find((candidate) => candidate.file_id === item.file_id);
      return {
        item_id: item.id,
        file_id: item.file_id,
        filename: item.filename ?? file?.original_filename ?? item.file_id,
        status: item.status,
        has_output: Boolean(item.has_output),
        review_confirmed: Boolean(item.reviewed_at),
        entity_count: Number(item.entity_count ?? 0),
        ready_for_delivery: Boolean(item.has_output),
        selected_for_export: true,
        page_count: Number(file?.page_count ?? 1),
        visual_review: {
          issue_count: 0,
          issue_pages: [],
          by_issue: {},
        },
      };
    }),
  };
}

export async function mockApi(
  page: Page,
  options: MockApiOptions = {},
): Promise<MockApiContractState> {
  let entityTypes = (options.entityTypes ?? initialEntityTypes).map((type) => ({ ...type }));
  const configuredPipelines = clone(options.pipelines ?? pipelines);
  let presets = initialPresets.map((preset) => ({ ...preset }));
  let files = (options.files ?? []).map((file) => buildFileInfo(clone(file)));
  let jobs = (options.jobs ?? legacyJobs).map((job) => normalizeMockJob(clone(job)));
  const state: MockApiContractState = {
    createdJobs: [],
    updatedJobs: [],
    uploads: [],
    submittedJobs: [],
    reviewDrafts: [],
    reviewCommits: [],
    exportReportRequests: [],
    batchDownloadRequests: [],
  };

  await page.route('**/health/**', async (route) =>
    json(route, {
      all_online: Boolean(options.servicesOnline),
      probe_ms: 3,
      checked_at: new Date('2026-04-05T10:00:00Z').toISOString(),
      gpu_memory: null,
      services: {
        paddle_ocr: { name: 'PaddleOCR', status: options.servicesOnline ? 'online' : 'offline' },
        has_ner: { name: 'HaS Text', status: options.servicesOnline ? 'online' : 'offline' },
        has_image: { name: 'HaS Image', status: options.servicesOnline ? 'online' : 'offline' },
      },
    }),
  );

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/auth/status') {
      return json(route, { auth_enabled: false, password_set: false, authenticated: true });
    }

    if (path === '/custom-types' && method === 'GET') {
      const enabledOnly = url.searchParams.get('enabled_only') === 'true';
      const customTypes = enabledOnly ? entityTypes.filter((type) => type.enabled) : entityTypes;
      return json(route, { custom_types: customTypes, total: customTypes.length });
    }

    if (path === '/custom-types' && method === 'POST') {
      const body = await parseJsonBody(route);
      const id = String(body.name ?? `Custom ${entityTypes.length + 1}`)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const next: MockEntityType = {
        id,
        name: String(body.name ?? id),
        category: 'direct',
        description: typeof body.description === 'string' ? body.description : null,
        examples: [],
        color: typeof body.color === 'string' ? body.color : '#2563eb',
        regex_pattern: typeof body.regex_pattern === 'string' ? body.regex_pattern : null,
        use_llm: Boolean(body.use_llm),
        enabled: true,
        order: entityTypes.length + 1,
        tag_template: typeof body.tag_template === 'string' ? body.tag_template : null,
        risk_level: 3,
      };
      entityTypes = [...entityTypes, next];
      return json(route, next, 201);
    }

    if (path === '/vision-pipelines' && method === 'GET') {
      return json(route, configuredPipelines);
    }

    if (path === '/presets' && method === 'GET') {
      return json(route, { presets, total: presets.length, page: 1, page_size: presets.length });
    }

    if (path === '/presets' && method === 'POST') {
      const body = await parseJsonBody(route);
      const now = new Date('2026-04-05T10:00:00Z').toISOString();
      const next: MockPreset = {
        id: `preset-${presets.length + 1}`,
        name: String(body.name ?? `Preset ${presets.length + 1}`),
        kind:
          body.kind === 'text' || body.kind === 'vision' || body.kind === 'full'
            ? body.kind
            : 'full',
        selectedEntityTypeIds: Array.isArray(body.selectedEntityTypeIds)
          ? body.selectedEntityTypeIds.map(String)
          : [],
        ocrHasTypes: Array.isArray(body.ocrHasTypes) ? body.ocrHasTypes.map(String) : [],
        hasImageTypes: Array.isArray(body.hasImageTypes) ? body.hasImageTypes.map(String) : [],
        replacementMode:
          body.replacementMode === 'smart' || body.replacementMode === 'mask'
            ? body.replacementMode
            : 'structured',
        created_at: now,
        updated_at: now,
      };
      presets = [...presets, next];
      return json(route, next, 201);
    }

    if (path.startsWith('/presets/') && method === 'PUT') {
      const id = path.split('/').pop() ?? '';
      const index = presets.findIndex((preset) => preset.id === id);
      if (index < 0) return json(route, { message: 'not found' }, 404);
      const body = await parseJsonBody(route);
      const updated = {
        ...presets[index],
        ...body,
        updated_at: new Date('2026-04-05T10:05:00Z').toISOString(),
      } as MockPreset;
      presets = presets.map((preset) => (preset.id === id ? updated : preset));
      return json(route, updated);
    }

    if (path.startsWith('/presets/') && method === 'DELETE') {
      const id = path.split('/').pop() ?? '';
      presets = presets.filter((preset) => preset.id !== id);
      return json(route, { message: 'deleted' });
    }

    if (path === '/recognition-presets') {
      return json(route, { message: 'legacy endpoint removed from mock; use /presets' }, 410);
    }

    if (path === '/jobs' && method === 'GET') {
      const { page, pageSize } = paginationParams(url, 20);
      const jobType = url.searchParams.get('job_type');
      const filteredJobs = jobType
        ? jobs.filter((job) => String(job.job_type ?? job.type ?? '') === jobType)
        : jobs;
      return json(route, {
        jobs: paginate(filteredJobs, page, pageSize),
        total: filteredJobs.length,
        page,
        page_size: pageSize,
      });
    }

    if (path === '/jobs' && method === 'POST') {
      const body = await parseJsonBody(route);
      state.createdJobs.push(body);
      const id = `job-${state.createdJobs.length}`;
      const job = normalizeMockJob({
        id,
        job_id: id,
        job_type: body.job_type ?? 'smart_batch',
        title: body.title ?? 'Mock batch job',
        status: 'draft',
        skip_item_review: body.skip_item_review ?? false,
        config: body.config ?? {},
        priority: body.priority,
        items: [],
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      jobs = [job, ...jobs];
      return json(route, job);
    }

    if (path === '/jobs/batch-details' && method === 'POST') {
      return json(route, { jobs });
    }

    const submitMatch = path.match(/^\/jobs\/([^/]+)\/submit$/);
    if (submitMatch && method === 'POST') {
      const jobId = decodeURIComponent(submitMatch[1]);
      state.submittedJobs.push(jobId);
      jobs = jobs.map((job) => {
        if (job.id !== jobId && job.job_id !== jobId) return job;
        const items = (job.items ?? []).map((item) => ({
          ...item,
          status: 'awaiting_review',
          has_output: false,
          entity_count: item.file_type === 'image' ? 1 : 1,
          updated_at: nowIso(),
        }));
        return normalizeMockJob({
          ...job,
          status: 'awaiting_review',
          items,
          progress: makeProgress(items),
          nav_hints: {
            item_count: items.length,
            first_awaiting_review_item_id:
              items.find((item) => item.status === 'awaiting_review')?.id ?? null,
            wizard_furthest_step: 4,
            batch_step1_configured: true,
            awaiting_review_count: items.length,
            redacted_count: 0,
          },
        });
      });
      return json(
        route,
        jobs.find((job) => job.id === jobId || job.job_id === jobId),
      );
    }

    const reviewDraftMatch = path.match(/^\/jobs\/([^/]+)\/items\/([^/]+)\/review-draft$/);
    if (reviewDraftMatch && method === 'GET') {
      return json(route, { exists: false, entities: [], bounding_boxes: [], updated_at: null });
    }
    if (reviewDraftMatch && method === 'PUT') {
      const body = await parseJsonBody(route);
      state.reviewDrafts.push({
        jobId: decodeURIComponent(reviewDraftMatch[1]),
        itemId: decodeURIComponent(reviewDraftMatch[2]),
        body,
      });
      return json(route, { exists: true, ...body, updated_at: nowIso() });
    }

    const commitMatch = path.match(/^\/jobs\/([^/]+)\/items\/([^/]+)\/review\/commit$/);
    if (commitMatch && method === 'POST') {
      const jobId = decodeURIComponent(commitMatch[1]);
      const itemId = decodeURIComponent(commitMatch[2]);
      const body = await parseJsonBody(route);
      state.reviewCommits.push({ jobId, itemId, body });
      let updatedItem: MockJobItem | undefined;
      jobs = jobs.map((job) => {
        if (job.id !== jobId && job.job_id !== jobId) return job;
        const items = (job.items ?? []).map((item) => {
          if (item.id !== itemId) return item;
          updatedItem = {
            ...item,
            status: 'completed',
            has_output: true,
            entity_count:
              (Array.isArray(body.entities) ? body.entities.length : 0) +
              (Array.isArray(body.bounding_boxes) ? body.bounding_boxes.length : 0),
            reviewed_at: nowIso(),
            reviewer: 'mock-e2e',
            updated_at: nowIso(),
          };
          return updatedItem;
        });
        const completed = items.filter((item) => item.status === 'completed').length;
        return normalizeMockJob({
          ...job,
          status: completed === items.length ? 'completed' : 'awaiting_review',
          items,
          progress: makeProgress(items),
          nav_hints: {
            item_count: items.length,
            first_awaiting_review_item_id:
              items.find((item) => item.status === 'awaiting_review')?.id ?? null,
            wizard_furthest_step: completed === items.length ? 5 : 4,
            batch_step1_configured: true,
            awaiting_review_count: items.filter((item) => item.status === 'awaiting_review').length,
            redacted_count: completed,
          },
        });
      });
      return json(route, updatedItem ?? { id: itemId, job_id: jobId, status: 'completed' });
    }

    const exportReportMatch = path.match(/^\/jobs\/([^/]+)\/export-report$/);
    if (exportReportMatch && method === 'GET') {
      const jobId = decodeURIComponent(exportReportMatch[1]);
      const fileIds = url.searchParams.getAll('file_ids');
      state.exportReportRequests.push({ jobId, fileIds });
      const job = jobs.find((entry) => entry.id === jobId || entry.job_id === jobId);
      if (!job) return json(route, { message: 'not found' }, 404);
      return json(route, buildExportReport(job, fileIds, files));
    }

    if (path === '/files/upload' && method === 'POST') {
      const raw = request.postDataBuffer()?.toString('latin1') ?? request.postData() ?? '';
      const jobId = extractMultipartField(raw, 'job_id');
      const uploadSource = extractMultipartField(raw, 'upload_source');
      const batchGroupId = extractMultipartField(raw, 'batch_group_id');
      state.uploads.push({
        job_id: jobId,
        upload_source: uploadSource,
        batch_group_id: batchGroupId,
        raw,
      });
      const filename = filenameFromMultipart(raw);
      const fileId = `file-${state.uploads.length}`;
      const fileType = fileTypeFromFilename(filename);
      const fileInfo = buildFileInfo({
        file_id: fileId,
        id: fileId,
        original_filename: filename,
        filename,
        file_type: fileType,
        file_size: 1024 + state.uploads.length,
        upload_source: uploadSource ?? 'batch',
        job_id: jobId,
        batch_group_id: batchGroupId,
      });
      files = [fileInfo, ...files];
      if (jobId) {
        jobs = jobs.map((job) => {
          if (job.id !== jobId && job.job_id !== jobId) return job;
          const item: MockJobItem = {
            id: `item-${state.uploads.length}`,
            job_id: jobId,
            file_id: fileId,
            sort_order: job.items?.length ?? 0,
            status: 'pending',
            filename,
            file_type: fileType,
            has_output: false,
            entity_count: 0,
            created_at: nowIso(),
            updated_at: nowIso(),
          };
          const items = [...(job.items ?? []), item];
          return normalizeMockJob({
            ...job,
            items,
            progress: makeProgress(items),
            nav_hints: {
              item_count: items.length,
              first_awaiting_review_item_id: null,
              wizard_furthest_step: 2,
              batch_step1_configured: true,
              awaiting_review_count: 0,
              redacted_count: 0,
            },
          });
        });
      }
      return json(route, {
        file_id: fileId,
        filename,
        file_type: fileType,
        file_size: fileInfo.file_size,
        created_at: fileInfo.created_at,
      });
    }

    const batchDownloadMatch = path === '/files/batch/download' && method === 'POST';
    if (batchDownloadMatch) {
      const body = await parseJsonBody(route);
      state.batchDownloadRequests.push(body);
      const fileIds = Array.isArray(body.file_ids) ? body.file_ids.map(String) : [];
      const redacted = body.redacted === true;
      return route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: {
          'X-Batch-Zip-Requested-Count': String(fileIds.length),
          'X-Batch-Zip-Included-Count': String(fileIds.length),
          'X-Batch-Zip-Skipped-Count': '0',
          'X-Batch-Zip-Redacted': redacted ? 'true' : 'false',
          'X-Batch-Zip-Skipped': '[]',
        },
        body: redacted ? 'mock-redacted-zip' : 'mock-original-zip',
      });
    }

    if (path === '/redaction/preview-map' && method === 'POST') {
      const body = await parseJsonBody(route);
      const entities = Array.isArray(body.entities) ? body.entities : [];
      return json(route, {
        entity_map: Object.fromEntries(
          entities
            .filter((entity): entity is Record<string, unknown> =>
              Boolean(entity && typeof entity === 'object'),
            )
            .map((entity, index) => [
              String(entity.text ?? `entity-${index}`),
              `ENTITY_${index + 1}`,
            ]),
        ),
      });
    }

    const previewImageMatch = path.match(/^\/redaction\/([^/]+)\/preview-image$/);
    if (previewImageMatch && method === 'POST') {
      return json(route, {
        image_base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      });
    }

    const fileDownloadMatch = path.match(/^\/files\/([^/]+)\/download$/);
    if (fileDownloadMatch && method === 'GET') {
      return text(
        route,
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        200,
        'image/png',
      );
    }

    if (path.startsWith('/jobs/') && method === 'GET') {
      const id = decodeURIComponent(path.slice('/jobs/'.length));
      const job = jobs.find((entry) => entry.id === id || entry.job_id === id);
      if (!job) return json(route, { message: 'not found' }, 404);
      return json(route, { ...job, items: Array.isArray(job.items) ? job.items : [] });
    }

    if (path === '/files' && method === 'GET') {
      const { page, pageSize } = paginationParams(url, 10);
      const source = url.searchParams.get('source');
      const jobId = url.searchParams.get('job_id');
      const filteredFiles = files.filter((file) => {
        if (source && String(file.upload_source ?? '') !== source) return false;
        if (jobId && String(file.job_id ?? '') !== jobId) return false;
        return true;
      });
      return json(route, {
        files: paginate(filteredFiles, page, pageSize),
        total: filteredFiles.length,
        page,
        page_size: pageSize,
      });
    }

    const fileInfoMatch = path.match(/^\/files\/([^/]+)$/);
    if (fileInfoMatch && method === 'GET') {
      const fileId = decodeURIComponent(fileInfoMatch[1]);
      const file = files.find((entry) => entry.file_id === fileId || entry.id === fileId);
      if (!file) return json(route, { message: 'not found' }, 404);
      return json(route, file);
    }

    if (path === '/safety/cleanup' && method === 'POST') {
      return json(route, { files_removed: 0, jobs_removed: 0 });
    }

    return json(route, {});
  });

  return state;
}
