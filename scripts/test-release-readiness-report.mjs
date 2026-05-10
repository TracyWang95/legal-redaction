#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-readiness-'));

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

function liveUiSummary(generatedAt, boxCount) {
  return {
    generated_at: generatedAt,
    passed: true,
    findings: [],
    single: {
      elapsed_ms: 10,
      recognition_elapsed_ms: 8,
      box_count: boxCount,
      entity_count: 1,
    },
    batch: {
      files: ['a.docx', 'b.docx', 'c.pdf', 'd.png'],
      review_actions: ['confirm', 'go-export'],
      api_timing: {
        job_id: 'job-current',
        first_reviewable_ms: 3000,
        first_reviewable_timing_method: 'api-job-item-status',
        all_recognition_complete_ms: 6500,
        all_recognition_complete_timing_method: 'api-job-item-status',
        poll_count: 5,
        poll_errors: 0,
        last_status: {
          all_recognition_complete: true,
          config_locked_at: '2026-02-01T00:00:00.000Z',
          freshness_counts: { 'item-timestamp-after-config-lock': 4 },
        },
      },
    },
    performance_context: {
      scope: 'Live UI timings are browser/API workflow evidence against already-running services.',
      batch: {
        recognition_wait_ms: 4000,
        phase_diagnostics: {
          recognition_wait_ms: 4000,
          first_reviewable_ui_ms: 4000,
          first_reviewable_api_ms: 3000,
          first_reviewable_source: 'api-job-item-status',
          all_recognition_complete_api_ms: 6500,
          all_recognition_complete_observed: true,
          all_recognition_complete_source: 'api-job-item-status',
          background_continued_after_review_open: true,
          review_waiting_for_background_ms: 1200,
          review_blocked_wait_ms: 800,
          api_status: {
            all_recognition_complete: true,
            config_locked_at: '2026-02-01T00:00:00.000Z',
            freshness_counts: { 'item-timestamp-after-config-lock': 4 },
          },
          api_poll_errors: 0,
        },
        pdf_recognition: [
          {
            label: 'input-03.pdf',
            recognition_duration_ms: 4000,
            cache: { state: 'warm_cache_hit_observed' },
            page_parallelism: {
              page_concurrency: 2,
              page_concurrency_effective: 2,
              configured_page_concurrency: 2,
              page_concurrency_configured: 2,
              page_duration_sum_ms: 6200,
              recognition_wall_clock_ms: 4000,
              page_sum_to_wall_clock_ratio: 1.55,
              observed_parallelism: 'parallel_overlap_observed',
            },
            cold_cache_supported: false,
            cold_start_supported: false,
          },
        ],
      },
      failed_requests: { total: 0, ignored: 0, actionable: 0 },
    },
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  const playwrightRoot = path.join(tmpDir, 'playwright');
  await writeJson(
    path.join(playwrightRoot, 'live-ui-z-old', 'summary.json'),
    liveUiSummary('2026-01-01T00:00:00.000Z', 1),
  );
  await writeJson(
    path.join(playwrightRoot, 'live-ui-a-new', 'summary.json'),
    liveUiSummary('2026-02-01T00:00:00.000Z', 3),
  );

  const node24ProofPath = path.join(playwrightRoot, 'node24-current', 'node24-proof.json');
  await writeJson(node24ProofPath, {
    node: { version: '24.0.0' },
    project_contract: { engine: '>=20 <25' },
    checks: [
      { command: 'node --version', status: 0 },
      { command: 'npm --version', status: 0 },
      { command: 'node scripts/test-dev-attach.mjs', status: 0 },
      { command: 'node scripts/test-docs-contract.mjs', status: 0 },
    ],
  });

  const modelManifestPath = path.join(playwrightRoot, 'model-provenance-round4', 'model-provenance-manifest.json');
  await writeJson(modelManifestPath, {
    privacy: { absolutePathsIncluded: false },
    summary: { foundCount: 2, requiredMissing: [] },
    models: [
      {
        basename: 'HaS_Text_0209_0.6B_Q4_K_M.gguf',
        upstream: { revision: '39a643aa8f19ad6c324fe96dacb1fc292fbe6095' },
      },
      {
        basename: 'sensitive_seg_best.pt',
        upstream: { revision: '3ed1114d783274208695e422bf22c017d6424669' },
      },
    ],
  });

  const evidenceManifestPath = path.join(playwrightRoot, 'round4-evidence-manifest.json');
  await writeJson(evidenceManifestPath, {
    privacy: { private_paths_redacted: true },
    artifacts: [
      {
        label: 'live-ui-ceshi-private',
        summary: {
          passed: true,
          single: { box_count: 3 },
          batch: { file_count: 4 },
        },
        files: [{ path: 'summary.json' }],
      },
      {
        label: 'model-provenance-round4',
        files: [{ path: 'model-provenance-manifest.json' }],
      },
      {
        label: 'node24-current',
        files: [{ path: 'node24-proof.json' }],
      },
      {
        label: 'release-readiness-round4',
        files: [{ path: 'release-readiness-report.json' }],
      },
    ],
  });

  const uiBrowserSummaryPath = path.join(playwrightRoot, 'ui-browser-contract-current', 'summary.json');
  await writeJson(uiBrowserSummaryPath, {
    generated_at: '2026-02-01T00:00:00.000Z',
    base_url: 'http://127.0.0.1:3000',
    viewport: { width: 1920, height: 1080 },
    mock_api: true,
    routes: [
      { name: 'start', path: '/', elapsed_ms: 11 },
      { name: 'single', path: '/single', elapsed_ms: 12 },
      { name: 'batch', path: '/batch', elapsed_ms: 13 },
      { name: 'jobs', path: '/jobs', elapsed_ms: 14 },
      { name: 'history', path: '/history', elapsed_ms: 15 },
      { name: 'settings', path: '/settings', elapsed_ms: 16 },
    ],
    failures: [],
    console: [],
    page_errors: [],
    failed_requests: [],
    blocked_requests: [],
    passed: true,
  });

  const ciWorkflowPath = path.join(tmpDir, 'ci.yml');
  await writeFile(
    ciWorkflowPath,
    `name: CI

on:
  pull_request:
  push:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: pip install -r backend/requirements-ci.txt
      - run: npm run quality:fast
      - run: npm run quality:frontend
`,
    'utf8',
  );

  const frontendDockerfilePath = path.join(tmpDir, 'frontend.Dockerfile');
  await writeFile(
    frontendDockerfilePath,
    `FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
`,
    'utf8',
  );

  const dockerComposePath = path.join(tmpDir, 'docker-compose.yml');
  await writeFile(
    dockerComposePath,
    `services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "\${BACKEND_PORT:-8000}:8000"
    environment:
      - CORS_ORIGINS=["http://localhost:\${FRONTEND_PORT:-3000}"]

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "\${FRONTEND_PORT:-3000}:8080"
    depends_on:
      backend:
        condition: service_healthy

  ocr:
    build:
      context: ./backend
      dockerfile: Dockerfile.ocr
    ports:
      - "8082:8082"
    profiles:
      - gpu

  ner:
    image: ghcr.io/ggerganov/llama.cpp:server
    ports:
      - "8080:8080"
    profiles:
      - gpu

  vision:
    build:
      context: ./backend
      dockerfile: Dockerfile.vision
    ports:
      - "8081:8081"
    profiles:
      - gpu
`,
    'utf8',
  );

  const outPath = path.join(tmpDir, 'release-readiness-test.json');
  const result = await spawnText(process.execPath, ['scripts/release-readiness-report.mjs', '--out', outPath], {
    cwd: rootDir,
    env: {
      ...process.env,
      RELEASE_PLAYWRIGHT_ROOT: playwrightRoot,
      RELEASE_NODE24_PROOF: node24ProofPath,
      RELEASE_MODEL_MANIFEST: modelManifestPath,
      RELEASE_EVIDENCE_MANIFEST: evidenceManifestPath,
      RELEASE_UI_BROWSER_SUMMARY: uiBrowserSummaryPath,
      RELEASE_CI_WORKFLOW: ciWorkflowPath,
      RELEASE_DOCKER_COMPOSE: dockerComposePath,
      RELEASE_FRONTEND_DOCKERFILE: frontendDockerfilePath,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /release readiness report:/);
  assert.match(result.stdout, /status=pass/);

  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.fail, 0);

  const reportText = JSON.stringify(report);
  const forbiddenReportTerms = [
    'ceshi',
    String.fromCharCode(0x6dc7, 0x2033, 0x57b1),
    String.fromCharCode(0x9365, 0x5267, 0x5896, 0x5f),
    String.fromCharCode(0x93c1, 0x7248, 0x5d41, 0x93bb, 0x612a, 0x7df5),
    String.fromCharCode(0x95b2, 0x56ea, 0x5598, 0x6924, 0x572d, 0x6d30),
    String.fromCharCode(0x6e, 0x65, 0x74, 0x64, 0x69, 0x73, 0x6b),
  ];
  for (const term of forbiddenReportTerms) assert.doesNotMatch(reportText, new RegExp(term, 'i'));
  assert.doesNotMatch(reportText, /Users\\[^"'\\/\s]+/);

  const checks = new Map(report.checks.map((check) => [check.id, check]));
  for (const id of [
    'node-contract',
    'node24-proof',
    'ci-workflow-contract',
    'quality-fast-contract',
    'docker-compose-startup-contract',
    'ui-browser-contract',
    'live-ui-private-corpus',
    'model-provenance',
    'evidence-manifest',
    'has-image-21-contract',
    'vision-no-regex',
    'docs-surface',
  ]) {
    assert.equal(checks.get(id)?.status, 'pass', `${id} should pass`);
  }

  assert.equal(checks.get('live-ui-private-corpus')?.evidence?.selected_summary, 'live-ui-a-new');
  assert.equal(checks.get('live-ui-private-corpus')?.evidence?.single?.box_count, 3);
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.performance_context?.batch?.pdf_recognition?.[0]?.cache?.state,
    'warm_cache_hit_observed',
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.performance_context?.batch?.pdf_recognition?.[0]?.cold_start_supported,
    false,
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_timing_diagnostics?.first_reviewable_api_ms,
    3000,
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_timing_diagnostics?.all_recognition_complete_api_ms,
    6500,
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_timing_diagnostics?.background_continued_after_review_open,
    true,
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.api_timing?.all_recognition_complete_timing_method,
    'api-job-item-status',
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_pdf_performance?.[0]?.page_concurrency,
    2,
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_pdf_performance?.[0]?.page_concurrency_effective,
    2,
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_pdf_performance?.[0]?.page_duration_sum_ms,
    6200,
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_pdf_performance?.[0]?.recognition_wall_clock_ms,
    4000,
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_pdf_performance?.[0]?.observed_parallelism,
    'parallel_overlap_observed',
  );
  assert.equal(
    checks.get('live-ui-private-corpus')?.evidence?.batch_pdf_performance?.[0]?.cache_state,
    'warm_cache_hit_observed',
  );
  assert.equal(checks.get('ci-workflow-contract')?.evidence?.required?.node24, true);
  assert.equal(checks.get('ci-workflow-contract')?.evidence?.required?.backend_requirements_ci, true);
  assert.equal(checks.get('ci-workflow-contract')?.evidence?.required?.public_quality_fast, true);
  assert.equal(checks.get('ci-workflow-contract')?.evidence?.required?.quality_frontend, true);
  assert.equal(checks.get('ci-workflow-contract')?.evidence?.forbidden?.requirements_lock, false);
  assert.equal(checks.get('ci-workflow-contract')?.evidence?.forbidden?.node20, false);
  assert.equal(checks.get('quality-fast-contract')?.evidence?.required?.quality_fast_alias, true);
  assert.equal(checks.get('quality-fast-contract')?.evidence?.required?.readiness_contract, true);
  assert.equal(checks.get('quality-fast-contract')?.evidence?.required?.ui_browser_contract, true);
  assert.equal(checks.get('quality-fast-contract')?.evidence?.required?.has_text_gpu_preflight, true);
  assert.equal(checks.get('quality-fast-contract')?.evidence?.forbidden?.default_private_real_files, false);
  assert.equal(checks.get('quality-fast-contract')?.evidence?.forbidden?.starts_model_services, false);
  assert.equal(
    checks.get('docker-compose-startup-contract')?.evidence?.required?.frontend_dockerfile_node24,
    true,
  );
  assert.equal(
    checks.get('docker-compose-startup-contract')?.evidence?.required?.compose_frontend_entry_3000,
    true,
  );
  assert.equal(
    checks.get('docker-compose-startup-contract')?.evidence?.required?.default_services_unprofiled,
    true,
  );
  assert.equal(
    checks.get('docker-compose-startup-contract')?.evidence?.required?.gpu_services_profiled,
    true,
  );
  assert.equal(checks.get('docker-compose-startup-contract')?.evidence?.forbidden?.stale_vite_5173, false);
  assert.equal(
    checks.get('docker-compose-startup-contract')?.evidence?.forbidden?.stale_playground_label,
    false,
  );
  assert.equal(checks.get('ui-browser-contract')?.evidence?.base_url, 'http://127.0.0.1:3000');
  assert.equal(checks.get('ui-browser-contract')?.evidence?.route_count, 6);
  assert.equal(checks.get('ui-browser-contract')?.evidence?.blocked_sensitive_api, 0);
  assert.equal(checks.get('model-provenance')?.evidence?.upstream_revisions?.models_with_revision, 2);
  assert.equal(checks.get('model-provenance')?.evidence?.upstream_revisions?.model_count, 2);
  assert.equal(checks.get('evidence-manifest')?.evidence?.required_artifacts?.live_ui, true);
  assert.equal(checks.get('evidence-manifest')?.evidence?.required_artifacts?.model_provenance, true);
  assert.equal(checks.get('evidence-manifest')?.evidence?.required_artifacts?.node24, true);
  assert.equal(checks.get('evidence-manifest')?.evidence?.required_artifacts?.release_readiness, true);
  assert.equal(checks.get('has-image-21-contract')?.evidence?.class_count, 21);
  assert.equal(checks.get('vision-no-regex')?.evidence?.checked_files > 0, true);
  assert.ok(report.remaining_release_gaps.some((gap) => gap.includes('clean public checkout')));
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('release readiness report tests passed');
