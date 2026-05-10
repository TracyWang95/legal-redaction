#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { authHeaders, requestJson, resolveAuthToken, resolveEvalEnv, tryRequestJson } from './eval-auth.mjs';

const DEFAULT_API = 'http://127.0.0.1:8000/api/v1';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_FIXTURES = [
  path.join(ROOT_DIR, 'fixtures', 'eval', 'sample-contract.txt'),
  path.join(ROOT_DIR, 'fixtures', 'eval', 'sample-incident-note.md'),
  path.join(ROOT_DIR, 'fixtures', 'eval', 'sample-invoice.html'),
];
const PRIVATE_CORPUS_ENV = 'EVAL_CESHI_DIR';
const DEFAULT_FIXTURES = process.env.EVAL_BATCH_USE_LOCAL_CESHI === '1'
  ? [...PUBLIC_FIXTURES, ...discoverPrivateCorpusFixtures()]
  : PUBLIC_FIXTURES;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'awaiting_review']);
const TERMINAL_ITEM_STATUSES = new Set(['awaiting_review', 'completed', 'failed', 'cancelled']);

function venvPython(venvDir) {
  return path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

function pythonCmd() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = [];
  if (process.env.VENV_DIR) candidates.push(venvPython(process.env.VENV_DIR));
  candidates.push(venvPython(path.join(ROOT_DIR, '.venv')));
  candidates.push(venvPython(path.join(ROOT_DIR, 'backend', '.venv')));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

function usage() {
  console.log(`Usage:
  node scripts/eval-batch-e2e.mjs [output-dir] [file ...]

Examples:
  DATAINFRA_TOKEN=... npm run eval:batch-e2e -- output/playwright/eval-batch-current
  DATAINFRA_TOKEN=... npm run eval:batch-e2e -- output/playwright/eval-batch-current <private-file.pdf> <private-file.docx>

Options via env:
  DATAINFRA_API          API base, default ${DEFAULT_API}
  DATAINFRA_PASSWORD     Login password for local auth
  DATAINFRA_TOKEN        Existing Bearer token
  DATAINFRA_TOKEN_FILE   File containing a Bearer token
  EVAL_BATCH_WAIT_MS     Poll timeout, default 900000
  EVAL_BATCH_POLL_MS     Poll interval, default 1000
  EVAL_BATCH_MIN_FILE_DETECTIONS   Per completed file, default 1
  EVAL_BATCH_MIN_TOTAL_DETECTIONS  Total entities + boxes, default input file count
  EVAL_BATCH_MIN_TOTAL_ENTITIES    Total text entities, default 0
  EVAL_BATCH_MIN_TOTAL_BOXES       Total visual boxes, default 0
  EVAL_BATCH_MAX_PDF_SIZE_RATIO    Fail if a redacted PDF is larger than this multiple of original, default 8
  EVAL_BATCH_MAX_PDF_SIZE_BYTES    Fail if a redacted PDF is larger than this many bytes, default 20971520
  EVAL_BATCH_WARN_PDF_SIZE_RATIO   Risk if a redacted PDF is larger than this multiple of original, default 4
  EVAL_BATCH_WARN_PDF_SIZE_BYTES   Risk if a redacted PDF is larger than this many bytes, default 10485760
  EVAL_BATCH_USE_LOCAL_CESHI       Also include files from EVAL_CESHI_DIR when set to 1
  EVAL_CESHI_DIR                   Private corpus directory used with EVAL_BATCH_USE_LOCAL_CESHI=1
`);
}

function discoverPrivateCorpusFixtures() {
  const root = process.env[PRIVATE_CORPUS_ENV] || '';
  if (!root || !existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  const byExt = (ext) => files.filter((file) => path.extname(file).toLowerCase() === ext);
  const image = byExt('.png')[0] || byExt('.jpg')[0] || byExt('.jpeg')[0];
  const pdf = byExt('.pdf')[0];
  const docx = byExt('.docx');
  return [...docx.slice(0, 2), pdf, image].filter(Boolean);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  const first = argv[0];
  const outDir = first && !looksLikeInputFile(first)
    ? first
    : path.join('output', 'playwright', `eval-batch-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const files = (first && !looksLikeInputFile(first) ? argv.slice(1) : argv).filter(Boolean);
  const selectedFiles = files.length > 0 ? files : DEFAULT_FIXTURES.filter((file) => existsSync(file));
  if (selectedFiles.length === 0) {
    throw new Error('Provide at least one input file, or restore fixtures/eval sample files.');
  }
  return { outDir, files: selectedFiles };
}

function looksLikeInputFile(value) {
  return /\.(docx?|pdf|png|jpe?g|txt|md|html?)$/i.test(value || '');
}

function apiRoot(apiBase) {
  return apiBase.replace(/\/api\/v\d+$/, '');
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  return 'application/octet-stream';
}

function splitCsv(value) {
  if (!value) return null;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

async function getEnabledEntityTypes(apiBase, token) {
  const configured = splitCsv(process.env.EVAL_BATCH_ENTITY_TYPES);
  if (configured) return configured;
  const body = await requestJson(`${apiBase}/custom-types?enabled_only=true&page_size=0`, {
    headers: authHeaders(token),
  });
  return (body.custom_types || []).map((item) => item.id).filter(Boolean);
}

async function createJob(apiBase, token, inputFiles, entityTypeIds) {
  return requestJson(`${apiBase}/jobs`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      job_type: 'smart_batch',
      title: `eval batch e2e ${new Date().toISOString()}`,
      skip_item_review: false,
      config: {
        batch_step1_configured: true,
        eval_script: 'eval-batch-e2e',
        input_count: inputFiles.length,
        entity_type_ids: entityTypeIds,
        selected_modes: ['text', 'image'],
      },
    }),
  });
}

async function uploadFile(apiBase, token, jobId, filePath) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeForFile(filePath) }), path.basename(filePath));
  form.append('job_id', jobId);
  form.append('upload_source', 'batch');
  return requestJson(`${apiBase}/files/upload`, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
  });
}

async function submitJob(apiBase, token, jobId) {
  return requestJson(`${apiBase}/jobs/${encodeURIComponent(jobId)}/submit`, {
    method: 'POST',
    headers: authHeaders(token),
  });
}

async function getJob(apiBase, token, jobId) {
  return requestJson(`${apiBase}/jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(token),
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollRecognition(apiBase, token, jobId) {
  const timeoutMs = Number.parseInt(process.env.EVAL_BATCH_WAIT_MS || '900000', 10);
  const pollMs = Number.parseInt(process.env.EVAL_BATCH_POLL_MS || '1000', 10);
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeoutMs) {
    last = await getJob(apiBase, token, jobId);
    assertJobMetadataHealthy(last, 'job polling');
    const items = last.items || [];
    const itemStatuses = items.map((item) => item.status);
    if (
      items.length > 0 &&
      itemStatuses.every((status) => TERMINAL_ITEM_STATUSES.has(status)) &&
      TERMINAL_JOB_STATUSES.has(last.status)
    ) {
      return last;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for recognition after ${timeoutMs}ms; last=${JSON.stringify(summarizeJob(last))}`);
}

function summarizeJob(job) {
  if (!job) return null;
  const navHints = job.nav_hints || {};
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    nav_hints: {
      metadata_degraded: Boolean(navHints.metadata_degraded),
      metadata_degraded_count: safeInteger(navHints.metadata_degraded_count, 0),
    },
    items: (job.items || []).map((item) => ({
      id: item.id,
      file_id: item.file_id,
      status: item.status,
      error_message: item.error_message,
      metadata_warning: item.metadata_warning || null,
    })),
  };
}

function jobMetadataDegradedCount(job) {
  const navHints = job?.nav_hints || {};
  const navCount = safeInteger(navHints.metadata_degraded_count, 0);
  const itemCount = (job?.items || [])
    .filter((item) => item?.metadata_warning === 'file_metadata_unavailable')
    .length;
  return Math.max(navCount, itemCount);
}

function assertJobMetadataHealthy(job, context) {
  const degradedCount = jobMetadataDegradedCount(job);
  if (degradedCount > 0 || job?.nav_hints?.metadata_degraded === true) {
    throw new Error(`metadata_degraded during ${context}: ${degradedCount || 'unknown'} file metadata record(s) unavailable`);
  }
}

async function getFileInfo(apiBase, token, fileId) {
  return requestJson(`${apiBase}/files/${encodeURIComponent(fileId)}`, {
    headers: authHeaders(token),
  });
}

function normalizeEntities(rawEntities) {
  return (Array.isArray(rawEntities) ? rawEntities : [])
    .map((entity, index) => ({
      id: stringOr(entity.id, `entity-${index + 1}`),
      text: stringOr(entity.text, ''),
      type: stringOr(entity.type, 'SENSITIVE_TEXT'),
      start: safeInteger(entity.start, 0),
      end: safeInteger(entity.end, Math.max(0, stringOr(entity.text, '').length)),
      page: safeInteger(entity.page, 1),
      confidence: safeNumber(entity.confidence, 1),
      source: ['regex', 'llm', 'manual', 'has'].includes(entity.source) ? entity.source : 'manual',
      coref_id: entity.coref_id ?? null,
      replacement: entity.replacement ?? null,
      selected: entity.selected !== false,
      custom_type_id: entity.custom_type_id ?? null,
    }))
    .filter((entity) => entity.text || entity.end >= entity.start);
}

function flattenBoundingBoxes(rawBoxes) {
  if (Array.isArray(rawBoxes)) return rawBoxes;
  if (!rawBoxes || typeof rawBoxes !== 'object') return [];
  return Object.values(rawBoxes).flatMap((value) => (Array.isArray(value) ? value : []));
}

function normalizeBoundingBoxes(rawBoxes) {
  return flattenBoundingBoxes(rawBoxes)
    .map((box, index) => ({
      id: stringOr(box.id, `box-${index + 1}`),
      x: clamp01(safeNumber(box.x, 0)),
      y: clamp01(safeNumber(box.y, 0)),
      width: clamp01(safeNumber(box.width, 0)),
      height: clamp01(safeNumber(box.height, 0)),
      page: safeInteger(box.page, 1),
      type: stringOr(box.type, 'visual_sensitive'),
      text: box.text == null ? null : String(box.text),
      selected: box.selected !== false,
      confidence: safeNumber(box.confidence, 1),
      source: normalizeBoxSource(box.source),
      source_detail: box.source_detail == null ? null : String(box.source_detail),
      evidence_source: box.evidence_source == null ? null : String(box.evidence_source),
      warnings: Array.isArray(box.warnings) ? box.warnings.map(String) : [],
    }))
    .filter((box) => box.width > 0 && box.height > 0);
}

function boundingBoxDiagnostics(boxes) {
  return (Array.isArray(boxes) ? boxes : []).map((box) => ({
    type: stringOr(box.type, 'visual_sensitive'),
    confidence: safeNumber(box.confidence, 1),
    source: normalizeBoxSource(box.source),
    page: safeInteger(box.page, 1),
    source_detail: box.source_detail == null ? null : String(box.source_detail),
    evidence_source: box.evidence_source == null ? null : String(box.evidence_source),
    warnings: Array.isArray(box.warnings) ? box.warnings.map(String) : [],
  }));
}

function normalizeBoxSource(source) {
  if (source === 'ocr_has' || source === 'has_image' || source === 'manual') return source;
  return source ? 'has_image' : 'manual';
}

function formatVisualIssueLabel(issue) {
  const labels = {
    edge_seal: 'Edge seal',
    seam_seal: 'Seam seal',
    fallback_detector: 'Fallback detector',
    low_confidence: 'Low confidence',
    large_ocr_region: 'Large OCR region',
    table_structure: 'Table structure',
    coarse_markup: 'Coarse markup',
    warning: 'Warning',
  };
  return labels[issue] || String(issue || 'Unknown issue')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function safeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envInteger(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envNumber(name, fallback) {
  const parsed = Number(process.env[name] || '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function includePrivateReportDetails() {
  return envBool('EVAL_REPORT_INCLUDE_PRIVATE_DETAILS', false);
}

function shortHash(value) {
  return sha256(value).slice(0, 16);
}

function pathBasename(value) {
  return String(value || '').replace(/\\/g, '/').split('/').pop() || String(value || '');
}

function inputRefForFile(filePath, index) {
  const resolved = path.resolve(filePath);
  const basename = pathBasename(resolved);
  const extension = path.extname(basename).toLowerCase();
  const ref = {
    label: `input-${String(index + 1).padStart(2, '0')}`,
    extension,
    path_sha256: shortHash(resolved),
    basename_sha256: shortHash(basename),
  };
  if (includePrivateReportDetails()) {
    ref.path = resolved;
    ref.basename = basename;
  }
  return ref;
}

function redactedName(value, fallback = 'file') {
  if (includePrivateReportDetails()) return String(value || '');
  const basename = pathBasename(value);
  const extension = path.extname(basename).toLowerCase();
  return `${fallback}-${shortHash(basename)}${extension}`;
}

function reportOutputDir(outDir) {
  const resolved = path.resolve(outDir);
  if (includePrivateReportDetails()) return resolved;
  const relative = path.relative(process.cwd(), resolved);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, '/');
  }
  return `output-${shortHash(resolved)}`;
}

function inputLabelForFileId(fileId, fileRefById, fallback = 'file') {
  const ref = fileRefById.get(String(fileId || ''));
  const fallbackExtension = path.extname(pathBasename(fallback)).toLowerCase();
  if (ref?.label) return `${ref.label}${fallbackExtension || ref.extension || ''}`;
  return redactedName(fallback, 'file');
}

function sanitizeUpload(uploaded, inputRef) {
  const safe = {
    file_id: uploaded.file_id,
    input_label: inputRef.label,
    input_extension: inputRef.extension,
    input_path_sha256: inputRef.path_sha256,
    file_type: uploaded.file_type,
    file_size: uploaded.file_size,
    page_count: uploaded.page_count,
  };
  if (includePrivateReportDetails()) {
    safe.filename = uploaded.filename;
  } else if (uploaded.filename) {
    safe.filename = `${inputRef.label}${path.extname(uploaded.filename).toLowerCase()}`;
  }
  return safe;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeVisionQuality(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const pages = {};
  for (const [page, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const pageQuality = value;
    const pipelineStatus = {};
    const rawStatus = pageQuality.pipeline_status;
    if (rawStatus && typeof rawStatus === 'object') {
      for (const [name, status] of Object.entries(rawStatus)) {
        if (!status || typeof status !== 'object') continue;
        pipelineStatus[name] = {
          ran: Boolean(status.ran),
          skipped: Boolean(status.skipped),
          failed: Boolean(status.failed),
          region_count: Number(status.region_count || 0),
          error: typeof status.error === 'string' ? status.error : status.error == null ? null : String(status.error),
        };
      }
    }
    pages[page] = {
      warnings: Array.isArray(pageQuality.warnings) ? pageQuality.warnings.map(String) : [],
      pipeline_status: pipelineStatus,
    };
  }
  return pages;
}

function boxWarningKeys(box) {
  return (Array.isArray(box.warnings) ? box.warnings : [])
    .map((warning) => String(warning || '').toLowerCase())
    .filter(Boolean);
}

function boxDiagnosticTokens(box) {
  return {
    source: String(box.source || '').toLowerCase(),
    sourceDetail: String(box.source_detail || '').toLowerCase(),
    evidenceSource: String(box.evidence_source || '').toLowerCase(),
    warnings: boxWarningKeys(box),
  };
}

function boxHasVisualToken(tokens, token) {
  return tokens.source.includes(token) ||
    tokens.sourceDetail.includes(token) ||
    tokens.evidenceSource.includes(token) ||
    tokens.warnings.some((warning) => warning.includes(token));
}

function isFallbackBox(tokens) {
  return boxHasVisualToken(tokens, 'fallback') ||
    tokens.warnings.includes('fallback_detector');
}

function isMissingEvidenceSource(box) {
  return String(box.evidence_source ?? '').trim() === '';
}

function isTableStructureBox(tokens) {
  return boxHasVisualToken(tokens, 'table_structure');
}

function isOcrTextBox(tokens) {
  return (boxHasVisualToken(tokens, 'ocr') || tokens.source === 'ocr_has') &&
    !isTableStructureBox(tokens);
}

function isHasImageModelBox(tokens) {
  if (isFallbackBox(tokens)) return false;
  if (tokens.evidenceSource === 'has_image_model') return true;
  return tokens.source === 'has_image' &&
    tokens.evidenceSource !== 'local_fallback' &&
    !isOcrTextBox(tokens) &&
    !isTableStructureBox(tokens);
}

function createEvidenceSourceSummary(file) {
  return {
    file_id: file.file_id || null,
    filename: file.filename || file.file_id || file.item_id || 'unknown',
    page: file.page == null ? null : safeInteger(file.page, 1),
    boxes: 0,
    has_image_model: 0,
    local_fallback: 0,
    ocr_has: 0,
    table_structure: 0,
    fallback_detector: 0,
    missing_evidence_source_boxes: 0,
    source_detail_counts: {},
    warnings_by_key: {},
  };
}

function addBoxToEvidenceSourceSummary(summary, box) {
  const tokens = boxDiagnosticTokens(box);
  const sourceDetail = String(box.source_detail || box.source || 'unknown');
  summary.boxes += 1;
  summary.source_detail_counts[sourceDetail] = (summary.source_detail_counts[sourceDetail] || 0) + 1;
  if (isHasImageModelBox(tokens)) {
    summary.has_image_model += 1;
  }
  if (isFallbackBox(tokens)) {
    summary.local_fallback += 1;
  }
  if (tokens.evidenceSource === 'ocr_has' || tokens.source === 'ocr_has') {
    summary.ocr_has += 1;
  }
  if (isTableStructureBox(tokens)) {
    summary.table_structure += 1;
  }
  if (tokens.warnings.includes('fallback_detector')) {
    summary.fallback_detector += 1;
  }
  if (isMissingEvidenceSource(box)) {
    summary.missing_evidence_source_boxes += 1;
  }
  for (const warning of boxWarningKeys(box)) {
    summary.warnings_by_key[warning] = (summary.warnings_by_key[warning] || 0) + 1;
  }
}

function evidenceSummarySortKey(row) {
  return [
    String(row.filename || ''),
    String(row.file_id || ''),
    String(row.page == null ? '' : row.page).padStart(8, '0'),
  ].join('\0');
}

function summarizeEvidenceSourcesByFileAndPage(reviewResults) {
  const byFile = new Map();
  const byFilePage = new Map();
  for (const result of reviewResults || []) {
    const fileKey = String(result.file_id || result.item_id || result.filename || 'unknown');
    if (!byFile.has(fileKey)) {
      byFile.set(fileKey, createEvidenceSourceSummary(result));
    }
    const fileSummary = byFile.get(fileKey);
    const diagnosticBoxes = result.bounding_box_diagnostics || result.bounding_boxes || [];
    for (const box of diagnosticBoxes) {
      const page = safeInteger(box.page, 1);
      const pageKey = `${fileKey}\0${page}`;
      if (!byFilePage.has(pageKey)) {
        byFilePage.set(pageKey, createEvidenceSourceSummary({ ...result, page }));
      }
      addBoxToEvidenceSourceSummary(fileSummary, box);
      addBoxToEvidenceSourceSummary(byFilePage.get(pageKey), box);
    }
  }
  const sortRows = (rows) => rows.sort((left, right) => evidenceSummarySortKey(left).localeCompare(evidenceSummarySortKey(right)));
  return {
    by_file: sortRows([...byFile.values()]),
    by_file_page: sortRows([...byFilePage.values()]),
  };
}

function summarizePipelineHealth(reviewResults) {
  const failures = [];
  let checked = 0;
  let fallbackDetectorBoxes = 0;
  let hasImageModelBoxes = 0;
  let localFallbackBoxes = 0;
  let ocrTextBoxes = 0;
  let tableStructureBoxes = 0;
  let lowConfidenceBoxes = 0;
  let missingEvidenceSourceBoxes = 0;
  const boxWarningsByKey = {};
  const sourceDetailCounts = {};
  const evidenceSourceSummary = summarizeEvidenceSourcesByFileAndPage(reviewResults);
  for (const result of reviewResults || []) {
    const diagnosticBoxes = result.bounding_box_diagnostics || result.bounding_boxes || [];
    for (const box of diagnosticBoxes) {
      const sourceDetail = String(box.source_detail || box.source || 'unknown');
      const tokens = boxDiagnosticTokens(box);
      const isFallback = isFallbackBox(tokens);
      sourceDetailCounts[sourceDetail] = (sourceDetailCounts[sourceDetail] || 0) + 1;
      if (isHasImageModelBox(tokens)) {
        hasImageModelBoxes += 1;
      }
      if (isFallback) {
        localFallbackBoxes += 1;
      }
      if (isOcrTextBox(tokens)) {
        ocrTextBoxes += 1;
      }
      if (Array.isArray(box.warnings) && box.warnings.includes('fallback_detector')) {
        fallbackDetectorBoxes += 1;
      }
      if (sourceDetail.includes('fallback') && !(Array.isArray(box.warnings) && box.warnings.includes('fallback_detector'))) {
        fallbackDetectorBoxes += 1;
      }
      if (isTableStructureBox(tokens)) {
        tableStructureBoxes += 1;
      }
      if (Number(box.confidence || 0) > 0 && Number(box.confidence || 0) < 0.55) {
        lowConfidenceBoxes += 1;
      }
      if (isMissingEvidenceSource(box)) {
        missingEvidenceSourceBoxes += 1;
      }
      for (const warning of Array.isArray(box.warnings) ? box.warnings : []) {
        const key = String(warning || 'warning');
        boxWarningsByKey[key] = (boxWarningsByKey[key] || 0) + 1;
      }
    }
    for (const [page, quality] of Object.entries(result.vision_quality || {})) {
      for (const [name, status] of Object.entries(quality.pipeline_status || {})) {
        if (status.skipped) continue;
        checked += 1;
        const label = `${result.filename || result.file_id || result.item_id} page ${page} ${name}`;
        if (status.failed) {
          failures.push(`${label} failed${status.error ? `: ${status.error}` : ''}`);
        } else if (!status.ran) {
          failures.push(`${label} did not run`);
        }
      }
    }
  }
  return {
    checked,
    failed: failures.length,
    failures,
    fallback_detector_boxes: fallbackDetectorBoxes,
    visual_diagnostics: {
      fallback_detector_boxes: fallbackDetectorBoxes,
      has_image_model_boxes: hasImageModelBoxes,
      local_fallback_boxes: localFallbackBoxes,
      ocr_text_boxes: ocrTextBoxes,
      table_structure_boxes: tableStructureBoxes,
      low_confidence_boxes: lowConfidenceBoxes,
      missing_evidence_source_boxes: missingEvidenceSourceBoxes,
      box_warnings_by_key: boxWarningsByKey,
      source_detail_counts: sourceDetailCounts,
      evidence_source_by_file: evidenceSourceSummary.by_file,
      evidence_source_by_file_page: evidenceSourceSummary.by_file_page,
    },
  };
}

async function commitReview(apiBase, token, jobId, item, fileInfo) {
  const entities = normalizeEntities(fileInfo.entities);
  const bounding_boxes = normalizeBoundingBoxes(fileInfo.bounding_boxes);
  const committed = await requestJson(
    `${apiBase}/jobs/${encodeURIComponent(jobId)}/items/${encodeURIComponent(item.id)}/review/commit?reviewer=eval-batch-e2e`,
    {
      method: 'POST',
      headers: authHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ entities, bounding_boxes }),
    },
  );
  return { committed, entities, bounding_boxes };
}

async function commitAllReviews(apiBase, token, jobId, jobDetail) {
  const results = [];
  for (const item of jobDetail.items || []) {
    const fileInfo = await getFileInfo(apiBase, token, item.file_id);
    if (item.status === 'failed' || item.status === 'cancelled') {
      results.push({ item, fileInfo, skipped: true, reason: item.status });
      continue;
    }
    if (item.status === 'completed') {
      results.push({
        item,
        fileInfo,
        skipped: true,
        reason: 'already_completed',
        entities: normalizeEntities(fileInfo.entities),
        bounding_boxes: normalizeBoundingBoxes(fileInfo.bounding_boxes),
        vision_quality: normalizeVisionQuality(fileInfo.vision_quality),
      });
      continue;
    }
    const result = await commitReview(apiBase, token, jobId, item, fileInfo);
    results.push({ item, fileInfo, vision_quality: normalizeVisionQuality(fileInfo.vision_quality), ...result });
  }
  return results;
}

async function getExportReport(apiBase, token, jobId, fileIds) {
  const params = new URLSearchParams();
  for (const fileId of fileIds) params.append('file_ids', fileId);
  const suffix = params.toString() ? `?${params}` : '';
  return requestJson(`${apiBase}/jobs/${encodeURIComponent(jobId)}/export-report${suffix}`, {
    headers: authHeaders(token),
  });
}

async function downloadBatchZip(apiBase, token, fileIds, redacted, outDir) {
  const response = await fetch(`${apiBase}/files/batch/download`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ file_ids: fileIds, redacted }),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    let detail = buffer.toString('utf8');
    try {
      detail = JSON.parse(detail).detail || detail;
    } catch {
      // keep raw detail
    }
    throw new Error(`batch zip download failed: HTTP ${response.status} ${detail}`);
  }
  const zipPath = path.join(outDir, redacted ? 'redacted.zip' : 'original.zip');
  await writeFile(zipPath, buffer);
  const manifest = inspectZip(zipPath);
  return {
    path: zipPath,
    bytes: buffer.length,
    headers: {
      requested: response.headers.get('X-Batch-Zip-Requested-Count'),
      included: response.headers.get('X-Batch-Zip-Included-Count'),
      skipped: response.headers.get('X-Batch-Zip-Skipped-Count'),
      redacted: response.headers.get('X-Batch-Zip-Redacted'),
    },
    manifest,
  };
}

function inspectZip(zipPath) {
  const python = pythonCmd();
  const code = [
    'import json, sys, zipfile',
    'sys.stdout.reconfigure(encoding="utf-8") if hasattr(sys.stdout, "reconfigure") else None',
    'p=sys.argv[1]',
    'with zipfile.ZipFile(p) as z:',
    '    names=z.namelist()',
    '    manifest=json.loads(z.read("manifest.json").decode("utf-8")) if "manifest.json" in names else None',
    '    entries=[{"name": n, "size": z.getinfo(n).file_size} for n in names]',
    'print(json.dumps({"entries": entries, "manifest": manifest}, ensure_ascii=False))',
  ].join('\n');
  const result = spawnSync(python, ['-c', code, zipPath], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (result.status !== 0) {
    throw new Error(`failed to inspect zip ${zipPath}: ${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function extractZipText(zipPath) {
  const python = pythonCmd();
  const code = [
    'import io, json, re, sys, zipfile',
    'sys.stdout.reconfigure(encoding="utf-8") if hasattr(sys.stdout, "reconfigure") else None',
    'p=sys.argv[1]',
    'text_ext={".txt",".md",".markdown",".html",".htm",".csv",".json",".xml"}',
    'def strip_xml(value):',
    '    value=re.sub(r"<[^>]+>", " ", value)',
    '    value=re.sub(r"\\s+", " ", value)',
    '    return value.strip()',
    'def decode_bytes(data):',
    '    for enc in ("utf-8", "utf-16", "gb18030", "latin-1"):',
    '        try:',
    '            return data.decode(enc)',
    '        except Exception:',
    '            pass',
    '    return data.decode("utf-8", "ignore")',
    'def docx_text(data):',
    '    parts=[]',
    '    with zipfile.ZipFile(io.BytesIO(data)) as dz:',
    '        for name in dz.namelist():',
    '            if name.startswith("word/") and name.endswith(".xml"):',
    '                parts.append(strip_xml(dz.read(name).decode("utf-8", "ignore")))',
    '    return "\\n".join(part for part in parts if part)',
    'def pdf_text(data):',
    '    try:',
    '        from pypdf import PdfReader',
    '    except Exception as exc:',
    '        return None, "pypdf_unavailable"',
    '    try:',
    '        reader=PdfReader(io.BytesIO(data))',
    '        return "\\n".join((page.extract_text() or "") for page in reader.pages), None',
    '    except Exception as exc:',
    '        return None, "pdf_extract_failed"',
    'out=[]',
    'with zipfile.ZipFile(p) as z:',
    '    for info in z.infolist():',
    '        name=info.filename',
    '        if name.endswith("/") or name=="manifest.json":',
    '            continue',
    '        ext=("."+name.rsplit(".",1)[-1].lower()) if "." in name.rsplit("/",1)[-1] else ""',
    '        data=z.read(name)',
    '        reason=None',
    '        text=None',
    '        if ext in text_ext:',
    '            text=strip_xml(decode_bytes(data)) if ext in {".html",".htm",".xml"} else decode_bytes(data)',
    '        elif ext==".docx":',
    '            try:',
    '                text=docx_text(data)',
    '            except Exception as exc:',
    '                reason="docx_extract_failed"',
    '        elif ext==".pdf":',
    '            text,reason=pdf_text(data)',
    '        else:',
    '            reason="unsupported_extension"',
    '        out.append({"name": name, "extension": ext, "checked": text is not None, "text": text or "", "reason": reason})',
    'print(json.dumps(out, ensure_ascii=False))',
  ].join('\n');
  const result = spawnSync(python, ['-c', code, zipPath], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`failed to extract zip text ${zipPath}: ${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function buildRedactionVerification(zipPath, reviewResults, fileRefById = new Map()) {
  const minLength = envInteger('EVAL_BATCH_MIN_LEAK_TEXT_LENGTH', 2);
  const extractedFiles = extractZipText(zipPath);
  const zipManifest = inspectZip(zipPath).manifest || {};
  const archiveToFileId = new Map(
    (zipManifest.included || [])
      .filter((item) => item && item.archive_name && item.file_id)
      .map((item) => [String(item.archive_name), String(item.file_id)]),
  );
  const checkedFiles = extractedFiles.filter((file) => file.checked);
  const skippedFiles = extractedFiles
    .filter((file) => !file.checked)
    .map((file) => {
      const fileId = archiveToFileId.get(file.name) || null;
      return {
        name: inputLabelForFileId(fileId, fileRefById, file.name),
        file_id: fileId,
        extension: file.extension,
        reason: file.reason || 'not_checked',
      };
    });
  const selectedEntities = [];
  for (const result of reviewResults || []) {
    for (const entity of result.entities || []) {
      if (entity.selected === false || !entity.text || entity.text.length < minLength) continue;
      const fileId = result.item?.file_id || null;
      selectedEntities.push({
        item_id: result.item?.id || null,
        file_id: fileId,
        filename: inputLabelForFileId(fileId, fileRefById, result.item?.filename || result.fileInfo?.original_filename),
        entity_id: entity.id,
        type: entity.type,
        text: entity.text,
      });
    }
  }
  const leaks = [];
  for (const entity of selectedEntities) {
    const comparableFiles = checkedFiles.filter((file) => {
      const archiveFileId = archiveToFileId.get(file.name);
      return !archiveFileId || !entity.file_id || archiveFileId === entity.file_id;
    });
    for (const file of comparableFiles) {
      if (file.text.includes(entity.text)) {
        const archiveFileId = archiveToFileId.get(file.name) || null;
        leaks.push({
          archive_name: inputLabelForFileId(archiveFileId, fileRefById, file.name),
          archive_file_id: archiveFileId,
          item_id: entity.item_id,
          file_id: entity.file_id,
          filename: entity.filename,
          entity_id: entity.entity_id,
          type: entity.type,
          text_length: entity.text.length,
          ...(includePrivateReportDetails() ? { text_sha256: sha256(entity.text) } : {}),
        });
        break;
      }
    }
  }
  return {
    checked_files: checkedFiles.map((file) => ({
      name: inputLabelForFileId(archiveToFileId.get(file.name), fileRefById, file.name),
      file_id: archiveToFileId.get(file.name) || null,
      extension: file.extension,
      text_length: file.text.length,
    })),
    skipped_files: skippedFiles,
    checked_entity_count: selectedEntities.length,
    leak_count: leaks.length,
    leaks,
  };
}

function normalizeArchiveName(value) {
  return String(value || '').replace(/\\/g, '/').split('/').pop() || String(value || '');
}

function isPdfName(value) {
  return /\.pdf$/i.test(normalizeArchiveName(value));
}

function buildZipEntryMap(zipSummary) {
  return new Map((zipSummary?.manifest?.entries || []).map((entry) => [String(entry.name), entry]));
}

function buildArchiveByFileId(zipSummary) {
  const byFileId = new Map();
  const entriesByName = buildZipEntryMap(zipSummary);
  for (const item of zipSummary?.manifest?.manifest?.included || []) {
    if (!item?.file_id || !item?.archive_name) continue;
    const entry = entriesByName.get(String(item.archive_name));
    byFileId.set(String(item.file_id), { manifest: item, entry });
  }
  return byFileId;
}

function sanitizeZipSummary(zipSummary, fileRefById) {
  if (includePrivateReportDetails()) return zipSummary;
  const archiveToFileId = new Map(
    (zipSummary?.manifest?.manifest?.included || [])
      .filter((item) => item?.archive_name && item?.file_id)
      .map((item) => [String(item.archive_name), String(item.file_id)]),
  );
  const safeArchiveName = (archiveName, fileId = null) =>
    inputLabelForFileId(fileId || archiveToFileId.get(String(archiveName || '')), fileRefById, archiveName);
  const safeManifest = zipSummary?.manifest?.manifest
    ? {
        ...zipSummary.manifest.manifest,
        included: (zipSummary.manifest.manifest.included || []).map((item) => ({
          ...item,
          filename: safeArchiveName(item.filename || item.archive_name, item.file_id),
          archive_name: safeArchiveName(item.archive_name || item.filename, item.file_id),
        })),
        skipped: (zipSummary.manifest.manifest.skipped || []).map((item) => ({
          ...item,
          filename: safeArchiveName(item.filename || item.archive_name, item.file_id),
          archive_name: item.archive_name ? safeArchiveName(item.archive_name, item.file_id) : null,
          reason: item.reason || null,
        })),
      }
    : null;
  return {
    ...zipSummary,
    path: pathBasename(zipSummary.path),
    manifest: {
      entries: (zipSummary?.manifest?.entries || []).map((entry) => ({
        ...entry,
        name: entry.name === 'manifest.json' ? entry.name : safeArchiveName(entry.name),
      })),
      manifest: safeManifest,
    },
  };
}

function sanitizeExportReport(report, fileRefById) {
  if (includePrivateReportDetails() || !report || typeof report !== 'object') return report;
  const sanitizeValue = (value, key = '', parent = {}) => {
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key, parent));
    if (!value || typeof value !== 'object') {
      if (
        typeof value === 'string' &&
        ['filename', 'original_filename', 'archive_name', 'original_archive_name', 'redacted_archive_name'].includes(key)
      ) {
        return inputLabelForFileId(parent.file_id, fileRefById, value);
      }
      return value;
    }
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = sanitizeValue(childValue, childKey, value);
    }
    return out;
  };
  return sanitizeValue(report);
}

function exportReportMetadataDegradedCount(report) {
  return (report?.files || [])
    .filter((file) =>
      file?.metadata_warning === 'file_metadata_unavailable' ||
      file?.error === 'file_metadata_unavailable' ||
      (Array.isArray(file?.blocking_reasons) && file.blocking_reasons.includes('file_metadata_unavailable'))
    )
    .length;
}

function assertExportReportMetadataHealthy(report) {
  const degradedCount = exportReportMetadataDegradedCount(report);
  if (degradedCount > 0) {
    throw new Error(`metadata_degraded during export report: ${degradedCount} file metadata record(s) unavailable`);
  }
}

function buildPdfSizeRegression(summary) {
  const maxRatio = envNumber('EVAL_BATCH_MAX_PDF_SIZE_RATIO', 8);
  const maxBytes = envInteger('EVAL_BATCH_MAX_PDF_SIZE_BYTES', 20 * 1024 * 1024);
  const warnRatio = envNumber('EVAL_BATCH_WARN_PDF_SIZE_RATIO', 4);
  const warnBytes = envInteger('EVAL_BATCH_WARN_PDF_SIZE_BYTES', 10 * 1024 * 1024);
  const thresholds = {
    max_pdf_size_ratio: maxRatio,
    max_pdf_size_bytes: maxBytes,
    warn_pdf_size_ratio: warnRatio,
    warn_pdf_size_bytes: warnBytes,
  };
  const originalByFileId = buildArchiveByFileId(summary.original_zip);
  const redactedByFileId = buildArchiveByFileId(summary.redacted_zip);
  const checked = [];
  const failures = [];
  const risks = [];

  for (const [fileId, redacted] of redactedByFileId.entries()) {
    const original = originalByFileId.get(fileId);
    const originalName = original?.manifest?.filename || original?.manifest?.archive_name;
    const redactedName = redacted?.manifest?.filename || redacted?.manifest?.archive_name;
    if (!isPdfName(originalName) && !isPdfName(redactedName)) continue;
    const originalBytes = Number(original?.entry?.size || 0);
    const redactedBytes = Number(redacted?.entry?.size || 0);
    const ratio = originalBytes > 0 ? redactedBytes / originalBytes : null;
    const item = {
      file_id: fileId,
      filename: redacted?.manifest?.archive_name || redactedName || originalName || fileId,
      original_archive_name: original?.manifest?.archive_name || null,
      redacted_archive_name: redacted?.manifest?.archive_name || null,
      original_bytes: originalBytes,
      redacted_bytes: redactedBytes,
      ratio: ratio == null ? null : Number(ratio.toFixed(3)),
      status: 'pass',
      messages: [],
    };
    if (originalBytes <= 0) {
      item.status = 'risk';
      item.messages.push('original PDF size unavailable');
    }
    if (redactedBytes <= 0) {
      item.status = 'fail';
      item.messages.push('redacted PDF is empty or size unavailable');
    }
    if (ratio != null && ratio > maxRatio) {
      item.status = 'fail';
      item.messages.push(`redacted/original PDF size ratio ${ratio.toFixed(2)} > ${maxRatio}`);
    }
    if (redactedBytes > maxBytes) {
      item.status = 'fail';
      item.messages.push(`redacted PDF size ${redactedBytes} > ${maxBytes} bytes`);
    }
    if (item.status !== 'fail' && ratio != null && ratio > warnRatio) {
      item.status = 'risk';
      item.messages.push(`redacted/original PDF size ratio ${ratio.toFixed(2)} > ${warnRatio}`);
    }
    if (item.status !== 'fail' && redactedBytes > warnBytes) {
      item.status = 'risk';
      item.messages.push(`redacted PDF size ${redactedBytes} > ${warnBytes} bytes`);
    }
    checked.push(item);
    if (item.status === 'fail') {
      failures.push(`${item.filename}: ${item.messages.join('; ')}`);
    } else if (item.status === 'risk') {
      risks.push(`${item.filename}: ${item.messages.join('; ')}`);
    }
  }

  return {
    checked_count: checked.length,
    failed_count: failures.length,
    risk_count: risks.length,
    thresholds,
    checked,
    failures,
    risks,
  };
}

function buildQualityGate(summary) {
  const failed = [];
  const expected = summary.inputs.length;
  const minFileDetections = envInteger('EVAL_BATCH_MIN_FILE_DETECTIONS', 1);
  const minTotalDetections = envInteger('EVAL_BATCH_MIN_TOTAL_DETECTIONS', expected);
  const minTotalEntities = envInteger('EVAL_BATCH_MIN_TOTAL_ENTITIES', 0);
  const minTotalBoxes = envInteger('EVAL_BATCH_MIN_TOTAL_BOXES', 0);
  if (summary.uploads.length !== expected) failed.push(`uploads ${summary.uploads.length} != inputs ${expected}`);
  if (summary.final_job.status !== 'completed') failed.push(`final job status is ${summary.final_job.status}`);
  for (const item of summary.final_job.items || []) {
    if (item.status !== 'completed') failed.push(`item ${item.id} status is ${item.status}`);
    if (item.error_message) failed.push(`item ${item.id} has error: ${item.error_message}`);
  }
  const reviewStats = (summary.review_results || []).reduce(
    (stats, result) => {
      const entities = Number(result.entity_count || 0);
      const boxes = Number(result.bounding_box_count || 0);
      stats.entities += entities;
      stats.boxes += boxes;
      stats.detections += entities + boxes;
      if (entities + boxes < minFileDetections) {
        stats.lowFiles.push(
          `${result.filename || result.file_id || result.item_id}: detections ${entities + boxes} < ${minFileDetections}`,
        );
      }
      return stats;
    },
    { entities: 0, boxes: 0, detections: 0, lowFiles: [] },
  );
  if (reviewStats.detections < minTotalDetections) {
    failed.push(`total detections ${reviewStats.detections} < ${minTotalDetections}`);
  }
  if (reviewStats.entities < minTotalEntities) {
    failed.push(`total text entities ${reviewStats.entities} < ${minTotalEntities}`);
  }
  if (reviewStats.boxes < minTotalBoxes) {
    failed.push(`total visual boxes ${reviewStats.boxes} < ${minTotalBoxes}`);
  }
  for (const lowFile of reviewStats.lowFiles) failed.push(`file below recognition threshold: ${lowFile}`);
  const pipelineHealth = summarizePipelineHealth(summary.review_results || []);
  for (const pipelineFailure of pipelineHealth.failures) {
    failed.push(`vision pipeline unhealthy: ${pipelineFailure}`);
  }
  if (summary.export_report.summary.action_required_files !== 0) {
    failed.push(`export report action_required_files ${summary.export_report.summary.action_required_files} != 0`);
  }
  if (!summary.export_report.summary.ready_for_delivery) failed.push('export report is not ready_for_delivery');
  const redactedManifest = summary.redacted_zip.manifest.manifest;
  if (!redactedManifest) failed.push('redacted zip missing manifest.json');
  if (redactedManifest && redactedManifest.included_count !== expected) {
    failed.push(`redacted zip included_count ${redactedManifest.included_count} != ${expected}`);
  }
  if (redactedManifest && redactedManifest.skipped_count !== 0) {
    failed.push(`redacted zip skipped_count ${redactedManifest.skipped_count} != 0`);
  }
  const redactedFiles = summary.redacted_zip.manifest.entries.filter((entry) => entry.name !== 'manifest.json');
  if (redactedFiles.length !== expected) failed.push(`redacted zip file entries ${redactedFiles.length} != ${expected}`);
  for (const entry of redactedFiles) {
    if (entry.size <= 0) failed.push(`redacted zip entry ${entry.name} is empty`);
  }
  const pdfSizeRegression = buildPdfSizeRegression(summary);
  for (const pdfFailure of pdfSizeRegression.failures) {
    failed.push(`redacted zip PDF size regression: ${pdfFailure}`);
  }
  const warningChecks = [];
  const missingEvidenceSourceBoxes = Number(
    pipelineHealth.visual_diagnostics?.missing_evidence_source_boxes || 0,
  );
  if (missingEvidenceSourceBoxes > 0) {
    warningChecks.push(`visual boxes missing evidence_source: ${missingEvidenceSourceBoxes}`);
  }
  const verification = summary.redaction_verification;
  if (verification) {
    if (Number(verification.leak_count || 0) > 0) {
      failed.push(`redacted zip leaked ${verification.leak_count} selected text entities`);
    }
    if (Number(verification.checked_entity_count || 0) > 0 && (verification.checked_files || []).length === 0) {
      failed.push('redacted zip text leakage could not be checked for any exported file');
    }
  }
  return {
    passed: failed.length === 0,
    failed_checks: failed,
    warning_checks: warningChecks,
    expected_files: expected,
    thresholds: {
      min_file_detections: minFileDetections,
      min_total_detections: minTotalDetections,
      min_total_entities: minTotalEntities,
      min_total_boxes: minTotalBoxes,
      ...pdfSizeRegression.thresholds,
    },
    recognition_totals: {
      detections: reviewStats.detections,
      entities: reviewStats.entities,
      bounding_boxes: reviewStats.boxes,
    },
    pipeline_health: pipelineHealth,
    pdf_size_regression: pdfSizeRegression,
  };
}

async function renderReport(summary, outDir) {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
  const exportReport = summary.export_report || {};
  const finalJob = summary.final_job || {};
  const byItemId = new Map((summary.review_results || []).map((result) => [result.item_id, result]));
  const exportByItemId = new Map((exportReport.files || []).map((file) => [file.item_id, file]));
  const yesNo = (value) => value ? 'yes' : 'no';
  const metric = (label, value, className = '') =>
    `<div class="metric">${esc(label)}<b class="${className}">${esc(value)}</b></div>`;
  const gate = summary.quality_gate || {};
  const totals = gate.recognition_totals || {};
  const thresholds = gate.thresholds || {};
  const pipelineHealth = gate.pipeline_health || {};
  const visualDiagnostics = pipelineHealth.visual_diagnostics || {};
  const sourceDetailRows = Object.entries(visualDiagnostics.source_detail_counts || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceDetail, count]) => `
    <tr><td>${esc(sourceDetail)}</td><td>${esc(count)}</td></tr>`)
    .join('');
  const warningTagRows = Object.entries(visualDiagnostics.box_warnings_by_key || {})
    .sort(([left], [right]) => formatVisualIssueLabel(left).localeCompare(formatVisualIssueLabel(right)))
    .map(([warning, count]) => `
    <tr><td>${esc(formatVisualIssueLabel(warning))}</td><td>${esc(count)}</td></tr>`)
    .join('');
  const evidenceSourceRows = (visualDiagnostics.evidence_source_by_file_page || [])
    .map((row) => `
    <tr>
      <td>${esc(row.filename || row.file_id || '')}</td>
      <td>${esc(row.page ?? '')}</td>
      <td>${esc(row.boxes ?? 0)}</td>
      <td>${esc(row.has_image_model ?? 0)}</td>
      <td>${esc(row.local_fallback ?? 0)}</td>
      <td>${esc(row.ocr_has ?? 0)}</td>
      <td>${esc(row.table_structure ?? 0)}</td>
      <td>${esc(row.fallback_detector ?? 0)}</td>
      <td>${esc(row.missing_evidence_source_boxes ?? 0)}</td>
    </tr>`)
    .join('');
  const exportSummary = exportReport.summary || {};
  const redactedManifest = summary.redacted_zip?.manifest?.manifest || {};
  const originalManifest = summary.original_zip?.manifest?.manifest || {};
  const visualIssueCount = Number(exportSummary.visual_review_issue_count || 0);
  const visualIssueFiles = Number(exportSummary.visual_review_issue_files || 0);
  const visualIssueEntries = Object.entries(exportSummary.visual_review_by_issue || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .sort(([issueA], [issueB]) => formatVisualIssueLabel(issueA).localeCompare(formatVisualIssueLabel(issueB)));
  const visualIssueRows = visualIssueEntries.map(([issue, count]) => `
    <tr>
      <td>${esc(formatVisualIssueLabel(issue))}</td>
      <td>${esc(count)}</td>
    </tr>`).join('');
  const visualIssueSummary = visualIssueEntries.length > 0
    ? `<table>
        <thead><tr><th>issue</th><th>count</th></tr></thead>
        <tbody>${visualIssueRows}</tbody>
      </table>`
    : '<p class="muted">No visual review risks recorded.</p>';
  const visualEvidence = exportSummary.visual_evidence || {};
  const visualEvidenceScalarKeys = [
    'total_boxes',
    'selected_boxes',
    'has_image_model',
    'local_fallback',
    'ocr_has',
    'table_structure',
    'fallback_detector',
  ];
  const visualEvidenceCounterKeys = [
    'source_counts',
    'evidence_source_counts',
    'source_detail_counts',
    'warnings_by_key',
  ];
  const formatCounterCell = (counter) => {
    const entries = Object.entries(counter || {})
      .filter(([, count]) => Number(count || 0) > 0)
      .sort(([left], [right]) => left.localeCompare(right));
    return entries.length > 0
      ? entries.map(([key, count]) => `<code>${esc(key)}</code>: ${esc(count)}`).join('<br>')
      : '<span class="muted">none</span>';
  };
  const visualEvidenceCounterTables = visualEvidenceCounterKeys.map((key) => {
    const rows = Object.entries(visualEvidence[key] || {})
      .filter(([, count]) => Number(count || 0) > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([counterKey, count]) => `
        <tr><td>${esc(counterKey)}</td><td>${esc(count)}</td></tr>`)
      .join('');
    return `
      <table>
        <thead><tr><th>${esc(key)}</th><th>boxes</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="2" class="muted">none</td></tr>'}</tbody>
      </table>`;
  }).join('');
  const visualEvidenceFileRows = (exportReport.files || []).map((file) => {
    const evidence = file.visual_evidence || {};
    return `
    <tr>
      <td>${esc(file.filename || file.file_id || '')}</td>
      <td>${esc(file.delivery_status || file.status || '')}</td>
      <td>${esc(evidence.total_boxes ?? 0)}</td>
      <td>${esc(evidence.selected_boxes ?? 0)}</td>
      <td>${esc(evidence.has_image_model ?? 0)}</td>
      <td>${esc(evidence.local_fallback ?? 0)}</td>
      <td>${esc(evidence.ocr_has ?? 0)}</td>
      <td>${esc(evidence.table_structure ?? 0)}</td>
      <td>${esc(evidence.fallback_detector ?? 0)}</td>
      <td>${formatCounterCell(evidence.source_counts)}</td>
      <td>${formatCounterCell(evidence.evidence_source_counts)}</td>
      <td>${formatCounterCell(evidence.source_detail_counts)}</td>
      <td>${formatCounterCell(evidence.warnings_by_key)}</td>
    </tr>`;
  }).join('');
  const redactionVerification = summary.redaction_verification || {};
  const pdfSizeRegression = gate.pdf_size_regression || {};
  const pdfSizeGateSummary =
    `${pdfSizeRegression.checked_count ?? 0} checked / ${pdfSizeRegression.failed_count ?? 0} fail / ${pdfSizeRegression.risk_count ?? 0} risk`;
  const pdfSizeRows = (pdfSizeRegression.checked || []).map((item) => `
    <tr>
      <td>${esc(item.filename || item.file_id)}</td>
      <td>${esc(item.original_bytes ?? 0)}</td>
      <td>${esc(item.redacted_bytes ?? 0)}</td>
      <td>${esc(item.ratio ?? '')}</td>
      <td class="${item.status === 'fail' ? 'fail' : item.status === 'risk' ? 'warn' : 'pass'}">${esc(item.status || '')}</td>
      <td>${esc((item.messages || []).join('; '))}</td>
    </tr>`).join('');
  const leakRows = (redactionVerification.leaks || []).map((leak) => `
    <tr>
      <td>${esc(leak.archive_name)}</td>
      <td>${esc(leak.filename || leak.file_id || '')}</td>
      <td>${esc(leak.type)}</td>
      <td><code>${esc(String(leak.text_sha256 || '').slice(0, 12))}</code></td>
      <td>${esc(leak.text_length || 0)}</td>
    </tr>`).join('');
  const skippedVerificationRows = (redactionVerification.skipped_files || []).map((file) => `
    <tr>
      <td>${esc(file.name)}</td>
      <td>${esc(file.extension || '')}</td>
      <td>${esc(file.reason || '')}</td>
    </tr>`).join('');
  const verificationBlock = redactionVerification.checked_entity_count == null
    ? '<p class="muted">Redacted ZIP leakage verification has not run.</p>'
    : `
      <div class="metrics">
        ${metric('Checked entities', redactionVerification.checked_entity_count ?? 0)}
        ${metric('Checked files', (redactionVerification.checked_files || []).length)}
        ${metric('Skipped files', (redactionVerification.skipped_files || []).length, (redactionVerification.skipped_files || []).length === 0 ? 'pass' : 'warn')}
        ${metric('Leaks', redactionVerification.leak_count ?? 0, Number(redactionVerification.leak_count || 0) === 0 ? 'pass' : 'fail')}
      </div>
      ${leakRows ? `
        <h3>Leaks</h3>
        <table>
          <thead><tr><th>archive file</th><th>source file</th><th>type</th><th>text hash</th><th>length</th></tr></thead>
          <tbody>${leakRows}</tbody>
        </table>` : '<p class="pass">No selected text entity leaks were found in checked redacted outputs.</p>'}
      ${skippedVerificationRows ? `
        <h3>Skipped Outputs</h3>
        <table>
          <thead><tr><th>archive file</th><th>extension</th><th>reason</th></tr></thead>
          <tbody>${skippedVerificationRows}</tbody>
        </table>` : ''}`;
  const rows = (finalJob.items || []).map((item) => {
    const review = byItemId.get(item.id) || {};
    const exported = exportByItemId.get(item.id) || {};
    const detections = Number(review.entity_count || 0) + Number(review.bounding_box_count || 0);
    const visualReview = exported.visual_review || {};
    const itemVisualIssueCount = Number(visualReview.issue_count || 0);
    const itemVisualIssuePages = Array.isArray(visualReview.issue_pages) && visualReview.issue_pages.length > 0
      ? ` p.${visualReview.issue_pages.join(', ')}`
      : '';
    return `
    <tr>
      <td>${esc(item.filename || item.file_id)}</td>
      <td>${esc(item.status)}</td>
      <td>${esc(detections)}</td>
      <td>${esc(review.entity_count || 0)}</td>
      <td>${esc(review.bounding_box_count || 0)}</td>
      <td class="${itemVisualIssueCount > 0 ? 'warn' : ''}">${esc(`${itemVisualIssueCount}${itemVisualIssuePages}`)}</td>
      <td>${esc(yesNo(exported.review_confirmed))}</td>
      <td>${esc(yesNo(exported.ready_for_delivery))}</td>
      <td>${esc(yesNo(item.has_output))}</td>
      <td>${esc(item.error_message || '')}</td>
    </tr>`;
  }).join('');
  const failures = (gate.failed_checks || []).map((item) => `<li>${esc(item)}</li>`).join('') || '<li>No failed checks</li>';
  const thresholdRows = Object.entries(thresholds).map(([key, value]) => `
    <tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join('');
  const deliveryFailures = (gate.failed_checks || [])
    .filter((item) => /ready_for_delivery|action_required|final job|item .*status|has error/.test(item))
    .map((item) => `<li>${esc(item)}</li>`).join('') || '<li>No delivery failures</li>';
  const recognitionFailures = (gate.failed_checks || [])
    .filter((item) => /detection|entities|boxes|recognition threshold|vision pipeline/.test(item))
    .map((item) => `<li>${esc(item)}</li>`).join('') || '<li>No recognition failures</li>';
  const zipFailures = (gate.failed_checks || [])
    .filter((item) => /zip/.test(item))
    .map((item) => `<li>${esc(item)}</li>`).join('') || '<li>No ZIP failures</li>';
  const errorBlock = summary.error
    ? `<section>
        <h2>Failure</h2>
        <p class="fail"><b>${esc(summary.error.stage || 'failed')}</b>: ${esc(summary.error.message)}</p>
      </section>`
    : '';
  const nextStepRows = (summary.next_steps || [])
    .map((step) => `<li><code>${esc(step)}</code></li>`)
    .join('');
  const nextStepsBlock = nextStepRows
    ? `<section>
        <h2>Next Steps</h2>
        <ul>${nextStepRows}</ul>
      </section>`
    : '';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Batch E2E Evaluation</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; background: #f8fafc; }
    header, section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .metric { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; background: #f9fafb; }
    .metric b { display: block; font-size: 24px; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .compact { font-size: 12px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 7px; text-align: left; vertical-align: top; }
    code { background: #f3f4f6; border-radius: 4px; padding: 1px 4px; }
    .pass { color: #047857; }
    .fail { color: #b91c1c; }
    .warn { color: #92400e; }
    .muted { color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <h1>Batch E2E Evaluation</h1>
    <p>${esc(summary.job_id)}</p>
    <div class="metrics">
      ${metric('Files', summary.inputs.length)}
      ${metric('Job', finalJob.status || summary.recognized_job?.status || summary.submitted?.status || 'not finished')}
      ${metric('Ready', yesNo(exportSummary.ready_for_delivery), exportSummary.ready_for_delivery ? 'pass' : 'fail')}
      ${metric('Quality', gate.passed == null ? 'INCOMPLETE' : gate.passed ? 'PASS' : 'FAIL', gate.passed == null ? 'warn' : gate.passed ? 'pass' : 'fail')}
      ${metric('Detections', totals.detections ?? 0)}
      ${metric('Entities', totals.entities ?? 0)}
      ${metric('Boxes', totals.bounding_boxes ?? 0)}
      ${metric('Pipeline failures', pipelineHealth.failed ?? 0, Number(pipelineHealth.failed || 0) === 0 ? 'pass' : 'fail')}
      ${metric('Action required', exportSummary.action_required_files ?? 0, Number(exportSummary.action_required_files || 0) === 0 ? 'pass' : 'fail')}
      ${metric('Visual issues', visualIssueCount, visualIssueCount === 0 ? 'pass' : 'warn')}
      ${metric('Redacted ZIP', `${redactedManifest.included_count ?? '?'} in / ${redactedManifest.skipped_count ?? '?'} skipped`, Number(redactedManifest.skipped_count || 0) === 0 ? 'pass' : 'fail')}
      ${metric('PDF size gate', pdfSizeGateSummary, Number(pdfSizeRegression.failed_count || 0) === 0 ? ((Number(pdfSizeRegression.risk_count || 0) === 0) ? 'pass' : 'warn') : 'fail')}
      ${metric('Wall ms', summary.wall_ms)}
    </div>
  </header>
  <section>
    <h2>Quality Gate</h2>
    <p class="muted">The report is deliverable only when recognition thresholds, review completion, export readiness, and ZIP contents all pass.</p>
    <ul class="${gate.passed ? 'pass' : 'fail'}">${failures}</ul>
    <div class="grid">
      <div>
        <h3>Recognition</h3>
        <ul>${recognitionFailures}</ul>
      </div>
      <div>
        <h3>Delivery</h3>
        <ul>${deliveryFailures}</ul>
      </div>
      <div>
        <h3>ZIP</h3>
        <ul>${zipFailures}</ul>
      </div>
    </div>
  </section>
  ${errorBlock}
  ${nextStepsBlock}
  <section>
    <h2>Thresholds And Totals</h2>
    <div class="grid">
      <table>
        <thead><tr><th>threshold</th><th>value</th></tr></thead>
        <tbody>${thresholdRows}</tbody>
      </table>
      <table>
        <thead><tr><th>artifact</th><th>included</th><th>skipped</th></tr></thead>
        <tbody>
          <tr><td>original.zip</td><td>${esc(originalManifest.included_count ?? '?')}</td><td>${esc(originalManifest.skipped_count ?? '?')}</td></tr>
          <tr><td>redacted.zip</td><td>${esc(redactedManifest.included_count ?? '?')}</td><td>${esc(redactedManifest.skipped_count ?? '?')}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
  <section>
    <h2>Pipeline Health</h2>
    <p class="muted">Non-skipped vision pipelines must run and must not fail. Model, fallback, OCR, and table buckets are separated so fallback recovery cannot hide HaS Image quality.</p>
    <div class="metrics">
      ${metric('Checked pipelines', pipelineHealth.checked ?? 0)}
      ${metric('Pipeline failures', pipelineHealth.failed ?? 0, Number(pipelineHealth.failed || 0) === 0 ? 'pass' : 'fail')}
      ${metric('HaS Image model boxes', visualDiagnostics.has_image_model_boxes ?? 0)}
      ${metric('Local fallback boxes', visualDiagnostics.local_fallback_boxes ?? 0, Number(visualDiagnostics.local_fallback_boxes || 0) === 0 ? 'pass' : 'warn')}
      ${metric('OCR text boxes', visualDiagnostics.ocr_text_boxes ?? 0, Number(visualDiagnostics.ocr_text_boxes || 0) === 0 ? 'pass' : 'warn')}
      ${metric('Fallback detector boxes', pipelineHealth.fallback_detector_boxes ?? 0, Number(pipelineHealth.fallback_detector_boxes || 0) === 0 ? 'pass' : 'warn')}
      ${metric('Table structure boxes', visualDiagnostics.table_structure_boxes ?? 0, Number(visualDiagnostics.table_structure_boxes || 0) === 0 ? 'pass' : 'warn')}
      ${metric('Low confidence boxes', visualDiagnostics.low_confidence_boxes ?? 0, Number(visualDiagnostics.low_confidence_boxes || 0) === 0 ? 'pass' : 'warn')}
      ${metric('Missing evidence_source boxes', visualDiagnostics.missing_evidence_source_boxes ?? 0, Number(visualDiagnostics.missing_evidence_source_boxes || 0) === 0 ? 'pass' : 'warn')}
    </div>
    <h3>Evidence Source By File And Page</h3>
    <table class="compact">
      <thead>
        <tr>
          <th>file</th>
          <th>page</th>
          <th>boxes</th>
          <th>has_image_model</th>
          <th>local_fallback</th>
          <th>ocr_has</th>
          <th>table_structure</th>
          <th>fallback_detector</th>
          <th>missing_evidence_source_boxes</th>
        </tr>
      </thead>
      <tbody>${evidenceSourceRows || '<tr><td colspan="9" class="muted">No per-page visual evidence source diagnostics.</td></tr>'}</tbody>
    </table>
    <div class="grid">
      <table>
        <thead><tr><th>source detail</th><th>boxes</th></tr></thead>
        <tbody>${sourceDetailRows || '<tr><td colspan="2" class="muted">No source detail diagnostics.</td></tr>'}</tbody>
      </table>
      <table>
        <thead><tr><th>warning</th><th>boxes</th></tr></thead>
        <tbody>${warningTagRows || '<tr><td colspan="2" class="muted">No box warnings.</td></tr>'}</tbody>
      </table>
    </div>
    ${(pipelineHealth.failures || []).length > 0
      ? `<ul class="fail">${pipelineHealth.failures.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
      : '<p class="pass">No unhealthy non-skipped vision pipelines were recorded.</p>'}
  </section>
  <section>
    <h2>Export Summary</h2>
    <div class="metrics">
      ${metric('Selected', exportSummary.selected_files ?? 0)}
      ${metric('Redacted selected', exportSummary.redacted_selected_files ?? 0)}
      ${metric('Review confirmed', exportSummary.review_confirmed_selected_files ?? 0)}
      ${metric('Failed selected', exportSummary.failed_selected_files ?? 0, Number(exportSummary.failed_selected_files || 0) === 0 ? 'pass' : 'fail')}
      ${metric('Coverage', exportSummary.redaction_coverage ?? 0)}
      ${metric('Visual issue files', visualIssueFiles, visualIssueFiles === 0 ? 'pass' : 'warn')}
      ${metric('Visual issues', visualIssueCount, visualIssueCount === 0 ? 'pass' : 'warn')}
    </div>
  </section>
  <section>
    <h2>Visual Review Risks</h2>
    <p class="muted">Visual risks do not fail export by themselves, but they show files that still deserve manual review before delivery.</p>
    ${visualIssueSummary}
  </section>
  <section>
    <h2>Export Visual Evidence</h2>
    <p class="muted">These counters come from export_report.summary.visual_evidence and files[].visual_evidence. They are separate from pipeline visual diagnostics.</p>
    <div class="metrics">
      ${visualEvidenceScalarKeys.map((key) => metric(key, visualEvidence[key] ?? 0, ['local_fallback', 'ocr_has', 'table_structure', 'fallback_detector'].includes(key) && Number(visualEvidence[key] || 0) > 0 ? 'warn' : '')).join('')}
    </div>
    <div class="grid">${visualEvidenceCounterTables}</div>
    <h3>Files</h3>
    <table class="compact">
      <thead>
        <tr>
          <th>file</th>
          <th>status</th>
          <th>total_boxes</th>
          <th>selected_boxes</th>
          <th>has_image_model</th>
          <th>local_fallback</th>
          <th>ocr_has</th>
          <th>table_structure</th>
          <th>fallback_detector</th>
          <th>source_counts</th>
          <th>evidence_source_counts</th>
          <th>source_detail_counts</th>
          <th>warnings_by_key</th>
        </tr>
      </thead>
      <tbody>${visualEvidenceFileRows || '<tr><td colspan="13" class="muted">No export visual evidence files.</td></tr>'}</tbody>
    </table>
  </section>
  <section>
    <h2>Redacted ZIP Verification</h2>
    <p class="muted">For text-extractable outputs, the evaluator checks that selected entity text no longer appears in the redacted ZIP. Non-text outputs are listed as skipped rather than treated as covered.</p>
    ${verificationBlock}
  </section>
  <section>
    <h2>PDF Size Regression</h2>
    <p class="muted">Redacted PDF outputs are compared against original ZIP PDF entries so rasterization regressions are visible before delivery.</p>
    ${pdfSizeRows ? `
      <table>
        <thead><tr><th>file</th><th>original bytes</th><th>redacted bytes</th><th>ratio</th><th>status</th><th>message</th></tr></thead>
        <tbody>${pdfSizeRows}</tbody>
      </table>` : '<p class="muted">No PDF outputs were present in the batch ZIPs.</p>'}
  </section>
  <section>
    <h2>Items</h2>
    <table>
      <thead><tr><th>file</th><th>status</th><th>detections</th><th>entities</th><th>boxes</th><th>visual issues</th><th>review</th><th>ready</th><th>output</th><th>error</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>
</body>
</html>`;
  await writeFile(path.join(outDir, 'report.html'), html, 'utf8');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function quoteCommandArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function buildFailureNextSteps(summary) {
  const steps = [
    `Open ${summary.output_dir || 'the output directory'}/report.html`,
    `Review ${summary.output_dir || 'the output directory'}/summary.partial.json`,
  ];
  if (summary.job_id) {
    steps.push(`curl ${summary.api}/jobs/${encodeURIComponent(summary.job_id)}`);
    steps.push(`curl ${summary.api}/jobs/${encodeURIComponent(summary.job_id)}/export-report`);
  }
  if (summary.job_id && (summary.final_job?.items || summary.recognized_job?.items || []).some((item) => item.status === 'failed')) {
    steps.push(`curl -X POST ${summary.api}/jobs/${encodeURIComponent(summary.job_id)}/requeue-failed`);
  }
  if (needsBackendStorageTriage(summary)) {
    steps.push(
      'Check backend logs around the failed job/export request for file metadata or SQLite errors; share only redacted file IDs, request path, and timestamp.',
      'Check SQLite storage: avoid WSL drvfs mounts for the backend data/database files, and confirm SQLite WAL (-wal/-shm) files are writable.',
      'Run npm run doctor:strict and inspect output/doctor-report.json for backend service, data directory, and storage warnings.',
    );
  }
  if (includePrivateReportDetails()) {
    const rerunArgs = [
      quoteCommandArg(summary.output_dir || path.join('output', 'playwright', 'eval-batch-current')),
      ...(summary.inputs || []).map((input) => quoteCommandArg(input.path || input)),
    ].join(' ');
    steps.push(`npm run eval:batch-e2e -- ${rerunArgs}`);
  } else {
    steps.push(
      `npm run eval:batch-e2e -- ${quoteCommandArg(summary.output_dir || path.join('output', 'playwright', 'eval-batch-current'))} <same input files in the listed input order>`,
    );
  }
  return steps;
}

function needsBackendStorageTriage(summary) {
  const stage = String(summary?.error?.stage || '').toLowerCase();
  if (!/(recognition|job polling|export report)/.test(stage)) return false;
  const message = String(summary?.error?.message || '').toLowerCase();
  if (message.includes('http 500') || message.includes('metadata_degraded')) return true;
  if (summary?.recognized_job?.nav_hints?.metadata_degraded) return true;
  if (summary?.final_job?.nav_hints?.metadata_degraded) return true;
  return exportReportMetadataDegradedCount(summary?.export_report) > 0;
}

async function writePartialArtifacts(summary, outDir, error, stage) {
  summary.error = {
    stage,
    message: errorMessage(error),
  };
  summary.next_steps = buildFailureNextSteps(summary);
  await writeFile(path.join(outDir, 'summary.partial.json'), JSON.stringify(summary, null, 2), 'utf8');
  await renderReport(summary, outDir);
}

async function removeStalePartialArtifacts(outDir) {
  try {
    await unlink(path.join(outDir, 'summary.partial.json'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function main() {
  const { outDir, files } = parseArgs(process.argv.slice(2));
  const env = resolveEvalEnv();
  const apiBase = (env.DATAINFRA_API || DEFAULT_API).replace(/\/+$/, '');
  await mkdir(outDir, { recursive: true });
  await removeStalePartialArtifacts(outDir);
  const started = performance.now();
  const inputRefs = files.map((file, index) => inputRefForFile(file, index));
  const fileRefById = new Map();
  const summary = {
    generated_at: new Date().toISOString(),
    api: apiBase,
    output_dir: reportOutputDir(outDir),
    privacy: {
      private_details: includePrivateReportDetails(),
      note: includePrivateReportDetails()
        ? 'Private report details are enabled; paths and original names may appear.'
        : 'Private paths and original names are redacted by default. Set EVAL_REPORT_INCLUDE_PRIVATE_DETAILS=1 for local-only raw details.',
    },
    inputs: inputRefs,
    uploads: [],
    review_results: [],
  };
  let stage = 'auth';
  try {
    const { token, authStatus } = await resolveAuthToken(apiBase, env);
    summary.auth_status = authStatus;
    stage = 'service health';
    summary.service_health = await tryRequestJson(`${apiRoot(apiBase)}/health/services`);
    stage = 'entity types';
    const entityTypeIds = await getEnabledEntityTypes(apiBase, token);
    summary.entity_type_count = entityTypeIds.length;
    stage = 'create job';
    const job = await createJob(apiBase, token, files, entityTypeIds);
    summary.job_id = job.id;
    for (const [index, file] of files.entries()) {
      stage = `upload ${inputRefs[index].label}${inputRefs[index].extension}`;
      const uploaded = await uploadFile(apiBase, token, job.id, file);
      fileRefById.set(String(uploaded.file_id), inputRefs[index]);
      summary.uploads.push(sanitizeUpload(uploaded, inputRefs[index]));
      console.log(`uploaded ${inputRefs[index].label}${inputRefs[index].extension} -> ${uploaded.file_id}`);
    }
    stage = 'submit job';
    summary.submitted = await submitJob(apiBase, token, job.id);
    console.log(`submitted job ${job.id}: ${summary.submitted.status}`);
    stage = 'recognition';
    const recognizedJob = await pollRecognition(apiBase, token, job.id);
    summary.recognized_job = summarizeJob(recognizedJob);
    console.log(`recognition reached ${recognizedJob.status}`);
    stage = 'commit reviews';
    const reviewResults = await commitAllReviews(apiBase, token, job.id, recognizedJob);
    summary.review_results = reviewResults.map((result) => ({
      item_id: result.item.id,
      file_id: result.item.file_id,
      filename: inputLabelForFileId(result.item.file_id, fileRefById, result.item.filename || result.fileInfo?.original_filename),
      skipped: Boolean(result.skipped),
      reason: result.reason || null,
      entity_count: (result.entities || []).length,
      bounding_box_count: (result.bounding_boxes || []).length,
      bounding_box_diagnostics: boundingBoxDiagnostics(result.bounding_boxes || []),
      vision_quality: result.vision_quality || normalizeVisionQuality(result.fileInfo?.vision_quality),
      committed_status: result.committed?.status || null,
    }));
    stage = 'final job';
    const finalJob = await getJob(apiBase, token, job.id);
    summary.final_job = summarizeJob(finalJob);
    const fileIds = summary.uploads.map((upload) => upload.file_id);
    stage = 'export report';
    const rawExportReport = await getExportReport(apiBase, token, job.id, fileIds);
    summary.export_report = sanitizeExportReport(rawExportReport, fileRefById);
    await writeFile(path.join(outDir, 'export-report.json'), JSON.stringify(summary.export_report, null, 2), 'utf8');
    assertExportReportMetadataHealthy(rawExportReport);
    stage = 'download original zip';
    const originalZip = await downloadBatchZip(apiBase, token, fileIds, false, outDir);
    summary.original_zip = sanitizeZipSummary(originalZip, fileRefById);
    stage = 'download redacted zip';
    const redactedZip = await downloadBatchZip(apiBase, token, fileIds, true, outDir);
    summary.redacted_zip = sanitizeZipSummary(redactedZip, fileRefById);
    stage = 'verify redacted zip';
    summary.redaction_verification = buildRedactionVerification(redactedZip.path, reviewResults, fileRefById);
    summary.wall_ms = Math.round(performance.now() - started);
    summary.quality_gate = buildQualityGate(summary);
    await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    await renderReport(summary, outDir);
    console.log(`summary: ${summary.output_dir}/summary.json`);
    console.log(`report: ${summary.output_dir}/report.html`);
    console.log(
      `files=${summary.inputs.length} job=${summary.final_job.status} ` +
      `ready=${summary.export_report.summary.ready_for_delivery} ` +
      `pdf=${summary.quality_gate.pdf_size_regression.checked_count} checked/` +
      `${summary.quality_gate.pdf_size_regression.failed_count} fail/` +
      `${summary.quality_gate.pdf_size_regression.risk_count} risk ` +
      `quality=${summary.quality_gate.passed ? 'pass' : 'fail'}`,
    );
    if (!summary.quality_gate.passed) {
      for (const check of summary.quality_gate.failed_checks) {
        console.error(`quality gate failed: ${check}`);
      }
      process.exit(1);
    }
  } catch (error) {
    summary.wall_ms = Math.round(performance.now() - started);
    try {
      await writePartialArtifacts(summary, outDir, error, stage);
      console.error(`partial summary: ${summary.output_dir}/summary.partial.json`);
      console.error(`failure report: ${summary.output_dir}/report.html`);
    } catch (writeError) {
      console.error(`failed to write partial artifacts: ${errorMessage(writeError)}`);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
