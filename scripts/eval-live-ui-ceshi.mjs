#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authHeaders, requestJson, resolveAuthToken, resolveEvalEnv } from './eval-auth.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const frontendRequire = createRequire(path.join(FRONTEND_DIR, 'package.json'));
const { chromium } = frontendRequire('@playwright/test');
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000/api/v1';
const PRIVATE_CORPUS_ENV = 'EVAL_CESHI_DIR';
const GPU_BUSY_RATIO = readNumberEnv('EVAL_LIVE_UI_GPU_BUSY_RATIO', 0.75);
const GPU_LARGE_PROCESS_MIB = readNumberEnv('EVAL_LIVE_UI_GPU_LARGE_PROCESS_MIB', 4096);
const SINGLE_RESULT_TIMEOUT_MS = readNumberEnv('EVAL_LIVE_UI_SINGLE_RESULT_TIMEOUT_MS', 600_000);
const SINGLE_SLOW_WARNING_MS = readNumberEnv('EVAL_LIVE_UI_SINGLE_SLOW_WARNING_MS', 120_000);
const BATCH_REVIEW_TIMEOUT_MS = readNumberEnv('EVAL_LIVE_UI_BATCH_REVIEW_TIMEOUT_MS', 900_000);
const BATCH_STATUS_POLL_INTERVAL_MS = readNumberEnv('EVAL_LIVE_UI_BATCH_STATUS_POLL_INTERVAL_MS', 1000);
const FIRST_REVIEWABLE_UI_API_GAP_NOTICE_MS = readNumberEnv('EVAL_LIVE_UI_FIRST_REVIEWABLE_UI_API_GAP_NOTICE_MS', 1000);
const FIRST_REVIEWABLE_UI_API_GAP_WARNING_MS = readNumberEnv('EVAL_LIVE_UI_FIRST_REVIEWABLE_UI_API_GAP_WARNING_MS', 5000);
const REVIEW_BACKGROUND_WAIT_NOTICE_MS = readNumberEnv('EVAL_LIVE_UI_REVIEW_BACKGROUND_WAIT_NOTICE_MS', 1000);
const STEP3_WAIT_SAMPLE_HEAD_LIMIT = Math.max(1, Math.trunc(readNumberEnv('EVAL_LIVE_UI_STEP3_WAIT_SAMPLE_HEAD_LIMIT', 4)));
const STEP3_WAIT_SAMPLE_TAIL_LIMIT = Math.max(1, Math.trunc(readNumberEnv('EVAL_LIVE_UI_STEP3_WAIT_SAMPLE_TAIL_LIMIT', 4)));
const STEP3_WAIT_SAMPLE_ROW_LIMIT = Math.max(1, Math.trunc(readNumberEnv('EVAL_LIVE_UI_STEP3_WAIT_SAMPLE_ROW_LIMIT', 8)));
const STEP3_WAIT_SAMPLE_TEXT_LIMIT = Math.max(16, Math.trunc(readNumberEnv('EVAL_LIVE_UI_STEP3_WAIT_SAMPLE_TEXT_LIMIT', 64)));
const STEP3_JOBS_REQUEST_HEAD_LIMIT = Math.max(1, Math.trunc(readNumberEnv('EVAL_LIVE_UI_STEP3_JOBS_REQUEST_HEAD_LIMIT', 6)));
const STEP3_JOBS_REQUEST_TAIL_LIMIT = Math.max(1, Math.trunc(readNumberEnv('EVAL_LIVE_UI_STEP3_JOBS_REQUEST_TAIL_LIMIT', 6)));
const SINGLE_VISION_REQUEST_HEAD_LIMIT = Math.max(1, Math.trunc(readNumberEnv('EVAL_LIVE_UI_SINGLE_VISION_REQUEST_HEAD_LIMIT', 6)));
const SINGLE_VISION_REQUEST_TAIL_LIMIT = Math.max(1, Math.trunc(readNumberEnv('EVAL_LIVE_UI_SINGLE_VISION_REQUEST_TAIL_LIMIT', 6)));
const PDF_PAGE_DURATION_RANK_LIMIT = Math.max(1, Math.trunc(readNumberEnv('EVAL_LIVE_UI_PDF_PAGE_DURATION_RANK_LIMIT', 6)));
const MAX_OVERLAY_BOX_AREA_RATIO = readNumberEnv('EVAL_LIVE_UI_MAX_OVERLAY_BOX_AREA_RATIO', 0.28);
const MIN_SERVICE_STATUS_FONT_PX = readNumberEnv('EVAL_LIVE_UI_MIN_SERVICE_STATUS_FONT_PX', 11);
const MIN_REDACTION_DARK_RUN_PX = readNumberEnv('EVAL_LIVE_UI_MIN_REDACTION_DARK_RUN_PX', 40);
const MIN_PAGE_CHANGED_PIXEL_RATIO = readNumberEnv('EVAL_LIVE_UI_MIN_PAGE_CHANGED_PIXEL_RATIO', 0.0001);
const MAX_RED_TO_WHITE_RATIO = readNumberEnv('EVAL_LIVE_UI_MAX_RED_TO_WHITE_RATIO', 0.8);
const MAX_BOX_AREA_RATIO = readNumberEnv('EVAL_LIVE_UI_MAX_BOX_AREA_RATIO', 0.28);
const MAX_BOX_WIDTH_RATIO = readNumberEnv('EVAL_LIVE_UI_MAX_BOX_WIDTH_RATIO', 0.94);
const MAX_BOX_HEIGHT_RATIO = readNumberEnv('EVAL_LIVE_UI_MAX_BOX_HEIGHT_RATIO', 0.6);
const BATCH_SESSION_JOB_KEYS = [
  'lr_batch_job_id_smart',
  'lr_batch_job_id_image',
  'lr_batch_job_id_text',
];
const ENTITY_ALIAS_LEAKS = new Set(['COMPANY', 'WORK_UNIT', 'TIME', 'DATETIME', 'DATE_TIME', 'DATE_AND_TIME', 'TIMESTAMP']);
const HAS_IMAGE_FIXED_SLUGS = new Set([
  'face',
  'fingerprint',
  'palmprint',
  'id_card',
  'hk_macau_permit',
  'passport',
  'employee_badge',
  'license_plate',
  'bank_card',
  'physical_key',
  'receipt',
  'shipping_label',
  'official_seal',
  'whiteboard',
  'sticky_note',
  'mobile_screen',
  'monitor_screen',
  'medical_wristband',
  'qr_code',
  'barcode',
  'paper',
]);

function normalizeHasImageSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function normalizeEvidenceSource(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[-\s]+/g, '_') || 'unknown';
}

function normalizeObservedType(value) {
  return String(value || 'unknown').trim() || 'unknown';
}

