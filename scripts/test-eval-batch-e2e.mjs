#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-batch-e2e-'));

function venvPython(venvDir) {
  return path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

function pythonCmd() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = [];
  if (process.env.VENV_DIR) candidates.push(venvPython(process.env.VENV_DIR));
  candidates.push(venvPython(path.join(rootDir, '.venv')));
  candidates.push(venvPython(path.join(rootDir, 'backend', '.venv')));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function spawnText(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function makeZip(zipPath, redacted, fileIds, contentOverride = null) {
  const manifest = {
    generated_at: '2026-05-05T00:00:00.000Z',
    redacted,
    requested_count: fileIds.length,
    included_count: fileIds.length,
    skipped_count: 0,
    included: fileIds.map((fileId, index) => ({
      file_id: fileId,
      filename: `file-${index + 1}.txt`,
      archive_name: `${redacted ? 'redacted_' : ''}file-${index + 1}.txt`,
    })),
    skipped: [],
  };
  const code = [
    'import json, sys, zipfile',
    'zip_path=sys.argv[1]',
    'manifest=json.loads(sys.argv[2])',
    'with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:',
    '    for item in manifest["included"]:',
    '        z.writestr(item["archive_name"], sys.argv[3] if sys.argv[3] else ("redacted content ☐" if manifest["redacted"] else "original content"))',
    '    z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))',
  ].join('\n');
  const result = spawnSync(pythonCmd(), ['-c', code, zipPath, JSON.stringify(manifest), contentOverride || ''], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.error?.message || ''}\n${result.stdout || ''}\n${result.stderr || ''}`);
}

function makeMixedZip(zipPath, redacted, entries) {
  const manifest = {
    generated_at: '2026-05-05T00:00:00.000Z',
    redacted,
    requested_count: entries.length,
    included_count: entries.length,
    skipped_count: 0,
    included: entries.map((entry) => ({
      file_id: entry.file_id,
      filename: entry.filename,
      archive_name: entry.archive_name,
    })),
    skipped: [],
  };
  const code = [
    'import base64, json, sys, zipfile',
    'zip_path=sys.argv[1]',
    'manifest=json.loads(sys.argv[2])',
    'entries=json.loads(sys.argv[3])',
    'with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:',
    '    for entry in entries:',
    '        z.writestr(entry["archive_name"], base64.b64decode(entry["content_b64"]))',
    '    z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))',
  ].join('\n');
  const result = spawnSync(pythonCmd(), ['-c', code, zipPath, JSON.stringify(manifest), JSON.stringify(entries)], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.error?.message || ''}\n${result.stdout || ''}\n${result.stderr || ''}`);
}

function b64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function assertBackendStorageNextSteps(summary) {
  const text = JSON.stringify(summary.next_steps || []);
  assert.match(text, /backend logs/);
  assert.match(text, /SQLite/);
  assert.match(text, /drvfs/);
  assert.match(text, /WAL/);
  assert.match(text, /doctor:strict/);
  assert.doesNotMatch(text, /contract-a\.txt|contract-b\.txt/);
}

async function assertBatchArtifactContract(outDir, expectedInputs) {
  const summary = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
  const exportReport = JSON.parse(await readFile(path.join(outDir, 'export-report.json'), 'utf8'));
  const report = await readFile(path.join(outDir, 'report.html'), 'utf8');
  assert.equal(summary.inputs.length, expectedInputs);
  assert.equal(summary.privacy.private_details, false);
  assert.ok(exportReport.summary, 'export-report.json should include summary');
  assert.match(report, /Batch E2E Evaluation/);
  const pdfGate = summary.quality_gate?.pdf_size_regression;
  assert.equal(typeof pdfGate?.checked_count, 'number');
  assert.equal(typeof pdfGate?.failed_count, 'number');
  assert.equal(typeof pdfGate?.risk_count, 'number');
  assert.ok(Array.isArray(pdfGate.checked));
  assert.equal(typeof pdfGate.thresholds?.max_pdf_size_ratio, 'number');
  assert.equal(typeof pdfGate.thresholds?.max_pdf_size_bytes, 'number');
  assert.equal(typeof pdfGate.thresholds?.warn_pdf_size_ratio, 'number');
  assert.equal(typeof pdfGate.thresholds?.warn_pdf_size_bytes, 'number');
  const artifactText = JSON.stringify({ summary, exportReport, report });
  assert.doesNotMatch(artifactText, /contract-a\.txt|contract-b\.txt/);
  return { summary, exportReport, report };
}

try {
  const inputA = path.join(tmpDir, 'contract-a.txt');
  const inputB = path.join(tmpDir, 'contract-b.txt');
  await writeFile(inputA, 'Party A: Alice\nPhone: 13800138000\n', 'utf8');
  await writeFile(inputB, 'Party B: Example Corp\nSeal here\n', 'utf8');

  const fileIds = ['file-1', 'file-2', 'file-3'];
  const originalZipPath = path.join(tmpDir, 'mock-original.zip');
  const redactedZipPath = path.join(tmpDir, 'mock-redacted.zip');
  const leakyRedactedZipPath = path.join(tmpDir, 'mock-redacted-leaky.zip');
  const pdfOriginalZipPath = path.join(tmpDir, 'mock-original-pdf.zip');
  const pdfBloatRedactedZipPath = path.join(tmpDir, 'mock-redacted-pdf-bloat.zip');
  makeZip(originalZipPath, false, fileIds);
  makeZip(redactedZipPath, true, fileIds);
  makeZip(leakyRedactedZipPath, true, fileIds, 'Alice leaked content');
  makeMixedZip(pdfOriginalZipPath, false, [
    { file_id: 'file-1', filename: 'contract.pdf', archive_name: 'contract.pdf', content_b64: b64(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024, 49)])) },
    { file_id: 'file-2', filename: 'notes.txt', archive_name: 'notes.txt', content_b64: b64('original content') },
    { file_id: 'file-3', filename: 'memo.txt', archive_name: 'memo.txt', content_b64: b64('original content') },
  ]);
  makeMixedZip(pdfBloatRedactedZipPath, true, [
    { file_id: 'file-1', filename: 'contract.pdf', archive_name: 'redacted_contract.pdf', content_b64: b64(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(9000, 50)])) },
    { file_id: 'file-2', filename: 'notes.txt', archive_name: 'redacted_notes.txt', content_b64: b64('redacted content') },
    { file_id: 'file-3', filename: 'memo.txt', archive_name: 'redacted_memo.txt', content_b64: b64('redacted content') },
  ]);
  const originalZip = await readFile(originalZipPath);
  const redactedZip = await readFile(redactedZipPath);
  const leakyRedactedZip = await readFile(leakyRedactedZipPath);
  const pdfOriginalZip = await readFile(pdfOriginalZipPath);
  const pdfBloatRedactedZip = await readFile(pdfBloatRedactedZipPath);

  const state = {
    job: null,
    uploads: [],
    items: [],
    commits: [],
    zeroDetections: false,
    pipelineFailure: false,
    failJobPolling: false,
    failExportReport: false,
    metadataDegradedJob: false,
    metadataDegradedExport: false,
    leakRedactedZip: false,
    pdfBloatZip: false,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: false, authenticated: true, password_set: null });
    }
    if (req.method === 'GET' && url.pathname === '/health/services') {
      return sendJson(res, 200, { backend: { status: 'online' } });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/custom-types') {
      return sendJson(res, 200, { custom_types: [{ id: 'PERSON' }, { id: 'PHONE' }], total: 2 });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/jobs') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        state.job = {
          id: 'job-1',
          job_type: parsed.job_type,
          title: parsed.title,
          status: 'draft',
          skip_item_review: false,
          config: parsed.config,
          created_at: '2026-05-05T00:00:00Z',
          updated_at: '2026-05-05T00:00:00Z',
          progress: {},
        };
        sendJson(res, 200, state.job);
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/files/upload') {
      req.on('data', () => {});
      req.on('end', () => {
        const index = state.uploads.length;
        const fileId = fileIds[index];
        const item = {
          id: `item-${index + 1}`,
          job_id: 'job-1',
          file_id: fileId,
          filename: `file-${index + 1}.txt`,
          file_type: 'text',
          status: 'pending',
          has_output: false,
          entity_count: 0,
          created_at: '2026-05-05T00:00:00Z',
          updated_at: '2026-05-05T00:00:00Z',
        };
        state.uploads.push(fileId);
        state.items.push(item);
        sendJson(res, 200, {
          file_id: fileId,
          filename: item.filename,
          file_type: 'text',
          file_size: 100 + index,
          page_count: 1,
        });
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/jobs/job-1/submit') {
      state.job.status = 'awaiting_review';
      for (const item of state.items) {
        item.status = 'awaiting_review';
        item.entity_count = 1;
      }
      return sendJson(res, 200, { ...state.job, progress: { awaiting_review: state.items.length } });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/jobs/job-1') {
      if (state.failJobPolling) {
        return sendJson(res, 500, { detail: 'mock job polling failure' });
      }
      const allCompleted = state.items.length > 0 && state.items.every((item) => item.status === 'completed');
      state.job.status = allCompleted ? 'completed' : state.job.status;
      return sendJson(res, 200, {
        ...state.job,
        progress: {
          total_items: state.items.length,
          awaiting_review: state.items.filter((item) => item.status === 'awaiting_review').length,
          completed: state.items.filter((item) => item.status === 'completed').length,
          failed: 0,
        },
        nav_hints: {
          metadata_degraded: state.metadataDegradedJob,
          metadata_degraded_count: state.metadataDegradedJob ? 1 : 0,
        },
        items: state.items,
      });
    }
    const fileInfoMatch = url.pathname.match(/^\/api\/v1\/files\/(file-\d+)$/);
    if (req.method === 'GET' && fileInfoMatch) {
      const fileId = fileInfoMatch[1];
      return sendJson(res, 200, {
        id: fileId,
        original_filename: `${fileId}.txt`,
        file_type: 'text',
        entities: [
          ...(state.zeroDetections
            ? []
            : [
                {
                  id: `${fileId}-entity-1`,
                  text: 'Alice',
                  type: 'PERSON',
                  start: 0,
                  end: 5,
                  page: 1,
                  confidence: 0.95,
                  source: 'regex',
                  selected: true,
                },
              ]),
        ],
        bounding_boxes: state.zeroDetections
          ? {}
          : {
              1: [
                {
                  id: `${fileId}-box-1`,
                  x: 0.1,
                  y: 0.1,
                  width: 0.2,
                  height: 0.1,
                  page: 1,
                  type: fileId === 'file-2' ? 'table' : 'official_seal',
                  selected: true,
                  confidence: fileId === 'file-2' ? 0.5 : 0.9,
                  source: fileId === 'file-2' ? 'ocr_has' : 'has_image',
                  source_detail: fileId === 'file-1'
                    ? 'local_red_seal_fallback'
                    : fileId === 'file-2'
                      ? 'table_structure'
                      : 'has_image',
                  evidence_source: fileId === 'file-1'
                    ? 'has_image_model'
                    : fileId === 'file-2'
                      ? 'ocr_has'
                      : 'has_image_model',
                  warnings: fileId === 'file-1' ? ['fallback_detector', 'edge_seal'] : [],
                },
                ...(fileId === 'file-2'
                  ? [
                      {
                        id: `${fileId}-box-2`,
                        x: 0.45,
                        y: 0.2,
                        width: 0.12,
                        height: 0.08,
                        page: 1,
                        type: 'visual_text',
                        selected: true,
                        confidence: 0.88,
                        source: 'ocr_has',
                        source_detail: 'ocr_text',
                        warnings: [],
                      },
                    ]
                  : []),
              ],
            },
        vision_quality: {
          1: {
            warnings: [],
            pipeline_status: {
              ocr_has: {
                ran: true,
                skipped: false,
                failed: false,
                region_count: state.zeroDetections ? 0 : 1,
                error: null,
              },
              has_image: {
                ran: !state.pipelineFailure,
                skipped: false,
                failed: state.pipelineFailure,
                region_count: state.pipelineFailure || state.zeroDetections ? 0 : 1,
                error: state.pipelineFailure ? 'mock HaS Image outage' : null,
              },
            },
          },
        },
      });
    }
    const commitMatch = url.pathname.match(/^\/api\/v1\/jobs\/job-1\/items\/(item-\d+)\/review\/commit$/);
    if (req.method === 'POST' && commitMatch) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        state.commits.push(parsed);
        const item = state.items.find((candidate) => candidate.id === commitMatch[1]);
        item.status = 'completed';
        item.has_output = true;
        item.entity_count = parsed.entities.length + parsed.bounding_boxes.length;
        sendJson(res, 200, item);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/jobs/job-1/export-report') {
      if (state.failExportReport) {
        return sendJson(res, 500, { detail: 'mock export report failure' });
      }
      return sendJson(res, 200, {
        generated_at: '2026-05-05T00:00:00Z',
        job: { id: 'job-1', status: 'completed', job_type: 'smart_batch', skip_item_review: false, config: {} },
        summary: {
          total_files: 2,
          selected_files: 2,
          redacted_selected_files: 2,
          unredacted_selected_files: 0,
          review_confirmed_selected_files: 2,
          failed_selected_files: 0,
          detected_entities: 4,
          redaction_coverage: 1,
          action_required_files: 0,
          ready_for_delivery: true,
          by_status: { completed: 2 },
          zip_redacted_included_files: 2,
          zip_redacted_skipped_files: 0,
          visual_review_issue_files: 1,
          visual_review_issue_count: 2,
          visual_review_by_issue: { edge_seal: 1, seam_seal: 1 },
          visual_evidence: {
            total_boxes: 4,
            selected_boxes: 3,
            has_image_model: 1,
            local_fallback: 1,
            ocr_has: 1,
            table_structure: 1,
            fallback_detector: 1,
            source_counts: { has_image: 2, ocr_has: 1 },
            evidence_source_counts: { has_image_model: 1, local_fallback: 1, ocr_has: 1 },
            source_detail_counts: { local_red_seal_fallback: 1, table_structure: 1 },
            warnings_by_key: { fallback_detector: 1, manual_review: 1 },
          },
        },
        redacted_zip: { included_count: 2, skipped_count: 0, skipped: [] },
        files: state.items.map((item, index) => {
          const hasVisualIssues = index === 0;
          const metadataWarning = state.metadataDegradedExport && index === 0
            ? 'file_metadata_unavailable'
            : null;
          const visualEvidenceByIndex = [
            {
              total_boxes: 1,
              selected_boxes: 1,
              has_image_model: 0,
              local_fallback: 1,
              ocr_has: 0,
              table_structure: 0,
              fallback_detector: 1,
              source_counts: { has_image: 1 },
              evidence_source_counts: { local_fallback: 1 },
              source_detail_counts: { local_red_seal_fallback: 1 },
              warnings_by_key: { fallback_detector: 1 },
            },
            {
              total_boxes: 2,
              selected_boxes: 1,
              has_image_model: 0,
              local_fallback: 0,
              ocr_has: 1,
              table_structure: 1,
              fallback_detector: 0,
              source_counts: { ocr_has: 1 },
              evidence_source_counts: { ocr_has: 1 },
              source_detail_counts: { table_structure: 1 },
              warnings_by_key: { manual_review: 1 },
            },
            {
              total_boxes: 1,
              selected_boxes: 1,
              has_image_model: 1,
              local_fallback: 0,
              ocr_has: 0,
              table_structure: 0,
              fallback_detector: 0,
              source_counts: { has_image: 1 },
              evidence_source_counts: { has_image_model: 1 },
              source_detail_counts: {},
              warnings_by_key: {},
            },
          ];
          return {
            item_id: item.id,
            file_id: item.file_id,
            filename: `${item.file_id}.txt`,
            status: 'completed',
            has_output: !metadataWarning,
            review_confirmed: true,
            entity_count: item.entity_count,
            ready_for_delivery: !metadataWarning,
            selected_for_export: true,
            error: metadataWarning,
            metadata_warning: metadataWarning,
            blocking_reasons: metadataWarning ? [metadataWarning] : [],
            visual_review: hasVisualIssues
              ? {
                  issue_count: 2,
                  issue_pages: ['5'],
                  by_issue: { edge_seal: 1, seam_seal: 1 },
                }
              : {
                  issue_count: 0,
                  issue_pages: [],
                  by_issue: {},
                },
            visual_evidence: visualEvidenceByIndex[index] || {
              total_boxes: 0,
              selected_boxes: 0,
              has_image_model: 0,
              local_fallback: 0,
              ocr_has: 0,
              table_structure: 0,
              fallback_detector: 0,
              source_counts: {},
              evidence_source_counts: {},
              source_detail_counts: {},
              warnings_by_key: {},
            },
          };
        }),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/files/batch/download') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        const zip = state.pdfBloatZip
          ? (parsed.redacted ? pdfBloatRedactedZip : pdfOriginalZip)
          : parsed.redacted
            ? state.leakRedactedZip
              ? leakyRedactedZip
              : redactedZip
            : originalZip;
        res.writeHead(200, {
          'content-type': 'application/zip',
          'X-Batch-Zip-Requested-Count': '2',
          'X-Batch-Zip-Included-Count': '2',
          'X-Batch-Zip-Skipped-Count': '0',
          'X-Batch-Zip-Redacted': parsed.redacted ? 'true' : 'false',
          'X-Batch-Zip-Skipped': '[]',
        });
        res.end(zip);
      });
      return;
    }
    sendJson(res, 404, { detail: `not found: ${req.method} ${url.pathname}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const outDir = path.join(tmpDir, 'out');
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'summary.partial.json'), '{"stale":true}', 'utf8');
    const result = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', outDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /quality=pass/);
    assert.match(result.stdout, /pdf=0 checked\/0 fail\/0 risk/);
    assert.equal(state.job.config.input_count, 3);
    assert.equal(state.commits.length, 3);
    assert.equal(state.commits[0].entities.length, 1);
    assert.equal(state.commits[0].bounding_boxes.length, 1);
    assert.equal(state.commits[1].bounding_boxes.length, 2);

    const { summary, report } = await assertBatchArtifactContract(outDir, 3);
    assert.equal(summary.inputs.length, 3);
    assert.equal(summary.privacy.private_details, false);
    assert.equal(summary.inputs[0].label, 'input-01');
    assert.equal(summary.inputs[0].extension, '.txt');
    assert.equal(typeof summary.inputs[0].path_sha256, 'string');
    assert.equal(summary.inputs[0].path, undefined);
    assert.equal(summary.uploads[0].input_label, 'input-01');
    assert.equal(summary.quality_gate.passed, true);
    assert.equal(summary.export_report.summary.ready_for_delivery, true);
    assert.equal(summary.export_report.summary.visual_review_issue_count, 2);
    assert.equal(summary.export_report.summary.visual_evidence.selected_boxes, 3);
    assert.equal(summary.export_report.summary.visual_evidence.has_image_model, 1);
    assert.equal(summary.export_report.summary.visual_evidence.local_fallback, 1);
    assert.equal(summary.export_report.summary.visual_evidence.ocr_has, 1);
    assert.equal(summary.export_report.summary.visual_evidence.table_structure, 1);
    assert.equal(summary.export_report.summary.visual_evidence.fallback_detector, 1);
    assert.deepEqual(summary.export_report.summary.visual_evidence.source_counts, { has_image: 2, ocr_has: 1 });
    assert.equal(summary.export_report.files[0].visual_evidence.local_fallback, 1);
    assert.equal(summary.export_report.files[1].visual_evidence.ocr_has, 1);
    assert.equal(summary.export_report.files[2].visual_evidence.has_image_model, 1);
    assert.equal(summary.redaction_verification.checked_entity_count, 3);
    assert.equal(summary.redaction_verification.checked_files.length, 3);
    assert.equal(summary.redaction_verification.leak_count, 0);
    assert.equal(summary.quality_gate.pipeline_health.failed, 0);
    assert.equal(summary.quality_gate.pipeline_health.checked, 6);
    assert.equal(summary.quality_gate.pipeline_health.fallback_detector_boxes, 1);
    assert.equal(summary.quality_gate.pipeline_health.visual_diagnostics.has_image_model_boxes, 1);
    assert.equal(summary.quality_gate.pipeline_health.visual_diagnostics.local_fallback_boxes, 1);
    assert.equal(summary.quality_gate.pipeline_health.visual_diagnostics.ocr_text_boxes, 1);
    assert.equal(summary.quality_gate.pipeline_health.visual_diagnostics.table_structure_boxes, 1);
    assert.equal(summary.quality_gate.pipeline_health.visual_diagnostics.low_confidence_boxes, 1);
    assert.equal(summary.quality_gate.pipeline_health.visual_diagnostics.missing_evidence_source_boxes, 1);
    assert.deepEqual(summary.quality_gate.warning_checks, ['visual boxes missing evidence_source: 1']);
    assert.equal(
      summary.quality_gate.pipeline_health.visual_diagnostics.box_warnings_by_key.fallback_detector,
      1,
    );
    assert.equal(
      summary.quality_gate.pipeline_health.visual_diagnostics.source_detail_counts.local_red_seal_fallback,
      1,
    );
    assert.equal(
      summary.quality_gate.pipeline_health.visual_diagnostics.source_detail_counts.table_structure,
      1,
    );
    assert.equal(
      summary.quality_gate.pipeline_health.visual_diagnostics.source_detail_counts.ocr_text,
      1,
    );
    const evidenceByFile = summary.quality_gate.pipeline_health.visual_diagnostics.evidence_source_by_file;
    const evidenceByFilePage = summary.quality_gate.pipeline_health.visual_diagnostics.evidence_source_by_file_page;
    assert.equal(evidenceByFile.length, 3);
    assert.equal(evidenceByFilePage.length, 3);
    const file1Evidence = evidenceByFilePage.find((row) => row.file_id === 'file-1' && row.page === 1);
    assert.equal(file1Evidence.boxes, 1);
    assert.equal(file1Evidence.has_image_model, 0);
    assert.equal(file1Evidence.local_fallback, 1);
    assert.equal(file1Evidence.ocr_has, 0);
    assert.equal(file1Evidence.table_structure, 0);
    assert.equal(file1Evidence.fallback_detector, 1);
    assert.equal(file1Evidence.missing_evidence_source_boxes, 0);
    assert.equal(file1Evidence.source_detail_counts.local_red_seal_fallback, 1);
    assert.equal(file1Evidence.warnings_by_key.fallback_detector, 1);
    const file2Evidence = evidenceByFilePage.find((row) => row.file_id === 'file-2' && row.page === 1);
    assert.equal(file2Evidence.boxes, 2);
    assert.equal(file2Evidence.has_image_model, 0);
    assert.equal(file2Evidence.local_fallback, 0);
    assert.equal(file2Evidence.ocr_has, 2);
    assert.equal(file2Evidence.table_structure, 1);
    assert.equal(file2Evidence.fallback_detector, 0);
    assert.equal(file2Evidence.missing_evidence_source_boxes, 1);
    const file3Evidence = evidenceByFilePage.find((row) => row.file_id === 'file-3' && row.page === 1);
    assert.equal(file3Evidence.boxes, 1);
    assert.equal(file3Evidence.has_image_model, 1);
    assert.equal(file3Evidence.local_fallback, 0);
    assert.equal(file3Evidence.ocr_has, 0);
    assert.equal(file3Evidence.table_structure, 0);
    assert.equal(file3Evidence.fallback_detector, 0);
    assert.equal(file3Evidence.missing_evidence_source_boxes, 0);
    const fallbackDiagnostics = summary.review_results
      .flatMap((result) => result.bounding_box_diagnostics || [])
      .filter((box) => box.source_detail === 'local_red_seal_fallback');
    assert.equal(fallbackDiagnostics.length, 1);
    assert.equal(fallbackDiagnostics[0].page, 1);
    assert.equal(fallbackDiagnostics[0].evidence_source, 'has_image_model');
    assert.equal(summary.quality_gate.pdf_size_regression.checked_count, 0);
    assert.equal(summary.redacted_zip.manifest.manifest.included_count, 3);
    assert.equal(summary.redacted_zip.manifest.entries.length, 4);
    assert.equal(summary.redacted_zip.path, 'redacted.zip');
    await access(path.join(outDir, 'export-report.json'));
    await access(path.join(outDir, 'redacted.zip'));
    await assert.rejects(
      () => access(path.join(outDir, 'summary.partial.json')),
      /ENOENT/,
    );
    assert.match(report, /Batch E2E Evaluation/);
    assert.match(report, /PASS/);
    assert.match(report, /Thresholds And Totals/);
    assert.match(report, /Detections/);
    assert.match(report, /Boxes/);
    assert.match(report, /Redacted ZIP/);
    assert.match(report, /PDF size gate/);
    assert.match(report, /0 checked \/ 0 fail \/ 0 risk/);
    assert.match(report, /Visual Review Risks/);
    assert.match(report, /Export Visual Evidence/);
    assert.match(report, /export_report\.summary\.visual_evidence/);
    assert.match(report, /files\[\]\.visual_evidence/);
    assert.match(report, /source_counts/);
    assert.match(report, /evidence_source_counts/);
    assert.match(report, /source_detail_counts/);
    assert.match(report, /warnings_by_key/);
    assert.match(report, /<td>input-01\.txt<\/td>\s*<td>completed<\/td>\s*<td>1<\/td>\s*<td>1<\/td>\s*<td>0<\/td>\s*<td>1<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>1<\/td>/);
    assert.match(report, /<td>input-02\.txt<\/td>\s*<td>completed<\/td>\s*<td>2<\/td>\s*<td>1<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>1<\/td>\s*<td>1<\/td>\s*<td>0<\/td>/);
    assert.match(report, /<td>input-03\.txt<\/td>\s*<td>completed<\/td>\s*<td>1<\/td>\s*<td>1<\/td>\s*<td>1<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>0<\/td>/);
    assert.match(report, /Pipeline Health/);
    assert.match(report, /HaS Image model boxes/);
    assert.match(report, /Local fallback boxes/);
    assert.match(report, /OCR text boxes/);
    assert.match(report, /Fallback detector boxes/);
    assert.match(report, /Table structure boxes/);
    assert.match(report, /Low confidence boxes/);
    assert.match(report, /Missing evidence_source boxes/);
    assert.match(report, /Evidence Source By File And Page/);
    assert.match(report, /has_image_model/);
    assert.match(report, /local_fallback/);
    assert.match(report, /ocr_has/);
    assert.match(report, /fallback_detector/);
    assert.match(report, /missing_evidence_source_boxes/);
    assert.match(report, /<td>input-01\.txt<\/td>\s*<td>1<\/td>\s*<td>1<\/td>\s*<td>0<\/td>\s*<td>1<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>1<\/td>\s*<td>0<\/td>/);
    assert.match(report, /<td>input-02\.txt<\/td>\s*<td>1<\/td>\s*<td>2<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>2<\/td>\s*<td>1<\/td>\s*<td>0<\/td>\s*<td>1<\/td>/);
    assert.match(report, /<td>input-03\.txt<\/td>\s*<td>1<\/td>\s*<td>1<\/td>\s*<td>1<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>0<\/td>\s*<td>0<\/td>/);
    assert.match(report, /red_seal_fallback/);
    assert.match(report, /ocr_text/);
    assert.match(report, /table_structure/);
    assert.match(report, /No unhealthy non-skipped vision pipelines/);
    assert.match(report, /Redacted ZIP Verification/);
    assert.match(report, /No selected text entity leaks/);
    assert.match(report, /visual issues/);
    assert.match(report, /Edge seal/);
    assert.match(report, /Seam seal/);
    assert.match(report, /review/);
    assert.match(report, /ready/);

    state.job = null;
    state.uploads = [];
    state.items = [];
    state.commits = [];
    state.zeroDetections = true;
    state.failExportReport = false;
    state.leakRedactedZip = false;

    const zeroOutDir = path.join(tmpDir, 'out-zero-detections');
    const zeroResult = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', zeroOutDir, inputA, inputB],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
        },
      },
    );
    assert.notEqual(zeroResult.status, 0, `${zeroResult.stdout}\n${zeroResult.stderr}`);
    assert.match(zeroResult.stdout, /quality=fail/);
    assert.match(zeroResult.stderr, /total detections 0 < 2/);
    assert.match(zeroResult.stderr, /file below recognition threshold/);

    const zeroSummary = JSON.parse(await readFile(path.join(zeroOutDir, 'summary.json'), 'utf8'));
    assert.equal(zeroSummary.quality_gate.passed, false);
    assert.equal(zeroSummary.quality_gate.recognition_totals.detections, 0);
    const zeroReport = await readFile(path.join(zeroOutDir, 'report.html'), 'utf8');
    assert.match(zeroReport, /FAIL/);
    assert.match(zeroReport, /Recognition/);
    assert.match(zeroReport, /Delivery/);
    assert.match(zeroReport, /ZIP/);
    assert.match(zeroReport, /total detections 0 &lt; 2/);

    state.job = null;
    state.uploads = [];
    state.items = [];
    state.commits = [];
    state.zeroDetections = false;
    state.failExportReport = false;
    state.leakRedactedZip = true;
    state.pdfBloatZip = false;

    const leakOutDir = path.join(tmpDir, 'out-leaky-redacted');
    const leakResult = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', leakOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
        },
      },
    );
    assert.notEqual(leakResult.status, 0, `${leakResult.stdout}\n${leakResult.stderr}`);
    assert.match(leakResult.stdout, /quality=fail/);
    assert.match(leakResult.stderr, /redacted zip leaked 3 selected text entities/);
    const leakSummary = JSON.parse(await readFile(path.join(leakOutDir, 'summary.json'), 'utf8'));
    assert.equal(leakSummary.quality_gate.passed, false);
    assert.equal(leakSummary.redaction_verification.leak_count, 3);
    assert.equal(leakSummary.redaction_verification.leaks[0].type, 'PERSON');
    assert.equal(leakSummary.redaction_verification.leaks[0].text_sha256, undefined);
    assert.match(leakSummary.redaction_verification.leaks[0].archive_name, /^input-\d\d\.txt$/);
    const leakReport = await readFile(path.join(leakOutDir, 'report.html'), 'utf8');
    assert.match(leakReport, /Redacted ZIP Verification/);
    assert.match(leakReport, /Leaks/);
    assert.match(leakReport, /PERSON/);

    state.job = null;
    state.uploads = [];
    state.items = [];
    state.commits = [];
    state.zeroDetections = false;
    state.pipelineFailure = false;
    state.failExportReport = false;
    state.leakRedactedZip = false;
    state.pdfBloatZip = true;

    const pdfBloatOutDir = path.join(tmpDir, 'out-pdf-bloat');
    const pdfBloatResult = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', pdfBloatOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
          EVAL_BATCH_MAX_PDF_SIZE_RATIO: '4',
          EVAL_BATCH_MAX_PDF_SIZE_BYTES: '1000000',
        },
      },
    );
    assert.notEqual(pdfBloatResult.status, 0, `${pdfBloatResult.stdout}\n${pdfBloatResult.stderr}`);
    assert.match(pdfBloatResult.stdout, /quality=fail/);
    assert.match(pdfBloatResult.stdout, /pdf=1 checked\/1 fail\/0 risk/);
    assert.match(pdfBloatResult.stderr, /redacted zip PDF size regression/);
    assert.match(pdfBloatResult.stderr, /redacted\/original PDF size ratio/);
    const { summary: pdfBloatSummary, report: pdfBloatReport } = await assertBatchArtifactContract(pdfBloatOutDir, 3);
    assert.equal(pdfBloatSummary.quality_gate.passed, false);
    assert.equal(pdfBloatSummary.quality_gate.pdf_size_regression.checked_count, 1);
    assert.equal(pdfBloatSummary.quality_gate.pdf_size_regression.failed_count, 1);
    assert.equal(pdfBloatSummary.quality_gate.pdf_size_regression.checked[0].status, 'fail');
    assert.ok(pdfBloatSummary.quality_gate.pdf_size_regression.checked[0].ratio > 4);
    assert.match(pdfBloatReport, /PDF size gate/);
    assert.match(pdfBloatReport, /1 checked \/ 1 fail \/ 0 risk/);
    assert.match(pdfBloatReport, /PDF Size Regression/);
    assert.match(pdfBloatReport, /input-01\.pdf/);

    state.job = null;
    state.uploads = [];
    state.items = [];
    state.commits = [];
    state.zeroDetections = false;
    state.pipelineFailure = true;
    state.failExportReport = false;
    state.leakRedactedZip = false;
    state.pdfBloatZip = false;

    const pipelineOutDir = path.join(tmpDir, 'out-pipeline-failure');
    const pipelineResult = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', pipelineOutDir, inputA, inputB],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
        },
      },
    );
    assert.notEqual(pipelineResult.status, 0, `${pipelineResult.stdout}\n${pipelineResult.stderr}`);
    assert.match(pipelineResult.stdout, /quality=fail/);
    assert.match(pipelineResult.stderr, /vision pipeline unhealthy/);
    assert.match(pipelineResult.stderr, /mock HaS Image outage/);
    const pipelineSummary = JSON.parse(await readFile(path.join(pipelineOutDir, 'summary.json'), 'utf8'));
    assert.equal(pipelineSummary.quality_gate.passed, false);
    assert.equal(pipelineSummary.quality_gate.pipeline_health.failed, 2);
    assert.match(pipelineSummary.quality_gate.pipeline_health.failures[0], /has_image failed/);
    const pipelineReport = await readFile(path.join(pipelineOutDir, 'report.html'), 'utf8');
    assert.match(pipelineReport, /Pipeline Health/);
    assert.match(pipelineReport, /mock HaS Image outage/);

    state.job = null;
    state.uploads = [];
    state.items = [];
    state.commits = [];
    state.zeroDetections = false;
    state.pipelineFailure = false;
    state.failJobPolling = true;
    state.failExportReport = false;
    state.metadataDegradedJob = false;
    state.metadataDegradedExport = false;
    state.leakRedactedZip = false;
    state.pdfBloatZip = false;

    const pollingFailOutDir = path.join(tmpDir, 'out-job-polling-failure');
    const pollingFailResult = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', pollingFailOutDir, inputA, inputB],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
        },
      },
    );
    assert.notEqual(pollingFailResult.status, 0, `${pollingFailResult.stdout}\n${pollingFailResult.stderr}`);
    assert.match(pollingFailResult.stderr, /HTTP 500 mock job polling failure/);
    const pollingFailSummary = JSON.parse(await readFile(path.join(pollingFailOutDir, 'summary.partial.json'), 'utf8'));
    assert.equal(pollingFailSummary.error.stage, 'recognition');
    assert.match(pollingFailSummary.error.message, /HTTP 500 mock job polling failure/);
    assertBackendStorageNextSteps(pollingFailSummary);
    const pollingFailReport = await readFile(path.join(pollingFailOutDir, 'report.html'), 'utf8');
    assert.match(pollingFailReport, /mock job polling failure/);
    assert.match(pollingFailReport, /backend logs/);
    assert.match(pollingFailReport, /SQLite/);

    state.job = null;
    state.uploads = [];
    state.items = [];
    state.commits = [];
    state.zeroDetections = false;
    state.pipelineFailure = false;
    state.failJobPolling = false;
    state.failExportReport = true;
    state.metadataDegradedJob = false;
    state.metadataDegradedExport = false;
    state.leakRedactedZip = false;
    state.pdfBloatZip = false;

    const failOutDir = path.join(tmpDir, 'out-export-report-failure');
    const failResult = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', failOutDir, inputA, inputB],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
        },
      },
    );
    assert.notEqual(failResult.status, 0, `${failResult.stdout}\n${failResult.stderr}`);
    assert.match(failResult.stderr, /mock export report failure/);
    assert.match(failResult.stderr, /partial summary:/);
    assert.match(failResult.stderr, /failure report:/);
    const partialSummary = JSON.parse(await readFile(path.join(failOutDir, 'summary.partial.json'), 'utf8'));
    assert.equal(partialSummary.error.stage, 'export report');
    assert.match(partialSummary.error.message, /mock export report failure/);
    assert.ok(partialSummary.next_steps.some((step) => step.includes('/jobs/job-1/export-report')));
    assertBackendStorageNextSteps(partialSummary);
    const failReport = await readFile(path.join(failOutDir, 'report.html'), 'utf8');
    assert.match(failReport, /INCOMPLETE/);
    assert.match(failReport, /Failure/);
    assert.match(failReport, /Next Steps/);
    assert.match(failReport, /mock export report failure/);
    assert.match(failReport, /backend logs/);
    assert.match(failReport, /SQLite/);
    assert.match(failReport, /doctor:strict/);

    state.job = null;
    state.uploads = [];
    state.items = [];
    state.commits = [];
    state.zeroDetections = false;
    state.pipelineFailure = false;
    state.failExportReport = false;
    state.metadataDegradedJob = true;
    state.metadataDegradedExport = false;
    state.leakRedactedZip = false;
    state.pdfBloatZip = false;

    const degradedJobOutDir = path.join(tmpDir, 'out-job-metadata-degraded');
    const degradedJobResult = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', degradedJobOutDir, inputA, inputB],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
        },
      },
    );
    assert.notEqual(degradedJobResult.status, 0, `${degradedJobResult.stdout}\n${degradedJobResult.stderr}`);
    assert.match(degradedJobResult.stderr, /metadata_degraded during job polling/);
    const degradedJobSummary = JSON.parse(await readFile(path.join(degradedJobOutDir, 'summary.partial.json'), 'utf8'));
    assert.equal(degradedJobSummary.error.stage, 'recognition');
    assert.match(degradedJobSummary.error.message, /metadata_degraded during job polling/);
    assertBackendStorageNextSteps(degradedJobSummary);
    const degradedJobReport = await readFile(path.join(degradedJobOutDir, 'report.html'), 'utf8');
    assert.match(degradedJobReport, /metadata_degraded during job polling/);
    assert.match(degradedJobReport, /drvfs/);
    assert.match(degradedJobReport, /WAL/);

    state.job = null;
    state.uploads = [];
    state.items = [];
    state.commits = [];
    state.zeroDetections = false;
    state.pipelineFailure = false;
    state.failExportReport = false;
    state.metadataDegradedJob = false;
    state.metadataDegradedExport = true;
    state.leakRedactedZip = false;
    state.pdfBloatZip = false;

    const degradedExportOutDir = path.join(tmpDir, 'out-export-metadata-degraded');
    const degradedExportResult = await spawnText(
      process.platform === 'win32' ? 'node.exe' : 'node',
      ['scripts/eval-batch-e2e.mjs', degradedExportOutDir, inputA, inputB],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_BATCH_WAIT_MS: '30000',
          EVAL_BATCH_POLL_MS: '50',
        },
      },
    );
    assert.notEqual(degradedExportResult.status, 0, `${degradedExportResult.stdout}\n${degradedExportResult.stderr}`);
    assert.match(degradedExportResult.stderr, /metadata_degraded during export report/);
    const degradedExportSummary = JSON.parse(await readFile(path.join(degradedExportOutDir, 'summary.partial.json'), 'utf8'));
    assert.equal(degradedExportSummary.error.stage, 'export report');
    assert.match(degradedExportSummary.error.message, /metadata_degraded during export report/);
    assert.equal(degradedExportSummary.export_report.files[0].metadata_warning, 'file_metadata_unavailable');
    assertBackendStorageNextSteps(degradedExportSummary);
    const degradedExportReport = await readFile(path.join(degradedExportOutDir, 'report.html'), 'utf8');
    assert.match(degradedExportReport, /metadata_degraded during export report/);
    assert.match(degradedExportReport, /backend logs/);
    assert.match(degradedExportReport, /doctor:strict/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval batch e2e tests passed');
