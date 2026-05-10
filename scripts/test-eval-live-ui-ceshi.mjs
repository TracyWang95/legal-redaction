#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendBatchApiQualityFindings,
  appendBatchExportVisualQualityFindings,
  appendBoxGeometryQualityFindings,
  buildBatchApiEvidence,
  buildBatchExportVisualEvidence,
  buildBatchPhaseDiagnostics,
  buildBoxGeometryEvidence,
  buildFailedRequestDiagnostics,
  buildAuthCookie,
  buildPerformanceContext,
  clickVisibleButtonByText,
  compactStep3JobsRequestEvidence,
  compactStep3WaitDomEvidence,
  finalizeSummary,
  isIgnorableFailedRequest,
  parseSingleDetectionTotal,
  resolveBatchJobIdSnapshot,
  resolveAllRecognitionCompleteTiming,
  sanitizeStep3JobsRequestSample,
  sanitizeStep3WaitDomSample,
  summarizeBatchRecognitionStatus,
} from './eval-live-ui-ceshi.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runScript(args, timeoutMs = 15_000, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/eval-live-ui-ceshi.mjs', ...args], {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`eval-live-ui-ceshi timed out. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, output: `${stdout}${stderr}` });
    });
  });
}

async function writeCeshiFixture(ceshiDir) {
  await mkdir(ceshiDir, { recursive: true });
  await writeFile(path.join(ceshiDir, 'input-a.docx'), 'docx-a');
  await writeFile(path.join(ceshiDir, 'input-b.docx'), 'docx-b');
  await writeFile(path.join(ceshiDir, 'input-c.pdf'), 'pdf');
  await writeFile(path.join(ceshiDir, 'input-d.png'), 'png');
}

async function testHelp() {
  const result = await runScript(['--help']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Single-file upload and recognition/);
  assert.match(result.output, /Batch upload, recognition, review/);
  assert.match(result.output, /--allow-gpu-busy/);
}

async function testDryRunWritesPlanWithoutBrowser() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-live-ui-dry-'));
  const ceshiDir = path.join(tmpDir, 'ceshi');
  const outDir = path.join(tmpDir, 'out');
  try {
    await writeFile(path.join(tmpDir, 'placeholder'), '');
    await writeCeshiFixture(ceshiDir);
    const result = await runScript([
      '--dry-run',
      '--ceshi-dir',
      ceshiDir,
      '--out-dir',
      outDir,
      '--base-url',
      'http://127.0.0.1:9',
    ], 15_000, { EVAL_LIVE_UI_GPU_PREFLIGHT_MOCK: 'busy' });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /single=input-01\.png batch=4/);
    assert.doesNotMatch(result.output, /GPU\/service preflight/);
    const plan = JSON.parse(await readFile(path.join(outDir, 'dry-run.json'), 'utf8'));
    assert.equal(plan.mode, 'dry-run');
    assert.equal(plan.skipped.browser, true);
    assert.equal(plan.single_image.label, 'input-01.png');
    assert.deepEqual(plan.batch_files.map((file) => file.label), [
      'input-01.docx',
      'input-02.docx',
      'input-03.pdf',
      'input-04.png',
    ]);
    assert.equal(typeof plan.private_corpus_dir_sha256, 'string');
    assert.equal(plan.ceshi_dir, undefined);
    assert.match(plan.browser_checks.join('\n'), /page overflow/);
    assert.match(plan.browser_checks.join('\n'), /legacy single-file label/);
    assert.doesNotMatch(plan.browser_checks.join('\n'), /\bPlayground\b/);
    assert.match(plan.browser_checks.join('\n'), /service status/);
    assert.match(plan.browser_checks.join('\n'), /visible mask/);
    assert.match(plan.browser_checks.join('\n'), /confirm-to-export/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testRealRunRefusesBusyGpuBeforeFrontend() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-live-ui-busy-'));
  const ceshiDir = path.join(tmpDir, 'ceshi');
  const outDir = path.join(tmpDir, 'out');
  try {
    await writeCeshiFixture(ceshiDir);
    const result = await runScript([
      '--ceshi-dir',
      ceshiDir,
      '--out-dir',
      outDir,
      '--base-url',
      'http://127.0.0.1:9',
    ], 15_000, { EVAL_LIVE_UI_GPU_PREFLIGHT_MOCK: 'busy' });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Live UI real run refused/);
    assert.match(result.output, /reserved GPU process|large GPU process/);
    assert.match(result.output, /Use --dry-run/);
    assert.doesNotMatch(result.output, /Frontend not reachable|fetch failed/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testAllowGpuBusyContinuesPastPreflight() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-live-ui-allow-busy-'));
  const ceshiDir = path.join(tmpDir, 'ceshi');
  const outDir = path.join(tmpDir, 'out');
  try {
    await writeCeshiFixture(ceshiDir);
    const result = await runScript([
      '--allow-gpu-busy',
      '--ceshi-dir',
      ceshiDir,
      '--out-dir',
      outDir,
      '--base-url',
      'http://127.0.0.1:9',
    ], 15_000, { EVAL_LIVE_UI_GPU_PREFLIGHT_MOCK: 'busy' });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /warning ignored by --allow-gpu-busy/);
    assert.match(result.output, /fetch failed|ECONNREFUSED|bad port/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function testFailedRequestClassification() {
  const abortedRedactionForce = {
    url: 'http://127.0.0.1:8000/api/v1/redaction/image?force=true',
    failure: 'net::ERR_ABORTED',
  };
  const abortedVisionForce = {
    url: 'http://127.0.0.1:8000/api/v1/vision/analyze?force=true',
    failure: 'net::ERR_ABORTED',
  };
  assert.equal(isIgnorableFailedRequest(abortedRedactionForce), true);
  assert.equal(isIgnorableFailedRequest(abortedVisionForce), true);
  assert.equal(
    isIgnorableFailedRequest({
      url: 'http://127.0.0.1:8000/api/v1/redaction/image?force=false',
      failure: 'net::ERR_ABORTED',
    }),
    false,
  );
  assert.equal(
    isIgnorableFailedRequest({
      url: 'http://127.0.0.1:8000/api/v1/vision/analyze?force=true',
      failure: 'net::ERR_FAILED',
    }),
    false,
  );
  assert.equal(
    isIgnorableFailedRequest({
      url: 'http://127.0.0.1:8000/api/v1/files/upload?force=true',
      failure: 'net::ERR_ABORTED',
    }),
    false,
  );
  assert.equal(isIgnorableFailedRequest({ url: 'blob:http://127.0.0.1/token', failure: 'net::ERR_FAILED' }), true);
  assert.equal(isIgnorableFailedRequest({ url: 'http://127.0.0.1:8000/health/services', failure: 'net::ERR_FAILED' }), true);
}

function testSummaryPassedRequiresOnlyRealFailures() {
  const summary = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [
      {
        method: 'POST',
        url: 'http://127.0.0.1:8000/api/v1/redaction/image?force=true',
        failure: 'net::ERR_ABORTED',
      },
      {
        method: 'POST',
        url: 'http://127.0.0.1:8000/api/v1/vision/analyze?force=true',
        failure: 'net::ERR_ABORTED',
      },
    ],
  });
  assert.equal(summary.passed, true);
  assert.equal(summary.ignored_failed_requests.length, 2);

  const realFailure = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [
      {
        method: 'POST',
        url: 'http://127.0.0.1:8000/api/v1/redaction/image?force=true',
        failure: 'net::ERR_ABORTED',
      },
      {
        method: 'POST',
        url: 'http://127.0.0.1:8000/api/v1/redaction/image',
        failure: 'net::ERR_FAILED',
      },
    ],
  });
  assert.equal(realFailure.passed, false);
  assert.equal(realFailure.ignored_failed_requests.length, 1);
  assert.equal(realFailure.failed_request_diagnostics.actionable, 1);
  assert.deepEqual(realFailure.failed_request_diagnostics.actionable_by_failure, { 'net::ERR_FAILED': 1 });
  assert.deepEqual(realFailure.actionable_failed_requests, [
    {
      method: 'POST',
      url: 'http://127.0.0.1:8000/api/v1/redaction/image',
      failure: 'net::ERR_FAILED',
      resource_type: null,
      is_navigation_request: null,
      frame_url: null,
      post_data_bytes: null,
      post_data_hash: null,
      elapsed_ms: null,
    },
  ]);
}

function testSummaryEvidenceStillCollectedOnFailure() {
  const summary = finalizeSummary({
    passed: false,
    error: 'recognition timed out',
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [
      {
        method: 'POST',
        url: 'http://127.0.0.1:8000/api/v1/vision/analyze?force=true',
        failure: 'net::ERR_ABORTED',
      },
    ],
  });
  assert.equal(summary.passed, false);
  assert.equal(summary.ignored_failed_requests.length, 1);
}

function testFailedRequestDiagnosticsKeepsActionableDetails() {
  const diagnostics = buildFailedRequestDiagnostics([
    {
      method: 'POST',
      url: 'http://127.0.0.1:8000/api/v1/files/upload?token=private',
      failure: 'net::ERR_FAILED',
      resource_type: 'xhr',
      is_navigation_request: false,
      frame_url: 'http://127.0.0.1:3000/batch/smart?jobId=job-private',
      post_data_bytes: 128,
      post_data_hash: 'abcd1234',
      elapsed_ms: 1234.4,
    },
    {
      method: 'POST',
      url: 'http://127.0.0.1:8000/api/v1/vision/analyze?force=true',
      failure: 'net::ERR_ABORTED',
    },
  ]);
  assert.equal(diagnostics.total, 2);
  assert.equal(diagnostics.ignored, 1);
  assert.equal(diagnostics.actionable, 1);
  assert.deepEqual(diagnostics.actionable_by_method, { POST: 1 });
  assert.deepEqual(diagnostics.actionable_by_url, { 'http://127.0.0.1:8000/api/v1/files/upload': 1 });
  assert.deepEqual(diagnostics.actionable_requests, [
    {
      method: 'POST',
      url: 'http://127.0.0.1:8000/api/v1/files/upload',
      failure: 'net::ERR_FAILED',
      resource_type: 'xhr',
      is_navigation_request: false,
      frame_url: 'http://127.0.0.1:3000/batch/smart',
      post_data_bytes: 128,
      post_data_hash: 'abcd1234',
      elapsed_ms: 1234,
    },
  ]);
}

function testAuthCookieUsesFrontendOriginOnly() {
  assert.equal(buildAuthCookie('http://127.0.0.1:3000', ''), null);
  assert.deepEqual(buildAuthCookie('http://127.0.0.1:3000', 'local-token'), {
    name: 'access_token',
    value: 'local-token',
    url: 'http://127.0.0.1:3000',
    httpOnly: true,
    sameSite: 'Strict',
    secure: false,
  });
  assert.equal(buildAuthCookie('https://example.test', 'local-token').secure, true);
}

function testSingleDetectionTotalParsing() {
  assert.equal(parseSingleDetectionTotal('复核选择 已选 10 / 10 区域列表 10 开始匿名化(10)'), 10);
  assert.equal(parseSingleDetectionTotal('Review selection Selected 3 / 7 Region list 7'), 7);
  assert.equal(parseSingleDetectionTotal('开始匿名化 (12)'), 12);
  assert.equal(parseSingleDetectionTotal('no detections yet'), 0);
}

function testBatchApiEvidenceFlagsEmptyScannedPdfAndImageWithoutNames() {
  const findings = [];
  const refs = [
    { label: 'input-01.docx' },
    { label: 'input-02.docx' },
    { label: 'input-03.pdf' },
    { label: 'input-04.png' },
  ];
  const evidence = buildBatchApiEvidence(
    {
      id: 'job-private',
      items: [
        { sort_order: 3, filename: 'private-image-name.png', file_type: 'image', status: 'awaiting_review', entity_count: 0 },
        { sort_order: 1, filename: 'private-doc-a.docx', file_type: 'docx', status: 'completed', entity_count: 0 },
        { sort_order: 2, filename: 'private-doc-b.docx', file_type: 'docx', status: 'completed', entity_count: 0 },
        { sort_order: 2.5, filename: 'private-contract.pdf', file_type: 'pdf_scanned', status: 'awaiting_review', entity_count: 0 },
      ],
    },
    refs,
  );
  appendBatchApiQualityFindings(evidence, findings);
  assert.equal(evidence.job_id, 'job-private');
  assert.deepEqual(evidence.files, [
    { label: 'input-01.docx', file_type: 'docx', status: 'completed', entity_count: 0 },
    { label: 'input-02.docx', file_type: 'docx', status: 'completed', entity_count: 0 },
    { label: 'input-03.pdf', file_type: 'pdf_scanned', status: 'awaiting_review', entity_count: 0 },
    { label: 'input-04.png', file_type: 'image', status: 'awaiting_review', entity_count: 0 },
  ]);
  assert.match(findings.join('\n'), /input-03\.pdf: scanned PDF API entity_count is 0/);
  assert.match(findings.join('\n'), /input-04\.png: image API entity_count is 0/);
  assert.doesNotMatch(JSON.stringify(evidence), /private-/);
  assert.doesNotMatch(findings.join('\n'), /private-/);
}

function testBatchApiEvidencePassesNonEmptyVisionResults() {
  const findings = [];
  const refs = [
    { label: 'input-01.docx' },
    { label: 'input-02.docx' },
    { label: 'input-03.pdf' },
    { label: 'input-04.png' },
  ];
  const evidence = buildBatchApiEvidence(
    {
      id: 'job-ok',
      items: [
        { sort_order: 0, file_type: 'docx', status: 'completed', entity_count: 0 },
        { sort_order: 1, file_type: 'docx', status: 'completed', entity_count: 0 },
        { sort_order: 2, file_type: 'pdf_scanned', status: 'completed', entity_count: 8 },
        { sort_order: 3, file_type: 'image', status: 'completed', entity_count: 2 },
      ],
    },
    refs,
  );
  appendBatchApiQualityFindings(evidence, findings);
  assert.deepEqual(findings, []);
}

function testBatchApiEvidenceRequiresCurrentJobAndMatchingItems() {
  const findings = [];
  const evidence = buildBatchApiEvidence(null, [{ label: 'input-01.pdf' }]);
  appendBatchApiQualityFindings(evidence, findings);
  assert.equal(evidence.job_id, null);
  assert.match(findings.join('\n'), /could not resolve the current job_id/);
  assert.match(findings.join('\n'), /item count mismatch: api=0 expected=1/);
}

function testBatchExportVisualEvidenceSummarizesPdfAndImageCoverage() {
  const findings = [];
  const evidence = buildBatchExportVisualEvidence(
    {
      summary: {
        ready_for_delivery: true,
        delivery_status: 'ready_for_delivery',
        detected_entities: 66,
        redaction_coverage: 1,
        visual_review_hint: true,
        visual_review_issue_files: 2,
        visual_review_issue_count: 45,
        visual_review_issue_pages_count: 7,
        visual_review_issue_labels: ['edge_seal', 'fallback_detector', 'seam_seal'],
        visual_review_by_issue: { edge_seal: 17, fallback_detector: 14 },
        visual_evidence: {
          total_boxes: 66,
          selected_boxes: 66,
          has_image_model: 14,
          local_fallback: 14,
          ocr_has: 38,
          source_counts: { has_image: 28, ocr_has: 38 },
        },
      },
      files: [
        {
          file_type: 'pdf_scanned',
          status: 'completed',
          entity_count: 57,
          page_count: 6,
          ready_for_delivery: true,
          review_confirmed: true,
          visual_review_hint: true,
          visual_evidence: {
            total_boxes: 57,
            selected_boxes: 57,
            has_image_model: 12,
            local_fallback: 12,
            ocr_has: 33,
            warnings_by_key: { edge_seal: 11, seam_seal: 9 },
          },
          visual_review: {
            review_hint: true,
            blocking: false,
            issue_count: 39,
            issue_pages: ['1', '2', '3', '4', '5', '6'],
            issue_labels: ['edge_seal', 'fallback_detector', 'seam_seal'],
            by_issue: { edge_seal: 15, seam_seal: 12 },
          },
        },
        {
          file_type: 'image',
          status: 'completed',
          entity_count: 9,
          page_count: 1,
          ready_for_delivery: true,
          review_confirmed: true,
          visual_evidence: {
            total_boxes: 9,
            has_image_model: 2,
            local_fallback: 2,
            ocr_has: 5,
          },
          visual_review: { issue_count: 6, issue_pages: ['1'] },
        },
      ],
    },
    [{ label: 'input-01.pdf' }, { label: 'input-02.png' }],
  );

  appendBatchExportVisualQualityFindings(evidence, findings);
  assert.deepEqual(findings, []);
  assert.equal(evidence.ready_for_delivery, true);
  assert.equal(evidence.visual_evidence.total_boxes, 66);
  assert.equal(evidence.visual_evidence.source_counts.has_image, 28);
  assert.equal(evidence.files[0].visual_evidence.total_boxes, 57);
  assert.equal(evidence.files[0].visual_review.issue_pages_count, 6);
  assert.deepEqual(evidence.files[0].visual_review.issue_labels, ['edge_seal', 'fallback_detector', 'seam_seal']);
  assert.equal(evidence.files[1].visual_evidence.has_image_model, 2);
  assert.doesNotMatch(JSON.stringify(evidence), /private|D:\\\\ceshi/i);
}

function testBatchExportVisualEvidenceFlagsMissingVisualBoxes() {
  const findings = [];
  const evidence = buildBatchExportVisualEvidence(
    {
      summary: { ready_for_delivery: false, delivery_status: 'action_required' },
      files: [
        {
          file_type: 'pdf_scanned',
          status: 'completed',
          entity_count: 4,
          page_count: 6,
          visual_evidence: { total_boxes: 0 },
          visual_review: { issue_pages_count: 0 },
        },
      ],
    },
    [{ label: 'input-01.pdf' }],
  );
  appendBatchExportVisualQualityFindings(evidence, findings);
  assert.match(findings.join('\n'), /not ready for delivery/);
  assert.match(findings.join('\n'), /0 visual boxes/);
  assert.match(findings.join('\n'), /no per-page visual review evidence/);
}

function testBoxGeometryEvidenceSummarizesPagesSourcesAndIssues() {
  const evidence = buildBoxGeometryEvidence(
    {
      id: 'file-pdf',
      file_type: 'pdf_scanned',
      page_count: 2,
      bounding_boxes: {
        1: [
          {
            id: 'ok-1',
            page: 1,
            type: 'official_seal',
            source: 'has_image',
            evidence_source: 'has_image_model',
            x: 0.85,
            y: 0.5,
            width: 0.08,
            height: 0.12,
            selected: true,
          },
          {
            id: 'ok-org',
            page: 1,
            type: 'ORG',
            source: 'ocr_has',
            evidence_source: 'ocr_has',
            x: 0.1,
            y: 0.15,
            width: 0.18,
            height: 0.03,
            selected: true,
          },
        ],
        2: [
          {
            id: 'ok-2',
            page: 2,
            type: 'PHONE',
            source: 'ocr_has',
            evidence_source: 'ocr_has',
            x: 0.2,
            y: 0.3,
            width: 0.2,
            height: 0.03,
            selected: true,
          },
          {
            id: 'ok-date',
            page: 2,
            type: 'DATE',
            source: 'ocr_has',
            evidence_source: 'ocr_has',
            x: 0.45,
            y: 0.7,
            width: 0.12,
            height: 0.03,
            selected: true,
          },
        ],
      },
    },
    { label: 'input-01.pdf' },
  );
  const findings = [];
  appendBoxGeometryQualityFindings({ files: [evidence] }, findings);
  assert.deepEqual(findings, []);
  assert.equal(evidence.total_boxes, 4);
  assert.equal(evidence.pages_with_boxes, 2);
  assert.deepEqual(evidence.by_page, { 1: 2, 2: 2 });
  assert.deepEqual(evidence.by_type, { official_seal: 1, ORG: 1, PHONE: 1, DATE: 1 });
  assert.equal(evidence.by_source.has_image, 1);
  assert.equal(evidence.by_evidence_source.ocr_has, 3);
  assert.deepEqual(evidence.alias_leak_types, []);
  assert.deepEqual(evidence.unknown_has_image_types, []);
  assert.equal(evidence.has_org, true);
  assert.equal(evidence.has_date, true);
  assert.equal(evidence.max_area_ratio, 0.0096);
}

function testBoxGeometryEvidenceFlagsSemanticAliasAndNonFixedHasImageTypes() {
  const evidence = buildBoxGeometryEvidence(
    {
      id: 'file-image',
      file_type: 'image',
      page_count: 1,
      bounding_boxes: [
        {
          id: 'alias-1',
          page: 1,
          type: 'COMPANY',
          source: 'ocr_has',
          evidence_source: 'ocr_has',
          x: 0.2,
          y: 0.2,
          width: 0.16,
          height: 0.04,
        },
        {
          id: 'has-image-unknown-1',
          page: 1,
          type: 'ORG',
          source: 'has_image',
          evidence_source: 'has_image_model',
          x: 0.55,
          y: 0.3,
          width: 0.14,
          height: 0.05,
        },
        {
          id: 'non-ascii-ocr-type-1',
          page: 1,
          type: '\u7528\u6237\u540d_\u5bc6\u7801',
          source: 'ocr_has',
          evidence_source: 'ocr_has',
          x: 0.15,
          y: 0.6,
          width: 0.2,
          height: 0.04,
        },
      ],
    },
    { label: 'input-01.png' },
  );
  const findings = [];
  appendBoxGeometryQualityFindings({ files: [evidence] }, findings);
  assert.deepEqual(evidence.by_type, { COMPANY: 1, ORG: 1, '\u7528\u6237\u540d_\u5bc6\u7801': 1 });
  assert.deepEqual(evidence.alias_leak_types, ['COMPANY', '\u7528\u6237\u540d_\u5bc6\u7801']);
  assert.deepEqual(evidence.unknown_has_image_types, ['ORG']);
  assert.equal(evidence.has_org, true);
  assert.equal(evidence.has_date, false);
  assert.match(findings.join('\n'), /input-01\.png: semantic alias type leaked: COMPANY, 用户名_密码\./);
  assert.match(findings.join('\n'), /input-01\.png: non-fixed HaS Image type detected: ORG\./);
}

function testEvidenceSummaryAggregatesTypeIntegrityIssues() {
  const evidence = {
    label: 'input-01.png',
    total_boxes: 3,
    by_type: { COMPANY: 1, ORG: 1, '\u7528\u6237\u540d_\u5bc6\u7801': 1 },
    alias_leak_types: ['COMPANY', '\u7528\u6237\u540d_\u5bc6\u7801'],
    unknown_has_image_types: ['ORG'],
  };
  const summary = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [],
    batch: {
      box_geometry_evidence: { files: [evidence] },
    },
  });
  assert.equal(summary.evidence_summary.type_integrity.state, 'type_normalization_issue_observed');
  assert.deepEqual(summary.evidence_summary.type_integrity.alias_leak_types, ['COMPANY', '\u7528\u6237\u540d_\u5bc6\u7801']);
  assert.deepEqual(summary.evidence_summary.type_integrity.unknown_has_image_types, ['ORG']);
  assert.deepEqual(summary.evidence_summary.type_integrity.alias_leak_files[0].counts_by_type, {
    COMPANY: 1,
    '\u7528\u6237\u540d_\u5bc6\u7801': 1,
  });
  assert.deepEqual(summary.evidence_summary.type_integrity.unknown_has_image_files[0].counts_by_type, { ORG: 1 });
  assert.match(summary.evidence_summary.type_integrity.summary, /alias leaks: COMPANY/);
  assert.match(summary.evidence_summary.type_integrity.summary, /unknown HaS Image: ORG/);
}

function testBoxGeometryEvidenceAllowsLocalFallbackNonFixedHasImageTypes() {
  const evidence = buildBoxGeometryEvidence(
    {
      id: 'file-image',
      file_type: 'image',
      page_count: 1,
      bounding_boxes: [
        {
          id: 'local-fallback-signature-1',
          page: 1,
          type: 'signature',
          source: 'has_image',
          evidence_source: 'local_fallback',
          x: 0.55,
          y: 0.3,
          width: 0.14,
          height: 0.05,
        },
        {
          id: 'local-fallback-handwriting-1',
          page: 1,
          type: 'handwriting',
          source: 'has_image',
          evidence_source: 'local_fallback',
          x: 0.2,
          y: 0.45,
          width: 0.3,
          height: 0.08,
        },
      ],
    },
    { label: 'input-local-fallback.png' },
  );
  const findings = [];
  appendBoxGeometryQualityFindings({ files: [evidence] }, findings);
  assert.deepEqual(evidence.by_type, { signature: 1, handwriting: 1 });
  assert.deepEqual(evidence.unknown_has_image_types, []);
  assert.doesNotMatch(findings.join('\n'), /non-fixed HaS Image type detected/);
}

function testBoxGeometryEvidenceFlagsOversizedAndOutOfBoundsBoxes() {
  const evidence = buildBoxGeometryEvidence(
    {
      id: 'file-pdf',
      file_type: 'pdf_scanned',
      page_count: 3,
      bounding_boxes: {
        1: [
          {
            id: 'bad-1',
            page: 9,
            type: 'official_seal',
            source: 'has_image',
            x: -0.1,
            y: 0.2,
            width: 1.2,
            height: 0.7,
          },
        ],
      },
    },
    { label: 'input-01.pdf' },
  );
  const findings = [];
  appendBoxGeometryQualityFindings({ files: [evidence] }, findings);
  assert.equal(evidence.issue_counts.page_out_of_range, 1);
  assert.equal(evidence.issue_counts.out_of_bounds, 1);
  assert.equal(evidence.issue_counts.oversized, 1);
  assert.match(findings.join('\n'), /geometry issues/);
  assert.match(findings.join('\n'), /1\/3 pages only/);
}

function testPerformanceContextExplainsWarmCachePdf() {
  const evidence = buildBatchApiEvidence(
    {
      id: 'job-perf',
      items: [
        {
          sort_order: 1,
          file_type: 'pdf_scanned',
          status: 'completed',
          entity_count: 4,
          recognition_duration_ms: 3500,
          recognition_page_concurrency: 2,
          recognition_page_concurrency_configured: 2,
          recognition_page_duration_sum_ms: 4200,
          recognition_parallelism_ratio: 1.2,
          recognition_pages: [
            {
              page: 1,
              duration_ms: 2200,
              duration_breakdown_ms: {
                total: 2200,
                pdf_render_ms: 11,
                pdf_render_cache_hit: true,
                pdf_text_layer_ms: 3,
                pdf_text_layer: {
                  cache_hit: true,
                  block_count: 8,
                  char_count: 240,
                  page_width: 1000,
                  page_height: 1400,
                },
                pdf_text_layer_skipped_sparse_file: true,
                private_path: 'D:\\ceshi\\private.pdf',
              },
              cache_status: {
                ocr_vl_cache_status: 'hit',
              },
            },
            {
              page: 2,
              duration_ms: 2000,
              duration_breakdown_ms: {
                total: 2000,
                pdf_render_ms: 19,
                pdf_render_cache_hit: true,
              },
              cache_status: {
                ocr_vl_cache_status: 'hit',
              },
            },
          ],
        },
      ],
    },
    [{ label: 'input-01.pdf' }],
  );
  assert.equal(evidence.files[0].recognition_duration_ms, 3500);
  assert.equal(evidence.files[0].recognition_page_concurrency, 2);
  assert.equal(evidence.files[0].recognition_page_concurrency_configured, 2);
  assert.equal(evidence.files[0].recognition_page_duration_sum_ms, 4200);
  assert.equal(evidence.files[0].recognition_parallelism_ratio, 1.2);
  assert.equal(evidence.files[0].recognition_pages[0].duration_breakdown_ms.private_path, undefined);
  assert.equal(evidence.files[0].recognition_pages[0].duration_breakdown_ms.pdf_text_layer.cache_hit, true);
  assert.equal(evidence.files[0].recognition_pages[0].duration_breakdown_ms.pdf_text_layer.block_count, 8);
  assert.equal(evidence.files[0].recognition_pages[0].duration_breakdown_ms.pdf_text_layer.char_count, 240);
  assert.equal(evidence.files[0].recognition_pages[0].duration_breakdown_ms.pdf_text_layer.page_width, 1000);
  assert.equal(evidence.files[0].recognition_pages[0].duration_breakdown_ms.pdf_text_layer.page_height, 1400);
  assert.equal(evidence.files[0].recognition_pages[0].duration_breakdown_ms.pdf_text_layer_skipped_sparse_file, true);

  const summary = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [
      {
        method: 'POST',
        url: 'http://127.0.0.1:8000/api/v1/vision/analyze?force=true',
        failure: 'net::ERR_ABORTED',
      },
    ],
    single: { recognition_elapsed_ms: 9000 },
    batch: {
      phases: { recognition_wait_ms: 5500 },
      api_evidence: evidence,
    },
  });
  assert.equal(summary.passed, true);
  assert.equal(summary.performance_context.batch.recognition_wait_ms, 5500);
  assert.equal(summary.performance_context.failed_requests.total, 1);
  assert.equal(summary.performance_context.failed_requests.ignored, 1);
  assert.equal(summary.performance_context.failed_requests.actionable, 0);
  const [pdfContext] = summary.performance_context.batch.pdf_recognition;
  assert.equal(pdfContext.recognition_duration_ms, 3500);
  assert.equal(pdfContext.cache.state, 'warm_cache_hit_observed');
  assert.equal(pdfContext.cache.hit_count, 5);
  assert.equal(pdfContext.cache.miss_or_disabled_count, 0);
  assert.equal(pdfContext.cold_cache_supported, false);
  assert.equal(pdfContext.cold_start_supported, false);
  assert.equal(pdfContext.page_parallelism.page_concurrency, 2);
  assert.equal(pdfContext.page_parallelism.page_concurrency_effective, 2);
  assert.equal(pdfContext.page_parallelism.configured_page_concurrency, 2);
  assert.equal(pdfContext.page_parallelism.page_concurrency_configured, 2);
  assert.equal(pdfContext.page_parallelism.page_duration_sum_ms, 4200);
  assert.equal(pdfContext.page_parallelism.recognition_wall_clock_ms, 3500);
  assert.equal(pdfContext.page_parallelism.page_sum_to_wall_clock_ratio, 1.2);
  assert.equal(pdfContext.page_parallelism.observed_parallelism, 'parallel_overlap_observed');
  assert.equal(pdfContext.text_layer.state, 'sparse_fallback_observed');
  assert.equal(pdfContext.text_layer.sparse_fallback_page_count, 1);
  assert.deepEqual(pdfContext.text_layer.sparse_fallback_pages, [1]);
  assert.equal(pdfContext.text_layer.text_layer_block_count_sum, 8);
  assert.equal(pdfContext.text_layer.text_layer_char_count_sum, 240);
  assert.equal(pdfContext.page_duration_rank.slowest_page.page, 1);
  assert.equal(pdfContext.page_duration_rank.slowest_page.duration_ms, 2200);
  assert.match(pdfContext.page_duration_rank.line, /input-01\.pdf page_duration_rank: p1=2200ms > p2=2000ms/);
  assert.match(pdfContext.readable_summary, /recognition=3500ms page_sum=4200ms ratio=1\.2 concurrency=2/);
  assert.match(pdfContext.readable_summary, /text_layer=sparse_fallback_observed/);
  assert.match(pdfContext.interpretation, /Warm-cache evidence/);
  assert.equal(summary.performance_context.batch.pdf_recognition_summary.file_count, 1);
  assert.equal(summary.performance_context.batch.pdf_recognition_summary.duration_sum_ms, 3500);
  assert.equal(summary.performance_context.batch.pdf_recognition_summary.parallel_overlap_observed_count, 1);
  assert.equal(summary.performance_context.batch.pdf_recognition_summary.sparse_text_layer_file_count, 1);
  assert.match(
    summary.performance_context.batch.pdf_recognition_summary.page_duration_rank_lines.join('\n'),
    /input-01\.pdf page_duration_rank: p1=2200ms > p2=2000ms/,
  );
  assert.match(summary.evidence_summary.summary_lines.join('\n'), /cache=warm_cache_hit_observed/);
  assert.match(summary.evidence_summary.summary_lines.join('\n'), /page_duration_rank: p1=2200ms > p2=2000ms/);

  const directContext = buildPerformanceContext(summary);
  assert.equal(directContext.batch.pdf_recognition[0].cache.state, 'warm_cache_hit_observed');
}

function testPerformanceContextExplainsColdCacheAndNoParallelProof() {
  const evidence = buildBatchApiEvidence(
    {
      id: 'job-cold',
      items: [
        {
          sort_order: 1,
          file_type: 'pdf_scanned',
          status: 'completed',
          entity_count: 4,
          recognition_duration_ms: 4000,
          recognition_page_concurrency: 2,
          recognition_page_concurrency_configured: 2,
          recognition_pages: [
            {
              page: 1,
              duration_ms: 1900,
              duration_breakdown_ms: { total: 1900, pdf_render_cache_hit: false },
              cache_status: { ocr_vl_cache_status: 'miss' },
            },
            {
              page: 2,
              duration_ms: 1800,
              duration_breakdown_ms: { total: 1800, pdf_render_cache_hit: false },
              cache_status: { ocr_vl_cache_status: 'miss' },
            },
          ],
        },
      ],
    },
    [{ label: 'input-01.pdf' }],
  );
  const summary = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [],
    batch: {
      phases: { recognition_wait_ms: 4100 },
      api_evidence: evidence,
    },
  });
  const [pdfContext] = summary.performance_context.batch.pdf_recognition;
  assert.equal(pdfContext.cache.state, 'cache_miss_or_disabled_observed');
  assert.equal(pdfContext.cache.hit_count, 0);
  assert.equal(pdfContext.cache.miss_or_disabled_count, 4);
  assert.equal(pdfContext.cold_cache_supported, true);
  assert.equal(pdfContext.cold_start_supported, true);
  assert.equal(pdfContext.page_parallelism.page_duration_sum_ms, 3700);
  assert.equal(pdfContext.page_parallelism.recognition_wall_clock_ms, 4000);
  assert.equal(pdfContext.page_parallelism.page_sum_to_wall_clock_ratio, 0.93);
  assert.equal(pdfContext.page_parallelism.observed_parallelism, 'parallel_overlap_not_observed');
}

function testBatchApiEvidenceKeepsPipelineStageDurations() {
  const evidence = buildBatchApiEvidence(
    {
      id: 'job-stage-duration',
      items: [
        {
          sort_order: 1,
          file_type: 'pdf_scanned',
          status: 'completed',
          entity_count: 9,
          recognition_duration_ms: 8207,
          recognition_pages: [
            {
              page: 1,
              duration_ms: 8207,
              duration_breakdown_ms: {
                total: 8063,
                request_total_ms: 8079,
                'ocr_has.has_text_slot_wait_ms': 2198,
                'ocr_has.has_text_model_ms': 4340,
                'ocr_has.has_text_cache_status': 'model_call',
                'has_image.model': 161,
                unsafe_text_payload: 'do-not-keep',
              },
              cache_status: { vision_result: 'miss' },
            },
          ],
        },
      ],
    },
    [{ label: 'input-01.pdf' }],
  );
  const [page] = evidence.files[0].recognition_pages;
  assert.equal(page.duration_breakdown_ms['ocr_has.has_text_slot_wait_ms'], 2198);
  assert.equal(page.duration_breakdown_ms['ocr_has.has_text_model_ms'], 4340);
  assert.equal(page.duration_breakdown_ms['ocr_has.has_text_cache_status'], 'model_call');
  assert.equal(page.duration_breakdown_ms['has_image.model'], 161);
  assert.equal(page.duration_breakdown_ms.unsafe_text_payload, undefined);
}

function testPerformanceContextDoesNotTreatMixedCacheAsColdStart() {
  const evidence = buildBatchApiEvidence(
    {
      id: 'job-mixed',
      items: [
        {
          sort_order: 1,
          file_type: 'pdf_scanned',
          status: 'completed',
          entity_count: 4,
          recognition_duration_ms: 5000,
          recognition_pages: [
            {
              page: 1,
              duration_ms: 3000,
              duration_breakdown_ms: { total: 3000, pdf_render_cache_hit: true },
              cache_status: { ocr_vl_cache_status: 'hit' },
            },
            {
              page: 2,
              duration_ms: 2900,
              duration_breakdown_ms: { total: 2900, pdf_render_cache_hit: false },
              cache_status: { ocr_vl_cache_status: 'miss' },
            },
          ],
        },
      ],
    },
    [{ label: 'input-01.pdf' }],
  );
  const summary = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [],
    batch: {
      phases: { recognition_wait_ms: 5200 },
      api_evidence: evidence,
    },
  });
  const [pdfContext] = summary.performance_context.batch.pdf_recognition;
  assert.equal(pdfContext.cache.state, 'cache_mixed_observed');
  assert.equal(pdfContext.cold_cache_supported, false);
  assert.equal(pdfContext.cold_start_supported, false);
  assert.match(pdfContext.interpretation, /mixed cache signals/i);
}

function testBatchPhaseDiagnosticsSeparatesPartialReviewAndBackgroundWait() {
  const summary = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [],
    batch: {
      phases: {
        recognition_wait_ms: 14489,
        open_step4_ms: 350,
        review_actions_ms: 31000,
        review_blocked_wait_ms: 15100,
        review_idle_polls: 7,
      },
      phase_events: {
        first_reviewable_ui_ms: 14489,
        review_open_from_submit_ms: 15120,
      },
      api_timing: {
        first_reviewable_ms: 4100,
        first_reviewable_observed_ms: 14300,
        all_recognition_complete_ms: 40213,
        poll_errors: 0,
        last_status: {
          expected_file_count: 4,
          api_item_count: 4,
          status_counts: { completed: 4 },
          reviewable_count: 4,
          recognition_complete_count: 4,
          all_recognition_complete: true,
        },
      },
    },
  });
  const diagnostics = summary.performance_context.batch.phase_diagnostics;
  assert.equal(summary.batch.phase_diagnostics.all_recognition_complete_api_ms, 40213);
  assert.equal(diagnostics.recognition_wait_ms, 14489);
  assert.equal(diagnostics.first_reviewable_ui_ms, 14489);
  assert.equal(diagnostics.first_reviewable_api_ms, 14300);
  assert.equal(diagnostics.first_reviewable_api_item_timestamp_ms, 4100);
  assert.equal(diagnostics.first_reviewable_api_observed_ms, 14300);
  assert.equal(diagnostics.first_reviewable_ui_minus_api_ms, 189);
  assert.equal(diagnostics.first_reviewable_ui_slower_than_api, true);
  assert.equal(diagnostics.first_reviewable_gap_severity, 'minor');
  assert.match(diagnostics.first_reviewable_readable_summary, /ui=14489ms api=14300ms api_item=4100ms delta=189ms state=ui_slower_than_api/);
  assert.match(diagnostics.first_reviewable_threshold_hint, /UI first-reviewable is 189ms slower than API/);
  assert.equal(diagnostics.all_recognition_complete_api_ms, 40213);
  assert.equal(diagnostics.background_continued_after_review_open, true);
  assert.equal(diagnostics.review_waiting_for_background_ms, 25093);
  assert.equal(diagnostics.review_blocked_wait_ms, 15100);
  assert.equal(diagnostics.review_blocked_wait_source, 'background_recognition_incomplete');
  assert.match(diagnostics.review_wait_readable_summary, /blocked=15100ms background=25093ms source=background_recognition_incomplete/);
  assert.match(diagnostics.review_wait_threshold_hint, /Review was open before all files finished recognition/);
  assert.equal(diagnostics.review_active_action_ms, 15900);
  assert.match(diagnostics.recognition_wait_scope, /first-reviewable latency/);
  assert.match(diagnostics.review_wait_scope, /no enabled confirm\/next\/export action/);
  assert.equal(diagnostics.first_reviewable_source, 'api-job-item-status');
  assert.equal(diagnostics.all_recognition_complete_source, 'api-job-item-status');
  assert.match(diagnostics.first_reviewable_scope, /UI\/API delta uses API poll observation/);
  assert.equal(diagnostics.all_recognition_complete_scope, 'API probe: /jobs/<id> status reports all files as terminal-recognized.');

  const direct = buildBatchPhaseDiagnostics(summary.batch);
  assert.equal(direct.all_recognition_complete_observed, true);
  assert.match(summary.performance_context.batch.timing_summary.lines.join('\n'), /first_reviewable: ui=14489ms api=14300ms api_item=4100ms delta=189ms/);
  assert.equal(summary.performance_context.batch.timing_summary.review_wait.source, 'background_recognition_incomplete');
  assert.match(summary.evidence_summary.summary_lines.join('\n'), /review_wait: blocked=15100ms background=25093ms/);
}

function testBatchPhaseDiagnosticsDoesNotCoerceIncompleteAllRecognitionToZero() {
  const summary = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [],
    batch: {
      phases: {
        recognition_wait_ms: 12000,
        open_step4_ms: 300,
        review_actions_ms: 5000,
        review_blocked_wait_ms: null,
      },
      phase_events: {
        first_reviewable_ui_ms: 12000,
        review_open_from_submit_ms: 12400,
      },
      api_timing: {
        first_reviewable_ms: 11800,
        all_recognition_complete_ms: false,
        last_status: {
          expected_file_count: 4,
          api_item_count: 4,
          status_counts: { completed: 3, processing: 1 },
          reviewable_count: 3,
          recognition_complete_count: 3,
          all_recognition_complete: false,
        },
      },
    },
  });
  const diagnostics = summary.batch.phase_diagnostics;
  assert.equal(diagnostics.all_recognition_complete_api_ms, null);
  assert.equal(diagnostics.all_recognition_complete_observed, false);
  assert.equal(diagnostics.all_recognition_complete_source, 'api-job-item-status-partial');
  assert.equal(diagnostics.background_continued_after_review_open, null);
  assert.equal(diagnostics.review_waiting_for_background_ms, null);
  assert.match(summary.performance_context.batch.timing_summary.lines.join('\n'), /all_recognition_complete: api=unknown observed=false/);
}

function testStep3WaitDomEvidenceIsCompactedAndSanitized() {
  const privateBody = `PRIVATE_BODY_${'x'.repeat(220)}`;
  const samples = Array.from({ length: 10 }, (_, index) => ({
    elapsed_ms: index * 500,
    document_hidden: index === 3,
    step3_next: {
      present: true,
      data_reviewable: index >= 8,
      disabled: index < 8,
      aria_disabled: index < 8,
      data_reviewable_count: index >= 8 ? '1' : '0',
      text: index === 4 ? privateBody : 'Next reviewable file',
    },
    recognition_rows: {
      row_count: 2,
      rows: [
        {
          index: 0,
          status_text: index === 5 ? privateBody : `processing ${index}`,
          progress_text: `${index * 10}%`,
          progress_value: String(index * 10),
        },
        {
          index: 1,
          status_text: 'queued',
          progress_text: '',
        },
      ],
    },
  }));

  const evidence = compactStep3WaitDomEvidence(samples, { headLimit: 2, tailLimit: 2 });
  const encoded = JSON.stringify(evidence);
  assert.equal(evidence.sample_count, 10);
  assert.equal(evidence.retained_count, 4);
  assert.equal(evidence.omitted_middle_count, 6);
  assert.equal(evidence.document_hidden_observed, true);
  assert.equal(evidence.final_data_reviewable, true);
  assert.equal(evidence.final_disabled, false);
  assert.doesNotMatch(encoded, /PRIVATE_BODY/);

  const sanitized = sanitizeStep3WaitDomSample(samples[5]);
  const sanitizedEncoded = JSON.stringify(sanitized);
  assert.doesNotMatch(sanitizedEncoded, /PRIVATE_BODY/);
  assert.match(sanitizedEncoded, /\[text:\d+ chars hash:/);
  assert.equal(sanitized.recognition_rows.sampled_count, 2);
}

function testStep3JobsRequestEvidenceIsCompactedAndSanitized() {
  const samples = Array.from({ length: 15 }, (_, index) => ({
    path: `/api/v1/jobs/job-private-${index}`,
    method: 'GET',
    elapsed_ms: index * 1000,
    status: 200,
    duration_ms: 40 + index,
    item_status_counts: index < 8
      ? { processing: 2 }
      : { awaiting_review: 1, processing: 1 },
    reviewable_count: index < 8 ? 0 : 1,
    body: `PRIVATE_BODY_${'x'.repeat(120)}`,
    text: 'sensitive response text',
  }));

  const evidence = compactStep3JobsRequestEvidence(samples, { headLimit: 2, tailLimit: 2 });
  const encoded = JSON.stringify(evidence);
  assert.equal(evidence.sample_count, 15);
  assert.equal(evidence.retained_count, 4);
  assert.equal(evidence.omitted_middle_count, 11);
  assert.equal(evidence.first_request_elapsed_ms, 0);
  assert.equal(evidence.first_reviewable_elapsed_ms, 8000);
  assert.equal(evidence.first_reviewable_response_elapsed_ms, 8048);
  assert.equal(evidence.final_reviewable_count, 1);
  assert.deepEqual(evidence.final_item_status_counts, { awaiting_review: 1, processing: 1 });
  assert.doesNotMatch(encoded, /PRIVATE_BODY|sensitive response text|"body":|"text":/);

  const sanitized = sanitizeStep3JobsRequestSample({
    path: '/api/v1/jobs/job-private',
    method: 'get',
    elapsed_ms: 12.3,
    status: '200',
    duration_ms: 7.6,
    status_counts: { completed: '2', ignored: -1 },
    reviewable_count: '2',
    response_text: 'must not be retained',
  });
  assert.deepEqual(sanitized, {
    path: '/api/v1/jobs/job-private',
    method: 'GET',
    elapsed_ms: 12,
    status: 200,
    duration_ms: 8,
    item_status_counts: { completed: 2 },
    reviewable_count: 2,
  });
}

function testBatchPhaseDiagnosticsIncludesStep3DomEvidence() {
  const summary = finalizeSummary({
    findings: [],
    page_errors: [],
    console: [],
    failed_requests: [],
    batch: {
      phases: {
        recognition_wait_ms: 13000,
        review_actions_ms: 1000,
        review_blocked_wait_ms: 0,
      },
      phase_events: {
        first_reviewable_ui_ms: 13000,
        review_open_from_submit_ms: 13200,
      },
      api_timing: {
        first_reviewable_ms: 1000,
        first_reviewable_observed_ms: 1100,
        poll_errors: 0,
      },
      phase_evidence: {
        step3_wait_dom_samples: [
          {
            elapsed_ms: 500,
            document_hidden: false,
            step3_next: {
              present: true,
              data_reviewable: false,
              disabled: true,
              aria_disabled: true,
              data_reviewable_count: '0',
              text: 'Continue',
            },
            recognition_rows: {
              row_count: 1,
              rows: [{ index: 0, status_text: 'processing', progress_text: '20%', progress_value: '20' }],
            },
          },
          {
            elapsed_ms: 13000,
            document_hidden: false,
            step3_next: {
              present: true,
              data_reviewable: true,
              disabled: false,
              aria_disabled: false,
              data_reviewable_count: '1',
              text: 'Continue',
            },
            recognition_rows: {
              row_count: 1,
              rows: [{ index: 0, status_text: 'awaiting review', progress_text: '100%', progress_value: '100' }],
            },
          },
        ],
        step3_jobs_request_samples: [
          {
            path: '/api/v1/jobs/job-private',
            method: 'GET',
            elapsed_ms: 50,
            status: 200,
            duration_ms: 35,
            item_status_counts: { processing: 2 },
            reviewable_count: 0,
          },
          {
            path: '/api/v1/jobs/job-private',
            method: 'GET',
            elapsed_ms: 1100,
            status: 200,
            duration_ms: 45,
            item_status_counts: { awaiting_review: 1, processing: 1 },
            reviewable_count: 1,
          },
        ],
      },
    },
  });

  const diagnostics = summary.batch.phase_diagnostics.step3_wait_dom;
  assert.equal(diagnostics.sample_count, 2);
  assert.equal(diagnostics.retained_count, 2);
  assert.equal(diagnostics.final_data_reviewable, true);
  assert.equal(diagnostics.samples[1].step3_next.data_reviewable_count, 1);
  assert.equal(summary.performance_context.batch.phase_diagnostics.step3_wait_dom.sample_count, 2);
  assert.equal(summary.evidence_summary.step3_wait_dom.sample_count, 2);
  assert.equal(summary.batch.phase_diagnostics.step3_jobs_requests.sample_count, 2);
  assert.equal(summary.batch.phase_diagnostics.step3_jobs_requests.first_request_elapsed_ms, 50);
  assert.equal(summary.batch.phase_diagnostics.step3_jobs_requests.first_reviewable_response_elapsed_ms, 1145);
  assert.equal(summary.performance_context.batch.phase_diagnostics.step3_jobs_requests.final_reviewable_count, 1);
  assert.equal(summary.evidence_summary.step3_jobs_requests.sample_count, 2);
  assert.match(summary.evidence_summary.summary_lines.join('\n'), /step3_wait_dom: samples=2 changes=2 retained=2/);
  assert.match(summary.evidence_summary.summary_lines.join('\n'), /step3_jobs_requests: samples=2 retained=2 first_get=50ms/);
  assert.match(summary.evidence_summary.summary_lines.join('\n'), /final_status_counts=awaiting_review:1,processing:1/);
}

function testBatchJobIdResolutionPrefersCurrentRunOverSessionFallback() {
  const staleSnapshot = {
    url_job_id: null,
    session_job_ids: {
      lr_batch_job_id_smart: 'job-stale',
      lr_batch_job_id_image: 'job-image-stale',
    },
  };
  assert.deepEqual(
    resolveBatchJobIdSnapshot(staleSnapshot, { preferredJobIds: ['job-created-current'] }),
    { job_id: 'job-created-current', source: 'current-run-captured' },
  );
  assert.deepEqual(
    resolveBatchJobIdSnapshot(
      { ...staleSnapshot, url_job_id: 'job-url-current' },
      { preferredJobIds: ['job-created-current'] },
    ),
    { job_id: 'job-url-current', source: 'url-query' },
  );
  assert.deepEqual(
    resolveBatchJobIdSnapshot(staleSnapshot, { allowSessionFallback: false }),
    { job_id: null, source: 'not_resolved' },
  );
  assert.deepEqual(resolveBatchJobIdSnapshot(staleSnapshot), {
    job_id: 'job-stale',
    source: 'sessionStorage:lr_batch_job_id_smart',
  });
}

function testBatchRecognitionStatusSummaryUsesCountsOnly() {
  const status = summarizeBatchRecognitionStatus(
    {
      id: 'job-private',
      items: [
        { sort_order: 2, filename: 'private.pdf', status: 'processing' },
        { sort_order: 1, filename: 'private.docx', status: 'awaiting_review', recognition_duration_ms: 1200 },
        { sort_order: 3, filename: 'private.png', status: 'completed' },
      ],
    },
    3,
  );
  assert.equal(status.first_reviewable, true);
  assert.equal(status.first_reviewable_source, 'api-job-item-status');
  assert.equal(status.reviewable_count, 2);
  assert.equal(status.recognition_complete_count, 2);
  assert.equal(status.all_recognition_complete, false);
  assert.equal(status.all_recognition_complete_source, null);
  assert.deepEqual(status.status_counts, { awaiting_review: 1, processing: 1, completed: 1 });
  assert.doesNotMatch(JSON.stringify(status), /private/);
}

function testBatchRecognitionStatusIgnoresStaleCompletedBeforeConfigLock() {
  const status = summarizeBatchRecognitionStatus(
    {
      id: 'job-stale',
      config: { config_locked_at: '2026-05-06T04:00:00.000Z' },
      items: [
        {
          sort_order: 1,
          status: 'completed',
          recognition_finished_at: '2026-05-06T03:59:58.000Z',
          recognition_duration_ms: 1200,
        },
        {
          sort_order: 2,
          status: 'awaiting_review',
          finished_at: '2026-05-06T03:59:59.000Z',
          recognition_duration_ms: 900,
        },
      ],
    },
    2,
    { runStartedAtMs: Date.parse('2026-05-06T04:00:00.000Z') },
  );
  assert.equal(status.config_locked_at, '2026-05-06T04:00:00.000Z');
  assert.equal(status.first_reviewable, false);
  assert.equal(status.first_reviewable_source, null);
  assert.equal(status.reviewable_count, 0);
  assert.equal(status.recognition_complete_count, 0);
  assert.equal(status.all_recognition_complete, false);
  assert.equal(status.stale_item_count, 2);
  assert.deepEqual(status.status_counts, { completed: 1, awaiting_review: 1 });
}

function testBatchRecognitionStatusAcceptsFreshCompletedAfterConfigLock() {
  const runStartedAtMs = Date.parse('2026-05-06T04:00:00.000Z');
  const job = {
    id: 'job-fresh',
    config: { config_locked_at: '2026-05-06T04:00:01.000Z' },
    items: [
      {
        sort_order: 1,
        status: 'completed',
        started_at: '2026-05-06T04:00:01.200Z',
        finished_at: '2026-05-06T04:00:05.000Z',
        recognition_duration_ms: 3800,
      },
      {
        sort_order: 2,
        status: 'awaiting_review',
        performance_timestamps: {
          started_at: '2026-05-06T04:00:02.000Z',
          finished_at: '2026-05-06T04:00:08.000Z',
        },
        recognition_duration_ms: 6000,
      },
    ],
  };
  const status = summarizeBatchRecognitionStatus(job, 2, { runStartedAtMs });
  assert.equal(status.first_reviewable, true);
  assert.equal(status.first_reviewable_at, '2026-05-06T04:00:05.000Z');
  assert.equal(status.reviewable_count, 2);
  assert.equal(status.recognition_complete_count, 2);
  assert.equal(status.all_recognition_complete, true);
  assert.equal(status.all_recognition_complete_at, '2026-05-06T04:00:08.000Z');
  assert.equal(status.all_recognition_complete_min_duration_ms, 6000);
  assert.equal(status.stale_item_count, 0);
  assert.equal(status.freshness_counts['item-timestamp-after-config-lock'], 2);

  const evidence = buildBatchApiEvidence(job, [{ label: 'input-01.docx' }, { label: 'input-02.pdf' }]);
  assert.equal(evidence.config_locked_at, '2026-05-06T04:00:01.000Z');
  assert.equal(evidence.files[0].started_at, '2026-05-06T04:00:01.200Z');
  assert.equal(evidence.files[0].finished_at, '2026-05-06T04:00:05.000Z');
  assert.equal(evidence.files[1].started_at, '2026-05-06T04:00:02.000Z');
  assert.equal(evidence.files[1].finished_at, '2026-05-06T04:00:08.000Z');
  assert.equal(evidence.files[1].current_batch_state, 'current-or-compatible');
}

function testBatchRecognitionStatusKeepsNoTimestampCompatibilityPath() {
  const status = summarizeBatchRecognitionStatus(
    {
      id: 'job-compatible',
      config: { config_locked_at: '2026-05-06T04:00:00.000Z' },
      items: [
        { sort_order: 1, status: 'completed' },
        { sort_order: 2, status: 'awaiting_review' },
      ],
    },
    2,
  );
  assert.equal(status.first_reviewable, true);
  assert.equal(status.reviewable_count, 2);
  assert.equal(status.recognition_complete_count, 2);
  assert.equal(status.all_recognition_complete, true);
  assert.equal(status.all_recognition_complete_at, null);
  assert.equal(status.stale_item_count, 0);
  assert.equal(status.freshness_counts['no-item-timestamp-compatible'], 2);
}

function testAllRecognitionCompleteTimingCanBeRaisedByLaterEvidence() {
  const runStartedAtMs = Date.parse('2026-05-06T04:24:05.000Z');
  const early = resolveAllRecognitionCompleteTiming(
    {
      all_recognition_complete: true,
      all_recognition_complete_min_duration_ms: 10_418,
    },
    runStartedAtMs,
    10_418,
  );
  assert.equal(early.ms, 10_418);
  assert.equal(early.method, 'recognition-duration-floor');

  const later = resolveAllRecognitionCompleteTiming(
    {
      all_recognition_complete: true,
      all_recognition_complete_at: '2026-05-06T04:24:40.207Z',
      all_recognition_complete_min_duration_ms: 35_185,
    },
    runStartedAtMs,
    16_779,
  );
  assert.equal(later.ms, 35_207);
  assert.equal(later.method, 'item-timestamp');
  assert.ok(later.ms > early.ms);
}

async function testBatchReviewDomButtonFallback() {
  const clicked = [];
  const buttons = [
    {
      textContent: '确认匿名化',
      disabled: true,
      style: { visibility: 'visible', display: 'block', pointerEvents: 'auto' },
      rect: { width: 120, height: 32 },
      getAttribute: () => null,
      scrollIntoView: () => clicked.push('disabled-scroll'),
      click: () => clicked.push('disabled-click'),
    },
    {
      textContent: '  确认匿名化  ',
      disabled: false,
      style: { visibility: 'visible', display: 'block', pointerEvents: 'auto' },
      rect: { width: 120, height: 32 },
      getAttribute: () => null,
      scrollIntoView: () => clicked.push('enabled-scroll'),
      click: () => clicked.push('enabled-click'),
    },
  ];
  const page = {
    evaluate: (callback, labels) => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = { querySelectorAll: (selector) => (selector === 'button' ? buttons : []) };
      globalThis.window = { getComputedStyle: (button) => button.style };
      try {
        return callback(labels);
      } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
      }
    },
  };

  for (const button of buttons) {
    button.getBoundingClientRect = () => button.rect;
  }

  assert.equal(await clickVisibleButtonByText(page, ['确认匿名化']), true);
  assert.deepEqual(clicked, ['enabled-scroll', 'enabled-click']);
}

testFailedRequestClassification();
testSummaryPassedRequiresOnlyRealFailures();
testSummaryEvidenceStillCollectedOnFailure();
testFailedRequestDiagnosticsKeepsActionableDetails();
testAuthCookieUsesFrontendOriginOnly();
testSingleDetectionTotalParsing();
testBatchApiEvidenceFlagsEmptyScannedPdfAndImageWithoutNames();
 testBatchApiEvidencePassesNonEmptyVisionResults();
 testBatchApiEvidenceRequiresCurrentJobAndMatchingItems();
testBatchExportVisualEvidenceSummarizesPdfAndImageCoverage();
testBatchExportVisualEvidenceFlagsMissingVisualBoxes();
testBoxGeometryEvidenceSummarizesPagesSourcesAndIssues();
testBoxGeometryEvidenceFlagsSemanticAliasAndNonFixedHasImageTypes();
testEvidenceSummaryAggregatesTypeIntegrityIssues();
testBoxGeometryEvidenceAllowsLocalFallbackNonFixedHasImageTypes();
testBoxGeometryEvidenceFlagsOversizedAndOutOfBoundsBoxes();
testPerformanceContextExplainsWarmCachePdf();
testBatchApiEvidenceKeepsPipelineStageDurations();
 testPerformanceContextExplainsColdCacheAndNoParallelProof();
testPerformanceContextDoesNotTreatMixedCacheAsColdStart();
testBatchPhaseDiagnosticsSeparatesPartialReviewAndBackgroundWait();
testBatchPhaseDiagnosticsDoesNotCoerceIncompleteAllRecognitionToZero();
testStep3WaitDomEvidenceIsCompactedAndSanitized();
testStep3JobsRequestEvidenceIsCompactedAndSanitized();
testBatchPhaseDiagnosticsIncludesStep3DomEvidence();
testBatchJobIdResolutionPrefersCurrentRunOverSessionFallback();
testBatchRecognitionStatusSummaryUsesCountsOnly();
testBatchRecognitionStatusIgnoresStaleCompletedBeforeConfigLock();
testBatchRecognitionStatusAcceptsFreshCompletedAfterConfigLock();
testBatchRecognitionStatusKeepsNoTimestampCompatibilityPath();
testAllRecognitionCompleteTimingCanBeRaisedByLaterEvidence();
await testBatchReviewDomButtonFallback();
await testHelp();
await testDryRunWritesPlanWithoutBrowser();
await testRealRunRefusesBusyGpuBeforeFrontend();
await testAllowGpuBusyContinuesPastPreflight();
console.log('eval-live-ui-ceshi tests passed');