const DEFAULT_OUT_DIR = path.join(
  ROOT_DIR,
  'output',
  'playwright',
  `live-ui-private-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

function readNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseArgs(argv) {
  let baseUrl = process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL;
  let apiBaseUrl = process.env.DATAINFRA_API || DEFAULT_API_BASE_URL;
  let ceshiDir = process.env[PRIVATE_CORPUS_ENV] || '';
  let outDir = process.env.EVAL_LIVE_UI_OUT_DIR || DEFAULT_OUT_DIR;
  let dryRun = false;
  let allowGpuBusy = false;
  let headed = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.EVAL_LIVE_UI_HEADED || '').toLowerCase(),
  );
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') baseUrl = argv[++index] || baseUrl;
    else if (arg.startsWith('--base-url=')) baseUrl = arg.slice('--base-url='.length);
    else if (arg === '--api-base-url') apiBaseUrl = argv[++index] || apiBaseUrl;
    else if (arg.startsWith('--api-base-url=')) apiBaseUrl = arg.slice('--api-base-url='.length);
    else if (arg === '--ceshi-dir' || arg === '--private-corpus-dir') ceshiDir = argv[++index] || ceshiDir;
    else if (arg.startsWith('--ceshi-dir=')) ceshiDir = arg.slice('--ceshi-dir='.length);
    else if (arg.startsWith('--private-corpus-dir=')) ceshiDir = arg.slice('--private-corpus-dir='.length);
    else if (arg === '--out-dir') outDir = argv[++index] || outDir;
    else if (arg.startsWith('--out-dir=')) outDir = arg.slice('--out-dir='.length);
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--headed') headed = true;
    else if (arg === '--allow-gpu-busy') allowGpuBusy = true;
    else if (arg === '-h' || arg === '--help') {
      console.log(`Usage:
  node scripts/eval-live-ui-ceshi.mjs [--out-dir output/playwright/run] [--headed] [--allow-gpu-busy]
  node scripts/eval-live-ui-ceshi.mjs --dry-run --private-corpus-dir fixtures/local-real

Runs a real browser against localhost with files from a private corpus directory:
  1. Single-file upload and recognition
  2. Batch upload, recognition, review, and export page entry

Real runs refuse to start when GPU memory is busy or reserved/large GPU processes are detected.
Use --dry-run to inspect the plan without browser work, or --allow-gpu-busy to override intentionally.`);
      process.exit(0);
    }
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
    ceshiDir,
    outDir,
    dryRun,
    headed,
    allowGpuBusy,
  };
}

async function resolveCeshiFiles(ceshiDir) {
  if (!ceshiDir) throw new Error(`Set ${PRIVATE_CORPUS_ENV} or pass --private-corpus-dir before running the private UI gate.`);
  if (!existsSync(ceshiDir)) throw new Error(`Private corpus directory not found. Set ${PRIVATE_CORPUS_ENV} to a local directory.`);
  const entries = await readdir(ceshiDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(ceshiDir, entry.name));
  const byExt = (ext) => files.filter((file) => path.extname(file).toLowerCase() === ext);
  const image = byExt('.png')[0] || byExt('.jpg')[0] || byExt('.jpeg')[0];
  const pdf = byExt('.pdf')[0];
  const docx = byExt('.docx');
  const selected = [...docx.slice(0, 2), pdf, image].filter(Boolean);
  if (!image || !pdf || docx.length < 2 || selected.length !== 4) {
    throw new Error(`Expected at least 2 docx, 1 pdf, and 1 image under ${ceshiDir}`);
  }
  return { singleImage: image, batchFiles: selected };
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function privateFileRef(file, index) {
  return {
    label: `input-${String(index + 1).padStart(2, '0')}${path.extname(file).toLowerCase()}`,
    path_sha256: shortHash(path.resolve(file)),
    basename_sha256: shortHash(path.basename(file)),
  };
}

async function ensureReachable(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok && response.status >= 500) {
    throw new Error(`Frontend not reachable: ${url} HTTP ${response.status}`);
  }
}

function runQuietCommand(command, commandArgs = [], options = {}) {
  try {
    const result = spawnSync(command, commandArgs, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeoutMs || 2500,
      shell: false,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseGpuMemoryRows(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, used, total] = line.split(',').map((part) => part.trim());
      return { name: name || 'GPU', used: Number(used), total: Number(total) };
    })
    .filter((row) => Number.isFinite(row.used) && Number.isFinite(row.total) && row.total > 0)
    .map((row) => ({ ...row, ratio: row.used / row.total }));
}

function parseGpuProcessRows(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, name, used] = line.split(',').map((part) => part.trim());
      return { pid: Number(pid), name: name || '', used: Number(used) };
    })
    .filter((row) => Number.isFinite(row.pid));
}

function probeGpuMemoryAndProcesses() {
  if (process.env.EVAL_LIVE_UI_GPU_PREFLIGHT_MOCK === 'busy') {
    return {
      available: true,
      source: 'mock',
      rows: [{ name: 'Mock GPU', used: 14_500, total: 16_000, ratio: 14_500 / 16_000 }],
      processes: [{ pid: 4242, name: 'reserved-gpu-worker', used: 12_288 }],
    };
  }
  if (process.env.EVAL_LIVE_UI_GPU_PREFLIGHT_MOCK === 'idle') {
    return {
      available: true,
      source: 'mock',
      rows: [{ name: 'Mock GPU', used: 512, total: 16_000, ratio: 512 / 16_000 }],
      processes: [],
    };
  }
  if (process.env.EVAL_LIVE_UI_GPU_PREFLIGHT_MOCK === 'unavailable') {
    return { available: false, source: 'mock unavailable', rows: [], processes: [] };
  }

  const memoryProbe = runQuietCommand('nvidia-smi', [
    '--query-gpu=name,memory.used,memory.total',
    '--format=csv,noheader,nounits',
  ]);
  if (!memoryProbe.ok || !memoryProbe.stdout.trim()) {
    return { available: false, source: 'nvidia-smi unavailable', rows: [], processes: [] };
  }
  const processProbe = runQuietCommand('nvidia-smi', [
    '--query-compute-apps=pid,process_name,used_memory',
    '--format=csv,noheader,nounits',
  ]);
  return {
    available: true,
    source: 'nvidia-smi',
    rows: parseGpuMemoryRows(memoryProbe.stdout),
    processes: processProbe.ok ? parseGpuProcessRows(processProbe.stdout) : [],
  };
}

function parseWindowsProcessRows(output) {
  try {
    const parsed = JSON.parse(output);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter(Boolean)
      .map((row) => ({
        pid: Number(row.ProcessId),
        name: String(row.Name || ''),
        commandLine: String(row.CommandLine || ''),
      }))
      .filter((row) => Number.isFinite(row.pid));
  } catch {
    return [];
  }
}

function reservedProcessPattern() {
  return process.env.EVAL_LIVE_UI_RESERVED_PROCESS_PATTERN || '';
}

function probeReservedGpuProcesses() {
  if (process.env.EVAL_LIVE_UI_GPU_PREFLIGHT_MOCK === 'busy') {
    return [{ pid: 4242, name: 'reserved-gpu-worker', commandLine: 'reserved-gpu-worker run' }];
  }
  if (process.env.EVAL_LIVE_UI_GPU_PREFLIGHT_MOCK === 'idle') return [];
  const pattern = reservedProcessPattern();
  if (!pattern) return [];

  if (process.platform === 'win32') {
    const powerShellPattern = pattern.replaceAll("'", "''");
    const command = [
      `$pattern = '${powerShellPattern}'`,
      "$rows = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
      '  ($_.Name -match $pattern) -or ($_.CommandLine -match $pattern)',
      '} | Select-Object ProcessId,Name,CommandLine',
      'if ($rows) { $rows | ConvertTo-Json -Compress }',
    ].join(' ');
    const result = runQuietCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ]);
    return result.ok && result.stdout.trim() ? parseWindowsProcessRows(result.stdout) : [];
  }

  const result = runQuietCommand('ps', ['-eo', 'pid=,comm=,args=']);
  if (!result.ok) return [];
  const matcher = new RegExp(pattern, 'i');
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => matcher.test(line))
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+)\s*(.*)$/);
      return {
        pid: match ? Number(match[1]) : null,
        name: match?.[2] || '',
        commandLine: match?.[3] || line,
      };
    })
    .filter((row) => Number.isFinite(row.pid));
}

function buildGpuPreflightFindings() {
  const gpu = probeGpuMemoryAndProcesses();
  const reservedGpuProcesses = probeReservedGpuProcesses();
  const findings = [];

  for (const [index, row] of gpu.rows.entries()) {
    if (row.ratio >= GPU_BUSY_RATIO) {
      findings.push(
        `gpu ${index} memory ${row.used}/${row.total} MiB (${(row.ratio * 100).toFixed(1)}%) >= ${(GPU_BUSY_RATIO * 100).toFixed(0)}% threshold`,
      );
    }
  }
  for (const processRow of gpu.processes) {
    const name = processRow.name || 'unknown';
    if (Number.isFinite(processRow.used) && processRow.used >= GPU_LARGE_PROCESS_MIB) {
      findings.push(`large GPU process detected: pid=${processRow.pid} name=${name} memory=${processRow.used} MiB`);
    }
  }
  for (const processRow of reservedGpuProcesses) {
    findings.push(`reserved GPU process detected: pid=${processRow.pid} name=${processRow.name || 'unknown'}`);
  }

  return { gpu, reservedGpuProcesses, findings: [...new Set(findings)] };
}

function formatGpuPreflightReport(report) {
  const lines = [
    'Live UI real run refused: GPU/service preflight detected a busy or reserved GPU.',
    `source: ${report.gpu.source}`,
  ];
  if (!report.gpu.available) {
    lines.push('gpu: unavailable; no GPU memory rows were returned');
  } else {
    for (const [index, row] of report.gpu.rows.entries()) {
      lines.push(`gpu ${index}: ${row.name} memory ${row.used}/${row.total} MiB (${(row.ratio * 100).toFixed(1)}%)`);
    }
  }
  if (report.gpu.processes.length) {
    lines.push('gpu processes:');
    for (const processRow of report.gpu.processes) {
      lines.push(`- pid=${processRow.pid} name=${processRow.name || 'unknown'} memory=${processRow.used || 'unknown'} MiB`);
    }
  }
  if (report.reservedGpuProcesses.length) {
    lines.push('reserved GPU processes:');
    for (const processRow of report.reservedGpuProcesses) {
      lines.push(`- pid=${processRow.pid} name=${processRow.name || 'unknown'}`);
    }
  }
  lines.push('findings:');
  for (const finding of report.findings) lines.push(`- ${finding}`);
  lines.push('Use --dry-run to inspect the plan without real browser work, or wait for GPU idle.');
  lines.push('Use --allow-gpu-busy only when you intentionally accept slow/contended real recognition.');
  return lines.join('\n');
}

function assertLiveUiGpuPreflight({ allowGpuBusy }) {
  const report = buildGpuPreflightFindings();
  if (report.findings.length === 0) {
    if (report.gpu.available) {
      console.log(`GPU/service preflight passed: ${report.gpu.source}`);
    } else {
      console.log(`GPU/service preflight passed with unknown GPU status: ${report.gpu.source}`);
    }
    return report;
  }
  if (allowGpuBusy) {
    console.warn(`GPU/service preflight warning ignored by --allow-gpu-busy:\n${formatGpuPreflightReport(report)}`);
    return report;
  }
  throw new Error(formatGpuPreflightReport(report));
}

function durationMs(start) {
  return Math.round(performance.now() - start);
}

function sanitizeFailedRequestUrl(value) {
  const url = String(value || '');
  if (url.startsWith('blob:')) return 'blob:';
  try {
    const parsed = new URL(url);
    const sanitized = `${parsed.origin}${parsed.pathname}`;
    return parsed.searchParams.get('force') === 'true' ? `${sanitized}?force=true` : sanitized;
  } catch {
    return url.split('?')[0];
  }
}

function isForceApiAbort(request, apiPrefix) {
  const url = String(request?.url || '');
  const failure = String(request?.failure || '');
  if (!failure.includes('ERR_ABORTED')) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith(apiPrefix) && parsed.searchParams.get('force') === 'true';
  } catch {
    return url.includes(apiPrefix) && url.includes('force=true');
  }
}

export function isIgnorableFailedRequest(request) {
  const url = String(request?.url || '');
  if (url.startsWith('blob:')) return true;
  if (url.includes('/health/services')) return true;
  return isForceApiAbort(request, '/api/v1/redaction/') || isForceApiAbort(request, '/api/v1/vision/');
}

export function isIgnorableConsoleMessage(message) {
  const text = String(message?.text || '');
  return text.includes('Failed to load resource: net::ERR_FILE_NOT_FOUND');
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    const key = String(value || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function failedRequestDetail(request) {
  return {
    method: String(request?.method || 'GET'),
    url: sanitizeFailedRequestUrl(request?.url),
    failure: String(request?.failure || ''),
    resource_type: request?.resource_type ? String(request.resource_type) : null,
    is_navigation_request:
      typeof request?.is_navigation_request === 'boolean' ? request.is_navigation_request : null,
    frame_url: request?.frame_url ? sanitizeFailedRequestUrl(request.frame_url) : null,
    post_data_bytes: Number.isFinite(Number(request?.post_data_bytes)) ? Number(request.post_data_bytes) : null,
    post_data_hash: request?.post_data_hash ? String(request.post_data_hash) : null,
    elapsed_ms: safeDurationMs(request?.elapsed_ms),
  };
}

export function buildFailedRequestDiagnostics(failedRequests) {
  const requests = Array.isArray(failedRequests) ? failedRequests : [];
  const ignored = requests.filter(isIgnorableFailedRequest);
  const actionable = requests.filter((request) => !isIgnorableFailedRequest(request)).map(failedRequestDetail);
  return {
    total: requests.length,
    ignored: ignored.length,
    actionable: actionable.length,
    actionable_requests: actionable,
    actionable_by_failure: countBy(actionable.map((request) => request.failure)),
    actionable_by_method: countBy(actionable.map((request) => request.method)),
    actionable_by_url: countBy(actionable.map((request) => request.url)),
    ignored_policy: 'blob URLs, service health polling, and force=true aborts are diagnostics, not release-blocking failures.',
  };
}

export function finalizeSummary(summary) {
  summary.ignored_failed_requests = summary.failed_requests.filter(isIgnorableFailedRequest);
  summary.ignored_console = summary.console.filter(isIgnorableConsoleMessage);
  summary.failed_request_diagnostics = buildFailedRequestDiagnostics(summary.failed_requests);
  summary.actionable_failed_requests = summary.failed_request_diagnostics.actionable_requests;
  if (summary.batch) summary.batch.phase_diagnostics = buildBatchPhaseDiagnostics(summary.batch);
  summary.performance_context = buildPerformanceContext(summary);
  summary.evidence_summary = buildEvidenceSummary(summary);
  if (summary.passed !== false) {
    summary.passed =
      summary.findings.length === 0 &&
      summary.page_errors.length === 0 &&
      summary.failed_requests.filter((request) => !isIgnorableFailedRequest(request)).length === 0 &&
      summary.console.filter((message) => !isIgnorableConsoleMessage(message)).length === 0;
  }
  return summary;
}

export function buildAuthCookie(baseUrl, token) {
  if (!token) return null;
  return {
    name: 'access_token',
    value: token,
    url: baseUrl,
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(baseUrl).protocol === 'https:',
  };
}

export function parseSingleDetectionTotal(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  const patterns = [
    /开始匿名化\s*\((\d+)\)/,
    /Start redaction\s*\((\d+)\)/i,
    /已选\s*\d+\s*\/\s*(\d+)/,
    /Selected\s+\d+\s*\/\s*(\d+)/i,
    /区域列表\s*(\d+)/,
    /Region list\s*(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }
  return 0;
}

async function countSingleDetectionItems(page) {
  const boxCount = await page.locator('[data-testid^="playground-box-"]').count();
  const entityCount = await page
    .locator('[data-testid^="playground-entity-"]:not([data-testid="playground-entity-panel"])')
    .count();
  const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  const visibleTotal = parseSingleDetectionTotal(bodyText);
  return { boxCount, entityCount, visibleTotal };
}

async function waitForSingleDetectionItems(page) {
  const deadline = Date.now() + 3000;
  let latest = await countSingleDetectionItems(page);
  while (Date.now() < deadline) {
    if (latest.boxCount + latest.entityCount > 0 || latest.visibleTotal > 0) {
      return latest;
    }
    await page.waitForTimeout(100);
    latest = await countSingleDetectionItems(page);
  }
  return latest;
}

function authSummaryForResult(result, resolvedEnv) {
  const authEnabled = result.authStatus?.auth_enabled !== false;
  let tokenSource = 'none';
  if (result.token) {
    if (resolvedEnv.DATAINFRA_TOKEN) tokenSource = 'env-token';
    else if (resolvedEnv.DATAINFRA_TOKEN_FILE) tokenSource = 'token-file';
    else if (result.tokenSource) tokenSource = result.tokenSource;
    else tokenSource = 'password-login';
  }
  return {
    auth_enabled: authEnabled,
    token_source: tokenSource,
    auth_disabled_by_env: Boolean(result.authDisabledByEnv),
  };
}

async function authenticateBrowserContext(context, baseUrl, apiBaseUrl, summary) {
  const resolvedEnv = resolveEvalEnv();
  const authResult = await resolveAuthToken(apiBaseUrl, resolvedEnv);
  summary.auth = authSummaryForResult(authResult, resolvedEnv);
  const cookie = buildAuthCookie(baseUrl, authResult.token);
  if (cookie) await context.addCookies([cookie]);
  return authResult.token || null;
}

function fileRefExt(ref) {
  return path.extname(String(ref?.label || '')).toLowerCase();
}

function isImageFileRef(ref) {
  return ['.png', '.jpg', '.jpeg'].includes(fileRefExt(ref));
}

function isPdfFileRef(ref) {
  return fileRefExt(ref) === '.pdf';
}

function safeEntityCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function safeDurationMs(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null;
}

function safeCountOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : null;
}

function diagnosticText(value, maxLength = STEP3_WAIT_SAMPLE_TEXT_LIMIT) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `[text:${text.length} chars hash:${shortHash(text)}]`;
}

function optionalDiagnosticText(value, maxLength = STEP3_WAIT_SAMPLE_TEXT_LIMIT) {
  const text = diagnosticText(value, maxLength);
  return text || null;
}

function sanitizeStep3WaitRow(row, index) {
  return {
    index: safeEntityCount(row?.index ?? index),
    status_text: optionalDiagnosticText(row?.status_text),
    progress_text: optionalDiagnosticText(row?.progress_text),
    progress_value: optionalDiagnosticText(row?.progress_value, 24),
  };
}

export function sanitizeStep3WaitDomSample(sample) {
  const button = sample?.step3_next && typeof sample.step3_next === 'object' ? sample.step3_next : {};
  const rows = Array.isArray(sample?.recognition_rows?.rows) ? sample.recognition_rows.rows : [];
  return {
    elapsed_ms: safeDurationMs(sample?.elapsed_ms),
    document_hidden: sample?.document_hidden === true,
    step3_next: {
      present: button.present === true,
      data_reviewable: button.data_reviewable === true ? true : button.data_reviewable === false ? false : null,
      disabled: button.disabled === true ? true : button.disabled === false ? false : null,
      aria_disabled: button.aria_disabled === true ? true : button.aria_disabled === false ? false : null,
      data_reviewable_count: safeDurationMs(button.data_reviewable_count),
      text: optionalDiagnosticText(button.text, 80),
    },
    recognition_rows: {
      row_count: safeEntityCount(sample?.recognition_rows?.row_count),
      sampled_count: Math.min(rows.length, STEP3_WAIT_SAMPLE_ROW_LIMIT),
      rows: rows.slice(0, STEP3_WAIT_SAMPLE_ROW_LIMIT).map(sanitizeStep3WaitRow),
    },
  };
}

function step3WaitDomSignature(sample) {
  return JSON.stringify({
    document_hidden: sample?.document_hidden,
    step3_next: sample?.step3_next,
    rows: sample?.recognition_rows?.rows,
    row_count: sample?.recognition_rows?.row_count,
  });
}

export function compactStep3WaitDomEvidence(samples, options = {}) {
  const rawSamples = Array.isArray(samples) ? samples : [];
  const sanitizedSamples = rawSamples.map(sanitizeStep3WaitDomSample);
  const changeSamples = [];
  let lastSignature = null;
  for (const sample of sanitizedSamples) {
    const signature = step3WaitDomSignature(sample);
    if (signature !== lastSignature) {
      changeSamples.push(sample);
      lastSignature = signature;
    }
  }
  const headLimit = Math.max(1, Math.trunc(options.headLimit ?? STEP3_WAIT_SAMPLE_HEAD_LIMIT));
  const tailLimit = Math.max(1, Math.trunc(options.tailLimit ?? STEP3_WAIT_SAMPLE_TAIL_LIMIT));
  const keepLimit = headLimit + tailLimit;
  const retainedSamples =
    changeSamples.length <= keepLimit
      ? changeSamples
      : [...changeSamples.slice(0, headLimit), ...changeSamples.slice(-tailLimit)];
  const hiddenSamples = changeSamples.filter((sample) => sample.document_hidden === true).length;
  const finalSample = sanitizedSamples.at(-1) || null;
  return {
    strategy: 'consecutive-change-dedupe-head-tail',
    sample_count: sanitizedSamples.length,
    change_sample_count: changeSamples.length,
    retained_count: retainedSamples.length,
    omitted_middle_count: Math.max(0, changeSamples.length - retainedSamples.length),
    row_limit: STEP3_WAIT_SAMPLE_ROW_LIMIT,
    text_policy:
      'Only button text plus bounded recognition-row status/progress control text is retained; long text is replaced by length/hash.',
    first_elapsed_ms: sanitizedSamples[0]?.elapsed_ms ?? null,
    last_elapsed_ms: finalSample?.elapsed_ms ?? null,
    final_data_reviewable: finalSample?.step3_next?.data_reviewable ?? null,
    final_disabled: finalSample?.step3_next?.disabled ?? null,
    document_hidden_observed: hiddenSamples > 0,
    samples: retainedSamples,
  };
}

function sanitizeStatusCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return {};
  return Object.keys(counts)
    .sort()
    .reduce((output, key) => {
      const count = safeCountOrNull(counts[key]);
      if (count !== null) output[String(key || 'unknown')] = count;
      return output;
    }, {});
}

function summarizeJobsResponseItems(job) {
  const items = sortedJobItems(job);
  const itemStatusCounts = {};
  let reviewableCount = 0;
  for (const item of items) {
    const status = normalizedJobItemStatus(item);
    itemStatusCounts[status] = (itemStatusCounts[status] || 0) + 1;
    if (isReviewableJobItem(item)) reviewableCount += 1;
  }
  return {
    item_status_counts: sanitizeStatusCounts(itemStatusCounts),
    reviewable_count: reviewableCount,
  };
}

function statusCountsToken(counts) {
  const entries = Object.entries(sanitizeStatusCounts(counts));
  return entries.length > 0 ? entries.map(([status, count]) => `${status}:${count}`).join(',') : 'none';
}

function safeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function step3JobsRequestPath(value) {
  try {
    const parsed = new URL(String(value || ''));
    return /\/jobs\/[^/?#]+$/.test(parsed.pathname) ? parsed.pathname : null;
  } catch {
    return null;
  }
}

export function sanitizeStep3JobsRequestSample(sample) {
  const method = String(sample?.method || '').trim().toUpperCase();
  return {
    path: String(sample?.path || '').trim() || null,
    method: method || null,
    elapsed_ms: safeDurationMs(sample?.elapsed_ms),
    status: safeHttpStatus(sample?.status),
    duration_ms: safeDurationMs(sample?.duration_ms),
    item_status_counts: sanitizeStatusCounts(sample?.item_status_counts ?? sample?.status_counts),
    reviewable_count: safeCountOrNull(sample?.reviewable_count),
  };
}

export function compactStep3JobsRequestEvidence(samples, options = {}) {
  const sanitizedSamples = (Array.isArray(samples) ? samples : []).map(sanitizeStep3JobsRequestSample);
  const headLimit = Math.max(1, Math.trunc(options.headLimit ?? STEP3_JOBS_REQUEST_HEAD_LIMIT));
  const tailLimit = Math.max(1, Math.trunc(options.tailLimit ?? STEP3_JOBS_REQUEST_TAIL_LIMIT));
  const keepLimit = headLimit + tailLimit;
  const retainedSamples =
    sanitizedSamples.length <= keepLimit
      ? sanitizedSamples
      : [...sanitizedSamples.slice(0, headLimit), ...sanitizedSamples.slice(-tailLimit)];
  const firstSample = sanitizedSamples[0] || null;
  const finalSample = sanitizedSamples.at(-1) || null;
  const firstSuccess = sanitizedSamples.find((sample) => sample.status !== null && sample.status < 400) || null;
  const firstReviewable = sanitizedSamples.find((sample) => (sample.reviewable_count ?? 0) > 0) || null;
  return {
    strategy: 'head-tail-request-response-summary',
    sample_count: sanitizedSamples.length,
    retained_count: retainedSamples.length,
    omitted_middle_count: Math.max(0, sanitizedSamples.length - retainedSamples.length),
    body_policy:
      'No response body text is retained; only URL path, method, request elapsed time, status, duration, item status counts, and reviewable count are kept.',
    first_request_elapsed_ms: firstSample?.elapsed_ms ?? null,
    first_success_elapsed_ms: firstSuccess?.elapsed_ms ?? null,
    first_reviewable_elapsed_ms: firstReviewable?.elapsed_ms ?? null,
    first_reviewable_response_elapsed_ms:
      firstReviewable && firstReviewable.elapsed_ms !== null && firstReviewable.duration_ms !== null
        ? firstReviewable.elapsed_ms + firstReviewable.duration_ms
        : null,
    final_reviewable_count: finalSample?.reviewable_count ?? null,
    final_item_status_counts: finalSample?.item_status_counts ?? {},
    samples: retainedSamples,
  };
}

async function collectStep3WaitDomSample(page, elapsedMs) {
  const rawSample = await page.evaluate(({ sampleElapsedMs, rowLimit }) => {
    const compactText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const textOf = (node) => compactText(node?.textContent);
    const first = (root, selectors) => {
      for (const selector of selectors) {
        const element = root.querySelector(selector);
        if (element) return element;
      }
      return null;
    };
    const button = document.querySelector('[data-testid="step3-next"]');
    const rows = Array.from(
      document.querySelectorAll(
        [
          '[data-testid="recognition-row"]',
          '[data-testid*="recognition-row"]',
          '[data-testid*="file-recognition"]',
          '[class*="recognition-row"]',
        ].join(', '),
      ),
    );
    return {
      elapsed_ms: sampleElapsedMs,
      document_hidden: document.hidden === true,
      step3_next: {
        present: Boolean(button),
        data_reviewable: button ? button.getAttribute('data-reviewable') === 'true' : null,
        disabled:
          button instanceof HTMLButtonElement
            ? button.disabled
            : button
              ? button.getAttribute('aria-disabled') === 'true'
              : null,
        aria_disabled: button ? button.getAttribute('aria-disabled') === 'true' : null,
        data_reviewable_count: button ? button.getAttribute('data-reviewable-count') : null,
        text: textOf(button),
      },
      recognition_rows: {
        row_count: rows.length,
        rows: rows.slice(0, rowLimit).map((row, index) => {
          const status = first(row, [
            '[data-testid*="status"]',
            '[data-testid*="badge"]',
            '[class*="status"]',
            '[class*="badge"]',
            '[role="status"]',
          ]);
          const progress = first(row, [
            '[data-testid*="progress"]',
            '[class*="progress"]',
            'progress',
            '[aria-valuenow]',
          ]);
          return {
            index,
            status_text: textOf(status),
            progress_text: textOf(progress),
            progress_value: progress?.getAttribute('aria-valuenow') || progress?.getAttribute('value') || null,
          };
        }),
      },
    };
  }, { sampleElapsedMs: safeDurationMs(elapsedMs), rowLimit: STEP3_WAIT_SAMPLE_ROW_LIMIT });
  return sanitizeStep3WaitDomSample(rawSample);
}

function safePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function safeRatio(value) {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 ? Math.round(ratio * 100) / 100 : null;
}

function safeFraction(value) {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 ? Math.round(ratio * 1_000_000) / 1_000_000 : null;
}

function safeTimestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeIsoTimestamp(value) {
  const ms = safeTimestampMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function getNestedValue(object, pathParts) {
  let current = object;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function addTimestampCandidate(candidates, item, path, role) {
  const value = getNestedValue(item, path.split('.'));
  const ms = safeTimestampMs(value);
  if (ms !== null) candidates.push({ ms, role, source: path });
}

function collectJobItemTiming(item) {
  const candidates = [];
  for (const [path, role] of [
    ['recognition_started_at', 'start'],
    ['recognition_finished_at', 'finish'],
    ['recognition_completed_at', 'finish'],
    ['recognition.started_at', 'start'],
    ['recognition.finished_at', 'finish'],
    ['recognition.completed_at', 'finish'],
    ['performance.started_at', 'start'],
    ['performance.finished_at', 'finish'],
    ['performance.completed_at', 'finish'],
    ['performance_timestamps.started_at', 'start'],
    ['performance_timestamps.finished_at', 'finish'],
    ['performance_timestamps.completed_at', 'finish'],
    ['performance_timestamps.recognition_started_at', 'start'],
    ['performance_timestamps.recognition_finished_at', 'finish'],
    ['timing.started_at', 'start'],
    ['timing.finished_at', 'finish'],
    ['timing.completed_at', 'finish'],
    ['timings.started_at', 'start'],
    ['timings.finished_at', 'finish'],
    ['timings.completed_at', 'finish'],
    ['started_at', 'start'],
    ['finished_at', 'finish'],
    ['completed_at', 'finish'],
    ['created_at', 'created'],
    ['updated_at', 'updated'],
  ]) {
    addTimestampCandidate(candidates, item, path, role);
  }
  const maxByRole = (role) => {
    const values = candidates.filter((candidate) => candidate.role === role).map((candidate) => candidate.ms);
    return values.length > 0 ? Math.max(...values) : null;
  };
  const minByRole = (role) => {
    const values = candidates.filter((candidate) => candidate.role === role).map((candidate) => candidate.ms);
    return values.length > 0 ? Math.min(...values) : null;
  };
  const relevant = candidates.filter((candidate) => candidate.role !== 'created');
  const latestRelevantMs = relevant.length > 0 ? Math.max(...relevant.map((candidate) => candidate.ms)) : null;
  const earliestStartMs = minByRole('start');
  const latestFinishMs = maxByRole('finish');
  return {
    candidates,
    started_at_ms: earliestStartMs,
    finished_at_ms: latestFinishMs,
    latest_relevant_ms: latestRelevantMs,
    recognition_duration_ms: safeDurationMs(item?.recognition_duration_ms),
  };
}

function resolveJobConfigLockedAtMs(job) {
  return (
    safeTimestampMs(job?.config?.config_locked_at) ??
    safeTimestampMs(job?.config_locked_at) ??
    safeTimestampMs(job?.config?.locked_at) ??
    null
  );
}

function classifyJobItemFreshness(item, cutoffMs) {
  const timing = collectJobItemTiming(item);
  if (cutoffMs === null) return { current: true, reason: 'no-config-lock-cutoff', timing };
  const status = normalizedJobItemStatus(item);
  const terminalOrReviewable = isReviewableJobItem(item) || isRecognitionCompleteJobItem(item);
  const decisiveMs = terminalOrReviewable
    ? timing.finished_at_ms ?? timing.started_at_ms ?? timing.latest_relevant_ms
    : timing.started_at_ms ?? timing.latest_relevant_ms;
  if (decisiveMs === null) {
    return { current: true, reason: 'no-item-timestamp-compatible', timing };
  }
  if (decisiveMs < cutoffMs) {
    return { current: false, reason: `${status}-before-config-lock`, timing };
  }
  return { current: true, reason: 'item-timestamp-after-config-lock', timing };
}

function durationFromAbsoluteTimestamp(timestampMs, runStartedAtMs, fallbackMs) {
  if (timestampMs !== null && runStartedAtMs !== null) {
    return safeDurationMs(Math.max(0, timestampMs - runStartedAtMs));
  }
  return safeDurationMs(fallbackMs);
}

export function resolveAllRecognitionCompleteTiming(status, runStartedAtMs, elapsedMs) {
  if (!status?.all_recognition_complete) return { ms: null, method: null };
  const timestampMs = safeTimestampMs(status.all_recognition_complete_at);
  const fromTimestamp = durationFromAbsoluteTimestamp(timestampMs, runStartedAtMs, null);
  const durationFloor = safeDurationMs(status.all_recognition_complete_min_duration_ms);
  const observed = fromTimestamp ?? safeDurationMs(elapsedMs);
  if (observed === null && durationFloor === null) return { ms: null, method: null };
  const resolved = Math.max(observed ?? 0, durationFloor ?? 0);
  const method =
    durationFloor !== null && durationFloor >= resolved && (fromTimestamp === null || durationFloor > fromTimestamp)
      ? 'recognition-duration-floor'
      : fromTimestamp !== null
        ? 'item-timestamp'
        : 'poll-observed-status';
  return { ms: resolved, method };
}

function sanitizeDurationBreakdown(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const isPipelineStageKey = /^(ocr_has|has_image)\.[a-z0-9_]+$/i.test(key);
    if (
      isPipelineStageKey ||
      [
        'total',
        'request_total_ms',
        'pdf_render_ms',
        'pdf_render_cache_hit',
        'cache_hit',
        'pdf_text_layer_ms',
        'pdf_text_layer_used',
        'pdf_text_layer_skipped_sparse_file',
        'pdf_text_layer',
        'block_count',
        'char_count',
        'page_width',
        'page_height',
        'ocr_cache_hits',
        'ocr_cache_misses',
        'ocr_structure_cache_hit',
        'ocr_structure_cache_status',
        'ocr_vl_cache_hit',
        'ocr_vl_cache_status',
      ].includes(key)
    ) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        output[key] = sanitizeDurationBreakdown(item);
      } else if (
        item === null ||
        ['string', 'number', 'boolean'].includes(typeof item)
      ) {
        output[key] = item;
      }
    }
  }
  return output;
}

function sanitizeCacheStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/cache|hit|miss|disabled/i.test(key)) {
      output[key] = item && typeof item === 'object' && !Array.isArray(item) ? sanitizeCacheStatus(item) : item;
    }
  }
  return output;
}

function sanitizeRecognitionPages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((page) => page && typeof page === 'object')
    .map((page, index) => ({
      page: Number.isFinite(Number(page.page)) ? Number(page.page) : index + 1,
      duration_ms: safeDurationMs(page.duration_ms),
      duration_breakdown_ms: sanitizeDurationBreakdown(page.duration_breakdown_ms),
      cache_status: sanitizeCacheStatus(page.cache_status),
    }));
}

function collectCacheSignals(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  const signals = [];
  for (const [key, item] of Object.entries(value)) {
    const signalPath = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'boolean' && /cache.*hit|hit.*cache/i.test(key)) {
      signals.push({ path: signalPath, value: item ? 'hit' : 'miss' });
      continue;
    }
    if (typeof item === 'string' && /cache|hit|miss|disabled/i.test(key)) {
      const normalized = item.toLowerCase();
      if (normalized.includes('hit')) signals.push({ path: signalPath, value: 'hit' });
      else if (normalized.includes('miss')) signals.push({ path: signalPath, value: 'miss' });
      else if (normalized.includes('disabled')) signals.push({ path: signalPath, value: 'disabled' });
      continue;
    }
    if (Array.isArray(item)) {
      for (const [index, entry] of item.entries()) {
        signals.push(...collectCacheSignals(entry, `${signalPath}[${index}]`));
      }
      continue;
    }
    if (item && typeof item === 'object') {
      signals.push(...collectCacheSignals(item, signalPath));
    }
  }
  return signals;
}

function summarizeRecognitionCache(file) {
  const pages = Array.isArray(file?.recognition_pages) ? file.recognition_pages : [];
  const signals = collectCacheSignals({
    duration_breakdown_ms: pages.map((page) => page.duration_breakdown_ms),
    cache_status: pages.map((page) => page.cache_status),
  });
  const hasHit = signals.some((signal) => signal.value === 'hit');
  const hasMissOrDisabled = signals.some((signal) => signal.value === 'miss' || signal.value === 'disabled');
  const hits = signals.filter((signal) => signal.value === 'hit').map((signal) => signal.path);
  const missesOrDisabled = signals
    .filter((signal) => signal.value === 'miss' || signal.value === 'disabled')
    .map((signal) => signal.path);
  let cacheState = 'cache_signal_absent';
  if (hasHit && hasMissOrDisabled) cacheState = 'cache_mixed_observed';
  else if (hasHit) cacheState = 'warm_cache_hit_observed';
  else if (hasMissOrDisabled) cacheState = 'cache_miss_or_disabled_observed';
  const interpretation = cacheState === 'cache_mixed_observed'
    ? 'Mixed cache signals detected across pages/stages; treat timings as mixed warm path and do not claim cold-start performance.'
    : cacheState === 'warm_cache_hit_observed'
      ? 'Warm-cache evidence observed.'
      : cacheState === 'cache_miss_or_disabled_observed'
        ? 'Only cache miss/disabled signals observed.'
        : 'No recognized cache signals.';
  return {
    state: cacheState,
    hits,
    misses_or_disabled: missesOrDisabled,
    hit_count: hits.length,
    miss_or_disabled_count: missesOrDisabled.length,
    signal_count: signals.length,
    mixed_signal: cacheState === 'cache_mixed_observed',
    interpretation,
  };
}

function pageDurationSumMs(file) {
  const explicit = safeDurationMs(file?.recognition_page_duration_sum_ms);
  if (explicit !== null) return explicit;
  const pages = Array.isArray(file?.recognition_pages) ? file.recognition_pages : [];
  const sum = pages.reduce((total, page) => total + (safeDurationMs(page?.duration_ms) ?? 0), 0);
  return sum > 0 ? sum : null;
}

function recognitionParallelismRatio(file) {
  const explicit = safeRatio(file?.recognition_parallelism_ratio);
  if (explicit !== null) return explicit;
  const sum = pageDurationSumMs(file);
  const wall = safeDurationMs(file?.recognition_duration_ms);
  if (!sum || !wall) return null;
  return safeRatio(sum / wall);
}

function summarizePageParallelism(file) {
  const pages = Array.isArray(file?.recognition_pages) ? file.recognition_pages : [];
  const wallClockMs = safeDurationMs(file?.recognition_duration_ms);
  const pageSumMs = pageDurationSumMs(file);
  const ratio = recognitionParallelismRatio(file);
  const configured = safePositiveInteger(file?.recognition_page_concurrency_configured);
  const effective = safePositiveInteger(file?.recognition_page_concurrency);
  let observed = 'not_enough_page_timing';
  if (pages.length <= 1) observed = 'single_page_not_applicable';
  else if (!wallClockMs || !pageSumMs || ratio === null) observed = 'not_enough_page_timing';
  else if ((effective ?? configured ?? 1) <= 1) observed = 'serial_by_configuration';
  else if (ratio >= 1.15) observed = 'parallel_overlap_observed';
  else observed = 'parallel_overlap_not_observed';
  return {
    page_count: pages.length,
    page_concurrency: effective,
    page_concurrency_effective: effective,
    configured_page_concurrency: configured,
    page_concurrency_configured: configured,
    page_duration_sum_ms: pageSumMs,
    recognition_wall_clock_ms: wallClockMs,
    page_sum_to_wall_clock_ratio: ratio,
    observed_parallelism: observed,
    interpretation:
      observed === 'parallel_overlap_observed'
        ? 'Per-page durations sum materially above recognition wall-clock, which is evidence of overlapping page work.'
        : 'This evidence does not prove overlapping page work; compare per-page duration sum against recognition wall-clock before claiming parallel PDF recognition.',
  };
}

function sortedJobItems(job) {
  return (Array.isArray(job?.items) ? job.items : [])
    .filter((item) => item && typeof item === 'object')
    .slice()
    .sort((a, b) => {
      const aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
}

function normalizedJobItemStatus(item) {
  return String(item?.status || '').trim().toLowerCase() || 'unknown';
}

function isReviewableJobItem(item) {
  const status = normalizedJobItemStatus(item);
  return [
    'awaiting_review',
    'reviewing',
    'reviewed',
    'completed',
    'redacted',
    'exported',
  ].includes(status);
}

function isRecognitionCompleteJobItem(item) {
  const status = normalizedJobItemStatus(item);
  if (
    [
      'awaiting_review',
      'reviewing',
      'reviewed',
      'completed',
      'redacted',
      'exported',
      'failed',
      'error',
      'skipped',
      'cancelled',
      'canceled',
    ].includes(status)
  ) {
    return true;
  }
  return safeDurationMs(item?.recognition_duration_ms) !== null;
}

export function summarizeBatchRecognitionStatus(job, expectedFileCount, options = {}) {
  const items = sortedJobItems(job);
  const expected = safePositiveInteger(expectedFileCount) ?? items.length;
  const configLockedAtMs = resolveJobConfigLockedAtMs(job);
  const runStartedAtMs = safeTimestampMs(options.runStartedAtMs);
  const cutoffMs = configLockedAtMs ?? null;
  const statusCounts = {};
  const freshnessCounts = {};
  let reviewableCount = 0;
  let recognitionCompleteCount = 0;
  let staleItemCount = 0;
  let timestampedItemCount = 0;
  let minReviewableDurationMs = null;
  let maxRecognitionDurationMs = null;
  const firstReviewableAtCandidates = [];
  const completeAtCandidates = [];
  for (const item of items) {
    const status = normalizedJobItemStatus(item);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const freshness = classifyJobItemFreshness(item, cutoffMs);
    freshnessCounts[freshness.reason] = (freshnessCounts[freshness.reason] || 0) + 1;
    if (freshness.timing.candidates.length > 0) timestampedItemCount += 1;
    if (!freshness.current) {
      staleItemCount += 1;
      continue;
    }
    const durationMs = freshness.timing.recognition_duration_ms;
    if (durationMs !== null) {
      maxRecognitionDurationMs = maxRecognitionDurationMs === null ? durationMs : Math.max(maxRecognitionDurationMs, durationMs);
    }
    if (isReviewableJobItem(item)) {
      reviewableCount += 1;
      if (durationMs !== null) {
        minReviewableDurationMs =
          minReviewableDurationMs === null ? durationMs : Math.min(minReviewableDurationMs, durationMs);
      }
      const reviewableAtMs =
        freshness.timing.finished_at_ms ??
        (runStartedAtMs !== null && durationMs !== null ? runStartedAtMs + durationMs : null);
      if (reviewableAtMs !== null) firstReviewableAtCandidates.push(reviewableAtMs);
    }
    if (isRecognitionCompleteJobItem(item)) {
      recognitionCompleteCount += 1;
      const completeAtMs =
        freshness.timing.finished_at_ms ??
        (runStartedAtMs !== null && durationMs !== null ? runStartedAtMs + durationMs : null);
      if (completeAtMs !== null) completeAtCandidates.push(completeAtMs);
    }
  }
  const allComplete = expected > 0 && items.length >= expected && recognitionCompleteCount >= expected;
  const allCompleteAtMs = allComplete && completeAtCandidates.length >= expected ? Math.max(...completeAtCandidates) : null;
  const firstReviewableAtMs = firstReviewableAtCandidates.length > 0 ? Math.min(...firstReviewableAtCandidates) : null;
  return {
    expected_file_count: expected,
    api_item_count: items.length,
    status_counts: statusCounts,
    config_locked_at: safeIsoTimestamp(configLockedAtMs),
    freshness_cutoff: safeIsoTimestamp(cutoffMs),
    freshness_counts: freshnessCounts,
    stale_item_count: staleItemCount,
    timestamped_item_count: timestampedItemCount,
    first_reviewable: reviewableCount > 0,
    first_reviewable_source: reviewableCount > 0 ? 'api-job-item-status' : null,
    first_reviewable_at: safeIsoTimestamp(firstReviewableAtMs),
    first_reviewable_min_duration_ms: minReviewableDurationMs,
    reviewable_count: reviewableCount,
    recognition_complete_count: recognitionCompleteCount,
    all_recognition_complete: allComplete,
    all_recognition_complete_source: allComplete ? 'api-job-item-status' : null,
    all_recognition_complete_at: safeIsoTimestamp(allCompleteAtMs),
    all_recognition_complete_min_duration_ms: allComplete ? maxRecognitionDurationMs : null,
  };
}

export function buildBatchApiEvidence(job, fileRefs) {
  const refs = Array.isArray(fileRefs) ? fileRefs : [];
  const items = sortedJobItems(job);
  const jobId = String(job?.id || job?.job_id || items[0]?.job_id || '');
  const configLockedAtMs = resolveJobConfigLockedAtMs(job);
  return {
    job_id: jobId || null,
    config_locked_at: safeIsoTimestamp(configLockedAtMs),
    file_count: refs.length,
    api_item_count: items.length,
    match_strategy: 'sort_order',
    files: refs.map((ref, index) => {
      const item = items[index] || {};
      const freshness = classifyJobItemFreshness(item, configLockedAtMs);
      const file = {
        label: ref.label,
        file_type: String(item.file_type || '').trim().toLowerCase() || 'unknown',
        status: String(item.status || '').trim().toLowerCase() || 'unknown',
        entity_count: safeEntityCount(item.entity_count),
      };
      if (configLockedAtMs !== null || freshness.timing.candidates.length > 0) {
        file.current_batch_state = freshness.current ? 'current-or-compatible' : 'stale-before-config-lock';
        file.current_batch_reason = freshness.reason;
      }
      const recognitionDurationMs = safeDurationMs(item.recognition_duration_ms);
      const recognitionPages = sanitizeRecognitionPages(item.recognition_pages);
      const recognitionPageConcurrency = safePositiveInteger(item.recognition_page_concurrency);
      const recognitionPageConcurrencyConfigured = safePositiveInteger(item.recognition_page_concurrency_configured);
      const recognitionPageDurationSumMs = safeDurationMs(item.recognition_page_duration_sum_ms);
      const recognitionParallelism = safeRatio(item.recognition_parallelism_ratio);
      const startedAt = safeIsoTimestamp(freshness.timing.started_at_ms);
      const finishedAt = safeIsoTimestamp(freshness.timing.finished_at_ms);
      if (recognitionDurationMs !== null) file.recognition_duration_ms = recognitionDurationMs;
      if (startedAt !== null) file.started_at = startedAt;
      if (finishedAt !== null) file.finished_at = finishedAt;
      if (recognitionPages.length > 0) file.recognition_pages = recognitionPages;
      if (recognitionPageConcurrency !== null) file.recognition_page_concurrency = recognitionPageConcurrency;
      if (recognitionPageConcurrencyConfigured !== null) {
        file.recognition_page_concurrency_configured = recognitionPageConcurrencyConfigured;
      }
      if (recognitionPageDurationSumMs !== null) file.recognition_page_duration_sum_ms = recognitionPageDurationSumMs;
      if (recognitionParallelism !== null) file.recognition_parallelism_ratio = recognitionParallelism;
      return file;
    }),
  };
}

function boundedDurationMs(value, maxValue) {
  const duration = safeDurationMs(value);
  if (duration === null) return null;
  const upper = safeDurationMs(maxValue);
  return upper === null ? duration : Math.min(duration, upper);
}

function durationToken(value) {
  const duration = safeDurationMs(value);
  return duration === null ? 'unknown' : `${duration}ms`;
}

function signedDurationToken(value) {
  const duration = Number(value);
  return Number.isFinite(duration) ? `${Math.round(duration)}ms` : 'unknown';
}

function classifyFirstReviewableGap(deltaMs) {
  if (deltaMs === null) return 'not_observed';
  if (deltaMs >= FIRST_REVIEWABLE_UI_API_GAP_WARNING_MS) return 'warning';
  if (deltaMs >= FIRST_REVIEWABLE_UI_API_GAP_NOTICE_MS) return 'notice';
  if (deltaMs > 0) return 'minor';
  return 'ok';
}

function firstReviewableGapHint(uiMs, apiMs, deltaMs) {
  if (uiMs === null || apiMs === null || deltaMs === null) {
    return 'UI/API first-reviewable comparison needs both browser and API timings.';
  }
  if (deltaMs > 0) {
    return `UI first-reviewable is ${deltaMs}ms slower than API first-reviewable; notice=${FIRST_REVIEWABLE_UI_API_GAP_NOTICE_MS}ms warning=${FIRST_REVIEWABLE_UI_API_GAP_WARNING_MS}ms. This points to UI polling, rendering, or step-enable latency rather than full-batch recognition time.`;
  }
  if (deltaMs < 0) {
    return `UI first-reviewable is ${Math.abs(deltaMs)}ms earlier than API first-reviewable; compare probe timing before drawing conclusions.`;
  }
  return 'UI and API first-reviewable timings are aligned.';
}

function reviewWaitSource(apiBackgroundReviewWaitMs, reviewBlockedWaitMs) {
  if (apiBackgroundReviewWaitMs !== null && apiBackgroundReviewWaitMs >= REVIEW_BACKGROUND_WAIT_NOTICE_MS) {
    return 'background_recognition_incomplete';
  }
  if (apiBackgroundReviewWaitMs !== null && apiBackgroundReviewWaitMs > 0) {
    return 'background_recognition_incomplete_minor';
  }
  if (reviewBlockedWaitMs !== null && reviewBlockedWaitMs > 0) return 'ui_controls_disabled';
  return 'not_observed';
}

function reviewWaitHint(source, apiBackgroundReviewWaitMs) {
  if (source === 'background_recognition_incomplete' || source === 'background_recognition_incomplete_minor') {
    return `Review was open before all files finished recognition; background wait is all_recognition_complete_api_ms - review_open_from_submit_ms, bounded by review_actions_ms (${durationToken(apiBackgroundReviewWaitMs)} observed).`;
  }
  if (source === 'ui_controls_disabled') {
    return 'Review-loop blocked time was observed, but API all-complete timing did not show unfinished background recognition during review.';
  }
  return 'No review blocking wait was observed.';
}

export function buildBatchPhaseDiagnostics(batch) {
  const phases = batch?.phases || {};
  const phaseEvents = batch?.phase_events || {};
  const apiTiming = batch?.api_timing || {};
  const phaseEvidence = batch?.phase_evidence || {};
  const step3WaitDomEvidence =
    phaseEvidence.step3_wait_dom && typeof phaseEvidence.step3_wait_dom === 'object'
      ? phaseEvidence.step3_wait_dom
      : compactStep3WaitDomEvidence(phaseEvidence.step3_wait_dom_samples);
  const step3JobsRequestsEvidence =
    phaseEvidence.step3_jobs_requests && typeof phaseEvidence.step3_jobs_requests === 'object'
      ? phaseEvidence.step3_jobs_requests
      : compactStep3JobsRequestEvidence(phaseEvidence.step3_jobs_request_samples);
  const lastStatus = apiTiming.last_status;
  const hasLastStatus = lastStatus && typeof lastStatus === 'object' && Object.keys(lastStatus).length > 0;
  const recognitionWaitMs = safeDurationMs(phases.recognition_wait_ms);
  const reviewActionsMs = safeDurationMs(phases.review_actions_ms);
  const reviewBlockedWaitMs = safeDurationMs(phases.review_blocked_wait_ms);
  const reviewOpenFromSubmitMs = safeDurationMs(phaseEvents.review_open_from_submit_ms);
  const firstReviewableUiMs = safeDurationMs(phaseEvents.first_reviewable_ui_ms) ?? recognitionWaitMs;
  const firstReviewableApiItemTimestampMs = safeDurationMs(apiTiming.first_reviewable_ms);
  const firstReviewableApiObservedMs = safeDurationMs(apiTiming.first_reviewable_observed_ms);
  const firstReviewableApiMs = firstReviewableApiObservedMs ?? firstReviewableApiItemTimestampMs;
  const allRecognitionCompleteMs = safeDurationMs(apiTiming.all_recognition_complete_ms);
  const firstReviewableSource = firstReviewableApiMs !== null ? 'api-job-item-status' : 'step3-next-enabled';
  const allRecognitionCompleteSource = allRecognitionCompleteMs !== null
    ? 'api-job-item-status'
    : hasLastStatus
      ? 'api-job-item-status-partial'
      : 'not_observed';
  const apiBackgroundReviewWaitMs =
    allRecognitionCompleteMs !== null && reviewOpenFromSubmitMs !== null && allRecognitionCompleteMs > reviewOpenFromSubmitMs
      ? boundedDurationMs(allRecognitionCompleteMs - reviewOpenFromSubmitMs, reviewActionsMs)
      : null;
  const reviewWaitingForBackgroundMs = apiBackgroundReviewWaitMs ?? reviewBlockedWaitMs;
  const firstReviewableUiApiDeltaMs =
    firstReviewableUiMs !== null && firstReviewableApiMs !== null
      ? firstReviewableUiMs - firstReviewableApiMs
      : null;
  const firstReviewableGapSeverity = classifyFirstReviewableGap(firstReviewableUiApiDeltaMs);
  const reviewBlockedSource = reviewWaitSource(apiBackgroundReviewWaitMs, reviewBlockedWaitMs);
  return {
    recognition_wait_ms: recognitionWaitMs,
    recognition_wait_scope:
      'UI wall-clock from submit-queue click until the step-3 next action is enabled; this is first-reviewable latency, not proof that every file finished recognition.',
    first_reviewable_ui_ms: firstReviewableUiMs,
    first_reviewable_api_ms: firstReviewableApiMs,
    first_reviewable_ui_minus_api_ms: firstReviewableUiApiDeltaMs,
    first_reviewable_ui_slower_than_api: firstReviewableUiApiDeltaMs !== null ? firstReviewableUiApiDeltaMs > 0 : null,
    first_reviewable_gap_severity: firstReviewableGapSeverity,
    first_reviewable_gap_thresholds_ms: {
      notice: FIRST_REVIEWABLE_UI_API_GAP_NOTICE_MS,
      warning: FIRST_REVIEWABLE_UI_API_GAP_WARNING_MS,
    },
    first_reviewable_api_item_timestamp_ms: firstReviewableApiItemTimestampMs,
    first_reviewable_api_observed_ms: firstReviewableApiObservedMs,
    first_reviewable_source: firstReviewableSource,
    first_reviewable_scope:
      'API probe: /jobs/<id> status reached a reviewable state. UI/API delta uses API poll observation when available; item timestamp is retained separately.',
    first_reviewable_readable_summary: [
      `first_reviewable: ui=${durationToken(firstReviewableUiMs)}`,
      `api=${durationToken(firstReviewableApiMs)}`,
      firstReviewableApiObservedMs !== null && firstReviewableApiItemTimestampMs !== null
        ? `api_item=${durationToken(firstReviewableApiItemTimestampMs)}`
        : null,
      `delta=${signedDurationToken(firstReviewableUiApiDeltaMs)}`,
      `state=${firstReviewableUiApiDeltaMs !== null && firstReviewableUiApiDeltaMs > 0 ? 'ui_slower_than_api' : firstReviewableGapSeverity}`,
      `severity=${firstReviewableGapSeverity}`,
    ].filter(Boolean).join(' '),
    first_reviewable_threshold_hint: firstReviewableGapHint(firstReviewableUiMs, firstReviewableApiMs, firstReviewableUiApiDeltaMs),
    review_open_from_submit_ms: reviewOpenFromSubmitMs,
    all_recognition_complete_api_ms: allRecognitionCompleteMs,
    all_recognition_complete_observed: allRecognitionCompleteMs !== null,
    all_recognition_complete_source: allRecognitionCompleteSource,
    all_recognition_complete_scope: 'API probe: /jobs/<id> status reports all files as terminal-recognized.',
    background_continued_after_review_open:
      allRecognitionCompleteMs !== null && reviewOpenFromSubmitMs !== null
        ? allRecognitionCompleteMs > reviewOpenFromSubmitMs
        : null,
    review_actions_ms: reviewActionsMs,
    review_blocked_wait_ms: reviewBlockedWaitMs,
    review_waiting_for_background_ms: reviewWaitingForBackgroundMs,
    review_blocked_wait_source: reviewBlockedSource,
    review_blocked_wait_thresholds_ms: {
      background_wait_notice: REVIEW_BACKGROUND_WAIT_NOTICE_MS,
    },
    review_wait_readable_summary: [
      `review_wait: blocked=${durationToken(reviewBlockedWaitMs)}`,
      `background=${durationToken(reviewWaitingForBackgroundMs)}`,
      `source=${reviewBlockedSource}`,
    ].join(' '),
    review_wait_threshold_hint: reviewWaitHint(reviewBlockedSource, reviewWaitingForBackgroundMs),
    review_active_action_ms:
      reviewActionsMs !== null && reviewBlockedWaitMs !== null
        ? Math.max(0, reviewActionsMs - reviewBlockedWaitMs)
        : null,
    review_wait_scope:
      'Time in the review step with no enabled confirm/next/export action, plus API-observed waiting for all files to finish when available.',
    step3_wait_dom: step3WaitDomEvidence,
    step3_jobs_requests: step3JobsRequestsEvidence,
    api_status: apiTiming.last_status || null,
    api_poll_errors: safeEntityCount(apiTiming.poll_errors),
  };
}

function compactTypeCounts(counts, types) {
  const output = {};
  for (const type of types || []) {
    const count = safeEntityCount(counts?.[type]);
    if (count > 0) output[type] = count;
  }
  return output;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort();
}

function summarizePdfTextLayer(file) {
  const pages = Array.isArray(file?.recognition_pages) ? file.recognition_pages : [];
  const sparsePages = [];
  const textLayerPages = [];
  let blockCount = 0;
  let charCount = 0;
  for (const page of pages) {
    const pageNumber = Number.isFinite(Number(page?.page)) ? Number(page.page) : null;
    const breakdown = page?.duration_breakdown_ms && typeof page.duration_breakdown_ms === 'object'
      ? page.duration_breakdown_ms
      : {};
    const textLayer = breakdown.pdf_text_layer && typeof breakdown.pdf_text_layer === 'object'
      ? breakdown.pdf_text_layer
      : {};
    if (Object.keys(textLayer).length > 0) {
      if (pageNumber !== null) textLayerPages.push(pageNumber);
      blockCount += safeEntityCount(textLayer.block_count ?? breakdown.block_count);
      charCount += safeEntityCount(textLayer.char_count ?? breakdown.char_count);
    }
    if (breakdown.pdf_text_layer_skipped_sparse_file === true) {
      if (pageNumber !== null) sparsePages.push(pageNumber);
    }
  }
  const sparsePageCount = sparsePages.length;
  return {
    page_count: pages.length,
    pages_with_text_layer_metrics: textLayerPages.length,
    sparse_fallback_page_count: sparsePageCount,
    sparse_fallback_pages: sparsePages.slice(0, 12),
    text_layer_block_count_sum: blockCount,
    text_layer_char_count_sum: charCount,
    state:
      sparsePageCount > 0
        ? 'sparse_fallback_observed'
        : textLayerPages.length > 0
          ? 'text_layer_metrics_observed'
          : 'text_layer_signal_absent',
    interpretation:
      sparsePageCount > 0
        ? 'PDF text-layer metrics were present but marked sparse on at least one page; this explains image OCR fallback and is not model quality evidence by itself.'
        : textLayerPages.length > 0
          ? 'PDF text-layer metrics are present without sparse fallback markers.'
          : 'No PDF text-layer metrics were captured in the sanitized API evidence.',
  };
}

function pageTextLayerState(page) {
  const breakdown = page?.duration_breakdown_ms && typeof page.duration_breakdown_ms === 'object'
    ? page.duration_breakdown_ms
    : {};
  if (breakdown.pdf_text_layer_skipped_sparse_file === true) return 'sparse_fallback';
  if (breakdown.pdf_text_layer && typeof breakdown.pdf_text_layer === 'object' && Object.keys(breakdown.pdf_text_layer).length > 0) {
    return 'text_layer_metrics';
  }
  return 'no_text_layer_signal';
}

function summarizePdfPageDurationRank(file) {
  const label = file?.label || 'unknown-pdf';
  const pages = Array.isArray(file?.recognition_pages) ? file.recognition_pages : [];
  const rankedPages = pages
    .map((page) => {
      const breakdown = page?.duration_breakdown_ms && typeof page.duration_breakdown_ms === 'object'
        ? page.duration_breakdown_ms
        : {};
      return {
        page: Number.isFinite(Number(page?.page)) ? Number(page.page) : null,
        duration_ms: safeDurationMs(page?.duration_ms),
        request_total_ms: safeDurationMs(breakdown.request_total_ms),
        total_ms: safeDurationMs(breakdown.total),
        pdf_render_ms: safeDurationMs(breakdown.pdf_render_ms),
        text_layer_state: pageTextLayerState(page),
      };
    })
    .filter((page) => page.page !== null || page.duration_ms !== null)
    .sort((a, b) => {
      const durationDiff = (b.duration_ms ?? -1) - (a.duration_ms ?? -1);
      if (durationDiff !== 0) return durationDiff;
      return (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER);
    });
  const topPages = rankedPages.slice(0, PDF_PAGE_DURATION_RANK_LIMIT);
  const line = topPages.length > 0
    ? `${label} page_duration_rank: ${topPages
      .map((page) => `p${page.page ?? '?'}=${durationToken(page.duration_ms)}`)
      .join(' > ')}`
    : `${label} page_duration_rank: not_observed`;
  return {
    page_count: pages.length,
    ranked_by: 'duration_ms_desc',
    limit: PDF_PAGE_DURATION_RANK_LIMIT,
    slowest_page: topPages[0] || null,
    pages: topPages,
    line,
    interpretation:
      topPages.length > 0
        ? 'Pages are sorted by sanitized per-page recognition duration so the slowest PDF pages are visible without reopening raw API evidence.'
        : 'No per-page duration evidence was available for this PDF.',
  };
}

function pdfRecognitionSummaryLine(file, cache, parallelism, textLayer) {
  const label = file?.label || 'unknown-pdf';
  const duration = safeDurationMs(file?.recognition_duration_ms);
  const pageSum = parallelism.page_duration_sum_ms;
  const ratio = parallelism.page_sum_to_wall_clock_ratio;
  const concurrency = parallelism.page_concurrency_effective ?? parallelism.page_concurrency_configured ?? 'unknown';
  return [
    `${label}: recognition=${duration === null ? 'unknown' : `${duration}ms`}`,
    `page_sum=${pageSum === null ? 'unknown' : `${pageSum}ms`}`,
    `ratio=${ratio === null ? 'unknown' : ratio}`,
    `concurrency=${concurrency}`,
    `parallelism=${parallelism.observed_parallelism}`,
    `cache=${cache.state}`,
    `text_layer=${textLayer.state}`,
  ].join(' ');
}

function summarizePdfRecognitionCollection(pdfRecognition) {
  const files = Array.isArray(pdfRecognition) ? pdfRecognition : [];
  const durationValues = files
    .map((file) => safeDurationMs(file.recognition_duration_ms))
    .filter((value) => value !== null);
  const slowest = files.reduce((current, file) => {
    const duration = safeDurationMs(file.recognition_duration_ms);
    if (duration === null) return current;
    if (!current || duration > current.recognition_duration_ms) {
      return { label: file.label, recognition_duration_ms: duration };
    }
    return current;
  }, null);
  return {
    file_count: files.length,
    timed_file_count: durationValues.length,
    duration_sum_ms: durationValues.reduce((total, value) => total + value, 0),
    max_duration_ms: slowest?.recognition_duration_ms ?? null,
    slowest_file: slowest,
    parallel_overlap_observed_count: files.filter(
      (file) => file.page_parallelism?.observed_parallelism === 'parallel_overlap_observed',
    ).length,
    sparse_text_layer_file_count: files.filter(
      (file) => file.text_layer?.state === 'sparse_fallback_observed',
    ).length,
    cache_states: files.reduce((counts, file) => {
      const state = file.cache?.state || 'unknown';
      counts[state] = (counts[state] || 0) + 1;
      return counts;
    }, {}),
    page_duration_rank_lines: files
      .map((file) => file.page_duration_rank?.line)
      .filter(Boolean),
    lines: files.map((file) => file.readable_summary).filter(Boolean),
  };
}

function summarizeBatchTimingDiagnostics(diagnostics) {
  const firstReviewableLine = diagnostics?.first_reviewable_readable_summary
    || [
      `first_reviewable: ui=${durationToken(diagnostics?.first_reviewable_ui_ms)}`,
      `api=${durationToken(diagnostics?.first_reviewable_api_ms)}`,
      `delta=${signedDurationToken(diagnostics?.first_reviewable_ui_minus_api_ms)}`,
    ].join(' ');
  const reviewWaitLine = diagnostics?.review_wait_readable_summary
    || [
      `review_wait: blocked=${durationToken(diagnostics?.review_blocked_wait_ms)}`,
      `background=${durationToken(diagnostics?.review_waiting_for_background_ms)}`,
      `source=${diagnostics?.review_blocked_wait_source || 'not_observed'}`,
    ].join(' ');
  const allCompleteLine = [
    `all_recognition_complete: api=${durationToken(diagnostics?.all_recognition_complete_api_ms)}`,
    `observed=${diagnostics?.all_recognition_complete_observed === true}`,
  ].join(' ');
  return {
    first_reviewable: {
      ui_ms: diagnostics?.first_reviewable_ui_ms ?? null,
      api_ms: diagnostics?.first_reviewable_api_ms ?? null,
      ui_minus_api_ms: diagnostics?.first_reviewable_ui_minus_api_ms ?? null,
      ui_slower_than_api: diagnostics?.first_reviewable_ui_slower_than_api ?? null,
      severity: diagnostics?.first_reviewable_gap_severity ?? 'not_observed',
      thresholds_ms: diagnostics?.first_reviewable_gap_thresholds_ms ?? null,
      hint: diagnostics?.first_reviewable_threshold_hint ?? null,
    },
    review_wait: {
      blocked_ms: diagnostics?.review_blocked_wait_ms ?? null,
      waiting_for_background_ms: diagnostics?.review_waiting_for_background_ms ?? null,
      source: diagnostics?.review_blocked_wait_source || 'not_observed',
      thresholds_ms: diagnostics?.review_blocked_wait_thresholds_ms ?? null,
      hint: diagnostics?.review_wait_threshold_hint ?? null,
    },
    lines: [firstReviewableLine, reviewWaitLine, allCompleteLine],
  };
}

export function buildPerformanceContext(summary) {
  const failedRequests = Array.isArray(summary?.failed_requests) ? summary.failed_requests : [];
  const ignoredFailedRequests = Array.isArray(summary?.ignored_failed_requests)
    ? summary.ignored_failed_requests
    : failedRequests.filter(isIgnorableFailedRequest);
  const actionableFailedRequests = failedRequests.filter((request) => !isIgnorableFailedRequest(request));
  const failedRequestDiagnostics =
    summary?.failed_request_diagnostics || buildFailedRequestDiagnostics(failedRequests);
  const files = Array.isArray(summary?.batch?.api_evidence?.files) ? summary.batch.api_evidence.files : [];
  const phaseDiagnostics = buildBatchPhaseDiagnostics(summary?.batch);
  const pdfRecognition = files
    .filter((file) => isPdfFileRef(file) || String(file?.file_type || '').includes('pdf'))
    .map((file) => {
      const cache = summarizeRecognitionCache(file);
      const parallelism = summarizePageParallelism(file);
      const textLayer = summarizePdfTextLayer(file);
      const pageDurationRank = summarizePdfPageDurationRank(file);
      const supportsColdStart = cache.state === 'cache_miss_or_disabled_observed';
      const isWarm = cache.state === 'warm_cache_hit_observed';
      const isMixed = cache.state === 'cache_mixed_observed';
      return {
        label: file.label,
        file_type: file.file_type,
        recognition_duration_ms: safeDurationMs(file.recognition_duration_ms),
        recognition_pages: file.recognition_pages,
        page_parallelism: parallelism,
        text_layer: textLayer,
        page_duration_rank: pageDurationRank,
        cache,
        cold_cache_supported: supportsColdStart,
        cold_start_supported: supportsColdStart,
        readable_summary: pdfRecognitionSummaryLine(file, cache, parallelism, textLayer),
        interpretation:
          isMixed
            ? 'Mixed cache signals observed across pages/stages; this PDF timing is not a clean cold-start path.'
            : isWarm
              ? 'Warm-cache evidence: cache hit signals are present, so short PDF recognition durations must not be cited as cold-start performance.'
              : supportsColdStart
                ? 'Only cache misses/disabled are visible; this can support a cold-cache comparison assumption with other startup checks.'
                : 'Cache signals are absent or unclassified; avoid cold-start claims from this PDF timing.',
      };
    });
  return {
    scope:
      'Live UI timings are browser/API workflow evidence against already-running services; this script does not start or stop model services.',
    single: {
      recognition_elapsed_ms: safeDurationMs(summary?.single?.recognition_elapsed_ms),
      timing_scope: 'browser wall-clock from loading state to result visibility',
    },
    batch: {
      recognition_wait_ms: safeDurationMs(summary?.batch?.phases?.recognition_wait_ms),
      timing_scope: 'browser wall-clock from submit-queue click until the step-3 next action is enabled',
      phase_diagnostics: phaseDiagnostics,
      timing_summary: summarizeBatchTimingDiagnostics(phaseDiagnostics),
      pdf_recognition: pdfRecognition,
      pdf_recognition_summary: summarizePdfRecognitionCollection(pdfRecognition),
    },
    failed_requests: {
      total: failedRequests.length,
      ignored: ignoredFailedRequests.length,
      actionable: actionableFailedRequests.length,
      actionable_requests: failedRequestDiagnostics.actionable_requests,
      actionable_by_failure: failedRequestDiagnostics.actionable_by_failure,
      actionable_by_method: failedRequestDiagnostics.actionable_by_method,
      actionable_by_url: failedRequestDiagnostics.actionable_by_url,
      ignored_policy: failedRequestDiagnostics.ignored_policy,
    },
  };
}

function summarizeTypeIntegrity(summary) {
  const files = Array.isArray(summary?.batch?.box_geometry_evidence?.files)
    ? summary.batch.box_geometry_evidence.files
    : [];
  const aliasFiles = files.filter((file) => Array.isArray(file.alias_leak_types) && file.alias_leak_types.length > 0);
  const unknownHasImageFiles = files.filter(
    (file) => Array.isArray(file.unknown_has_image_types) && file.unknown_has_image_types.length > 0,
  );
  const aliasTypes = uniqueSorted(aliasFiles.flatMap((file) => file.alias_leak_types || []));
  const unknownHasImageTypes = uniqueSorted(
    unknownHasImageFiles.flatMap((file) => file.unknown_has_image_types || []),
  );
  return {
    checked_files: files.length,
    total_boxes: files.reduce((total, file) => total + safeEntityCount(file.total_boxes), 0),
    alias_leak_file_count: aliasFiles.length,
    alias_leak_types: aliasTypes,
    alias_leak_files: aliasFiles.map((file) => ({
      label: file.label,
      types: file.alias_leak_types,
      counts_by_type: compactTypeCounts(file.by_type, file.alias_leak_types),
    })),
    unknown_has_image_file_count: unknownHasImageFiles.length,
    unknown_has_image_types: unknownHasImageTypes,
    unknown_has_image_files: unknownHasImageFiles.map((file) => ({
      label: file.label,
      types: file.unknown_has_image_types,
      counts_by_type: compactTypeCounts(file.by_type, file.unknown_has_image_types),
    })),
    fixed_has_image_model_source:
      'Only has_image_model evidence_source is checked against the fixed HaS Image class set; local_fallback and ocr_has are diagnostic sources.',
    state:
      aliasTypes.length > 0 || unknownHasImageTypes.length > 0
        ? 'type_normalization_issue_observed'
        : files.length > 0
          ? 'type_normalization_clean'
          : 'type_normalization_not_checked',
    summary:
      aliasTypes.length > 0 || unknownHasImageTypes.length > 0
        ? [
            aliasTypes.length > 0 ? `alias leaks: ${aliasTypes.join(', ')}` : null,
            unknownHasImageTypes.length > 0 ? `unknown HaS Image: ${unknownHasImageTypes.join(', ')}` : null,
          ].filter(Boolean).join('; ')
        : files.length > 0
          ? 'No alias leaks or non-fixed HaS Image model types observed.'
          : 'Box geometry evidence was not collected.',
  };
}

export function buildEvidenceSummary(summary) {
  const pdfSummary = summary?.performance_context?.batch?.pdf_recognition_summary
    ?? summarizePdfRecognitionCollection(summary?.performance_context?.batch?.pdf_recognition || []);
  const batchTimingSummary = summary?.performance_context?.batch?.timing_summary
    ?? summarizeBatchTimingDiagnostics(summary?.performance_context?.batch?.phase_diagnostics || {});
  const step3WaitDom = summary?.performance_context?.batch?.phase_diagnostics?.step3_wait_dom
    ?? summary?.batch?.phase_diagnostics?.step3_wait_dom
    ?? summary?.batch?.phase_evidence?.step3_wait_dom
    ?? compactStep3WaitDomEvidence(summary?.batch?.phase_evidence?.step3_wait_dom_samples);
  const step3JobsRequests = summary?.performance_context?.batch?.phase_diagnostics?.step3_jobs_requests
    ?? summary?.batch?.phase_diagnostics?.step3_jobs_requests
    ?? summary?.batch?.phase_evidence?.step3_jobs_requests
    ?? compactStep3JobsRequestEvidence(summary?.batch?.phase_evidence?.step3_jobs_request_samples);
  const typeIntegrity = summarizeTypeIntegrity(summary);
  const step3WaitDomLine = [
    `step3_wait_dom: samples=${safeEntityCount(step3WaitDom.sample_count)}`,
    `changes=${safeEntityCount(step3WaitDom.change_sample_count)}`,
    `retained=${safeEntityCount(step3WaitDom.retained_count)}`,
    `hidden=${step3WaitDom.document_hidden_observed === true}`,
    `final_reviewable=${step3WaitDom.final_data_reviewable === true}`,
    `final_disabled=${step3WaitDom.final_disabled === true}`,
  ].join(' ');
  const step3JobsRequestsLine = [
    `step3_jobs_requests: samples=${safeEntityCount(step3JobsRequests.sample_count)}`,
    `retained=${safeEntityCount(step3JobsRequests.retained_count)}`,
    `first_get=${durationToken(step3JobsRequests.first_request_elapsed_ms)}`,
    `first_success=${durationToken(step3JobsRequests.first_success_elapsed_ms)}`,
    `first_reviewable=${durationToken(step3JobsRequests.first_reviewable_response_elapsed_ms)}`,
    `final_reviewable_count=${step3JobsRequests.final_reviewable_count ?? 'unknown'}`,
    `final_status_counts=${statusCountsToken(step3JobsRequests.final_item_status_counts)}`,
  ].join(' ');
  return {
    batch_timing: batchTimingSummary,
    step3_wait_dom: step3WaitDom,
    step3_jobs_requests: step3JobsRequests,
    pdf_recognition: pdfSummary,
    type_integrity: typeIntegrity,
    finding_count: Array.isArray(summary?.findings) ? summary.findings.length : 0,
    summary_lines: [
      ...batchTimingSummary.lines,
      step3WaitDomLine,
      step3JobsRequestsLine,
      ...pdfSummary.lines,
      ...(pdfSummary.page_duration_rank_lines || []),
      `type_integrity=${typeIntegrity.state}: ${typeIntegrity.summary}`,
    ],
  };
}

export function appendBatchApiQualityFindings(evidence, findings) {
  if (!evidence?.job_id) {
    addFindingOnce(findings, 'Batch API evidence could not resolve the current job_id.');
  }
  if (evidence && evidence.api_item_count !== evidence.file_count) {
    addFindingOnce(
      findings,
      `Batch API evidence item count mismatch: api=${evidence.api_item_count} expected=${evidence.file_count}.`,
    );
  }
  for (const file of evidence?.files || []) {
    const entityCount = safeEntityCount(file.entity_count);
    if (isPdfFileRef(file) && file.file_type === 'pdf_scanned' && entityCount === 0) {
      addFindingOnce(
        findings,
        `${file.label}: scanned PDF API entity_count is 0 after batch review; recognition may have been overwritten by an empty draft.`,
      );
    }
    if (isImageFileRef(file) && entityCount === 0) {
      addFindingOnce(
        findings,
        `${file.label}: image API entity_count is 0 after batch review; recognition may have been overwritten by an empty draft.`,
      );
    }
  }
  return evidence;
}

function sanitizeNumberRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const number = safeEntityCount(item);
    if (number > 0) output[key] = number;
  }
  return output;
}

function sanitizeVisualEvidence(value) {
  const evidence = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    total_boxes: safeEntityCount(evidence.total_boxes),
    selected_boxes: safeEntityCount(evidence.selected_boxes),
    has_image_model: safeEntityCount(evidence.has_image_model),
    local_fallback: safeEntityCount(evidence.local_fallback),
    ocr_has: safeEntityCount(evidence.ocr_has),
    table_structure: safeEntityCount(evidence.table_structure),
    fallback_detector: safeEntityCount(evidence.fallback_detector),
    source_counts: sanitizeNumberRecord(evidence.source_counts),
    evidence_source_counts: sanitizeNumberRecord(evidence.evidence_source_counts),
    source_detail_counts: sanitizeNumberRecord(evidence.source_detail_counts),
    warnings_by_key: sanitizeNumberRecord(evidence.warnings_by_key),
  };
}

function sanitizeVisualReview(value) {
  const review = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const issuePages = Array.isArray(review.issue_pages)
    ? review.issue_pages.map((page) => String(page)).filter(Boolean)
    : [];
  const issueLabels = Array.isArray(review.issue_labels)
    ? review.issue_labels.map((label) => String(label)).filter(Boolean)
    : [];
  return {
    review_hint: Boolean(review.review_hint),
    blocking: Boolean(review.blocking),
    issue_count: safeEntityCount(review.issue_count),
    issue_pages: issuePages,
    issue_pages_count: safeEntityCount(review.issue_pages_count) || issuePages.length,
    issue_labels: issueLabels,
    by_issue: sanitizeNumberRecord(review.by_issue),
  };
}

export function buildBatchExportVisualEvidence(report, fileRefs) {
  const refs = Array.isArray(fileRefs) ? fileRefs : [];
  const files = Array.isArray(report?.files) ? report.files : [];
  const summary = report?.summary && typeof report.summary === 'object' ? report.summary : {};
  return {
    ready_for_delivery: Boolean(summary.ready_for_delivery),
    delivery_status: String(summary.delivery_status || ''),
    detected_entities: safeEntityCount(summary.detected_entities),
    redaction_coverage: Number.isFinite(Number(summary.redaction_coverage))
      ? Math.round(Number(summary.redaction_coverage) * 1000) / 1000
      : null,
    visual_review_hint: Boolean(summary.visual_review_hint),
    visual_review_issue_files: safeEntityCount(summary.visual_review_issue_files),
    visual_review_issue_count: safeEntityCount(summary.visual_review_issue_count),
    visual_review_issue_pages_count: safeEntityCount(summary.visual_review_issue_pages_count),
    visual_review_issue_labels: Array.isArray(summary.visual_review_issue_labels)
      ? summary.visual_review_issue_labels.map((label) => String(label)).filter(Boolean)
      : [],
    visual_review_by_issue: sanitizeNumberRecord(summary.visual_review_by_issue),
    visual_evidence: sanitizeVisualEvidence(summary.visual_evidence),
    files: refs.map((ref, index) => {
      const file = files[index] && typeof files[index] === 'object' ? files[index] : {};
      return {
        label: ref.label,
        file_id: String(file.file_id || ''),
        item_id: String(file.item_id || ''),
        file_type: String(file.file_type || '').trim().toLowerCase() || 'unknown',
        status: String(file.status || '').trim().toLowerCase() || 'unknown',
        entity_count: safeEntityCount(file.entity_count),
        page_count: safeEntityCount(file.page_count),
        ready_for_delivery: Boolean(file.ready_for_delivery),
        review_confirmed: Boolean(file.review_confirmed),
        visual_review_hint: Boolean(file.visual_review_hint),
        visual_evidence: sanitizeVisualEvidence(file.visual_evidence),
        visual_review: sanitizeVisualReview(file.visual_review),
      };
    }),
  };
}

export function appendBatchExportVisualQualityFindings(evidence, findings) {
  if (!evidence) {
    addFindingOnce(findings, 'Batch export visual evidence could not be collected.');
    return evidence;
  }
  if (!evidence.ready_for_delivery) {
    addFindingOnce(findings, `Batch export report is not ready for delivery: ${evidence.delivery_status || 'unknown'}.`);
  }
  for (const file of evidence.files || []) {
    const type = String(file.file_type || '').toLowerCase();
    const isVisualFile = type.includes('pdf') || type === 'image' || type === 'png' || type === 'jpg' || type === 'jpeg';
    if (!isVisualFile) continue;
    if (file.entity_count > 0 && file.visual_evidence.total_boxes === 0) {
      addFindingOnce(findings, `${file.label}: visual file has entities but export report has 0 visual boxes.`);
    }
    if (type.includes('pdf') && file.page_count > 1 && file.visual_review.issue_pages_count === 0) {
      addFindingOnce(findings, `${file.label}: multi-page PDF has no per-page visual review evidence.`);
    }
  }
  return evidence;
}

function normalizeJobId(value) {
  const text = String(value || '').trim();
  return text || null;
}

function extractJobIdFromPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  for (const key of ['id', 'job_id', 'jobId']) {
    const direct = normalizeJobId(payload[key]);
    if (direct) return direct;
  }
  for (const key of ['job', 'data', 'result']) {
    const nested = extractJobIdFromPayload(payload[key]);
    if (nested) return nested;
  }
  return null;
}

function jobIdFromRequestUrl(value, expectedAction = null) {
  try {
    const parsed = new URL(String(value || ''));
    const match = parsed.pathname.match(/\/jobs\/([^/]+)(?:\/([^/?#]+))?$/);
    if (!match) return null;
    if (expectedAction && match[2] !== expectedAction) return null;
    if (!expectedAction && match[2]) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function recordBoundJobId(binding, jobId, source) {
  const normalized = normalizeJobId(jobId);
  if (!normalized || !binding) return null;
  binding.observedJobIds ??= [];
  binding.observedJobIds.push({ job_id: normalized, source, observed_at_ms: Date.now() });
  if (source === 'submit-response-url') binding.submittedJobId = normalized;
  if (source === 'create-response-body') binding.createdJobId = normalized;
  return normalized;
}

function createBatchJobBinding() {
  return {
    createdJobId: null,
    submittedJobId: null,
    observedJobIds: [],
    responseErrors: 0,
  };
}

function attachBatchJobIdCapture(page, binding) {
  const onResponse = async (response) => {
    try {
      const request = response.request();
      const method = request.method().toUpperCase();
      const url = response.url();
      if (method === 'POST') {
        const submittedId = jobIdFromRequestUrl(url, 'submit');
        if (submittedId && response.status() < 500) {
          recordBoundJobId(binding, submittedId, 'submit-response-url');
        }
      }
      const createPath = new URL(url).pathname;
      if (method === 'POST' && /\/jobs\/?$/.test(createPath) && response.status() < 400) {
        const payload = await response.json().catch(() => null);
        const createdId = extractJobIdFromPayload(payload);
        if (createdId) recordBoundJobId(binding, createdId, 'create-response-body');
      }
    } catch {
      binding.responseErrors += 1;
    }
  };
  page.on('response', onResponse);
  return () => page.off('response', onResponse);
}

function createStep3JobsRequestMonitor(page) {
  const requestStarts = new Map();
  const samples = [];
  const pending = new Set();
  let startAt = null;

  const onRequest = (request) => {
    if (startAt === null) return;
    const method = String(request.method() || '').toUpperCase();
    if (method !== 'GET') return;
    const pathOnly = step3JobsRequestPath(request.url());
    if (!pathOnly) return;
    requestStarts.set(request, {
      path: pathOnly,
      method,
      requestAt: performance.now(),
    });
  };

  const recordResponse = async (response) => {
    const request = response.request();
    const started = requestStarts.get(request);
    if (!started) return;
    requestStarts.delete(request);
    const responseAt = performance.now();
    let itemSummary = { item_status_counts: {}, reviewable_count: null };
    if (response.status() < 500) {
      const payload = await response.json().catch(() => null);
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        itemSummary = summarizeJobsResponseItems(payload);
      }
    }
    samples.push(sanitizeStep3JobsRequestSample({
      path: started.path,
      method: started.method,
      elapsed_ms: started.requestAt - startAt,
      status: response.status(),
      duration_ms: responseAt - started.requestAt,
      ...itemSummary,
    }));
  };

  const onResponse = (response) => {
    const promise = recordResponse(response).catch(() => null);
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  };

  const onRequestFailed = (request) => {
    const started = requestStarts.get(request);
    if (!started) return;
    requestStarts.delete(request);
    samples.push(sanitizeStep3JobsRequestSample({
      path: started.path,
      method: started.method,
      elapsed_ms: started.requestAt - startAt,
      status: null,
      duration_ms: performance.now() - started.requestAt,
      item_status_counts: {},
      reviewable_count: null,
    }));
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    markStart(value = performance.now()) {
      startAt = value;
    },
    async flush() {
      await Promise.allSettled(Array.from(pending));
    },
    evidence() {
      return compactStep3JobsRequestEvidence(samples);
    },
    detach() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    },
  };
}

export function resolveBatchJobIdSnapshot(snapshot, options = {}) {
  const urlJobId = normalizeJobId(snapshot?.url_job_id);
  if (urlJobId) return { job_id: urlJobId, source: 'url-query' };
  const preferred = Array.isArray(options.preferredJobIds) ? options.preferredJobIds : [];
  for (const candidate of preferred) {
    const jobId = normalizeJobId(candidate);
    if (jobId) return { job_id: jobId, source: 'current-run-captured' };
  }
  if (options.allowSessionFallback === false) return { job_id: null, source: 'not_resolved' };
  const sessionJobIds = snapshot?.session_job_ids && typeof snapshot.session_job_ids === 'object'
    ? snapshot.session_job_ids
    : {};
  for (const key of BATCH_SESSION_JOB_KEYS) {
    const jobId = normalizeJobId(sessionJobIds[key]);
    if (jobId) return { job_id: jobId, source: `sessionStorage:${key}` };
  }
  return { job_id: null, source: 'not_resolved' };
}

async function readBatchJobIdSnapshot(page) {
  return page.evaluate((sessionKeys) => {
    const params = new URLSearchParams(window.location.search);
    const sessionJobIds = {};
    for (const key of sessionKeys) {
      sessionJobIds[key] = window.sessionStorage.getItem(key);
    }
    return {
      url: window.location.href,
      url_job_id: params.get('jobId'),
      session_job_ids: sessionJobIds,
    };
  }, BATCH_SESSION_JOB_KEYS);
}

async function resolveCurrentBatchJobId(page, options = {}) {
  const snapshot = await readBatchJobIdSnapshot(page);
  const binding = options.binding || {};
  const preferredJobIds = [
    binding.submittedJobId,
    binding.createdJobId,
    ...(Array.isArray(options.preferredJobIds) ? options.preferredJobIds : []),
  ];
  const resolution = resolveBatchJobIdSnapshot(snapshot, {
    preferredJobIds,
    allowSessionFallback: options.allowSessionFallback,
  });
  return { ...resolution, snapshot };
}

async function getCurrentBatchJobIdFromPage(page, options = {}) {
  const resolution = await resolveCurrentBatchJobId(page, options);
  return options.withDetails ? resolution : resolution.job_id;
}

function clearBatchSessionStateForNewRun() {
  const sessionPrefixes = ['lr_batch_job_id_', 'batchWizard:config:'];
  const exactSessionKeys = ['batchWizard:config:v1'];
  for (const key of Object.keys(window.sessionStorage)) {
    if (exactSessionKeys.includes(key) || sessionPrefixes.some((prefix) => key.startsWith(prefix))) {
      window.sessionStorage.removeItem(key);
    }
  }
}

async function isolateBatchSessionState(page) {
  await page.evaluate(clearBatchSessionStateForNewRun).catch(() => null);
  await page.addInitScript(clearBatchSessionStateForNewRun);
}

function createBatchApiTimingTracker(expectedFileCount, options = {}) {
  return {
    expectedFileCount,
    jobId: null,
    jobIdSource: null,
    jobIdSnapshot: null,
    jobBinding: options.jobBinding || null,
    allowSessionFallback: options.allowSessionFallback !== false,
    runStartedAtMs: Date.now(),
    firstReviewableMs: null,
    firstReviewableObservedMs: null,
    firstReviewableItemTimestampMs: null,
    firstReviewableTimingMethod: null,
    allRecognitionCompleteMs: null,
    allRecognitionCompleteTimingMethod: null,
    lastStatus: null,
    lastPollAtMs: 0,
    pollErrors: 0,
  };
}

async function updateBatchApiTiming({
  apiBaseUrl,
  token,
  page,
  start,
  tracker,
  force = false,
}) {
  if (!apiBaseUrl || !tracker) return tracker;
  const elapsed = durationMs(start);
  if (!force && elapsed - tracker.lastPollAtMs < BATCH_STATUS_POLL_INTERVAL_MS) return tracker;
  tracker.lastPollAtMs = elapsed;
  try {
    if (!tracker.jobId) {
      const resolution = await getCurrentBatchJobIdFromPage(page, {
        binding: tracker.jobBinding,
        allowSessionFallback: tracker.allowSessionFallback,
        withDetails: true,
      });
      tracker.jobId = resolution.job_id;
      tracker.jobIdSource = resolution.source;
      tracker.jobIdSnapshot = resolution.snapshot;
    }
    if (!tracker.jobId) return tracker;
    const job = await requestJson(`${apiBaseUrl}/jobs/${encodeURIComponent(tracker.jobId)}`, {
      headers: authHeaders(token),
    });
    const status = summarizeBatchRecognitionStatus(job, tracker.expectedFileCount, {
      runStartedAtMs: tracker.runStartedAtMs,
      observedAtMs: tracker.runStartedAtMs + elapsed,
    });
    tracker.lastStatus = status;
    if (status.first_reviewable && tracker.firstReviewableMs === null) {
      const timestampMs = safeTimestampMs(status.first_reviewable_at);
      const fromTimestamp = durationFromAbsoluteTimestamp(timestampMs, tracker.runStartedAtMs, null);
      tracker.firstReviewableObservedMs = elapsed;
      tracker.firstReviewableItemTimestampMs = fromTimestamp;
      tracker.firstReviewableMs = fromTimestamp ?? elapsed;
      tracker.firstReviewableTimingMethod = fromTimestamp !== null ? 'item-timestamp' : 'poll-observed-status';
    }
    if (status.all_recognition_complete) {
      const completeTiming = resolveAllRecognitionCompleteTiming(status, tracker.runStartedAtMs, elapsed);
      if (
        completeTiming.ms !== null &&
        (tracker.allRecognitionCompleteMs === null || completeTiming.ms > tracker.allRecognitionCompleteMs)
      ) {
        tracker.allRecognitionCompleteMs = completeTiming.ms;
        tracker.allRecognitionCompleteTimingMethod = completeTiming.method;
      }
    }
  } catch {
    tracker.pollErrors += 1;
  }
  return tracker;
}

function batchApiTimingSummary(tracker) {
  return {
    job_id: tracker?.jobId || null,
    job_id_source: tracker?.jobIdSource || null,
    job_id_snapshot: tracker?.jobIdSnapshot || null,
    captured_job_ids: Array.isArray(tracker?.jobBinding?.observedJobIds) ? tracker.jobBinding.observedJobIds : [],
    job_id_capture_errors: safeEntityCount(tracker?.jobBinding?.responseErrors),
    first_reviewable_ms: safeDurationMs(tracker?.firstReviewableMs),
    first_reviewable_observed_ms: safeDurationMs(tracker?.firstReviewableObservedMs),
    first_reviewable_item_timestamp_ms: safeDurationMs(tracker?.firstReviewableItemTimestampMs),
    first_reviewable_timing_method: tracker?.firstReviewableTimingMethod || null,
    all_recognition_complete_ms: safeDurationMs(tracker?.allRecognitionCompleteMs),
    all_recognition_complete_timing_method: tracker?.allRecognitionCompleteTimingMethod || null,
    last_status: tracker?.lastStatus || null,
    poll_errors: safeEntityCount(tracker?.pollErrors),
  };
}

async function collectBatchApiEvidence(apiBaseUrl, token, jobId, fileRefs, findings) {
  if (!jobId) {
    const evidence = buildBatchApiEvidence(null, fileRefs);
    appendBatchApiQualityFindings(evidence, findings);
    return evidence;
  }
  try {
    const job = await requestJson(`${apiBaseUrl}/jobs/${encodeURIComponent(jobId)}`, {
      headers: authHeaders(token),
    });
    const evidence = buildBatchApiEvidence(job, fileRefs);
    appendBatchApiQualityFindings(evidence, findings);
    return evidence;
  } catch (error) {
    addFindingOnce(
      findings,
      `Batch API evidence fetch failed for current job_id: ${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }`,
    );
    return {
      job_id: jobId,
      file_count: fileRefs.length,
      api_item_count: 0,
      match_strategy: 'sort_order',
      files: fileRefs.map((ref) => ({
        label: ref.label,
        file_type: 'unknown',
        status: 'unknown',
        entity_count: 0,
      })),
    };
  }
}

async function collectBatchExportVisualEvidence(apiBaseUrl, token, jobId, fileRefs, findings) {
  if (!jobId) {
    const evidence = buildBatchExportVisualEvidence(null, fileRefs);
    appendBatchExportVisualQualityFindings(null, findings);
    return evidence;
  }
  try {
    const report = await requestJson(`${apiBaseUrl}/jobs/${encodeURIComponent(jobId)}/export-report`, {
      headers: authHeaders(token),
    });
    const evidence = buildBatchExportVisualEvidence(report, fileRefs);
    appendBatchExportVisualQualityFindings(evidence, findings);
    return evidence;
  } catch (error) {
    addFindingOnce(
      findings,
      `Batch export visual evidence fetch failed for current job_id: ${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }`,
    );
    return buildBatchExportVisualEvidence(null, fileRefs);
  }
}

function boxNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function flattenBoundingBoxes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((box) => box && typeof box === 'object');
  if (typeof value !== 'object') return [];
  const boxes = [];
  for (const [pageKey, rawBoxes] of Object.entries(value)) {
    if (!Array.isArray(rawBoxes)) continue;
    for (const rawBox of rawBoxes) {
      if (rawBox && typeof rawBox === 'object') {
        boxes.push({ ...rawBox, page: rawBox.page ?? pageKey });
      }
    }
  }
  return boxes;
}

function boxIssueSummary(box, pageCount) {
  const x = boxNumber(box.x);
  const y = boxNumber(box.y);
  const width = boxNumber(box.width);
  const height = boxNumber(box.height);
  const pageNumber = Number(box.page);
  const issues = [];
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) issues.push('page_out_of_range');
  if (x === null || y === null || width === null || height === null) {
    issues.push('invalid_geometry');
    return { issues, area: null, width, height, touches_edge: false };
  }
  if (width <= 0 || height <= 0) issues.push('non_positive_size');
  if (x < -0.002 || y < -0.002 || x + width > 1.002 || y + height > 1.002) issues.push('out_of_bounds');
  const area = Math.max(width, 0) * Math.max(height, 0);
  if (area > MAX_BOX_AREA_RATIO || width > MAX_BOX_WIDTH_RATIO || height > MAX_BOX_HEIGHT_RATIO) issues.push('oversized');
  const touchesEdge = x <= 0.01 || y <= 0.01 || x + width >= 0.99 || y + height >= 0.99;
  return { issues, area, width, height, touches_edge: touchesEdge };
}

export function buildBoxGeometryEvidence(fileInfo, fileRef) {
  const pageCount = safePositiveInteger(fileInfo?.page_count) ?? 1;
  const boxes = flattenBoundingBoxes(fileInfo?.bounding_boxes);
  const byPage = {};
  const byType = {};
  const bySource = {};
  const byEvidenceSource = {};
  const issueCounts = {};
  const aliasLeakTypes = new Set();
  const unknownHasImageTypes = new Set();
  let selectedBoxes = 0;
  let maxArea = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  let edgeTouchingBoxes = 0;
  const sampleIssues = [];
  for (const box of boxes) {
    const pageNumber = Number.isInteger(Number(box.page)) ? Number(box.page) : 0;
    byPage[String(pageNumber)] = (byPage[String(pageNumber)] || 0) + 1;
    const type = normalizeObservedType(box.type);
    byType[type] = (byType[type] || 0) + 1;
    const source = String(box.source || 'unknown');
    if (ENTITY_ALIAS_LEAKS.has(type.toUpperCase()) || (source === 'ocr_has' && /[^\x00-\x7F]/.test(type))) {
      aliasLeakTypes.add(type);
    }
    const evidenceSource = normalizeEvidenceSource(box.evidence_source);
    if (evidenceSource === 'has_image_model' && !HAS_IMAGE_FIXED_SLUGS.has(normalizeHasImageSlug(type))) {
      unknownHasImageTypes.add(type);
    }
    bySource[source] = (bySource[source] || 0) + 1;
    byEvidenceSource[evidenceSource] = (byEvidenceSource[evidenceSource] || 0) + 1;
    if (box.selected !== false) selectedBoxes += 1;
    const geometry = boxIssueSummary(box, pageCount);
    if (geometry.area !== null) maxArea = Math.max(maxArea, geometry.area);
    if (geometry.width !== null) maxWidth = Math.max(maxWidth, geometry.width);
    if (geometry.height !== null) maxHeight = Math.max(maxHeight, geometry.height);
    if (geometry.touches_edge) edgeTouchingBoxes += 1;
    for (const issue of geometry.issues) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
      if (sampleIssues.length < 12) {
        sampleIssues.push({
          id: String(box.id || ''),
          page: pageNumber || null,
          type: String(box.type || ''),
          source,
          issue,
          x: boxNumber(box.x),
          y: boxNumber(box.y),
          width: boxNumber(box.width),
          height: boxNumber(box.height),
        });
      }
    }
  }
  return {
    label: fileRef?.label || null,
    file_id: String(fileInfo?.id || fileRef?.file_id || ''),
    file_type: String(fileInfo?.file_type || fileRef?.file_type || '').toLowerCase(),
    page_count: pageCount,
    total_boxes: boxes.length,
    selected_boxes: selectedBoxes,
    pages_with_boxes: Object.keys(byPage).filter((page) => Number(page) >= 1).length,
    by_page: byPage,
    by_type: byType,
    by_source: bySource,
    by_evidence_source: byEvidenceSource,
    alias_leak_types: Array.from(aliasLeakTypes).sort(),
    unknown_has_image_types: Array.from(unknownHasImageTypes).sort(),
    has_org: Object.keys(byType).some((type) => type.toUpperCase() === 'ORG'),
    has_date: Object.keys(byType).some((type) => type.toUpperCase() === 'DATE'),
    issue_counts: issueCounts,
    issue_count: Object.values(issueCounts).reduce((total, count) => total + count, 0),
    edge_touching_boxes: edgeTouchingBoxes,
    max_area_ratio: safeFraction(maxArea),
    max_width_ratio: safeFraction(maxWidth),
    max_height_ratio: safeFraction(maxHeight),
    sample_issues: sampleIssues,
  };
}

export function appendBoxGeometryQualityFindings(evidence, findings) {
  for (const file of evidence?.files || []) {
    if (file.alias_leak_types?.length > 0) {
      addFindingOnce(findings, `${file.label}: semantic alias type leaked: ${file.alias_leak_types.join(', ')}.`);
    }
    if (file.unknown_has_image_types?.length > 0) {
      addFindingOnce(findings, `${file.label}: non-fixed HaS Image type detected: ${file.unknown_has_image_types.join(', ')}.`);
    }
    if (file.issue_count > 0) {
      addFindingOnce(
        findings,
        `${file.label}: bounding-box geometry issues detected ${JSON.stringify(file.issue_counts)}.`,
      );
    }
    if (String(file.file_type).includes('pdf') && file.total_boxes > 0 && file.pages_with_boxes < file.page_count) {
      addFindingOnce(
        findings,
        `${file.label}: PDF has boxes on ${file.pages_with_boxes}/${file.page_count} pages only.`,
      );
    }
  }
  return evidence;
}

async function collectBoxGeometryEvidence(apiBaseUrl, token, exportEvidence, findings) {
  const visualFiles = (Array.isArray(exportEvidence?.files) ? exportEvidence.files : []).filter((file) => {
    const type = String(file.file_type || '').toLowerCase();
    return file.file_id && file.visual_evidence?.total_boxes > 0 && (type.includes('pdf') || type === 'image');
  });
  const files = [];
  for (const file of visualFiles) {
    try {
      const info = await requestJson(`${apiBaseUrl}/files/${encodeURIComponent(file.file_id)}`, {
        headers: authHeaders(token),
      });
      files.push(buildBoxGeometryEvidence(info, file));
    } catch (error) {
      addFindingOnce(
        findings,
        `${file.label}: bounding-box geometry fetch failed: ${
          error instanceof Error ? error.message.split('\n')[0] : String(error)
        }`,
      );
    }
  }
  const evidence = {
    checked_files: files.length,
    total_boxes: files.reduce((total, file) => total + file.total_boxes, 0),
    total_issues: files.reduce((total, file) => total + file.issue_count, 0),
    files,
  };
  appendBoxGeometryQualityFindings(evidence, findings);
  return evidence;
}

function pageListForVisualFile(file) {
  const pageCount = safePositiveInteger(file?.page_count) ?? 1;
  const issuePages = Array.isArray(file?.visual_review?.issue_pages)
    ? file.visual_review.issue_pages
        .map((page) => Number(page))
        .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount)
    : [];
  const pages = issuePages.length > 0 ? issuePages : Array.from({ length: pageCount }, (_, index) => index + 1);
  return Array.from(new Set(pages)).slice(0, 12);
}

export async function collectPageImagePixelEvidence(page, apiBaseUrl, token, exportEvidence, findings) {
  const files = Array.isArray(exportEvidence?.files) ? exportEvidence.files : [];
  const visualFiles = files.filter((file) => {
    const type = String(file.file_type || '').toLowerCase();
    return file.file_id && file.visual_evidence?.total_boxes > 0 && (type.includes('pdf') || type === 'image');
  });
  const requests = [];
  for (const file of visualFiles) {
    for (const pageNumber of pageListForVisualFile(file)) {
      requests.push({
        label: file.label,
        file_id: file.file_id,
        file_type: file.file_type,
        page: pageNumber,
        visual_boxes: file.visual_evidence.total_boxes,
      });
    }
  }
  if (requests.length === 0) return { checked_pages: 0, pages: [] };

  const result = await page.evaluate(
    async ({ apiBaseUrl: base, token: authToken, requests: pageRequests }) => {
      async function imageDataFor(url) {
        const response = await fetch(url, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('2d canvas unavailable');
        ctx.drawImage(bitmap, 0, 0);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        bitmap.close();
        return { width: canvas.width, height: canvas.height, data: image.data };
      }

      function compareImages(original, redacted) {
        const width = Math.min(original.width, redacted.width);
        const height = Math.min(original.height, redacted.height);
        const total = Math.max(width * height, 1);
        let changed = 0;
        let originalRed = 0;
        let redToWhite = 0;
        let redToNonWhite = 0;
        let redactedNonWhite = 0;
        let redactedDark = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const oi = (y * original.width + x) * 4;
            const ri = (y * redacted.width + x) * 4;
            const or = original.data[oi];
            const og = original.data[oi + 1];
            const ob = original.data[oi + 2];
            const rr = redacted.data[ri];
            const rg = redacted.data[ri + 1];
            const rb = redacted.data[ri + 2];
            const delta = Math.abs(or - rr) + Math.abs(og - rg) + Math.abs(ob - rb);
            if (delta > 45) changed += 1;
            const redLike = or > 150 && og < 135 && ob < 135 && or > og * 1.25 && or > ob * 1.25;
            const redactedWhite = rr > 245 && rg > 245 && rb > 245;
            const nonWhite = rr < 245 || rg < 245 || rb < 245;
            const dark = rr < 120 || rg < 120 || rb < 120;
            if (nonWhite) redactedNonWhite += 1;
            if (dark) redactedDark += 1;
            if (redLike) {
              originalRed += 1;
              if (redactedWhite) redToWhite += 1;
              if (nonWhite) redToNonWhite += 1;
            }
          }
        }
        return {
          width,
          height,
          changed_pixels: changed,
          changed_ratio: changed / total,
          original_red_pixels: originalRed,
          red_to_white_pixels: redToWhite,
          red_to_white_ratio: originalRed > 0 ? redToWhite / originalRed : 0,
          red_to_nonwhite_pixels: redToNonWhite,
          redacted_nonwhite_ratio: redactedNonWhite / total,
          redacted_dark_ratio: redactedDark / total,
        };
      }

      const output = [];
      for (const request of pageRequests) {
        const baseUrl = `${base}/files/${encodeURIComponent(request.file_id)}/page-image?page=${request.page}`;
        const original = await imageDataFor(`${baseUrl}&redacted=false`);
        const redacted = await imageDataFor(`${baseUrl}&redacted=true`);
        output.push({ ...request, ...compareImages(original, redacted) });
      }
      return output;
    },
    { apiBaseUrl, token, requests },
  );

  const pages = Array.isArray(result) ? result : [];
  for (const item of pages) {
    if (item.changed_ratio < MIN_PAGE_CHANGED_PIXEL_RATIO) {
      addFindingOnce(
        findings,
        `${item.label} page ${item.page}: redacted page is visually unchanged despite ${item.visual_boxes} visual boxes.`,
      );
    }
    if (item.original_red_pixels >= 50 && item.red_to_white_ratio > MAX_RED_TO_WHITE_RATIO) {
      addFindingOnce(
        findings,
        `${item.label} page ${item.page}: red stamp-like pixels became mostly white (${Math.round(item.red_to_white_ratio * 100)}%).`,
      );
    }
  }
  return {
    checked_pages: pages.length,
    min_changed_ratio: pages.length ? Math.min(...pages.map((item) => item.changed_ratio)) : null,
    max_red_to_white_ratio: pages.length ? Math.max(...pages.map((item) => item.red_to_white_ratio)) : null,
    pages: pages.map((item) => ({
      label: item.label,
      file_type: item.file_type,
      page: item.page,
      width: item.width,
      height: item.height,
      changed_pixels: safeEntityCount(item.changed_pixels),
      changed_ratio: safeFraction(item.changed_ratio),
      original_red_pixels: safeEntityCount(item.original_red_pixels),
      red_to_white_pixels: safeEntityCount(item.red_to_white_pixels),
      red_to_white_ratio: safeFraction(item.red_to_white_ratio),
      red_to_nonwhite_pixels: safeEntityCount(item.red_to_nonwhite_pixels),
      redacted_nonwhite_ratio: safeFraction(item.redacted_nonwhite_ratio),
      redacted_dark_ratio: safeFraction(item.redacted_dark_ratio),
    })),
  };
}

function addFindingOnce(findings, finding) {
  if (!findings.includes(finding)) findings.push(finding);
}

async function assertNoPageOverflow(page, findings, label) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docClientWidth: doc.clientWidth,
      docClientHeight: doc.clientHeight,
      docScrollWidth: doc.scrollWidth,
      docScrollHeight: doc.scrollHeight,
      bodyScrollWidth: body?.scrollWidth || 0,
      bodyScrollHeight: body?.scrollHeight || 0,
    };
  });
  const maxScrollWidth = Math.max(metrics.docScrollWidth, metrics.bodyScrollWidth);
  const maxScrollHeight = Math.max(metrics.docScrollHeight, metrics.bodyScrollHeight);
  const widthLimit = Math.max(metrics.innerWidth, metrics.docClientWidth) + 2;
  const heightLimit = Math.max(metrics.innerHeight, metrics.docClientHeight) + 2;
  if (maxScrollWidth > widthLimit) {
    addFindingOnce(
      findings,
      `${label}: page has horizontal overflow ${maxScrollWidth}px > ${widthLimit}px.`,
    );
  }
  if (maxScrollHeight > heightLimit) {
    addFindingOnce(
      findings,
      `${label}: page-level vertical overflow ${maxScrollHeight}px > ${heightLimit}px.`,
    );
  }
}

async function assertNoForbiddenVisibleCopy(page, findings, label) {
  const text = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  const forbidden = [
    { name: 'legacy single-file label', test: () => /\bPlayground\b/i.test(text) },
    { name: 'busy service copy', test: () => /\bBusy\b/i.test(text) || text.includes('\u7e41\u5fd9') },
    {
      name: 'old risk review copy',
      test: () =>
        [
          '\u4f18\u5148\u590d\u6838\u98ce\u9669\u9875',
          '\u5fc5\u5ba1\u9875',
          '\u8d28\u91cf\u98ce\u9669\u9875',
          '\u672a\u6d4f\u89c8\u98ce\u9669\u9875',
          '\u672a\u6d4f\u89c8\u547d\u4e2d\u9875',
        ].some((copy) => text.includes(copy)),
    },
  ];
  for (const item of forbidden) {
    if (item.test()) {
      addFindingOnce(findings, `${label}: visible ${item.name} is still present.`);
    }
  }
}
async function assertServiceStatusVisible(page, findings, label) {
  const status = await page.evaluate((minFontPx) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = Array.from(document.querySelectorAll('body *'))
      .filter((element) => visible(element))
      .map((element) => {
        const text = element.innerText || '';
        const rect = element.getBoundingClientRect();
        return { element, text, rect, area: rect.width * rect.height };
      })
      .filter(
        (item) =>
          item.text.includes('\u670d\u52a1\u72b6\u6001') ||
          item.text.includes('\u672c\u5730\u670d\u52a1') ||
          item.text.includes('\u6a21\u578b\u670d\u52a1') ||
          /Local service/i.test(item.text),
      )
      .sort((a, b) => a.area - b.area);
    const candidate = candidates[0];
    if (!candidate) return { found: false };
    const textNodes = Array.from(candidate.element.querySelectorAll('*'))
      .filter((element) => visible(element) && (element.textContent || '').trim())
      .map((element) => Number.parseFloat(window.getComputedStyle(element).fontSize || '0'))
      .filter((fontSize) => Number.isFinite(fontSize) && fontSize > 0);
    const rootFont = Number.parseFloat(window.getComputedStyle(candidate.element).fontSize || '0');
    const minFont = Math.min(...textNodes, rootFont || minFontPx);
    return {
      found: true,
      width: Math.round(candidate.rect.width),
      height: Math.round(candidate.rect.height),
      minFont,
    };
  }, MIN_SERVICE_STATUS_FONT_PX);

  if (!status.found) {
    addFindingOnce(findings, `${label}: local service status summary is not visible.`);
    return;
  }
  if (status.minFont < MIN_SERVICE_STATUS_FONT_PX) {
    addFindingOnce(
      findings,
      `${label}: local service status text is too small (${status.width}x${status.height}, min font ${status.minFont}px).`,
    );
  }
}

async function assertOverlayBoxesNotOversized(page, findings, label) {
  const audit = await page.evaluate((maxAreaRatio) => {
    const preview = document.querySelector('[aria-label="Image redaction preview (read-only)"]');
    if (!(preview instanceof HTMLElement)) return { checked: 0, oversized: [] };
    const previewRect = preview.getBoundingClientRect();
    const previewArea = Math.max(previewRect.width * previewRect.height, 1);
    const boxes = Array.from(
      preview.querySelectorAll('div[style*="left"][style*="top"][style*="width"][style*="height"]'),
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 4 &&
        rect.height > 4 &&
        style.position === 'absolute' &&
        style.borderStyle !== 'none'
      );
    });
    const oversized = boxes
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const areaRatio = (rect.width * rect.height) / previewArea;
        const widthRatio = rect.width / Math.max(previewRect.width, 1);
        const heightRatio = rect.height / Math.max(previewRect.height, 1);
        return { index, areaRatio, widthRatio, heightRatio };
      })
      .filter(
        (box) =>
          box.areaRatio > maxAreaRatio ||
          box.widthRatio > 0.85 ||
          box.heightRatio > 0.85,
      );
    return { checked: boxes.length, oversized };
  }, MAX_OVERLAY_BOX_AREA_RATIO);

  for (const box of audit.oversized) {
    addFindingOnce(
      findings,
      `${label}: overlay box ${box.index} is oversized (area ${(box.areaRatio * 100).toFixed(1)}%).`,
    );
  }
}

async function assertRedactedPreviewHasVisibleMask(page, findings, label) {
  const mask = await page.evaluate(async (minRunPx) => {
    const visible = (image) => {
      const rect = image.getBoundingClientRect();
      const style = window.getComputedStyle(image);
      return rect.width > 20 && rect.height > 20 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const images = Array.from(document.images).filter((image) => {
      const isRedactedAlt = /鍖垮悕鍖栫粨鏋渱Redacted result/i.test(image.alt || '');
      const isNonEditorPreview = !image.closest('[aria-label="Image redaction preview (read-only)"]');
      return visible(image) && (isRedactedAlt || isNonEditorPreview);
    });
    const image = images.at(-1);
    if (!image) return { found: false };
    if (!image.complete) {
      await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', reject, { once: true });
      });
    }
    const originalImage = [...images]
      .slice(0, -1)
      .reverse()
      .find((candidate) => candidate.naturalWidth === image.naturalWidth && candidate.naturalHeight === image.naturalHeight);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { found: true, readable: false };
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, width, height).data;
    const minX = Math.floor(width * 0.05);
    const maxX = Math.ceil(width * 0.95);
    const minY = Math.floor(height * 0.05);
    const maxY = Math.ceil(height * 0.95);
    const columnRuns = new Uint16Array(width);
    const changedColumnRuns = new Uint16Array(width);
    const softColumnRuns = new Uint16Array(width);
    let maxHorizontalRun = 0;
    let maxVerticalRun = 0;
    let maxChangedHorizontalRun = 0;
    let maxChangedVerticalRun = 0;
    let maxSoftHorizontalRun = 0;
    let maxSoftVerticalRun = 0;
    let darkPixels = 0;
    let changedPixels = 0;
    let softMaskPixels = 0;
    let originalData = null;
    if (originalImage) {
      const originalCanvas = document.createElement('canvas');
      originalCanvas.width = width;
      originalCanvas.height = height;
      const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
      if (originalContext) {
        originalContext.drawImage(originalImage, 0, 0);
        originalData = originalContext.getImageData(0, 0, width, height).data;
      }
    }
    for (let y = minY; y < maxY; y += 1) {
      let rowRun = 0;
      let changedRowRun = 0;
      let softRowRun = 0;
      for (let x = minX; x < maxX; x += 1) {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const dark = alpha > 200 && data[offset] < 35 && data[offset + 1] < 35 && data[offset + 2] < 35;
        const maxChannel = Math.max(red, green, blue);
        const minChannel = Math.min(red, green, blue);
        const softMask =
          alpha > 200 &&
          maxChannel < 246 &&
          minChannel > 90 &&
          maxChannel - minChannel < 65;
        const changed =
          originalData &&
          alpha > 200 &&
          Math.abs(data[offset] - originalData[offset]) +
            Math.abs(data[offset + 1] - originalData[offset + 1]) +
            Math.abs(data[offset + 2] - originalData[offset + 2]) >
            60;
        if (dark) {
          darkPixels += 1;
          rowRun += 1;
          columnRuns[x] += 1;
          if (rowRun > maxHorizontalRun) maxHorizontalRun = rowRun;
          if (columnRuns[x] > maxVerticalRun) maxVerticalRun = columnRuns[x];
        } else {
          rowRun = 0;
          columnRuns[x] = 0;
        }
        if (softMask) {
          softMaskPixels += 1;
          softRowRun += 1;
          softColumnRuns[x] += 1;
          if (softRowRun > maxSoftHorizontalRun) maxSoftHorizontalRun = softRowRun;
          if (softColumnRuns[x] > maxSoftVerticalRun) maxSoftVerticalRun = softColumnRuns[x];
        } else {
          softRowRun = 0;
          softColumnRuns[x] = 0;
        }
        if (changed) {
          changedPixels += 1;
          changedRowRun += 1;
          changedColumnRuns[x] += 1;
          if (changedRowRun > maxChangedHorizontalRun) maxChangedHorizontalRun = changedRowRun;
          if (changedColumnRuns[x] > maxChangedVerticalRun) maxChangedVerticalRun = changedColumnRuns[x];
        } else {
          changedRowRun = 0;
          changedColumnRuns[x] = 0;
        }
      }
    }
    const darkMaskPassed = maxHorizontalRun >= minRunPx && maxVerticalRun >= minRunPx;
    const mosaicMaskPassed =
      Boolean(originalData) &&
      changedPixels >= minRunPx * minRunPx &&
      maxChangedHorizontalRun >= minRunPx &&
      maxChangedVerticalRun >= minRunPx;
    const softMaskPassed =
      softMaskPixels >= minRunPx * minRunPx &&
      maxSoftHorizontalRun >= minRunPx &&
      maxSoftVerticalRun >= minRunPx;
    return {
      found: true,
      readable: true,
      width,
      height,
      darkPixels,
      changedPixels,
      softMaskPixels,
      maxHorizontalRun,
      maxVerticalRun,
      maxChangedHorizontalRun,
      maxChangedVerticalRun,
      maxSoftHorizontalRun,
      maxSoftVerticalRun,
      passed: darkMaskPassed || mosaicMaskPassed || softMaskPassed,
    };
  }, MIN_REDACTION_DARK_RUN_PX).catch((error) => ({
    found: true,
    readable: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (!mask.found) {
    addFindingOnce(findings, `${label}: redacted image preview is not visible.`);
  } else if (!mask.readable) {
    addFindingOnce(findings, `${label}: redacted image preview could not be sampled.`);
  } else if (!mask.passed) {
    addFindingOnce(
      findings,
      `${label}: no visible redaction mask found in redacted preview (dark ${mask.maxHorizontalRun}x${mask.maxVerticalRun}, changed ${mask.maxChangedHorizontalRun}x${mask.maxChangedVerticalRun}, soft ${mask.maxSoftHorizontalRun}x${mask.maxSoftVerticalRun}).`,
    );
  }
}

async function assertLiveUiVisualState(page, findings, label) {
  await assertNoPageOverflow(page, findings, label);
  await assertNoForbiddenVisibleCopy(page, findings, label);
  await assertServiceStatusVisible(page, findings, label);
}

async function screenshot(page, outDir, name, findings) {
  if (findings) await assertLiveUiVisualState(page, findings, name);
  const target = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function clickIfEnabled(locator, timeout = 1000, options = {}) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    const count = await locator.count();
    for (let index = 0; index < Math.max(1, count); index += 1) {
      const candidate = count > 1 ? locator.nth(index) : locator;
      if (!(await candidate.isVisible().catch(() => false))) continue;
      if (!(await candidate.isEnabled().catch(() => false))) continue;
      await candidate.scrollIntoViewIfNeeded().catch(() => null);
      await candidate.click({ force: options.force === true, timeout: Math.max(timeout, 3000) });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function clickIfCurrentlyEnabled(locator, options = {}) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = count > 1 ? locator.nth(index) : locator;
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (!(await candidate.isEnabled().catch(() => false))) continue;
    await candidate.scrollIntoViewIfNeeded().catch(() => null);
    await candidate.click({ force: options.force === true, timeout: 3000 });
    return true;
  }
  return false;
}

async function clickFirstEnabled(locators, timeout = 1000, options = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    for (const locator of locators) {
      if (await clickIfEnabled(locator, 250, options)) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

export async function clickVisibleButtonByText(page, labels) {
  return page.evaluate((candidateLabels) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, '');
    const wanted = candidateLabels.map(normalize);
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const button of buttons) {
      const text = normalize(button.textContent);
      const matches = wanted.some((label) => text === label || text.includes(label));
      if (!matches) continue;
      const style = window.getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      const disabled =
        button.disabled ||
        button.getAttribute('aria-disabled') === 'true' ||
        style.pointerEvents === 'none';
      if (disabled || style.visibility === 'hidden' || style.display === 'none') continue;
      if (rect.width <= 0 || rect.height <= 0) continue;
      button.scrollIntoView({ block: 'center', inline: 'center' });
      button.click();
      return true;
    }
    return false;
  }, labels);
}

async function clickVisibleReviewAction(page, findings, reviewActions, options = {}) {
  const immediateActions = [
    { action: 'confirm', locators: [page.getByTestId('confirm-redact')], options: { force: true } },
    { action: 'next-required-page', locators: [page.getByTestId('review-next-required-page')] },
    { action: 'next-page', locators: [page.getByTestId('review-page-next')] },
    { action: 'next-file', locators: [page.getByTestId('review-next')] },
    { action: 'go-export', locators: [page.getByTestId('go-export')], options: { force: true } },
  ];
  for (const candidate of immediateActions) {
    for (const locator of candidate.locators) {
      if (await clickIfCurrentlyEnabled(locator, candidate.options || {})) {
        reviewActions.push(candidate.action);
        return true;
      }
    }
  }
  const fallbackActions = [
    { action: 'confirm', locators: [page.getByTestId('confirm-redact')], timeout: 2500, options: { force: true } },
    { action: 'next-required-page', locators: [page.getByTestId('review-next-required-page')], timeout: 1000 },
    {
      action: 'next-page',
      locators: [
        page.getByTestId('review-page-next'),
        page.getByRole('button', { name: /\u4e0b\u4e00\u9875/ }),
      ],
      timeout: 1000,
    },
    { action: 'next-file', locators: [page.getByTestId('review-next')], timeout: 1000 },
    { action: 'go-export', locators: [page.getByTestId('go-export')], timeout: 1500, options: { force: true } },
  ];
  for (const candidate of fallbackActions) {
    if (await clickFirstEnabled(candidate.locators, candidate.timeout, candidate.options || {})) {
      reviewActions.push(candidate.action);
      return true;
    }
  }
  const domFallbackActions = [
    { action: 'confirm', labels: ['\u786e\u8ba4\u533f\u540d\u5316'] },
    { action: 'next-required-page', labels: ['\u4e0b\u4e00\u4e2a\u5fc5\u5ba1\u9875'] },
    { action: 'next-page', labels: ['\u4e0b\u4e00\u9875'] },
    { action: 'next-file', labels: ['\u4e0b\u4e00\u4efd'] },
    { action: 'go-export', labels: ['\u8fdb\u5165\u5bfc\u51fa'] },
  ];
  for (const candidate of domFallbackActions) {
    if (await clickVisibleButtonByText(page, candidate.labels)) {
      reviewActions.push(candidate.action);
      return true;
    }
  }
  if (options.reportNoAction !== false) {
    findings.push('Batch review loop had no enabled next/confirm/export action.');
  }
  return false;
}
async function waitAfterReviewAction(page, fallbackTimeoutMs = 150) {
  try {
    await Promise.race([
      page.getByTestId('batch-step5-export').waitFor({ timeout: 500 }),
      page.waitForLoadState('networkidle', { timeout: 500 }),
      page.waitForTimeout(fallbackTimeoutMs),
    ]);
  } catch {
    await page.waitForTimeout(fallbackTimeoutMs);
  }
}

async function waitForBatchReviewContentReady(page) {
  await page.getByTestId('batch-step4-review').waitFor({ timeout: 900_000 });
  await page.waitForFunction(
    () => {
      const visible = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const loadingVisible = visible('[data-testid="batch-step4-content-loading"]');
      const errorVisible = visible('[data-testid="batch-step4-load-error"]');
      const textContentVisible =
        visible('[data-testid="select-all-entities"]') ||
        visible('[data-testid="review-entity-empty"]');
      const imageContentVisible =
        visible('[data-testid="review-image-tab-original"]') ||
        visible('[data-testid="review-image-pipeline-quality"]') ||
        visible('[data-testid="review-image-empty-regions"]');
      return errorVisible || (!loadingVisible && (textContentVisible || imageContentVisible));
    },
    null,
    { timeout: 30_000 },
  );
}

async function waitForSingleResult(page) {
  await Promise.race([
    page.getByTestId('playground-result').waitFor({ timeout: SINGLE_RESULT_TIMEOUT_MS }),
    page.getByTestId('playground-redact-btn').waitFor({ timeout: SINGLE_RESULT_TIMEOUT_MS }),
    page.getByTestId('playground-entity-panel').waitFor({ timeout: SINGLE_RESULT_TIMEOUT_MS }),
  ]);
}

async function expectNoOldRiskCopy(page, findings) {
  const oldCopy = [
    '\u4f18\u5148\u590d\u6838\u98ce\u9669\u9875',
    '\u5fc5\u5ba1\u9875',
    '\u8d28\u91cf\u98ce\u9669\u9875',
    '\u672a\u6d4f\u89c8\u98ce\u9669\u9875',
    '\u672a\u6d4f\u89c8\u547d\u4e2d\u9875',
  ];
  const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  for (const text of oldCopy) {
    if (bodyText.includes(text)) findings.push(`Old risk-review copy still visible: ${text}`);
  }
}
async function runSingleFlow(page, outDir, baseUrl, singleImage, findings) {
  const start = performance.now();
  const phaseStart = performance.now();
  const phases = {};
  await page.goto(`${baseUrl}/single`);
  await page.getByTestId('playground-upload').waitFor({ timeout: 30_000 });
  phases.open_ms = durationMs(phaseStart);
  await screenshot(page, outDir, 'single-01-upload', findings);

  const uploadStart = performance.now();
  await page.locator('[data-testid="playground-dropzone"] input[type="file"]').setInputFiles(singleImage);
  await page.getByTestId('playground-loading').waitFor({ timeout: 30_000 });
  phases.upload_to_loading_ms = durationMs(uploadStart);
  const recognitionStart = performance.now();
  const loadingUrl = page.url();
  if (!/\/single(?:$|\?)/.test(new URL(loadingUrl).pathname + new URL(loadingUrl).search)) {
    findings.push(`Single flow changed URL while loading: ${loadingUrl}`);
  }
  await screenshot(page, outDir, 'single-02-loading', findings);

  await waitForSingleResult(page);
  const recognitionElapsedMs = durationMs(recognitionStart);
  if (recognitionElapsedMs >= SINGLE_SLOW_WARNING_MS) {
    findings.push(
      `Single image recognition was slow: ${recognitionElapsedMs}ms >= ${SINGLE_SLOW_WARNING_MS}ms.`,
    );
  }
  await expectNoOldRiskCopy(page, findings);
  const counts = await waitForSingleDetectionItems(page);
  const inferredBoxes =
    counts.boxCount === 0 && counts.visibleTotal > counts.entityCount
      ? counts.visibleTotal - counts.entityCount
      : counts.boxCount;
  const boxCount = Math.max(counts.boxCount, inferredBoxes);
  const entityCount = counts.entityCount;
  await assertOverlayBoxesNotOversized(page, findings, 'single-03-result');
  await screenshot(page, outDir, 'single-03-result', findings);

  const rerun = page.getByTestId('playground-rerun-btn');
  if (await clickIfEnabled(rerun, 2000)) {
    await page.getByTestId('playground-loading').waitFor({ timeout: 10_000 }).catch(() => null);
    const cancelClicked = await clickIfEnabled(page.getByTestId('playground-cancel-processing'), 3000);
    if (!cancelClicked) {
      summaryNote(findings, 'Single rerun finished before cancel could be clicked.');
    }
    await waitForSingleResult(page);
    const afterCancelCounts = await waitForSingleDetectionItems(page);
    const afterCancelBoxes =
      afterCancelCounts.boxCount === 0 && afterCancelCounts.visibleTotal > afterCancelCounts.entityCount
        ? afterCancelCounts.visibleTotal - afterCancelCounts.entityCount
        : afterCancelCounts.boxCount;
    if (cancelClicked && boxCount > 0 && afterCancelBoxes === 0) {
      findings.push('Canceling single rerun cleared previous visual results.');
    }
    await assertOverlayBoxesNotOversized(page, findings, 'single-04-rerun-cancel');
    await screenshot(page, outDir, 'single-04-rerun-cancel', findings);
  }

  const redact = page.getByTestId('playground-redact-btn');
  if (await clickIfEnabled(redact, 2000)) {
    const redactStart = performance.now();
    await page.getByTestId('playground-download').waitFor({ timeout: 120_000 });
    phases.redaction_ms = durationMs(redactStart);
    await assertRedactedPreviewHasVisibleMask(page, findings, 'single-05-redacted');
    await screenshot(page, outDir, 'single-05-redacted', findings);
  } else {
    findings.push('Single redact button was not enabled after recognition.');
  }

  return {
    elapsed_ms: durationMs(start),
    recognition_elapsed_ms: recognitionElapsedMs,
    phases,
    image: privateFileRef(singleImage, 0),
    box_count: boxCount,
    entity_count: entityCount,
  };
}

function summaryNote(findings, note) {
  if (process.env.EVAL_LIVE_UI_VERBOSE_NOTES === '1') {
    findings.push(note);
  }
}

async function runBatchFlow(page, outDir, baseUrl, apiBaseUrl, authToken, batchFiles, findings) {
  const start = performance.now();
  const phases = {};
  const phaseEvents = {};
  await isolateBatchSessionState(page);
  const batchJobBinding = createBatchJobBinding();
  const detachBatchJobCapture = attachBatchJobIdCapture(page, batchJobBinding);
  const step3JobsRequestMonitor = createStep3JobsRequestMonitor(page);
  const openStart = performance.now();
  await page.goto(`${baseUrl}/batch`);
  await page.getByTestId('batch-hub-title').waitFor({ timeout: 30_000 });
  phases.open_hub_ms = durationMs(openStart);
  await screenshot(page, outDir, 'batch-01-hub', findings);
  const step1Start = performance.now();
  await page.getByTestId('batch-launch-smart').click();

  await page.getByTestId('batch-step1-config').waitFor({ timeout: 30_000 });
  phases.open_step1_ms = durationMs(step1Start);
  await screenshot(page, outDir, 'batch-02-step1', findings);
  await expectNoOldRiskCopy(page, findings);
  const step2Start = performance.now();
  await clickIfEnabled(page.getByTestId('confirm-step1'), 3000);
  await page.getByTestId('advance-upload').click();

  await page.getByTestId('batch-step2-upload').waitFor({ timeout: 30_000 });
  phases.open_step2_ms = durationMs(step2Start);
  await screenshot(page, outDir, 'batch-03-step2-empty', findings);
  const uploadStart = performance.now();
  await page.locator('[data-testid="drop-zone"] input[type="file"]').setInputFiles(batchFiles);
  await page.getByTestId('step2-next').waitFor({ timeout: 30_000 });
  phases.upload_files_ms = durationMs(uploadStart);
  const step3Start = performance.now();
  await page.getByTestId('step2-next').click();

  await page.getByTestId('batch-step3-recognize').waitFor({ timeout: 30_000 });
  phases.open_step3_ms = durationMs(step3Start);
  await screenshot(page, outDir, 'batch-04-step3-before-submit', findings);
  const recognitionStart = performance.now();
  const apiTimingTracker = createBatchApiTimingTracker(batchFiles.length, { jobBinding: batchJobBinding });
  step3JobsRequestMonitor.markStart(recognitionStart);
  await page.getByTestId('submit-queue').click();
  const recognitionDeadline = Date.now() + 900_000;
  let step3NextEnabledObserved = false;
  const step3WaitDomSamples = [];
  let apiTimingUpdateInFlight = null;
  const pumpApiTiming = (force = false) => {
    if (apiTimingUpdateInFlight && !force) return;
    const updatePromise = updateBatchApiTiming({
      apiBaseUrl,
      token: authToken,
      page,
      start: recognitionStart,
      tracker: apiTimingTracker,
      force,
    }).catch(() => {
      apiTimingTracker.pollErrors += 1;
    });
    const trackedPromise = updatePromise.finally(() => {
      if (apiTimingUpdateInFlight === trackedPromise) apiTimingUpdateInFlight = null;
    });
    apiTimingUpdateInFlight = trackedPromise;
  };
  while (Date.now() <= recognitionDeadline) {
    pumpApiTiming();
    const domSample = await collectStep3WaitDomSample(page, performance.now() - recognitionStart);
    step3WaitDomSamples.push(domSample);
    const nextEnabled =
      domSample.step3_next.present === true &&
      domSample.step3_next.data_reviewable === true &&
      domSample.step3_next.disabled !== true;
    if (nextEnabled) {
      step3NextEnabledObserved = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  if (!step3NextEnabledObserved) {
    await page.waitForFunction(
      () => {
        const button = document.querySelector('[data-testid="step3-next"]');
        const reviewable = button?.getAttribute('data-reviewable') === 'true';
        const disabled =
          button instanceof HTMLButtonElement
            ? button.disabled
            : button?.getAttribute('aria-disabled') === 'true';
        return Boolean(button) && reviewable && !disabled;
      },
      null,
      { timeout: 30_000 },
    );
    step3WaitDomSamples.push(await collectStep3WaitDomSample(page, performance.now() - recognitionStart));
  }
  phases.recognition_wait_ms = durationMs(recognitionStart);
  phaseEvents.first_reviewable_ui_ms = phases.recognition_wait_ms;
  await updateBatchApiTiming({
    apiBaseUrl,
    token: authToken,
    page,
    start: recognitionStart,
    tracker: apiTimingTracker,
    force: true,
  });
  const reviewOpenStart = performance.now();
  await page.getByTestId('step3-next').click();
  await page.getByTestId('batch-step4-review').waitFor({ timeout: 900_000 });
  phases.open_step4_ms = durationMs(reviewOpenStart);
  phaseEvents.review_open_from_submit_ms = durationMs(recognitionStart);
  await updateBatchApiTiming({
    apiBaseUrl,
    token: authToken,
    page,
    start: recognitionStart,
    tracker: apiTimingTracker,
    force: true,
  });
  const reviewContentStart = performance.now();
  await waitForBatchReviewContentReady(page);
  phases.open_step4_content_ms = durationMs(reviewContentStart);
  await screenshot(page, outDir, 'batch-05-step4-ready', findings);
  await expectNoOldRiskCopy(page, findings);

  const reviewActions = [];
  const reviewStart = performance.now();
  const reviewDeadline = Date.now() + BATCH_REVIEW_TIMEOUT_MS;
  let idleReviewPolls = 0;
  let reviewBlockedWaitMs = 0;
  while (Date.now() <= reviewDeadline) {
    if (await page.getByTestId('batch-step5-export').count()) break;
    await updateBatchApiTiming({
      apiBaseUrl,
      token: authToken,
      page,
      start: recognitionStart,
      tracker: apiTimingTracker,
    });
    const actionProbeStart = performance.now();
    if (!(await clickVisibleReviewAction(page, findings, reviewActions, { reportNoAction: false }))) {
      idleReviewPolls += 1;
      await waitAfterReviewAction(page, 1000);
      reviewBlockedWaitMs += Math.round(performance.now() - actionProbeStart);
      continue;
    }
    idleReviewPolls = 0;
    if (reviewActions.at(-1) === 'go-export') {
      await page.getByTestId('batch-step5-export').waitFor({ timeout: 120_000 });
      break;
    }
    await waitAfterReviewAction(page);
    await updateBatchApiTiming({
      apiBaseUrl,
      token: authToken,
      page,
      start: recognitionStart,
      tracker: apiTimingTracker,
    });
  }
  phases.review_actions_ms = durationMs(reviewStart);
  phases.review_idle_polls = idleReviewPolls;
  phases.review_blocked_wait_ms = reviewBlockedWaitMs;
  await updateBatchApiTiming({
    apiBaseUrl,
    token: authToken,
    page,
    start: recognitionStart,
    tracker: apiTimingTracker,
    force: true,
  });

  const exportStart = performance.now();
  if (!(await page.getByTestId('batch-step5-export').count())) {
    findings.push('Batch review did not reach export before the review timeout.');
  }
  await page.getByTestId('batch-step5-export').waitFor({ timeout: 120_000 });
  phases.open_step5_ms = durationMs(exportStart);
  if (!reviewActions.includes('confirm')) {
    findings.push('Batch review reached export without any confirm action.');
  }
  if (!reviewActions.includes('go-export')) {
    findings.push('Batch review reached export without using the export action.');
  }
  await expectNoOldRiskCopy(page, findings);
  await screenshot(page, outDir, 'batch-06-step5-export', findings);

  const fileRefs = batchFiles.map((file, index) => privateFileRef(file, index));
  const apiTiming = batchApiTimingSummary(apiTimingTracker);
  await step3JobsRequestMonitor.flush();
  const phaseEvidence = {
    step3_wait_dom: compactStep3WaitDomEvidence(step3WaitDomSamples),
    step3_jobs_requests: step3JobsRequestMonitor.evidence(),
  };
  step3JobsRequestMonitor.detach();
  detachBatchJobCapture();
  return {
    elapsed_ms: durationMs(start),
    phases,
    phase_events: phaseEvents,
    api_timing: apiTiming,
    phase_evidence: phaseEvidence,
    phase_diagnostics: buildBatchPhaseDiagnostics({
      phases,
      phase_events: phaseEvents,
      api_timing: apiTiming,
      phase_evidence: phaseEvidence,
    }),
    job_id: apiTiming.job_id || await getCurrentBatchJobIdFromPage(page, { binding: batchJobBinding }),
    file_count: batchFiles.length,
    files: fileRefs,
    review_actions: reviewActions,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outDir, { recursive: true });
  const files = await resolveCeshiFiles(args.ceshiDir);
  if (args.dryRun) {
    const plan = {
      mode: 'dry-run',
      base_url: args.baseUrl,
      api_base_url: args.apiBaseUrl,
      private_corpus_dir_sha256: shortHash(path.resolve(args.ceshiDir)),
      out_dir: args.outDir,
      single_image: privateFileRef(files.singleImage, 0),
      batch_files: files.batchFiles.map((file, index) => privateFileRef(file, index)),
      browser_checks: [
        'page overflow at 1920x1080',
        'visible legacy single-file label / busy-state / risk-review copy',
        'local service status visibility and minimum font size',
        'single-image overlay box area ratio',
        'single-image redacted preview visible mask (solid or mosaic)',
        'batch review confirm-to-export action sequence',
        'batch API evidence keeps scanned PDF/image entity counts after review draft commits',
        'batch export visual evidence and original-vs-redacted page pixel comparison',
      ],
      skipped: {
        browser: true,
        upload: true,
        recognition: true,
        reason: 'dry-run only validates local file selection and prints the browser-flow plan',
      },
    };
    await writeFile(path.join(args.outDir, 'dry-run.json'), JSON.stringify(plan, null, 2), 'utf8');
    console.log(`dry-run: ${path.join(args.outDir, 'dry-run.json')}`);
    console.log(`single=${plan.single_image.label} batch=${plan.batch_files.length}`);
    return;
  }
  assertLiveUiGpuPreflight({ allowGpuBusy: args.allowGpuBusy });
  await ensureReachable(args.baseUrl);

  const summary = {
    generated_at: new Date().toISOString(),
    base_url: args.baseUrl,
    api_base_url: args.apiBaseUrl,
    out_dir: args.outDir,
    findings: [],
    console: [],
    page_errors: [],
    failed_requests: [],
  };

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1920, height: 1080 },
  });
  const authToken = await authenticateBrowserContext(context, args.baseUrl, args.apiBaseUrl, summary);
  const page = await context.newPage();
  const requestFailureStart = performance.now();
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      summary.console.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => summary.page_errors.push(String(error)));
  page.on('requestfailed', (request) => {
    const postData = request.postData() || '';
    let frameUrl = null;
    try {
      frameUrl = request.frame()?.url() || null;
    } catch {
      frameUrl = null;
    }
    summary.failed_requests.push({
      method: request.method(),
      url: sanitizeFailedRequestUrl(request.url()),
      failure: request.failure()?.errorText || '',
      resource_type: request.resourceType(),
      is_navigation_request: request.isNavigationRequest(),
      frame_url: frameUrl ? sanitizeFailedRequestUrl(frameUrl) : null,
      post_data_bytes: postData ? Buffer.byteLength(postData) : 0,
      post_data_hash: postData ? shortHash(postData) : null,
      elapsed_ms: durationMs(requestFailureStart),
    });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('onboarding_completed', 'true');
  });

  try {
    summary.single = await runSingleFlow(
      page,
      args.outDir,
      args.baseUrl,
      files.singleImage,
      summary.findings,
    );
    summary.batch = await runBatchFlow(
      page,
      args.outDir,
      args.baseUrl,
      args.apiBaseUrl,
      authToken,
      files.batchFiles,
      summary.findings,
    );
    summary.batch.api_evidence = await collectBatchApiEvidence(
      args.apiBaseUrl,
      authToken,
      summary.batch.job_id,
      summary.batch.files,
      summary.findings,
    );
    summary.batch.export_visual_evidence = await collectBatchExportVisualEvidence(
      args.apiBaseUrl,
      authToken,
      summary.batch.job_id,
      summary.batch.files,
      summary.findings,
    );
    summary.batch.box_geometry_evidence = await collectBoxGeometryEvidence(
      args.apiBaseUrl,
      authToken,
      summary.batch.export_visual_evidence,
      summary.findings,
    );
    summary.batch.page_pixel_evidence = await collectPageImagePixelEvidence(
      page,
      args.apiBaseUrl,
      authToken,
      summary.batch.export_visual_evidence,
      summary.findings,
    );
    finalizeSummary(summary);
  } catch (error) {
    summary.passed = false;
    summary.error = error instanceof Error ? error.stack || error.message : String(error);
    try {
      await screenshot(page, args.outDir, 'failure');
    } catch {
      // ignore screenshot failures while unwinding
    }
  } finally {
    finalizeSummary(summary);
    await writeFile(path.join(args.outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    await browser.close();
  }

  console.log(`summary: ${path.join(args.outDir, 'summary.json')}`);
  console.log(`passed=${summary.passed} findings=${summary.findings.length}`);
  if (!summary.passed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
