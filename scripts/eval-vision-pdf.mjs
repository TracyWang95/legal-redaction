#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { authHeaders, requestJson, resolveAuthToken, resolveEvalEnv, tryRequestJson } from './eval-auth.mjs';

const DEFAULT_API = 'http://127.0.0.1:8000/api/v1';
const DEFAULT_EXCLUDED_HAS_IMAGE_IDS = new Set(['paper']);
const VISUAL_BOX_TYPES = new Set([
  'face',
  'fingerprint',
  'official_seal',
  'qr_code',
  'qrcode',
  'barcode',
  'photo',
  'portrait',
  'stamp',
  'seal',
]);

function usage() {
  console.log(`Usage:
  DATAINFRA_TOKEN=... node scripts/eval-vision-pdf.mjs <pdf-or-image-path> [output-dir] [--pages 1,5]
  node scripts/eval-vision-pdf.mjs --render-report <summary.json>

Options via env:
  DATAINFRA_API       API base, default ${DEFAULT_API}
  DATAINFRA_PASSWORD  Login password for the local app
  DATAINFRA_TOKEN     Existing Bearer token; preferred over DATAINFRA_PASSWORD when set
  DATAINFRA_TOKEN_FILE  File containing a Bearer token; used when DATAINFRA_TOKEN is not set
  EVAL_OCR_TYPES      Comma-separated OCR+HaS type ids; default reads /vision-pipelines
  EVAL_IMAGE_TYPES    Comma-separated HaS Image type ids; default reads /vision-pipelines excluding paper
  EVAL_VISION_PAGES   Optional page selection, for example 1,5 or 1,3-4
  EVAL_VISION_CONCURRENCY  Page concurrency, default 1
  EVAL_REDACTION_PREVIEW   Generate page-xx-redacted.png previews, default true
  EVAL_VISION_MIN_TOTAL_BOXES  Fail below this total, default page count
  EVAL_VISION_MIN_PAGE_BOXES   Fail below this per page, default 1
  EVAL_VISION_MIN_TOTAL_VISUAL_BOXES  Fail below this visual-box total, default 0
  EVAL_VISION_MIN_PAGE_VISUAL_BOXES   Fail below this visual-box count per page, default 0
  EVAL_VISION_MIN_TOTAL_HAS_IMAGE_BOXES  Fail below this HaS Image box total, default 0
  EVAL_VISION_MIN_PAGE_HAS_IMAGE_BOXES   Fail below this HaS Image box count per page, default 0
  EVAL_VISION_MAX_WARNINGS     Fail above this warning count, default -1 (disabled)
  EVAL_VISION_MAX_PAGE_MS      Fail when any page exceeds this, default 0 (disabled)
  EVAL_VISION_REQUIRE_ALL_ONLINE  Fail when /health/services is not all_online, default false
`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  if (argv[0] === '--render-report') {
    return { renderReport: argv[1], pdfPath: null, outDir: null, pages: [] };
  }

  const positional = [];
  const pages = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pages') {
      index += 1;
      while (index < argv.length && !argv[index].startsWith('--')) {
        pages.push(argv[index]);
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (arg.startsWith('--pages=')) {
      pages.push(arg.slice('--pages='.length));
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  return {
    renderReport: null,
    pdfPath: positional[0] || null,
    outDir: positional[1] || null,
    pages,
  };
}

function normalizePagesArg(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join(',');
  }
  return String(value).trim();
}

function parsePages(value, pageCount) {
  const normalized = normalizePagesArg(value);
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
  if (invalid.length) {
    throw new Error(`Page selection out of range 1-${pageCount}: ${invalid.join(', ')}`);
  }
  return deduped;
}

function splitCsv(value) {
  if (!value) return null;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultTypeIds(pipelines, mode) {
  const pipeline = pipelines.find((item) => item.mode === mode && item.enabled);
  if (!pipeline) return [];
  return pipeline.types
    .filter((item) => item.enabled !== false)
    .filter((item) => mode !== 'has_image' || !DEFAULT_EXCLUDED_HAS_IMAGE_IDS.has(item.id))
    .map((item) => item.id);
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'application/octet-stream';
}

async function uploadFile(apiBase, token, filePath) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeForFile(filePath) }), path.basename(filePath));
  form.append('upload_source', 'playground');

  return requestJson(`${apiBase}/files/upload`, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
  });
}

function healthBaseFromApi(apiBase) {
  return apiBase.replace(/\/api\/v\d+$/, '');
}

function summarizeBoxes(boxes) {
  const byType = {};
  const bySource = {};
  for (const box of boxes) {
    byType[box.type] = (byType[box.type] || 0) + 1;
    bySource[box.source || 'unknown'] = (bySource[box.source || 'unknown'] || 0) + 1;
  }
  return { byType, bySource };
}

