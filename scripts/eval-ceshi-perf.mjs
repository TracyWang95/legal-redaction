#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { authHeaders, requestJson, resolveAuthToken, resolveEvalEnv, tryRequestJson } from './eval-auth.mjs';

const DEFAULT_API = 'http://127.0.0.1:8000/api/v1';
const DEFAULT_OUT_DIR = path.join('output', 'playwright', 'eval-ceshi-perf-current');
const PRIVATE_CORPUS_ENV = 'EVAL_CESHI_DIR';
const PRIVATE_PDF_PLACEHOLDER = '<private-corpus-pdf>';
const DEFAULT_EXCLUDED_HAS_IMAGE_IDS = new Set(['paper']);

function usage() {
  console.log(`Usage:
  DATAINFRA_TOKEN_FILE=tmp/eval-token.txt node scripts/eval-ceshi-perf.mjs
  node scripts/eval-ceshi-perf.mjs [pdf-path] [output-dir]
  node scripts/eval-ceshi-perf.mjs --dry-run
  node scripts/eval-ceshi-perf.mjs --preflight

Measures the six-page private PDF performance path without touching UI code:
  upload local-read/http time
  parse time
  forced per-page vision time with include_result_image=false
  expected vision cache-hit time with include_result_image=false
  vision concurrency 1/2/3
  preview-image request time

Options:
  --pages 1-6                 Pages to measure, default env EVAL_CESHI_PERF_PAGES or 1-6
  --concurrency 1,2,3          Vision concurrency matrix, default env EVAL_CESHI_PERF_CONCURRENCY or 1,2,3
  --preview-concurrency 1,2,3  Preview concurrency matrix, default env EVAL_CESHI_PERF_PREVIEW_CONCURRENCY or same as --concurrency
  --cache-concurrency 3        Expected cache-hit pass concurrency, default env EVAL_CESHI_PERF_CACHE_CONCURRENCY or max concurrency
  --out-dir path               Output directory; useful when omitting pdf-path
  --dry-run                    Print the plan only; no network calls
  --preflight                  Check input/API readiness without reading login token or uploading files

Env:
  EVAL_CESHI_PERF_PDF          Private PDF path.
  EVAL_CESHI_DIR               Directory used to discover the first private PDF when EVAL_CESHI_PERF_PDF is unset.
  DATAINFRA_API                API base, default ${DEFAULT_API}
  DATAINFRA_PASSWORD           Login password for local auth
  DATAINFRA_TOKEN              Existing Bearer token
  DATAINFRA_TOKEN_FILE         File containing a Bearer token
  EVAL_OCR_TYPES               Comma-separated OCR+HaS type ids; default reads /vision-pipelines
  EVAL_IMAGE_TYPES             Comma-separated HaS Image type ids; default reads /vision-pipelines excluding paper
  EVAL_REPORT_INCLUDE_PRIVATE_DETAILS=1  Include raw input path in local-only artifacts
`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  let pages = process.env.EVAL_CESHI_PERF_PAGES || '1-6';
  let concurrency = process.env.EVAL_CESHI_PERF_CONCURRENCY || '1,2,3';
  let previewConcurrency = process.env.EVAL_CESHI_PERF_PREVIEW_CONCURRENCY || '';
  let cacheConcurrency = process.env.EVAL_CESHI_PERF_CACHE_CONCURRENCY || '';
  let explicitOutDir = '';
  const dryRun = argv.includes('--dry-run') || process.env.npm_config_dry_run === 'true';
  const preflight = argv.includes('--preflight') || process.env.npm_config_preflight === 'true';
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') continue;
    if (arg === '--preflight') continue;
    if (arg === '--pages') {
      pages = argv[++index] || pages;
      continue;
    }
    if (arg.startsWith('--pages=')) {
      pages = arg.slice('--pages='.length);
      continue;
    }
    if (arg === '--concurrency') {
      concurrency = argv[++index] || concurrency;
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      concurrency = arg.slice('--concurrency='.length);
      continue;
    }
    if (arg === '--preview-concurrency') {
      previewConcurrency = argv[++index] || previewConcurrency;
      continue;
    }
    if (arg.startsWith('--preview-concurrency=')) {
      previewConcurrency = arg.slice('--preview-concurrency='.length);
      continue;
    }
    if (arg === '--cache-concurrency') {
      cacheConcurrency = argv[++index] || cacheConcurrency;
      continue;
    }
    if (arg.startsWith('--cache-concurrency=')) {
      cacheConcurrency = arg.slice('--cache-concurrency='.length);
      continue;
    }
    if (arg === '--out-dir') {
      explicitOutDir = argv[++index] || explicitOutDir;
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      explicitOutDir = arg.slice('--out-dir='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }
  const { pdfPath, outDir } = resolveInputAndOutput(positional, explicitOutDir, dryRun || preflight);
  const concurrencyValues = parseIntegerList(concurrency, 'concurrency', 1, 3);
  const previewConcurrencyValues = parseIntegerList(
    previewConcurrency || concurrencyValues.join(','),
    'preview concurrency',
    1,
    3,
  );
  const cacheConcurrencyValue = clampInteger(
    Number.parseInt(cacheConcurrency || String(Math.max(...concurrencyValues)), 10),
    1,
    3,
  );
  return {
    cacheConcurrency: cacheConcurrencyValue,
    concurrency: concurrencyValues,
    dryRun,
    outDir,
    pages,
    pdfPath,
    preflight,
    previewConcurrency: previewConcurrencyValues,
  };
}

function resolveInputAndOutput(positional, explicitOutDir, planOnly) {
  if (positional.length >= 2) {
    return {
      pdfPath: positional[0] || process.env.EVAL_CESHI_PERF_PDF || discoverDefaultPdf(),
      outDir: explicitOutDir || positional[1] || DEFAULT_OUT_DIR,
    };
  }
  if (positional.length === 1) {
    const only = positional[0];
    const looksLikePdf = path.extname(only).toLowerCase() === '.pdf';
    if (!explicitOutDir && planOnly && !looksLikePdf) {
      return {
        pdfPath: process.env.EVAL_CESHI_PERF_PDF || discoverDefaultPdf(),
        outDir: only,
      };
    }
    return {
      pdfPath: only || process.env.EVAL_CESHI_PERF_PDF || discoverDefaultPdf(),
      outDir: explicitOutDir || DEFAULT_OUT_DIR,
    };
  }
  return {
    pdfPath: process.env.EVAL_CESHI_PERF_PDF || discoverDefaultPdf(),
    outDir: explicitOutDir || DEFAULT_OUT_DIR,
  };
}

function discoverDefaultPdf() {
  const root = process.env[PRIVATE_CORPUS_ENV] || '';
  if (!root) return PRIVATE_PDF_PLACEHOLDER;
  try {
    const candidates = readdirSync(root)
      .filter((name) => path.extname(name).toLowerCase() === '.pdf')
      .sort((a, b) => a.localeCompare(b));
    if (candidates.length > 0) return path.join(root, candidates[0]);
  } catch {
    return PRIVATE_PDF_PLACEHOLDER;
  }
  return PRIVATE_PDF_PLACEHOLDER;
}

function parseIntegerList(value, label, min, max) {
  const parsed = String(value || '')
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item));
  const unique = [...new Set(parsed)].map((item) => clampInteger(item, min, max));
  if (unique.length === 0) throw new Error(`Invalid ${label}: ${value}`);
  return unique.sort((a, b) => a - b);
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parsePages(value, pageCount) {
  const normalized = String(value || '').trim();
  if (!normalized) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const selected = [];
  for (const part of normalized.split(',')) {
    const token = part.trim();
    if (!token) continue;
    if (token.includes('-')) {
      const [left, right] = token.split('-', 2);
      const start = Number.parseInt(left, 10);
      const end = Number.parseInt(right, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        throw new Error(`Invalid page range: ${token}`);
      }
      for (let page = start; page <= end; page += 1) selected.push(page);
    } else {
      const page = Number.parseInt(token, 10);
      if (!Number.isFinite(page)) throw new Error(`Invalid page number: ${token}`);
      selected.push(page);
    }
  }
  const deduped = [...new Set(selected)];
  const invalid = deduped.filter((page) => page < 1 || page > pageCount);
  if (invalid.length > 0) {
    throw new Error(`Page selection out of range 1-${pageCount}: ${invalid.join(', ')}`);
  }
  return deduped;
}

function splitCsv(value) {
  if (!value) return null;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function defaultTypeIds(pipelines, mode) {
  const pipeline = pipelines.find((item) => item.mode === mode && item.enabled);
  if (!pipeline) return [];
  return (pipeline.types || [])
    .filter((item) => item.enabled !== false)
    .filter((item) => mode !== 'has_image' || !DEFAULT_EXCLUDED_HAS_IMAGE_IDS.has(item.id))
    .map((item) => item.id)
    .filter(Boolean);
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function apiRoot(apiBase) {
  return apiBase.replace(/\/api\/v\d+$/, '');
}

function envBool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function includePrivateReportDetails() {
  return envBool('EVAL_REPORT_INCLUDE_PRIVATE_DETAILS', false);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function looksPrivateTimingKey(key) {
  const normalized = String(key).toLowerCase();
  if (/^(?:path|file_path|filename|file_name|basename|original_filename|input|output|raw|raw_text|text|content)$/.test(normalized)) {
    return true;
  }
  return /(?:private|local|absolute).*(?:path|file|filename)|(?:path|file|filename).*(?:private|local|absolute)/i.test(normalized);
}

function looksPrivateTimingString(value) {
  return /[A-Za-z]:\\|\/mnt\/|\/Users\/|\/home\/|\\ceshi|ceshi|\.pdf|\.docx|\.png|\.jpe?g/i.test(String(value));
}

function sanitizeTimingDiagnostics(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (looksPrivateTimingString(value)) return '<redacted>';
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }
  if (Array.isArray(value)) {
    if (depth >= 3) return [];
    return value.slice(0, 20).map((item) => sanitizeTimingDiagnostics(item, depth + 1));
  }
  if (!isPlainObject(value) || depth >= 4) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (looksPrivateTimingKey(key)) continue;
    output[key] = sanitizeTimingDiagnostics(item, depth + 1);
  }
  return output;
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 16);
}

function inputRef(filePath) {
  const resolved = path.resolve(filePath);
  const basename = path.basename(resolved);
  const ref = {
    label: `input-pdf${path.extname(basename).toLowerCase() || '.pdf'}`,
    path_sha256: shortHash(resolved),
    basename_sha256: shortHash(basename),
  };
  if (includePrivateReportDetails()) {
    ref.path = resolved;
    ref.basename = basename;
  }
  return ref;
}

function authPreflightSummary(authStatus) {
  if (authStatus?.auth_enabled === false) {
    return {
      state: 'disabled',
      needs_credentials_for_real_run: false,
      reason: 'backend reports auth_enabled=false',
    };
  }
  if (authStatus?.error) {
    return {
      state: 'unknown',
      needs_credentials_for_real_run: null,
      reason: authStatus.error,
    };
  }
  return {
    state: 'enabled',
    needs_credentials_for_real_run: true,
    reason: 'real run needs DATAINFRA_TOKEN, DATAINFRA_TOKEN_FILE, or DATAINFRA_PASSWORD',
    password_set: authStatus?.password_set ?? null,
  };
}

function describePreflightJson(result) {
  if (result?.error) return `error: ${result.error}`;
  if (Array.isArray(result)) return `ok (${result.length} items)`;
  if (result && typeof result === 'object') return 'ok';
  return result == null ? 'empty' : 'ok';
}

async function runPreflight(args) {
  const ref = inputRef(args.pdfPath);
  const env = resolveEvalEnv();
  const apiBase = (env.DATAINFRA_API || DEFAULT_API).replace(/\/+$/, '');
  const fileExists = existsSync(args.pdfPath);
  const authStatus = await tryRequestJson(`${apiBase}/auth/status`);
  const serviceHealth = await tryRequestJson(`${apiRoot(apiBase)}/health/services`);
  const pipelineProbe = await tryRequestJson(`${apiBase}/vision-pipelines`);
  const auth = authPreflightSummary(authStatus);
  const summary = {
    generated_at: new Date().toISOString(),
    mode: 'preflight',
    api: apiBase,
    input: ref,
    input_exists: fileExists,
    output_dir: args.outDir,
    pages: args.pages,
    concurrency: args.concurrency,
    cache_concurrency: args.cacheConcurrency,
    preview_concurrency: args.previewConcurrency,
    auth,
    auth_status: authStatus,
    service_health: serviceHealth,
    vision_pipelines_probe: pipelineProbe?.error ? { error: pipelineProbe.error } : { ok: true },
    skips: [
      {
        stage: 'upload_parse_vision_preview',
        skipped: true,
        reason: 'preflight mode only checks local file/API readiness; it does not read a token, upload files, or run recognition',
      },
    ],
  };
  console.log('private PDF perf preflight:');
  console.log(`- input: ${includePrivateReportDetails() ? path.resolve(args.pdfPath) : `${ref.label} path_sha256=${ref.path_sha256}`} exists=${fileExists}`);
  console.log(`- output: ${args.outDir}`);
  console.log(`- api: ${apiBase}`);
  console.log(`- auth: ${auth.state}; credentials for real run: ${auth.needs_credentials_for_real_run === true ? 'needed' : auth.needs_credentials_for_real_run === false ? 'not needed' : 'unknown'}; ${auth.reason}`);
  console.log(`- services: ${describePreflightJson(serviceHealth)}`);
  console.log(`- vision pipelines without token: ${describePreflightJson(pipelineProbe)}`);
  console.log('- skipped real work: preflight does not upload, parse, run OCR/vision, or request preview images');
  if (auth.needs_credentials_for_real_run) {
    console.log('- next auth step: DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt');
  }
  if (!fileExists || authStatus?.error) {
    process.exitCode = 1;
  }
  await mkdir(args.outDir, { recursive: true });
  await writeFile(path.join(args.outDir, 'preflight-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`preflight summary: ${path.resolve(args.outDir, 'preflight-summary.json')}`);
}

async function timed(label, fn) {
  const start = performance.now();
  try {
    const value = await fn();
    return { ok: true, label, elapsed_ms: Math.round(performance.now() - start), value };
  } catch (error) {
    return {
      ok: false,
      label,
      elapsed_ms: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function uploadFile(apiBase, token, filePath) {
  const readStart = performance.now();
  const bytes = await readFile(filePath);
  const localReadMs = Math.round(performance.now() - readStart);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeForFile(filePath) }), path.basename(filePath));
  form.append('upload_source', 'playground');
  const http = await timed('upload_http', () => requestJson(`${apiBase}/files/upload`, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
  }));
  if (!http.ok) throw new Error(http.error);
  return {
    local_read_ms: localReadMs,
    http_ms: http.elapsed_ms,
    total_ms: localReadMs + http.elapsed_ms,
    bytes: bytes.length,
    response: http.value,
  };
}

async function getPipelines(apiBase, token) {
  return requestJson(`${apiBase}/vision-pipelines`, {
    headers: authHeaders(token),
  });
}

function visionBody(selectedOcrTypes, selectedImageTypes) {
  return {
    selected_ocr_has_types: selectedOcrTypes,
    selected_has_image_types: selectedImageTypes,
  };
}

async function requestVision(apiBase, token, fileId, page, force, selectedOcrTypes, selectedImageTypes) {
  const query = new URLSearchParams({
    page: String(page),
    include_result_image: 'false',
  });
  if (force) query.set('force', 'true');
  const result = await requestJson(`${apiBase}/redaction/${encodeURIComponent(fileId)}/vision?${query}`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(visionBody(selectedOcrTypes, selectedImageTypes)),
  });
  const boxes = Array.isArray(result.bounding_boxes) ? result.bounding_boxes : [];
  const durationMs = sanitizeTimingDiagnostics(result.duration_ms || {});
  const durationBreakdownMs = sanitizeTimingDiagnostics(
    isPlainObject(result.duration_breakdown_ms) ? result.duration_breakdown_ms : durationMs,
  );
  const pipelineStatus = result.pipeline_status || {};
  const cacheStatus = sanitizeTimingDiagnostics(result.cache_status || {});
  return {
    page,
    box_count: boxes.length,
    result_image_present: Boolean(result.result_image),
    warning_count: Array.isArray(result.warnings) ? result.warnings.length : 0,
    pipeline_status: pipelineStatus,
    duration_ms: durationMs,
    duration_breakdown_ms: durationBreakdownMs,
    cache_status: cacheStatus,
    stage_diagnostics: buildVisionStageDiagnostics({
      boxes,
      cacheStatus,
      durationBreakdownMs,
      durationMs,
      pipelineStatus,
      warnings: result.warnings,
    }),
    boxes,
  };
}

async function requestPreview(apiBase, token, fileId, page, boxes) {
  const result = await requestJson(`${apiBase}/redaction/${encodeURIComponent(fileId)}/preview-image?page=${page}`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      bounding_boxes: boxes,
      config: {
        image_redaction_method: 'fill',
        image_fill_color: '#000000',
        image_redaction_strength: 75,
      },
    }),
  });
  return {
    page,
    image_base64_present: Boolean(result.image_base64),
  };
}

