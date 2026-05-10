#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { authHeaders, requestJson, resolveAuthToken, resolveEvalEnv, tryRequestJson } from './eval-auth.mjs';

const DEFAULT_API = 'http://127.0.0.1:8000/api/v1';
const SEMANTIC_ENTITY_TYPES = new Set(['PERSON', 'ORG', 'ADDRESS', 'DATE', 'BIRTH_DATE']);

function usage() {
  console.log(`Usage:
  DATAINFRA_TOKEN=... node scripts/eval-text-file.mjs <docx-pdf-txt-path> [output-dir]
  node scripts/eval-text-file.mjs --render-report <summary.json>

Options via env:
  DATAINFRA_API       API base, default ${DEFAULT_API}
  DATAINFRA_PASSWORD  Login password for the local app
  DATAINFRA_TOKEN     Existing Bearer token; preferred over DATAINFRA_PASSWORD when set
  DATAINFRA_TOKEN_FILE  File containing a Bearer token; used when DATAINFRA_TOKEN is not set
  EVAL_TEXT_TYPES     Comma-separated entity type ids; default reads enabled /custom-types
  EVAL_TEXT_MIN_ENTITIES       Minimum entity count, default 1
  EVAL_TEXT_MIN_CONTENT_CHARS  Minimum parsed content chars, default 1
  EVAL_TEXT_MAX_WARNINGS       Maximum warnings, default -1 (disabled)
  EVAL_TEXT_MAX_PARSE_MS       Maximum parse latency, default 0 (disabled)
  EVAL_TEXT_MAX_NER_MS         Maximum NER latency, default 0 (disabled)
  EVAL_TEXT_REQUIRE_SEMANTIC_HIT  Fail when semantic types have no HaS/semantic hit, default false
`);
}