async function saveBase64Png(filePath, base64) {
  if (!base64) return false;
  const clean = base64.includes(',') ? base64.split(',').pop() : base64;
  await writeFile(filePath, Buffer.from(clean, 'base64'));
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pdfPath && !args.renderReport) {
    usage();
    process.exit(2);
  }
  if (args.renderReport) {
    await renderReportFromSummary(args.renderReport);
    return;
  }

  const env = resolveEvalEnv();
  const apiBase = (env.DATAINFRA_API || DEFAULT_API).replace(/\/+$/, '');
  const outDir = args.outDir || path.join(
    'output',
    'playwright',
    `eval-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );

  const { token, authStatus } = await resolveAuthToken(apiBase, env);
  await mkdir(outDir, { recursive: true });
  const serviceHealth = await tryRequestJson(`${healthBaseFromApi(apiBase)}/health/services`);
  const pipelines = await requestJson(`${apiBase}/vision-pipelines`, {
    headers: authHeaders(token),
  });
  const selectedOcrTypes = splitCsv(process.env.EVAL_OCR_TYPES) || defaultTypeIds(pipelines, 'ocr_has');
  const selectedImageTypes = splitCsv(process.env.EVAL_IMAGE_TYPES) || defaultTypeIds(pipelines, 'has_image');

  const upload = await uploadFile(apiBase, token, args.pdfPath);
  const parse = await requestJson(`${apiBase}/files/${upload.file_id}/parse`, {
    headers: authHeaders(token),
  });
  const pageCount = Math.max(1, Number(parse?.page_count || upload.page_count || 1));
  const selectedPages = parsePages(args.pages.length ? args.pages : env.EVAL_VISION_PAGES, pageCount);
  const pageConcurrency = clampInteger(process.env.EVAL_VISION_CONCURRENCY, 1, 1, 4);
  const withRedactionPreview = parseBool(process.env.EVAL_REDACTION_PREVIEW, true);
  const pages = Array.from({ length: selectedPages.length });
  const wallStart = performance.now();

  await mapLimit(
    selectedPages,
    pageConcurrency,
    async (page, pageIndex) => {
      const start = performance.now();
      const result = await requestJson(`${apiBase}/redaction/${upload.file_id}/vision?page=${page}`, {
        method: 'POST',
        headers: authHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          selected_ocr_has_types: selectedOcrTypes,
          selected_has_image_types: selectedImageTypes,
        }),
      });
      const elapsedMs = Math.round(performance.now() - start);
      const boxes = result.bounding_boxes || [];
      const visualBoxCount = boxes.filter(isVisualBox).length;
      const hasImageBoxCount = boxes.filter(isHasImageBox).length;
      const pageName = `page-${String(page).padStart(2, '0')}`;
      await writeFile(path.join(outDir, `${pageName}.json`), JSON.stringify(boxes, null, 2), 'utf8');
      const previewImage = await saveBase64Png(path.join(outDir, `${pageName}-preview.png`), result.result_image);
      let redactionPreview = false;
      let redactionPreviewMs = 0;
      if (withRedactionPreview) {
        const redactStart = performance.now();
        const preview = await requestJson(`${apiBase}/redaction/${upload.file_id}/preview-image?page=${page}`, {
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
        redactionPreview = await saveBase64Png(
          path.join(outDir, `${pageName}-redacted.png`),
          preview.image_base64,
        );
        redactionPreviewMs = Math.round(performance.now() - redactStart);
      }
      pages[pageIndex] = {
        page,
        elapsed_ms: elapsedMs,
        redaction_preview_ms: redactionPreviewMs,
        redaction_preview: redactionPreview,
        preview_image: previewImage,
        box_count: boxes.length,
        visual_box_count: visualBoxCount,
        has_image_box_count: hasImageBoxCount,
        qa_warnings: analyzeVisionPage(page, boxes, elapsedMs, {
          previewImage,
          redactionPreview,
          redactionPreviewEnabled: withRedactionPreview,
        }),
        ...summarizeBoxes(boxes),
      };
      const redactionSuffix = redactionPreview ? `, preview ${(redactionPreviewMs / 1000).toFixed(2)}s` : '';
      console.log(
        `${pageName}: ${boxes.length} boxes, ${visualBoxCount} visual, ` +
        `${hasImageBoxCount} has_image, ${(elapsedMs / 1000).toFixed(2)}s${redactionSuffix}`,
      );
    },
  );

  const wallMs = Math.round(performance.now() - wallStart);
  const totalMs = pages.reduce((sum, page) => sum + page.elapsed_ms, 0);
  const totalBoxes = pages.reduce((sum, page) => sum + page.box_count, 0);
  const totalVisualBoxes = pages.reduce((sum, page) => sum + page.visual_box_count, 0);
  const totalHasImageBoxes = pages.reduce((sum, page) => sum + page.has_image_box_count, 0);
  const summary = {
    api: apiBase,
    input: path.resolve(args.pdfPath),
    output_dir: path.resolve(outDir),
    file_id: upload.file_id,
    file_type: upload.file_type,
    page_count: pageCount,
    selected_pages: selectedPages,
    evaluated_page_count: pages.length,
    selected_ocr_has_types: selectedOcrTypes,
    selected_has_image_types: selectedImageTypes,
    auth_status: authStatus,
    service_health: serviceHealth,
    page_concurrency: pageConcurrency,
    redaction_preview_enabled: withRedactionPreview,
    wall_ms: wallMs,
    total_ms: totalMs,
    total_boxes: totalBoxes,
    total_visual_boxes: totalVisualBoxes,
    total_has_image_boxes: totalHasImageBoxes,
    average_ms: Math.round(totalMs / Math.max(1, pages.length)),
    pages,
  };
  summary.qa_warnings = summarizeVisionWarnings(summary);
  summary.quality_gate = buildQualityGate(summary);
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'report.html'), renderHtmlReport(summary), 'utf8');
  console.log(`summary: ${path.resolve(outDir, 'summary.json')}`);
  console.log(`report: ${path.resolve(outDir, 'report.html')}`);
  console.log(
    `pages=${summary.pages.length} boxes=${summary.total_boxes} ` +
    `visual=${summary.total_visual_boxes} has_image=${summary.total_has_image_boxes} ` +
    `warnings=${summary.qa_warnings.length} quality=${summary.quality_gate.passed ? 'pass' : 'fail'}`,
  );
  if (!summary.quality_gate.passed) {
    for (const check of summary.quality_gate.failed_checks) {
      console.error(`quality gate failed: ${check}`);
    }
    process.exit(1);
  }
}

async function renderReportFromSummary(summaryPath) {
  if (!summaryPath) {
    throw new Error('Set a summary.json path after --render-report.');
  }
  const resolvedSummaryPath = path.resolve(summaryPath);
  const summary = JSON.parse(await readFile(resolvedSummaryPath, 'utf8'));
  const reportPath = path.join(path.dirname(resolvedSummaryPath), 'report.html');
  await writeFile(reportPath, renderHtmlReport(summary), 'utf8');
  console.log(`report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

function clampInteger(value, defaultValue, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function envInteger(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildQualityGate(summary) {
  const expectedPages = Array.isArray(summary.selected_pages) && summary.selected_pages.length > 0
    ? summary.selected_pages.length
    : summary.page_count;
  const thresholds = {
    min_total_boxes: envInteger('EVAL_VISION_MIN_TOTAL_BOXES', Math.max(1, expectedPages || 1)),
    min_page_boxes: envInteger('EVAL_VISION_MIN_PAGE_BOXES', 1),
    min_total_visual_boxes: envInteger('EVAL_VISION_MIN_TOTAL_VISUAL_BOXES', 0),
    min_page_visual_boxes: envInteger('EVAL_VISION_MIN_PAGE_VISUAL_BOXES', 0),
    min_total_has_image_boxes: envInteger('EVAL_VISION_MIN_TOTAL_HAS_IMAGE_BOXES', 0),
    min_page_has_image_boxes: envInteger('EVAL_VISION_MIN_PAGE_HAS_IMAGE_BOXES', 0),
    max_warnings: envInteger('EVAL_VISION_MAX_WARNINGS', -1),
    max_page_ms: envInteger('EVAL_VISION_MAX_PAGE_MS', 0),
    require_all_online: parseBool(process.env.EVAL_VISION_REQUIRE_ALL_ONLINE, false),
  };
  const failed = [];
  const warningCount = (summary.qa_warnings || []).length;
  const totalBoxes = Number(summary.total_boxes || 0);
  const totalVisualBoxes = Number(summary.total_visual_boxes || 0);
  const totalHasImageBoxes = Number(summary.total_has_image_boxes || 0);
  if (summary.pages.length !== expectedPages) {
    failed.push(`evaluated pages ${summary.pages.length} != selected pages ${expectedPages}`);
  }
  if (totalBoxes < thresholds.min_total_boxes) {
    failed.push(`total boxes ${totalBoxes} < ${thresholds.min_total_boxes}`);
  }
  if (totalVisualBoxes < thresholds.min_total_visual_boxes) {
    failed.push(`total visual boxes ${totalVisualBoxes} < ${thresholds.min_total_visual_boxes}`);
  }
  if (totalHasImageBoxes < thresholds.min_total_has_image_boxes) {
    failed.push(`total HaS Image boxes ${totalHasImageBoxes} < ${thresholds.min_total_has_image_boxes}`);
  }
  if (thresholds.max_warnings >= 0 && warningCount > thresholds.max_warnings) {
    failed.push(`warnings ${warningCount} > ${thresholds.max_warnings}`);
  }
  if (thresholds.require_all_online && summary.service_health?.all_online !== true) {
    failed.push('service health is not all_online');
  }
  for (const page of summary.pages) {
    const boxCount = Number(page.box_count || 0);
    const visualBoxCount = Number(page.visual_box_count || 0);
    const hasImageBoxCount = Number(page.has_image_box_count || 0);
    if (boxCount < thresholds.min_page_boxes) {
      failed.push(`page ${page.page} boxes ${boxCount} < ${thresholds.min_page_boxes}`);
    }
    if (visualBoxCount < thresholds.min_page_visual_boxes) {
      failed.push(`page ${page.page} visual boxes ${visualBoxCount} < ${thresholds.min_page_visual_boxes}`);
    }
    if (hasImageBoxCount < thresholds.min_page_has_image_boxes) {
      failed.push(`page ${page.page} HaS Image boxes ${hasImageBoxCount} < ${thresholds.min_page_has_image_boxes}`);
    }
    if (thresholds.max_page_ms > 0 && Number(page.elapsed_ms || 0) > thresholds.max_page_ms) {
      failed.push(`page ${page.page} elapsed ${page.elapsed_ms}ms > ${thresholds.max_page_ms}ms`);
    }
  }
  return {
    passed: failed.length === 0,
    failed_checks: failed,
    thresholds,
    warning_count: warningCount,
    total_boxes: totalBoxes,
    total_visual_boxes: totalVisualBoxes,
    total_has_image_boxes: totalHasImageBoxes,
    expected_pages: expectedPages,
  };
}

function isVisualBox(box) {
  const type = String(box?.type || '').toLowerCase();
  const source = String(box?.source || '').toLowerCase();
  if (type === 'paper') return false;
  return source === 'has_image' || VISUAL_BOX_TYPES.has(type);
}

function isHasImageBox(box) {
  return String(box?.source || '').toLowerCase() === 'has_image';
}

async function mapLimit(items, concurrency, worker) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

function renderHtmlReport(summary) {
  const title = `Vision Eval - ${path.basename(summary.input)}`;
  const typeRows = aggregateTypeCounts(summary.pages);
  const sourceRows = aggregateSourceCounts(summary.pages);
  const reviewRows = buildReviewQueue(summary.pages);
  const warningCount = countWarnings(summary.pages);
  const pageCards = summary.pages.map((page) => renderPageCard(page)).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8f8;
      --panel: #ffffff;
      --line: #e5e7eb;
      --text: #111827;
      --muted: #6b7280;
      --accent: #0f766e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 1;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(12px);
    }
    .wrap { max-width: 1320px; margin: 0 auto; padding: 20px; }
    h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.25; }
    h2 { margin: 0 0 12px; font-size: 17px; }
    .path { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .metric, .panel, .page {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .metric { padding: 12px; }
    .metric span { display: block; color: var(--muted); font-size: 12px; }
    .metric strong { display: block; margin-top: 5px; font-size: 22px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 18px;
    }
    .panel { padding: 14px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 12px;
      background: #f8fafc;
      white-space: nowrap;
    }
    .chip strong { color: var(--accent); }
    .pages {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 18px;
      padding: 20px;
      max-width: 1600px;
      margin: 0 auto;
    }
    .page { overflow: hidden; }
    .page-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
    }
    .page-head strong { font-size: 15px; }
    .page-head span { color: var(--muted); font-size: 12px; }
    .preview {
      display: block;
      width: 100%;
      max-height: 760px;
      object-fit: contain;
      background: #eef0f2;
    }
    figure { margin: 0; border-bottom: 1px solid var(--line); }
    figcaption {
      padding: 8px 12px;
      color: var(--muted);
      font-size: 12px;
      background: #fafafa;
      border-bottom: 1px solid var(--line);
    }
    .page-body { padding: 12px 14px 14px; }
    .json-link {
      display: inline-block;
      margin-top: 10px;
      color: var(--accent);
      text-decoration: none;
      font-size: 13px;
    }
    .empty { color: var(--muted); font-size: 13px; }
    .warn {
      color: #92400e;
      font-size: 13px;
      line-height: 1.55;
    }
    .warn + .warn { margin-top: 6px; }
    .review-list { display: grid; gap: 10px; }
    .review-item {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fffdf7;
    }
    .review-item a { color: var(--accent); font-weight: 650; text-decoration: none; }
    .review-thumb {
      display: grid;
      place-items: center;
      width: 96px;
      height: 128px;
      object-fit: cover;
      object-position: top center;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #eef0f2;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }
    img.review-thumb { display: block; }
    .review-note { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .review-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 7px; font-size: 12px; }
    .review-links a { font-weight: 600; }
    .review-badge {
      border-radius: 999px;
      background: #fef3c7;
      color: #92400e;
      padding: 2px 8px;
      font-size: 12px;
      white-space: nowrap;
    }
    .quality-failure {
      grid-template-columns: 112px minmax(0, 1fr);
      background: #fff7ed;
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>${escapeHtml(title)}</h1>
      <div class="path">${escapeHtml(summary.input)}</div>
      <div class="metrics">
    ${renderMetric('页数', formatPageMetric(summary))}
    ${renderMetric('总框数', summary.total_boxes ?? summary.pages.reduce((sum, page) => sum + page.box_count, 0))}
    ${renderMetric('HaS Image', summary.total_has_image_boxes ?? summary.pages.reduce((sum, page) => sum + (page.has_image_box_count || 0), 0))}
    ${renderMetric('墙钟耗时', formatMs(summary.wall_ms || summary.total_ms))}
    ${renderMetric('页耗时均值', formatMs(summary.average_ms))}
    ${renderMetric('页级并发', summary.page_concurrency || 1)}
    ${renderMetric('脱敏预览', summary.redaction_preview_enabled ? '已生成' : '未生成')}
    ${renderMetric('需复核页', reviewRows.length)}
    ${renderMetric('质检提示', warningCount)}
    ${renderMetric('质量门槛', summary.quality_gate ? (summary.quality_gate.passed ? 'PASS' : 'FAIL') : '未采集')}
      </div>
    </div>
  </header>
  <main>
    <section class="wrap">
      ${renderReviewQueue(reviewRows)}
    </section>
    <section class="wrap grid">
      ${renderPanel('类型统计', typeRows)}
      ${renderPanel('来源统计', sourceRows)}
      ${renderServiceHealth(summary.service_health)}
      ${renderQualityGate(summary.quality_gate)}
      ${renderQualityFailurePanel(summary.quality_gate)}
      ${renderWarnings(summary.qa_warnings || [])}
    </section>
    <section class="pages">
      ${pageCards}
    </section>
  </main>
</body>
</html>`;
}

function renderMetric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function formatPageMetric(summary) {
  const selectedPages = Array.isArray(summary.selected_pages) ? summary.selected_pages : [];
  if (!selectedPages.length || selectedPages.length === Number(summary.page_count || 0)) {
    return summary.page_count;
  }
  return `${selectedPages.length}/${summary.page_count}`;
}

function renderPanel(title, rows) {
  const body = rows.length
    ? `<div class="chips">${rows.map(([key, count]) => renderChip(key, count)).join('')}</div>`
    : '<div class="empty">暂无</div>';
  return `<div class="panel"><h2>${escapeHtml(title)}</h2>${body}</div>`;
}

function renderServiceHealth(health) {
  if (!health || health.error) {
    return `<div class="panel"><h2>服务快照</h2><div class="warn">${escapeHtml(health?.error || '未采集')}</div></div>`;
  }
  const services = Object.entries(health.services || {}).map(([key, service]) => [
    `${service.name || key} ${service.status || 'unknown'}`,
    '',
  ]);
  const gpu = health.gpu_memory
    ? [[`GPU ${health.gpu_memory.used_mb}/${health.gpu_memory.total_mb} MiB`, '']]
    : [['GPU 未采集', '']];
  const gpuProcesses = (health.gpu_processes || []).map((proc) => {
    const memory = Number.isFinite(proc.used_mb) ? `${proc.used_mb} MiB` : '显存未知';
    return [`GPU pid ${proc.pid} ${memory}`, proc.name || '未知进程'];
  });
  const rows = [
    [`all_online=${Boolean(health.all_online)}`, ''],
    [`probe=${health.probe_ms ?? '?'}ms`, ''],
    ...gpu,
    ...gpuProcesses,
    ...services,
  ];
  return renderPanel('服务快照', rows);
}

function renderPageCard(page) {
  const pageName = `page-${String(page.page).padStart(2, '0')}`;
  const typeRows = Object.entries(page.byType || {}).sort(sortCountDesc);
  const sourceRows = Object.entries(page.bySource || {}).sort(sortCountDesc);
  const hasPreviewImage = page.preview_image !== false;
  const previewImage = hasPreviewImage
    ? `<figure><figcaption>识别框预览</figcaption><a href="${pageName}-preview.png"><img class="preview" src="${pageName}-preview.png" alt="Page ${page.page} preview"></a></figure>`
    : '<div class="empty" style="padding: 12px 14px; border-bottom: 1px solid var(--line);">未生成识别框预览图</div>';
  const redactedImage = page.redaction_preview
    ? `<figure><figcaption>脱敏预览</figcaption><a href="${pageName}-redacted.png"><img class="preview" src="${pageName}-redacted.png" alt="Page ${page.page} redacted preview"></a></figure>`
    : '';
  const timing = page.redaction_preview
    ? `${formatMs(page.elapsed_ms)} + preview ${formatMs(page.redaction_preview_ms)}`
    : formatMs(page.elapsed_ms);
  const hasImageCount = Number(page.has_image_box_count || page.bySource?.has_image || 0);
  return `<article class="page" id="${pageName}">
    <div class="page-head">
      <strong>第 ${page.page} 页</strong>
      <span>${page.box_count} boxes · ${hasImageCount} HaS Image · ${timing}</span>
    </div>
    ${previewImage}
    ${redactedImage}
    <div class="page-body">
      ${renderWarnings(page.qa_warnings || [], '页面提示')}
      <div class="chips">${typeRows.map(([key, count]) => renderChip(key, count)).join('') || '<span class="empty">无类型命中</span>'}</div>
      <div class="chips" style="margin-top: 8px;">${sourceRows.map(([key, count]) => renderChip(key, count)).join('') || '<span class="empty">无来源统计</span>'}</div>
      <a class="json-link" href="${pageName}.json">查看 ${pageName}.json</a>
    </div>
  </article>`;
}

function buildReviewQueue(pages) {
  return pages
    .map((page) => {
      const warnings = page.qa_warnings || [];
      const sealCount = Number(page.byType?.official_seal || 0);
      const ocrCount = Number(page.bySource?.ocr_has || 0);
      const hasImageCount = Number(page.has_image_box_count || page.bySource?.has_image || 0);
      const score =
        warnings.length * 10 +
        sealCount * 2 +
        (page.box_count === 0 ? 8 : 0) +
        (hasImageCount === 0 ? 4 : 0);
      return {
        page: page.page,
        score,
        boxCount: page.box_count || 0,
        sealCount,
        ocrCount,
        hasImageCount,
        previewImage: page.preview_image !== false,
        redactionPreview: Boolean(page.redaction_preview),
        warnings,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.page - b.page);
}

function renderReviewQueue(rows) {
  if (!rows.length) {
    return '<div class="panel"><h2>重点复核队列</h2><div class="empty">无重点提示</div></div>';
  }
  const items = rows
    .map((row) => {
      const pageName = `page-${String(row.page).padStart(2, '0')}`;
      const warningText = row.warnings.length ? row.warnings.join(' ') : '包含印章或视觉候选，建议抽查框位置。';
      const counts = `${row.boxCount} boxes / ${row.sealCount} seals / ${row.hasImageCount} HaS Image / ${row.ocrCount} OCR`;
      const previewLink = row.previewImage ? `<a href="${pageName}-preview.png">预览图</a>` : '';
      const thumbnail = row.previewImage
        ? `<a href="#${pageName}" aria-label="跳转到第 ${row.page} 页"><img class="review-thumb" src="${pageName}-preview.png" alt="第 ${row.page} 页预览"></a>`
        : `<a class="review-thumb review-thumb-empty" href="#${pageName}">第 ${row.page} 页</a>`;
      const redactedLink = row.redactionPreview ? `<a href="${pageName}-redacted.png">脱敏图</a>` : '';
      return `<div class="review-item">
        ${thumbnail}
        <div>
          <a href="#${pageName}">第 ${row.page} 页</a>
          <div class="review-note">${escapeHtml(warningText)}</div>
          <div class="review-note">${escapeHtml(counts)}</div>
          <div class="review-links">
            ${previewLink}
            ${redactedLink}
            <a href="${pageName}.json">JSON</a>
          </div>
        </div>
        <span class="review-badge">score ${row.score}</span>
      </div>`;
    })
    .join('');
  return `<div class="panel"><h2>重点复核队列</h2><div class="review-list">${items}</div></div>`;
}

function renderChip(key, count) {
  if (count === '') return `<span class="chip">${escapeHtml(key)}</span>`;
  return `<span class="chip">${escapeHtml(key)} <strong>${escapeHtml(String(count))}</strong></span>`;
}

function renderWarnings(warnings, title = '质检提示') {
  const body = warnings.length
    ? warnings.map((warning) => `<div class="warn">${escapeHtml(warning)}</div>`).join('')
    : '<div class="empty">无</div>';
  return `<div class="panel"><h2>${escapeHtml(title)}</h2>${body}</div>`;
}

function renderQualityGate(gate) {
  if (!gate) {
    return '<div class="panel"><h2>质量门槛</h2><div class="empty">未采集</div></div>';
  }
  const failed = gate.failed_checks || [];
  const status = gate.passed ? '<div class="empty">PASS</div>' : '<div class="warn">FAIL</div>';
  const summary = `<div class="review-note">boxes=${escapeHtml(String(gate.total_boxes ?? 0))}, visual=${escapeHtml(String(gate.total_visual_boxes ?? 0))}, HaS Image=${escapeHtml(String(gate.total_has_image_boxes ?? 0))}, warnings=${escapeHtml(String(gate.warning_count ?? 0))}</div>`;
  const failedHtml = failed.length
    ? failed.map((check) => `<div class="warn">${renderQualityCheck(check)}</div>`).join('')
    : '<div class="empty">无失败项</div>';
  const thresholdRows = Object.entries(gate.thresholds || {});
  const thresholdHtml = thresholdRows.length
    ? `<div class="chips" style="margin-top: 10px;">${thresholdRows.map(([key, value]) => renderChip(key, value)).join('')}</div>`
    : '';
  return `<div class="panel"><h2>质量门槛</h2>${status}${summary}${failedHtml}${thresholdHtml}</div>`;
}

function renderQualityFailurePanel(gate) {
  const failed = gate?.failed_checks || [];
  if (!gate || gate.passed || failed.length === 0) return '';
  const items = failed.map((check) => {
    const detail = describeQualityFailure(check);
    return `<div class="review-item quality-failure">
      <span class="review-badge">${escapeHtml(detail.kind)}</span>
      <div>
        <div class="warn">${renderQualityCheck(check)}</div>
        <div class="review-note">${escapeHtml(detail.reason)}</div>
        <div class="review-note"><strong>Next action:</strong> ${escapeHtml(detail.action)}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="panel"><h2>Quality failure diagnosis</h2><div class="review-list">${items}</div></div>`;
}

function describeQualityFailure(check) {
  const text = String(check);
  if (/^page \d+ boxes /.test(text)) {
    return {
      kind: 'page boxes',
      reason: 'A selected page produced fewer boxes than the configured page threshold.',
      action: 'Open the linked page preview, confirm whether it is blank, then retry OCR/vision services or lower EVAL_VISION_MIN_PAGE_BOXES only if the fixture is intentionally empty.',
    };
  }
  if (/^page \d+ visual boxes /.test(text)) {
    return {
      kind: 'page visual',
      reason: 'The page did not meet the visual-region threshold.',
      action: 'Check the HaS Image service and selected image types; inspect the linked page for seals, QR codes, photos, or other supported visual sensitive regions.',
    };
  }
  if (/^page \d+ HaS Image boxes /.test(text)) {
    return {
      kind: 'page has_image',
      reason: 'HaS Image did not return enough regions for this page.',
      action: 'Verify the HaS Image model is online, selected image type ids are enabled, and GPU memory is not exhausted before rerunning.',
    };
  }
  if (/^page \d+ elapsed /.test(text)) {
    return {
      kind: 'page latency',
      reason: 'A page exceeded the configured latency threshold.',
      action: 'Inspect service health and GPU pressure, reduce page concurrency, or raise EVAL_VISION_MAX_PAGE_MS when the fixture is expected to be slow.',
    };
  }
  if (/^total boxes /.test(text)) {
    return {
      kind: 'total boxes',
      reason: 'The whole document produced fewer detections than expected.',
      action: 'Confirm OCR/vision services are online, selected pipelines are non-empty, and the input fixture actually contains sensitive regions.',
    };
  }
  if (/^total visual boxes /.test(text)) {
    return {
      kind: 'total visual',
      reason: 'The document-level visual-region threshold was not met.',
      action: 'Check image recognition configuration and avoid counting OCR text boxes as visual detections unless that is the intended gate.',
    };
  }
  if (/^total HaS Image boxes /.test(text)) {
    return {
      kind: 'total has_image',
      reason: 'The HaS Image pipeline did not meet the document-level threshold.',
      action: 'Run npm run doctor, confirm the has_image service is online, and review EVAL_IMAGE_TYPES.',
    };
  }
  if (/^warnings /.test(text)) {
    return {
      kind: 'warnings',
      reason: 'The report generated more QA warnings than the allowed limit.',
      action: 'Open the review queue and fix the warning causes before increasing EVAL_VISION_MAX_WARNINGS.',
    };
  }
  if (text.includes('service health')) {
    return {
      kind: 'service health',
      reason: 'The run required all services online, but the health snapshot was not all_online.',
      action: 'Run npm run doctor, start missing model services, then rerun the eval.',
    };
  }
  if (text.includes('evaluated pages')) {
    return {
      kind: 'page coverage',
      reason: 'The report did not evaluate the expected number of selected pages.',
      action: 'Check --pages / EVAL_VISION_PAGES and ensure the input page count is parsed correctly.',
    };
  }
  return {
    kind: 'quality gate',
    reason: 'This failed check came from the configured quality gate.',
    action: 'Inspect summary.json, service health, and the linked report sections before changing thresholds.',
  };
}

function renderQualityCheck(check) {
  const text = String(check);
  const match = text.match(/^page (\d+) /);
  if (!match) return escapeHtml(text);
  const pageName = `page-${String(Number(match[1])).padStart(2, '0')}`;
  return `<a href="#${pageName}">第 ${escapeHtml(match[1])} 页</a>: ${escapeHtml(text.replace(/^page \d+ /, ''))}`;
}

function aggregateTypeCounts(pages) {
  return aggregateCounts(pages, 'byType');
}

function aggregateSourceCounts(pages) {
  return aggregateCounts(pages, 'bySource');
}

function countWarnings(pages) {
  return pages.reduce((sum, page) => sum + (page.qa_warnings || []).length, 0);
}

function aggregateCounts(pages, field) {
  const counts = {};
  for (const page of pages) {
    for (const [key, count] of Object.entries(page[field] || {})) {
      counts[key] = (counts[key] || 0) + count;
    }
  }
  return Object.entries(counts).sort(sortCountDesc);
}

function sortCountDesc(a, b) {
  return b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));
}

function formatMs(value) {
  const ms = Number(value || 0);
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function analyzeVisionPage(page, boxes, elapsedMs, options) {
  const warnings = [];
  if (boxes.length === 0) {
    warnings.push(`第 ${page} 页没有识别框，需确认是否空白页或漏检。`);
  }
  if (elapsedMs > 8000) {
    warnings.push(`第 ${page} 页识别耗时 ${formatMs(elapsedMs)}，超过 8s。`);
  }
  if (options.redactionPreviewEnabled && !options.redactionPreview) {
    warnings.push(`第 ${page} 页未生成脱敏预览。`);
  }
  if (!options.previewImage) {
    warnings.push(`第 ${page} 页未生成识别框预览图。`);
  }
  const sealBoxes = boxes.filter((box) => box.type === 'official_seal');
  const seamCluster = findEdgeSealCluster(sealBoxes);
  if (seamCluster) {
    warnings.push(`第 ${page} 页${seamCluster.edge}侧存在 ${seamCluster.count} 个骑缝章/碎片章候选，需检查是否框准且无漏段。`);
  }
  for (const box of sealBoxes) {
    const area = Number(box.width || 0) * Number(box.height || 0);
    if (area > 0.06) {
      warnings.push(`第 ${page} 页存在较大的公章框（${(area * 100).toFixed(1)}% 页面面积），需检查是否过度遮挡正文/表格。`);
      break;
    }
  }
  const edgeVisual = boxes.find((box) => {
    if (box.type !== 'official_seal') return false;
    const x = Number(box.x || 0);
    const y = Number(box.y || 0);
    const width = Number(box.width || 0);
    const height = Number(box.height || 0);
    return x < 0.035 || y < 0.035 || x + width > 0.965 || y + height > 0.965;
  });
  if (edgeVisual && !seamCluster) {
    warnings.push(`第 ${page} 页存在靠边缘的公章候选，需重点检查角落章或骑缝章是否框准。`);
  }
  const largeTextBox = boxes.find((box) => {
    const area = Number(box.width || 0) * Number(box.height || 0);
    return box.source === 'ocr_has' && area > 0.035;
  });
  if (largeTextBox) {
    warnings.push(`第 ${page} 页存在较大的 OCR 文本框：${largeTextBox.type || 'UNKNOWN'}，需检查框位是否过粗。`);
  }
  return warnings;
}

function findEdgeSealCluster(sealBoxes) {
  const buckets = [
    ['左', 'y', (box) => Number(box.x || 0) < 0.05],
    ['右', 'y', (box) => Number(box.x || 0) + Number(box.width || 0) > 0.95],
    ['上', 'x', (box) => Number(box.y || 0) < 0.05],
    ['下', 'x', (box) => Number(box.y || 0) + Number(box.height || 0) > 0.95],
  ];
  for (const [edge, axis, predicate] of buckets) {
    const edgeBoxes = sealBoxes
      .filter(predicate)
      .map((box) => ({
        start: Number(box[axis] || 0),
        end: Number(box[axis] || 0) + Number(axis === 'x' ? box.width || 0 : box.height || 0),
      }))
      .sort((a, b) => a.start - b.start);
    let cluster = 0;
    let lastEnd = -Infinity;
    for (const box of edgeBoxes) {
      if (cluster === 0 || box.start <= lastEnd + 0.08) {
        cluster += 1;
        lastEnd = Math.max(lastEnd, box.end);
      } else {
        cluster = 1;
        lastEnd = box.end;
      }
      if (cluster >= 3) return { edge, count: cluster };
    }
  }
  return null;
}

function summarizeVisionWarnings(summary) {
  const warnings = summary.pages.flatMap((page) => page.qa_warnings || []);
  const gpu = summary.service_health?.gpu_memory;
  if (gpu?.used_mb && gpu?.total_mb) {
    const ratio = gpu.used_mb / gpu.total_mb;
    if (ratio >= 0.9) {
      warnings.push(`评测时 GPU 显存占用 ${(ratio * 100).toFixed(1)}%（${gpu.used_mb}/${gpu.total_mb} MiB），高显存压力可能导致推理长尾或服务离线。`);
    }
  }
  if (summary.service_health?.all_online === false) {
    warnings.push('评测开始时存在离线模型服务，需检查服务快照。');
  }
  const selectedPages = Array.isArray(summary.selected_pages) && summary.selected_pages.length > 0
    ? summary.selected_pages
    : Array.from({ length: summary.page_count || 0 }, (_, index) => index + 1);
  if (selectedPages.length !== summary.pages.length) {
    warnings.push(`页数不一致：选择 ${selectedPages.length} 页，实际评估 ${summary.pages.length} 页。`);
  }
  if (summary.wall_ms > 60000) {
    warnings.push(`整体评估耗时 ${formatMs(summary.wall_ms)}，超过 60s。`);
  }
  return warnings;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