async function mapLimit(items, concurrency, worker) {
  let nextIndex = 0;
  const results = Array.from({ length: items.length });
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runPageStage(stage, concurrency, pages, worker) {
  const wallStart = performance.now();
  const rows = await mapLimit(pages, concurrency, async (page) => {
    const measured = await timed(stage, () => worker(page));
    return {
      stage,
      concurrency,
      page,
      ok: measured.ok,
      elapsed_ms: measured.elapsed_ms,
      ...(measured.ok
        ? measured.value
        : { error: measured.error }),
    };
  });
  return {
    stage,
    concurrency,
    wall_ms: Math.round(performance.now() - wallStart),
    pages: rows,
    stats: summarizeRows(rows),
  };
}

function summarizeRows(rows) {
  const okRows = rows.filter((row) => row.ok);
  const values = okRows.map((row) => row.elapsed_ms);
  return {
    ok_count: okRows.length,
    failed_count: rows.length - okRows.length,
    min_ms: percentile(values, 0),
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    max_ms: percentile(values, 1),
    average_ms: values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null,
  };
}

function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

function flattenTimingRows(summary) {
  const rows = [];
  rows.push({
    stage: 'upload',
    concurrency: 1,
    page: '',
    ok: true,
    elapsed_ms: summary.upload.total_ms,
    detail: `local_read_ms=${summary.upload.local_read_ms};http_ms=${summary.upload.http_ms};bytes=${summary.upload.bytes}`,
  });
  rows.push({
    stage: 'parse',
    concurrency: 1,
    page: '',
    ok: summary.parse.ok,
    elapsed_ms: summary.parse.elapsed_ms,
    detail: summary.parse.ok ? `page_count=${summary.page_count}` : summary.parse.error,
  });
  for (const run of [
    ...summary.vision_runs,
    summary.cache_hit_run,
    ...summary.preview_runs,
  ].filter(Boolean)) {
    for (const page of run.pages || []) {
      const diagnosticDetail = page.stage_diagnostics
        ? formatStageDiagnostics(page.stage_diagnostics)
        : page.ok
          ? formatPreviewDiagnostics(page)
          : '';
      rows.push({
        stage: run.stage,
        concurrency: run.concurrency,
        page: page.page,
        ok: page.ok,
        elapsed_ms: page.elapsed_ms,
        detail: page.ok
          ? diagnosticDetail
          : page.error,
      });
    }
  }
  return rows;
}

function statusForPipeline(pipelineStatus, key) {
  const status = pipelineStatus && typeof pipelineStatus === 'object' ? pipelineStatus[key] : null;
  return {
    ran: Boolean(status?.ran),
    skipped: Boolean(status?.skipped),
    failed: Boolean(status?.failed),
    region_count: Number.isFinite(Number(status?.region_count)) ? Number(status.region_count) : 0,
    duration_ms: numberOrNull(status?.duration_ms),
    stage_duration_ms: status?.stage_duration_ms && typeof status.stage_duration_ms === 'object'
      ? status.stage_duration_ms
      : {},
    error: status?.error ?? null,
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function countBoxesByField(boxes, field) {
  const counts = {};
  for (const box of boxes || []) {
    const key = box && typeof box === 'object' ? String(box[field] || '') : '';
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function countWarnings(warnings) {
  const counts = {};
  for (const warning of Array.isArray(warnings) ? warnings : []) {
    const key = String(warning || '').trim();
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
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

function hasOcrImageStage(ocrStatus) {
  const stages = ocrStatus.stage_duration_ms || {};
  return Number(stages.ocr || 0) > 0 || Number(stages.prepare || 0) > 0 || Number(stages.match || 0) > 0;
}

function buildVisionStageDiagnostics({ boxes, cacheStatus, durationBreakdownMs, durationMs, pipelineStatus, warnings }) {
  const sourceCounts = countBoxesByField(boxes, 'source');
  const sourceDetailCounts = countBoxesByField(boxes, 'source_detail');
  const evidenceSourceCounts = countBoxesByField(boxes, 'evidence_source');
  const ocrHas = statusForPipeline(pipelineStatus, 'ocr_has');
  const hasImage = statusForPipeline(pipelineStatus, 'has_image');
  const pdfTextLayer = durationMs && typeof durationMs.pdf_text_layer === 'object'
    ? durationMs.pdf_text_layer
    : {};
  const pdfTextLayerPresent = Object.keys(pdfTextLayer).length > 0;
  const pdfTextLayerBoxCount = Number(sourceDetailCounts.pdf_text_layer || 0);
  const pdfTextLayerCharCount = numberOrNull(pdfTextLayer.char_count);
  const pdfTextLayerSparseFallback = Boolean(
    pdfTextLayerPresent &&
    ocrHas.ran &&
    pdfTextLayerBoxCount === 0 &&
    hasOcrImageStage(ocrHas)
  );
  const pdfTextLayerSkippedSparseFile = Boolean(durationMs?.pdf_text_layer_skipped_sparse_file);
  return {
    ocr_has: ocrHas,
    has_image: hasImage,
    pdf_render: {
      ms: numberOrNull(durationMs?.pdf_render_ms),
      cache_hit: durationMs?.pdf_render_cache_hit ?? null,
    },
    pdf_text_layer: {
      present: pdfTextLayerPresent,
      ms: numberOrNull(durationMs?.pdf_text_layer_ms),
      block_count: numberOrNull(pdfTextLayer.block_count),
      char_count: pdfTextLayerCharCount,
      box_count: pdfTextLayerBoxCount,
      sparse_fallback: pdfTextLayerSparseFallback,
      skipped_sparse_file: pdfTextLayerSkippedSparseFile,
    },
    request_total_ms: numberOrNull(durationMs?.request_total_ms),
    backend_total_ms: numberOrNull(durationMs?.total),
    cache_status: cacheStatus && typeof cacheStatus === 'object' ? cacheStatus : {},
    box_source_counts: sourceCounts,
    box_source_detail_counts: sourceDetailCounts,
    evidence_source_counts: evidenceSourceCounts,
    warning_counts: countWarnings(warnings),
    single_page_stage_summary: buildSinglePageStageSummary({
      cacheStatus,
      durationBreakdownMs,
      durationMs,
      hasImageStatus: hasImage,
      ocrHasStatus: ocrHas,
    }),
  };
}

function collectNumberLeaves(value, prefix = '') {
  if (!isPlainObject(value)) return [];
  const leaves = [];
  for (const [key, item] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'number' && Number.isFinite(item)) {
      leaves.push({ path: nextPrefix, value: Math.round(item) });
      continue;
    }
    if (isPlainObject(item)) leaves.push(...collectNumberLeaves(item, nextPrefix));
  }
  return leaves;
}

function numericLeafMatches(leaves, pattern) {
  return leaves.filter((leaf) => pattern.test(leaf.path));
}

function sumLeaves(leaves) {
  if (!leaves.length) return null;
  return leaves.reduce((sum, leaf) => sum + leaf.value, 0);
}

function firstLeafValue(leaves, patterns) {
  for (const pattern of patterns) {
    const match = leaves.find((leaf) => pattern.test(leaf.path));
    if (match) return match.value;
  }
  return null;
}

function compactStageDetails(leaves) {
  return Object.fromEntries(
    leaves
      .filter((leaf) => !/(?:^|\.)total$|request_total_ms|cache_hits|cache_misses|page_width|page_height|char_count|block_count/i.test(leaf.path))
      .slice(0, 8)
      .map((leaf) => [leaf.path, leaf.value]),
  );
}

function buildStageGroup(leaves, label, totalPatterns, detailPattern, fallbackStatus) {
  const matchingDetails = numericLeafMatches(leaves, detailPattern)
    .filter((leaf) => !/(?:^|\.)total$|request_total_ms|cache_hits|cache_misses|page_width|page_height|char_count|block_count/i.test(leaf.path));
  const totalMs = firstLeafValue(leaves, totalPatterns) ?? sumLeaves(matchingDetails) ?? fallbackStatus?.duration_ms ?? null;
  return {
    label,
    total_ms: totalMs,
    details_ms: compactStageDetails(matchingDetails),
  };
}

function cacheSignalSummary(durationBreakdownMs, cacheStatus) {
  const signals = collectCacheSignals({
    duration_breakdown_ms: durationBreakdownMs,
    cache_status: cacheStatus,
  });
  return {
    hits: signals.filter((signal) => signal.value === 'hit').map((signal) => signal.path),
    misses_or_disabled: signals
      .filter((signal) => signal.value === 'miss' || signal.value === 'disabled')
      .map((signal) => signal.path),
    hit_count: signals.filter((signal) => signal.value === 'hit').length,
    miss_or_disabled_count: signals.filter((signal) => signal.value === 'miss' || signal.value === 'disabled').length,
    signal_count: signals.length,
  };
}

function buildSinglePageStageSummary({ cacheStatus, durationBreakdownMs, durationMs, hasImageStatus, ocrHasStatus }) {
  const source = isPlainObject(durationBreakdownMs) && Object.keys(durationBreakdownMs).length
    ? durationBreakdownMs
    : durationMs;
  const stageSource = {
    ...(isPlainObject(source) ? source : {}),
    ocr_has_stage: isPlainObject(ocrHasStatus?.stage_duration_ms)
      ? ocrHasStatus.stage_duration_ms
      : {},
    has_image_stage: isPlainObject(hasImageStatus?.stage_duration_ms)
      ? hasImageStatus.stage_duration_ms
      : {},
  };
  const leaves = collectNumberLeaves(stageSource);
  const ocr = buildStageGroup(
    leaves,
    'OCR',
    [
      /(?:^|\.)ocr_has_stage\.ocr$/i,
      /(?:^|\.)ocr_has_stage\.ocr_ms$/i,
      /^(?:ocr|ocr_ms)$/i,
    ],
    /(?:^|\.)(?:ocr|paddleocr)(?:\.|$)|(?:^|\.)ocr_has_stage\.ocr(?:_ms)?$/i,
    null,
  );
  const hasText = buildStageGroup(
    leaves,
    'HaS Text',
    [
      /(?:^|\.)ocr_has_stage\.has_ner$/i,
      /(?:^|\.)ocr_has_stage\.has_ner_ms$/i,
      /has_text(?:_ms)?$/i,
      /has_ner(?:_ms)?$/i,
      /(?:^|\.)ner(?:_ms)?$/i,
    ],
    /(?:has_text|has_ner|ner|match)/i,
    null,
  );
  const hasImage = buildStageGroup(
    leaves,
    'HaS Image',
    [
      /(?:^|\.)has_image_stage\.total$/i,
      /^(?:has_image|has_image_ms)$/i,
      /(?:^|\.)has_image(?:\.duration_ms)?$/i,
    ],
    /(?:^|\.)has_image(?:\.|$)|(?:^|\.)has_image_stage\.(?:prepare|model|local_fallback|fallback|draw|total)$/i,
    hasImageStatus,
  );
  const structure = buildStageGroup(
    leaves,
    'structure',
    [
      /(?:^|\.)ocr_has_stage\.ocr_structure(?:_ms)?$/i,
      /ocr_structure(?:_ms)?$/i,
      /(?:^|\.)structure(?:_ms)?$/i,
    ],
    /(?:ocr_structure|(?:^|\.)structure(?:\.|$))/i,
    null,
  );
  const vl = buildStageGroup(
    leaves,
    'VL',
    [
      /(?:^|\.)ocr_has_stage\.ocr_vl(?:_ms)?$/i,
      /ocr_vl(?:_ms)?$/i,
      /(?:^|\.)vl(?:_ms)?$/i,
      /paddleocr_vl(?:_ms)?$/i,
    ],
    /(?:ocr_vl|paddleocr_vl|(?:^|\.)vl(?:\.|$))/i,
    null,
  );
  const candidates = [ocr, hasText, hasImage, structure, vl]
    .filter((stage) => Number.isFinite(Number(stage.total_ms)));
  const bottleneck = candidates.length
    ? candidates.reduce((slowest, stage) => (stage.total_ms > slowest.total_ms ? stage : slowest), candidates[0])
    : null;
  return {
    source: source === durationBreakdownMs ? 'duration_breakdown_ms' : 'duration_ms_fallback',
    ocr,
    has_text: hasText,
    has_image: hasImage,
    structure,
    vl,
    cache: cacheSignalSummary(stageSource, cacheStatus),
    bottleneck: bottleneck ? { stage: bottleneck.label, total_ms: bottleneck.total_ms } : null,
  };
}

function formatPipelineStatus(label, status) {
  if (!status) return `${label}=missing`;
  const state = status.failed ? 'failed' : status.skipped ? 'skipped' : status.ran ? 'ran' : 'not_run';
  const stageDurations = formatStageDurationMap(status.stage_duration_ms);
  return `${label}=${state}:${status.region_count ?? 0}:${status.duration_ms ?? ''}${stageDurations ? `:${stageDurations}` : ''}`;
}

function formatStageDurationMap(value) {
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value)
    .filter(([, ms]) => Number.isFinite(Number(ms)))
    .map(([stage, ms]) => `${stage}=${Number(ms)}`)
    .join('|');
}

function formatStageDiagnostics(diagnostics) {
  const pdfTextLayer = diagnostics.pdf_text_layer || {};
  const pdfRender = diagnostics.pdf_render || {};
  const cacheStatus = diagnostics.cache_status || {};
  return [
    formatPipelineStatus('ocr_has', diagnostics.ocr_has),
    formatPipelineStatus('has_image', diagnostics.has_image),
    `pdf_render_ms=${pdfRender.ms ?? ''}`,
    `pdf_render_cache_hit=${pdfRender.cache_hit ?? ''}`,
    `pdf_text_layer_ms=${pdfTextLayer.ms ?? ''}`,
    `pdf_text_layer_chars=${pdfTextLayer.char_count ?? ''}`,
    `pdf_text_layer_boxes=${pdfTextLayer.box_count ?? ''}`,
    `pdf_text_layer_sparse_fallback=${pdfTextLayer.sparse_fallback ? 'true' : 'false'}`,
    `pdf_text_layer_skipped_sparse_file=${pdfTextLayer.skipped_sparse_file ? 'true' : 'false'}`,
    `request_total_ms=${diagnostics.request_total_ms ?? ''}`,
    `backend_total_ms=${diagnostics.backend_total_ms ?? ''}`,
    `cache_status=${cacheStatus.vision_result ?? ''}`,
    `single_page_stage_summary=${formatSinglePageStageSummary(diagnostics.single_page_stage_summary)}`,
  ].join(';');
}

function formatPreviewDiagnostics(page) {
  return `preview_image_present=${page.image_base64_present ?? ''}`;
}

function formatSinglePageStageSummary(summary) {
  if (!summary || typeof summary !== 'object') return '';
  const ms = (stage) => stage?.total_ms ?? '-';
  const cache = summary.cache || {};
  const bottleneck = summary.bottleneck
    ? `${summary.bottleneck.stage}:${summary.bottleneck.total_ms}ms`
    : '-';
  return [
    `OCR=${ms(summary.ocr)}`,
    `HaS_Text=${ms(summary.has_text)}`,
    `HaS_Image=${ms(summary.has_image)}`,
    `structure=${ms(summary.structure)}`,
    `VL=${ms(summary.vl)}`,
    `cache=hit:${cache.hit_count ?? 0}/miss_or_disabled:${cache.miss_or_disabled_count ?? 0}`,
    `bottleneck=${bottleneck}`,
  ].join('|');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function renderCsv(rows) {
  const columns = ['stage', 'concurrency', 'page', 'ok', 'elapsed_ms', 'detail'];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n') + '\n';
}

function buildComparison(summary) {
  const visionOne = summary.vision_runs.find((run) => run.concurrency === 1);
  const visionThree = summary.vision_runs.find((run) => run.concurrency === 3);
  const cache = summary.cache_hit_run;
  return {
    vision_concurrency_1_wall_ms: visionOne?.wall_ms ?? null,
    vision_concurrency_3_wall_ms: visionThree?.wall_ms ?? null,
    vision_3_vs_1_speedup: speedup(visionOne?.wall_ms, visionThree?.wall_ms),
    cache_hit_wall_ms: cache?.wall_ms ?? null,
    cache_hit_vs_concurrency_1_speedup: speedup(visionOne?.wall_ms, cache?.wall_ms),
  };
}

function speedup(baseline, candidate) {
  const left = Number(baseline || 0);
  const right = Number(candidate || 0);
  if (!left || !right) return null;
  return Number((left / right).toFixed(2));
}

function renderMarkdown(summary) {
  const line = (label, value) => `- ${label}: ${value ?? '-'}`;
  const runRows = summary.vision_runs
    .map((run) => `| vision forced | ${run.concurrency} | ${run.wall_ms} | ${run.stats.average_ms ?? '-'} | ${run.stats.p95_ms ?? '-'} | ${run.stats.failed_count} |`)
    .join('\n');
  const previewRows = summary.preview_runs
    .map((run) => `| preview-image | ${run.concurrency} | ${run.wall_ms} | ${run.stats.average_ms ?? '-'} | ${run.stats.p95_ms ?? '-'} | ${run.stats.failed_count} |`)
    .join('\n');
  const cacheRow = summary.cache_hit_run
    ? `| expected cache hit | ${summary.cache_hit_run.concurrency} | ${summary.cache_hit_run.wall_ms} | ${summary.cache_hit_run.stats.average_ms ?? '-'} | ${summary.cache_hit_run.stats.p95_ms ?? '-'} | ${summary.cache_hit_run.stats.failed_count} |`
    : '';
  const diagnosticRows = renderDiagnosticRows(summary);
  const singlePageStageRows = renderSinglePageStageRows(summary);
  return `# Private PDF Performance Evaluation

Generated: ${summary.generated_at}

## Input

${line('input label', summary.input.label)}
${line('path sha256', summary.input.path_sha256)}
${line('basename sha256', summary.input.basename_sha256)}
${includePrivateReportDetails() ? line('private path', summary.input.path) : '- private details: redacted by default'}
${line('api', summary.api)}
${line('pages', summary.selected_pages.join(','))}
  ${line('vision include_result_image', summary.request_profile.vision_include_result_image)}
  ${line('forced vision force', summary.request_profile.forced_vision_force)}
  ${line('cache-hit vision force', summary.request_profile.cache_hit_vision_force)}
  ${line('cache-hit run is expected reuse', summary.request_profile.cache_hit_is_expected_reuse_probe)}
  ${line('cache-hit supports cold-start claim', summary.request_profile.cache_hit_supports_cold_start)}
  ${line('cache-hit interpretation', summary.request_profile.cache_hit_interpretation)}

## Stage Timings

${line('upload total ms', summary.upload.total_ms)}
${line('upload local read ms', summary.upload.local_read_ms)}
${line('upload HTTP ms', summary.upload.http_ms)}
${line('parse ms', summary.parse.elapsed_ms)}
${line('page count', summary.page_count)}

## Runs

| stage | concurrency | wall ms | avg page ms | p95 page ms | failed |
| --- | ---: | ---: | ---: | ---: | ---: |
${runRows}
${cacheRow}
${previewRows}

## Stage Diagnostics

| run | c | page | page_elapsed | ocr_has | has_image | pdf_render | pdf_text_layer | request_total | cache_status |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | ---: | --- |
${diagnosticRows || '| - | - | - | - | - | - | - | - | - | - |'}

## Single-Page Stage Summary

Use this table after the concurrency matrix shows wall-clock improvement from parallel page work. When concurrency is already effective, the next bottleneck is usually the slowest single-page stage rather than the page scheduler. Inspect OCR/HaS Text/HaS Image/structure/VL/cache bottlenecks before changing page concurrency.

| run | c | page | OCR ms | HaS Text ms | HaS Image ms | structure ms | VL ms | cache signals | bottleneck |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
${singlePageStageRows || '| - | - | - | - | - | - | - | - | - | - |'}

## Comparisons

${line('vision concurrency 3 vs 1 speedup', summary.comparison.vision_3_vs_1_speedup)}
${line('cache hit vs forced concurrency 1 speedup', summary.comparison.cache_hit_vs_concurrency_1_speedup)}
${line('next bottleneck read', renderConcurrencyInterpretation(summary))}

## Live UI Batch Timing Read

When comparing this PDF baseline with \`eval-live-ui-ceshi\` output, treat live
UI \`recognition_wait_ms\` as first-reviewable latency: it stops when the batch
review step can be entered for available files. Use
\`performance_context.batch.phase_diagnostics.all_recognition_complete_api_ms\`
for full-batch recognition completion, and
\`review_waiting_for_background_ms\` for time spent in review while later files
or model work were still finishing.

Detailed per-request rows are in \`timings.csv\`.
`;
}

function renderDiagnosticRows(summary) {
  const runs = [
    ...summary.vision_runs.map((run) => ['forced', run]),
    ...(summary.cache_hit_run ? [['cache_hit', summary.cache_hit_run]] : []),
  ];
  const rows = [];
  for (const [label, run] of runs) {
    for (const page of run.pages || []) {
      if (!page.ok || !page.stage_diagnostics) continue;
      const diagnostics = page.stage_diagnostics;
      rows.push([
        label,
        run.concurrency,
        page.page,
        `${page.elapsed_ms}ms`,
        markdownPipelineCell(diagnostics.ocr_has),
        markdownPipelineCell(diagnostics.has_image),
        markdownPdfRenderCell(diagnostics.pdf_render),
        markdownPdfTextLayerCell(diagnostics.pdf_text_layer),
        diagnostics.request_total_ms ?? '-',
        markdownCacheCell(diagnostics.cache_status),
      ]);
    }
  }
  return rows
    .map((row) => `| ${row.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
    .join('\n');
}

function renderSinglePageStageRows(summary) {
  const runs = [
    ...summary.vision_runs.map((run) => ['forced', run]),
    ...(summary.cache_hit_run ? [['cache_hit', summary.cache_hit_run]] : []),
  ];
  const rows = [];
  for (const [label, run] of runs) {
    for (const page of run.pages || []) {
      const stageSummary = page.stage_diagnostics?.single_page_stage_summary;
      if (!page.ok || !stageSummary) continue;
      rows.push([
        label,
        run.concurrency,
        page.page,
        stageSummary.ocr?.total_ms ?? '-',
        stageSummary.has_text?.total_ms ?? '-',
        stageSummary.has_image?.total_ms ?? '-',
        stageSummary.structure?.total_ms ?? '-',
        stageSummary.vl?.total_ms ?? '-',
        markdownCacheSummaryCell(stageSummary.cache),
        stageSummary.bottleneck
          ? `${stageSummary.bottleneck.stage} ${stageSummary.bottleneck.total_ms}ms`
          : '-',
      ]);
    }
  }
  return rows
    .map((row) => `| ${row.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
    .join('\n');
}

function markdownCacheSummaryCell(cache) {
  if (!cache || typeof cache !== 'object') return '-';
  return `hit=${cache.hit_count ?? 0} miss_or_disabled=${cache.miss_or_disabled_count ?? 0}`;
}

function renderConcurrencyInterpretation(summary) {
  const speedup = Number(summary.comparison.vision_3_vs_1_speedup);
  if (Number.isFinite(speedup) && speedup > 1.1) {
    return `vision page concurrency is effective (${speedup}x c3 vs c1); inspect Single-Page Stage Summary for OCR/HaS Text/HaS Image/structure/VL/cache bottlenecks`;
  }
  return 'if page concurrency does not reduce wall time, inspect scheduler/service saturation before single-page stages';
}

function markdownPipelineCell(status) {
  if (!status) return '-';
  const state = status.failed ? 'failed' : status.skipped ? 'skipped' : status.ran ? 'ran' : 'not_run';
  const parts = [`${state}`, `regions=${status.region_count ?? 0}`];
  if (status.duration_ms != null) parts.push(`${status.duration_ms}ms`);
  const stageDurations = formatStageDurationMap(status.stage_duration_ms);
  if (stageDurations) parts.push(`stages=${stageDurations}`);
  if (status.error) parts.push(`error=${status.error}`);
  return parts.join(' ');
}

function markdownPdfRenderCell(pdfRender) {
  if (!pdfRender || pdfRender.ms == null) return '-';
  const cache = pdfRender.cache_hit == null ? 'cache=?' : `cache=${pdfRender.cache_hit ? 'hit' : 'miss'}`;
  return `${pdfRender.ms}ms ${cache}`;
}

function markdownPdfTextLayerCell(pdfTextLayer) {
  if (!pdfTextLayer) return '-';
  if (pdfTextLayer.skipped_sparse_file) return 'skipped sparse file';
  if (!pdfTextLayer.present) return '-';
  const parts = [
    `${pdfTextLayer.ms ?? '-'}ms`,
    `chars=${pdfTextLayer.char_count ?? '-'}`,
    `blocks=${pdfTextLayer.block_count ?? '-'}`,
    `boxes=${pdfTextLayer.box_count ?? 0}`,
  ];
  if (pdfTextLayer.sparse_fallback) parts.push('sparse fallback');
  return parts.join(' ');
}

function markdownCacheCell(cacheStatus) {
  if (!cacheStatus || typeof cacheStatus !== 'object') return '-';
  const value = cacheStatus.vision_result ?? '-';
  const force = cacheStatus.force == null ? '' : ` force=${Boolean(cacheStatus.force)}`;
  return `${value}${force}`;
}

async function writeArtifacts(outDir, summary) {
  await mkdir(outDir, { recursive: true });
  const rows = flattenTimingRows(summary);
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'timings.csv'), renderCsv(rows), 'utf8');
  await writeFile(path.join(outDir, 'report.md'), renderMarkdown(summary), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ref = inputRef(args.pdfPath);
  if (args.preflight) {
    await runPreflight(args);
    return;
  }
  if (args.dryRun) {
    console.log('private PDF perf plan:');
    console.log(`- input: ${includePrivateReportDetails() ? path.resolve(args.pdfPath) : `${ref.label} path_sha256=${ref.path_sha256}`}`);
    console.log(`- output: ${args.outDir}`);
    console.log(`- pages: ${args.pages}`);
    console.log(`- stages: upload, parse, forced vision, expected cache hit, preview-image`);
    console.log(`- vision include_result_image: false (matches frontend recognition path)`);
    console.log(`- forced vision: force=true, bypasses cached page results for timing`);
    console.log(`- expected cache hit: force omitted, repeats same page/type signature after forced runs`);
    console.log(`- vision concurrency: ${args.concurrency.join(',')}`);
    console.log(`- cache concurrency: ${args.cacheConcurrency}`);
    console.log(`- preview concurrency: ${args.previewConcurrency.join(',')}`);
    return;
  }
  if (!existsSync(args.pdfPath)) {
    throw new Error('Input PDF not found. Set EVAL_CESHI_PERF_PDF, EVAL_CESHI_DIR, or pass a private PDF path.');
  }

  const env = resolveEvalEnv();
  const apiBase = (env.DATAINFRA_API || DEFAULT_API).replace(/\/+$/, '');
  const { token, authStatus } = await resolveAuthToken(apiBase, env);
  const serviceHealth = await tryRequestJson(`${apiRoot(apiBase)}/health/services`);
  const pipelines = await getPipelines(apiBase, token);
  const selectedOcrTypes = splitCsv(process.env.EVAL_OCR_TYPES) || defaultTypeIds(pipelines, 'ocr_has');
  const selectedImageTypes = splitCsv(process.env.EVAL_IMAGE_TYPES) || defaultTypeIds(pipelines, 'has_image');
  await mkdir(args.outDir, { recursive: true });

  const upload = await uploadFile(apiBase, token, args.pdfPath);
  console.log(`upload: ${upload.total_ms}ms (${upload.http_ms}ms HTTP, ${upload.bytes} bytes)`);

  const parse = await timed('parse', () => requestJson(`${apiBase}/files/${encodeURIComponent(upload.response.file_id)}/parse`, {
    headers: authHeaders(token),
  }));
  if (!parse.ok) throw new Error(parse.error);
  const pageCount = Math.max(1, Number(parse.value?.page_count || upload.response.page_count || 1));
  const selectedPages = parsePages(args.pages, pageCount);
  console.log(`parse: ${parse.elapsed_ms}ms, pages=${pageCount}, selected=${selectedPages.join(',')}`);

  const boxesByPage = new Map();
  const visionRuns = [];
  for (const concurrency of args.concurrency) {
    const run = await runPageStage(
      'vision_forced',
      concurrency,
      selectedPages,
      (page) => requestVision(
        apiBase,
        token,
        upload.response.file_id,
        page,
        true,
        selectedOcrTypes,
        selectedImageTypes,
      ),
    );
    for (const pageResult of run.pages) {
      if (pageResult.ok && Array.isArray(pageResult.boxes)) boxesByPage.set(pageResult.page, pageResult.boxes);
    }
    visionRuns.push(redactBoxesFromRun(run));
    console.log(`vision forced c=${concurrency}: wall=${run.wall_ms}ms avg=${run.stats.average_ms ?? '-'}ms p95=${run.stats.p95_ms ?? '-'}ms`);
  }

  const cacheHitRunRaw = await runPageStage(
    'vision_cache_hit',
    args.cacheConcurrency,
    selectedPages,
    (page) => requestVision(
      apiBase,
      token,
      upload.response.file_id,
      page,
      false,
      selectedOcrTypes,
      selectedImageTypes,
    ),
  );
  const cacheHitRun = redactBoxesFromRun(cacheHitRunRaw);
  console.log(`vision expected cache hit c=${args.cacheConcurrency}: wall=${cacheHitRun.wall_ms}ms avg=${cacheHitRun.stats.average_ms ?? '-'}ms`);

  const previewRuns = [];
  for (const concurrency of args.previewConcurrency) {
    const run = await runPageStage(
      'preview_image',
      concurrency,
      selectedPages,
      (page) => requestPreview(apiBase, token, upload.response.file_id, page, boxesByPage.get(page) || []),
    );
    previewRuns.push(run);
    console.log(`preview c=${concurrency}: wall=${run.wall_ms}ms avg=${run.stats.average_ms ?? '-'}ms p95=${run.stats.p95_ms ?? '-'}ms`);
  }

  const summary = {
    generated_at: new Date().toISOString(),
    api: apiBase,
    output_dir: path.resolve(args.outDir),
    input: ref,
    auth_status: authStatus,
    service_health: serviceHealth,
    file_id: upload.response.file_id,
    file_type: upload.response.file_type,
    upload: {
      local_read_ms: upload.local_read_ms,
      http_ms: upload.http_ms,
      total_ms: upload.total_ms,
      bytes: upload.bytes,
      page_count: upload.response.page_count ?? null,
    },
    parse: {
      ok: parse.ok,
      elapsed_ms: parse.elapsed_ms,
    },
    page_count: pageCount,
    selected_pages: selectedPages,
    selected_ocr_has_types: selectedOcrTypes,
    selected_has_image_types: selectedImageTypes,
    request_profile: {
      vision_include_result_image: false,
      forced_vision_force: true,
      cache_hit_vision_force: false,
      default_frontend_path: true,
      cache_hit_is_expected_reuse_probe: true,
      cache_hit_supports_cold_start: false,
      cache_hit_interpretation: 'expected-reuse-only: warm-cache reuse path without a proven cold baseline',
    },
    vision_runs: visionRuns,
    cache_hit_run: cacheHitRun,
    preview_runs: previewRuns,
  };
  summary.comparison = buildComparison(summary);
  await writeArtifacts(args.outDir, summary);
  console.log(`summary: ${path.resolve(args.outDir, 'summary.json')}`);
  console.log(`timings: ${path.resolve(args.outDir, 'timings.csv')}`);
  console.log(`report: ${path.resolve(args.outDir, 'report.md')}`);
}

function redactBoxesFromRun(run) {
  return {
    ...run,
    pages: run.pages.map((page) => {
      const { boxes, pipeline_status: pipelineStatus, ...safe } = page;
      return {
        ...safe,
        pipeline_status_keys: pipelineStatus && typeof pipelineStatus === 'object'
          ? Object.keys(pipelineStatus)
          : [],
      };
    }),
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