function splitCsv(value) {
  if (!value) return null;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.html' || ext === '.htm') return 'text/html';
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

function summarizeEntities(entities) {
  const byType = {};
  const bySource = {};
  for (const entity of entities) {
    byType[entity.type] = (byType[entity.type] || 0) + 1;
    bySource[entity.source || 'unknown'] = (bySource[entity.source || 'unknown'] || 0) + 1;
  }
  return { byType, bySource };
}

function envInteger(env, name, fallback) {
  const parsed = Number.parseInt(env[name] || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function buildQualityGate(summary, entities, env = process.env) {
  const thresholds = {
    min_entities: envInteger(env, 'EVAL_TEXT_MIN_ENTITIES', 1),
    min_content_chars: envInteger(env, 'EVAL_TEXT_MIN_CONTENT_CHARS', 1),
    max_warnings: envInteger(env, 'EVAL_TEXT_MAX_WARNINGS', -1),
    max_parse_ms: envInteger(env, 'EVAL_TEXT_MAX_PARSE_MS', 0),
    max_ner_ms: envInteger(env, 'EVAL_TEXT_MAX_NER_MS', 0),
    require_semantic_hit: parseBool(env.EVAL_TEXT_REQUIRE_SEMANTIC_HIT, false),
  };
  const failed = [];
  const warningCount = (summary.warnings || []).length + (summary.qa_warnings || []).length;
  const entityCount = Number(summary.entity_count || 0);
  const contentChars = Number(summary.content_chars || 0);
  if (summary.recognition_failed) {
    failed.push('recognition_failed is true');
  }
  if (summary.error) {
    failed.push(`recognition error: ${summary.error}`);
  }
  if (entityCount < thresholds.min_entities) {
    failed.push(`entity count ${entityCount} < ${thresholds.min_entities}`);
  }
  if (contentChars < thresholds.min_content_chars) {
    failed.push(`content chars ${contentChars} < ${thresholds.min_content_chars}`);
  }
  if (thresholds.max_warnings >= 0 && warningCount > thresholds.max_warnings) {
    failed.push(`warnings ${warningCount} > ${thresholds.max_warnings}`);
  }
  if (thresholds.max_parse_ms > 0 && Number(summary.parse_ms || 0) > thresholds.max_parse_ms) {
    failed.push(`parse elapsed ${summary.parse_ms}ms > ${thresholds.max_parse_ms}ms`);
  }
  if (thresholds.max_ner_ms > 0 && Number(summary.ner_ms || 0) > thresholds.max_ner_ms) {
    failed.push(`NER elapsed ${summary.ner_ms}ms > ${thresholds.max_ner_ms}ms`);
  }
  if (thresholds.require_semantic_hit && selectedSemanticTypes(summary).length && !hasSemanticHit(entities)) {
    failed.push('semantic entity types selected but no HaS/semantic entity hit');
  }
  return {
    passed: failed.length === 0,
    failed_checks: failed,
    thresholds,
    warning_count: warningCount,
    entity_count: entityCount,
    content_chars: contentChars,
  };
}

function selectedSemanticTypes(summary) {
  return (summary.selected_entity_types || []).filter((type) => SEMANTIC_ENTITY_TYPES.has(type));
}

function hasSemanticHit(entities) {
  return entities.some((entity) => {
    const source = String(entity.source || '').toLowerCase();
    return SEMANTIC_ENTITY_TYPES.has(entity.type) && (source.includes('has') || source.includes('semantic'));
  });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath || inputPath === '-h' || inputPath === '--help') {
    usage();
    process.exit(inputPath ? 0 : 2);
  }
  if (inputPath === '--render-report') {
    await renderReportFromSummary(process.argv[3]);
    return;
  }

  const env = resolveEvalEnv();
  const apiBase = (env.DATAINFRA_API || DEFAULT_API).replace(/\/+$/, '');
  const outDir = process.argv[3] || path.join(
    'output',
    'playwright',
    `eval-text-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );

  const { token, authStatus } = await resolveAuthToken(apiBase, env);
  await mkdir(outDir, { recursive: true });
  const serviceHealth = await tryRequestJson(`${healthBaseFromApi(apiBase)}/health/services`);
  const enabledTypes = await requestJson(`${apiBase}/custom-types?enabled_only=true&page_size=0`, {
    headers: authHeaders(token),
  });
  const selectedTypes = splitCsv(env.EVAL_TEXT_TYPES) ||
    (enabledTypes.custom_types || []).map((item) => item.id);

  const upload = await uploadFile(apiBase, token, inputPath);
  const parseStart = performance.now();
  const parse = await requestJson(`${apiBase}/files/${upload.file_id}/parse`, {
    headers: authHeaders(token),
  });
  const parseMs = Math.round(performance.now() - parseStart);

  const nerStart = performance.now();
  const ner = await requestJson(`${apiBase}/files/${upload.file_id}/ner/hybrid`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ entity_type_ids: selectedTypes }),
  });
  const nerMs = Math.round(performance.now() - nerStart);

  const entities = ner.entities || [];
  const summary = {
    api: apiBase,
    input: path.resolve(inputPath),
    output_dir: path.resolve(outDir),
    file_id: upload.file_id,
    file_type: upload.file_type,
    page_count: parse.page_count || upload.page_count || 1,
    content_chars: (parse.content || '').length,
    selected_entity_types: selectedTypes,
    auth_status: authStatus,
    service_health: serviceHealth,
    parse_ms: parseMs,
    ner_ms: nerMs,
    entity_count: entities.length,
    entity_summary: ner.entity_summary || summarizeEntities(entities).byType,
    source_summary: summarizeEntities(entities).bySource,
    recognition_failed: Boolean(ner.recognition_failed),
    warnings: ner.warnings || [],
    error: ner.error || null,
  };
  summary.qa_warnings = analyzeTextEval(summary, entities);
  summary.quality_gate = buildQualityGate(summary, entities, env);

  await writeFile(path.join(outDir, 'parse.json'), JSON.stringify(parse, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'entities.json'), JSON.stringify(entities, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(outDir, 'report.html'), renderHtmlReport(summary, parse.content || '', entities), 'utf8');

  console.log(
    `${path.basename(inputPath)}: ${entities.length} entities, parse ${(parseMs / 1000).toFixed(2)}s, ` +
    `ner ${(nerMs / 1000).toFixed(2)}s, quality=${summary.quality_gate.passed ? 'pass' : 'fail'}`,
  );
  console.log(`summary: ${path.resolve(outDir, 'summary.json')}`);
  console.log(`report: ${path.resolve(outDir, 'report.html')}`);
  if (!summary.quality_gate.passed) {
    for (const check of summary.quality_gate.failed_checks) {
      console.error(`quality gate failed: ${check}`);
    }
    process.exitCode = 1;
  }
}

async function renderReportFromSummary(summaryPath) {
  if (!summaryPath) {
    throw new Error('Set a summary.json path after --render-report.');
  }
  const resolvedSummaryPath = path.resolve(summaryPath);
  const outDir = path.dirname(resolvedSummaryPath);
  const summary = JSON.parse(await readFile(resolvedSummaryPath, 'utf8'));
  const parse = JSON.parse(await readFile(path.join(outDir, 'parse.json'), 'utf8'));
  const entities = JSON.parse(await readFile(path.join(outDir, 'entities.json'), 'utf8'));
  const reportPath = path.join(outDir, 'report.html');
  await writeFile(reportPath, renderHtmlReport(summary, parse.content || '', entities), 'utf8');
  console.log(`report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

function renderHtmlReport(summary, content, entities) {
  const title = `Text Eval - ${path.basename(summary.input)}`;
  const sortedEntities = [...entities].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
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
      background: rgba(255, 255, 255, 0.94);
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
    .metric, .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .metric { padding: 12px; }
    .metric span { display: block; color: var(--muted); font-size: 12px; }
    .metric strong { display: block; margin-top: 5px; font-size: 22px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-top: 18px;
    }
    .panel { padding: 14px; overflow: hidden; }
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
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 9px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; background: #fafafa; }
    td { overflow-wrap: anywhere; }
    mark {
      background: #d1fae5;
      color: #064e3b;
      border-radius: 4px;
      padding: 0 3px;
    }
    .source {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 7px;
      background: #eef2ff;
      color: #3730a3;
      font-size: 12px;
    }
    .muted { color: var(--muted); }
    .small { font-size: 12px; }
    .warn { color: #b45309; }
    .error { color: #b91c1c; }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>${escapeHtml(title)}</h1>
      <div class="path">${escapeHtml(summary.input)}</div>
      <div class="metrics">
        ${renderMetric('实体数', summary.entity_count)}
        ${renderMetric('字符数', summary.content_chars)}
        ${renderMetric('解析耗时', formatMs(summary.parse_ms))}
        ${renderMetric('识别耗时', formatMs(summary.ner_ms))}
        ${renderMetric('类型数', summary.selected_entity_types.length)}
        ${renderMetric('质量门槛', summary.quality_gate ? (summary.quality_gate.passed ? 'PASS' : 'FAIL') : '未采集')}
      </div>
    </div>
  </header>
  <main class="wrap">
    <section class="grid">
      ${renderPanel('类型统计', Object.entries(summary.entity_summary || {}).sort(sortCountDesc))}
      ${renderPanel('来源统计', Object.entries(summary.source_summary || {}).sort(sortCountDesc))}
      ${renderServiceHealth(summary.service_health)}
      ${renderQualityGate(summary.quality_gate)}
      ${renderWarnings(summary)}
    </section>
    <section class="panel" style="margin-top: 18px;">
      <h2>实体明细</h2>
      ${renderEntityTable(sortedEntities)}
    </section>
  </main>
</body>
</html>`;
}

function renderMetric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function renderPanel(title, rows) {
  const body = rows.length
    ? `<div class="chips">${rows.map(([key, count]) => renderChip(key, count)).join('')}</div>`
    : '<div class="muted small">暂无</div>';
  return `<div class="panel"><h2>${escapeHtml(title)}</h2>${body}</div>`;
}

function renderServiceHealth(health) {
  if (!health || health.error) {
    return `<div class="panel"><h2>服务快照</h2><div class="warn">${escapeHtml(health?.error || '未采集')}</div></div>`;
  }
  const rows = [
    [`all_online=${Boolean(health.all_online)}`, ''],
    [`probe=${health.probe_ms ?? '?'}ms`, ''],
  ];
  if (health.gpu_memory) {
    rows.push([`GPU ${health.gpu_memory.used_mb}/${health.gpu_memory.total_mb} MiB`, '']);
  }
  for (const proc of health.gpu_processes || []) {
    const memory = Number.isFinite(proc.used_mb) ? `${proc.used_mb} MiB` : '显存未知';
    rows.push([`GPU pid ${proc.pid} ${memory}`, proc.name || '未知进程']);
  }
  for (const [key, service] of Object.entries(health.services || {})) {
    rows.push([`${service.name || key} ${service.status || 'unknown'}`, '']);
  }
  return renderPanel('服务快照', rows);
}

function renderQualityGate(gate) {
  if (!gate) {
    return '<div class="panel"><h2>质量门槛</h2><div class="muted small">未采集</div></div>';
  }
  const lines = [
    `<div class="${gate.passed ? 'small' : 'error'}">${gate.passed ? 'PASS' : 'FAIL'}</div>`,
    `<div class="muted small">entities=${escapeHtml(String(gate.entity_count ?? 0))}, chars=${escapeHtml(String(gate.content_chars ?? 0))}, warnings=${escapeHtml(String(gate.warning_count ?? 0))}</div>`,
  ];
  for (const check of gate.failed_checks || []) {
    lines.push(`<div class="error">${escapeHtml(check)}</div>`);
  }
  const thresholds = Object.entries(gate.thresholds || {});
  const thresholdHtml = thresholds.length
    ? `<div class="chips" style="margin-top: 10px;">${thresholds.map(([key, value]) => renderChip(key, value)).join('')}</div>`
    : '';
  return `<div class="panel"><h2>质量门槛</h2>${lines.join('')}${thresholdHtml}</div>`;
}

function renderWarnings(summary) {
  const lines = [];
  if (summary.recognition_failed) lines.push('<div class="error">识别失败标记为 true</div>');
  if (summary.error) lines.push(`<div class="error">${escapeHtml(summary.error)}</div>`);
  for (const warning of summary.warnings || []) {
    lines.push(`<div class="warn">${escapeHtml(warning)}</div>`);
  }
  for (const warning of summary.qa_warnings || []) {
    lines.push(`<div class="warn">${escapeHtml(warning)}</div>`);
  }
  return `<div class="panel"><h2>质检提示</h2>${lines.join('') || '<div class="muted small">无</div>'}</div>`;
}

function renderChip(key, count) {
  if (count === '') return `<span class="chip">${escapeHtml(key)}</span>`;
  return `<span class="chip">${escapeHtml(key)} <strong>${escapeHtml(String(count))}</strong></span>`;
}

function renderEntityTable(entities) {
  if (!entities.length) return '<div class="muted small">暂无实体</div>';
  const rows = entities.map((entity, index) => {
    const fingerprint = sensitiveTextFingerprint(entity.text);
    return `<tr>
      <td style="width: 48px;">${index + 1}</td>
      <td style="width: 130px;">${escapeHtml(entity.type || '')}</td>
      <td style="width: 90px;"><span class="source">${escapeHtml(entity.source || 'unknown')}</span></td>
      <td style="width: 180px;"><code>${escapeHtml(fingerprint.sha256.slice(0, 16))}</code></td>
      <td style="width: 90px;">${escapeHtml(String(fingerprint.length))}</td>
      <td style="width: 120px;" class="muted">${escapeHtml(`${entity.start ?? ''}-${entity.end ?? ''}`)}</td>
    </tr>`;
  }).join('');
  return `<p class="muted small">Raw entity text and surrounding context are withheld from this report; rows show text hash and length only.</p><table>
    <thead><tr><th>#</th><th>类型</th><th>来源</th><th>文本</th><th>位置</th><th>上下文</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function sensitiveTextFingerprint(value) {
  const text = String(value ?? '');
  return {
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    length: text.length,
  };
}

function sortCountDesc(a, b) {
  return b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));
}

function formatMs(value) {
  const ms = Number(value || 0);
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function analyzeTextEval(summary, entities) {
  const warnings = [];
  const gpu = summary.service_health?.gpu_memory;
  if (gpu?.used_mb && gpu?.total_mb) {
    const ratio = gpu.used_mb / gpu.total_mb;
    if (ratio >= 0.9) {
      warnings.push(`评测时 GPU 显存占用 ${(ratio * 100).toFixed(1)}%（${gpu.used_mb}/${gpu.total_mb} MiB），高显存压力可能影响模型服务稳定性。`);
    }
  }
  if (summary.service_health?.all_online === false) {
    warnings.push('评测开始时存在离线模型服务，需检查服务快照。');
  }
  if (!entities.length) {
    warnings.push('未识别到任何实体，需确认文件是否解析成功或默认类型是否过窄。');
  }
  if (summary.ner_ms > 10000) {
    warnings.push(`文本识别耗时 ${formatMs(summary.ner_ms)}，超过 10s。`);
  }
  const semanticTypes = selectedSemanticTypes(summary);
  if (semanticTypes.length && !hasSemanticHit(entities)) {
    warnings.push('已选择语义类实体，但没有 HaS/semantic 来源命中，需检查语义服务或候选行过滤是否过严。');
  }
  const moneyLikeCount = entities.filter((entity) => {
    const text = String(entity.text || '');
    return entity.type === 'AMOUNT' && /[%％]/.test(text);
  }).length;
  if (moneyLikeCount > 5) {
    warnings.push(`金额类型中包含 ${moneyLikeCount} 个百分比样式结果，需检查金额和比例的类型边界。`);
  }
  for (const [key, count] of duplicatePositionCounts(entities)) {
    if (count >= 4) {
      warnings.push(`同一位置存在重复实体：${key} 出现 ${count} 次，需检查去重逻辑。`);
      break;
    }
  }
  if (summary.content_chars > 300 && (summary.source_summary?.regex || 0) > 0 && semanticTypes.length && !summary.source_summary?.has) {
    warnings.push('当前结果主要来自快速确定性规则，语义类文档建议确认 HaS Text 是否正常参与。');
  }
  return warnings;
}

function duplicatePositionCounts(entities) {
  const counts = new Map();
  for (const entity of entities) {
    if (!Number.isFinite(entity.start) || !Number.isFinite(entity.end)) continue;
    const key = `${entity.type || 'UNKNOWN'}:${entity.start}-${entity.end}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
