#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OUT = path.join('output', 'release-readiness-report.json');
const DEFAULT_PLAYWRIGHT_ROOT = path.join('output', 'playwright');
const HAS_IMAGE_SLUGS = [
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
];

function usage() {
  console.log(`Usage:
  node scripts/release-readiness-report.mjs [--out path]

Creates a local prompt-to-artifact release readiness report from existing
workspace evidence. It does not start services, read private input files, or run
model inference.
`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  let out = DEFAULT_OUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      out = argv[++index] || out;
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { out };
}

async function readText(relativePath) {
  return readFile(path.resolve(relativePath), 'utf8');
}

async function readJson(relativePath) {
  if (!existsSync(relativePath)) return null;
  return JSON.parse((await readText(relativePath)).replace(/^\uFEFF/, ''));
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeLabel(value, fallback = 'artifact') {
  const text = String(value || fallback);
  if (/ceshi|[A-Za-z]:\\|\/mnt\/|\/Users\/|\/home\//i.test(text)) {
    return `${fallback}-${shortHash(text)}`;
  }
  return text;
}

function playwrightRoot() {
  return process.env.RELEASE_PLAYWRIGHT_ROOT || DEFAULT_PLAYWRIGHT_ROOT;
}

function liveUiSummaryDefaultPath() {
  return path.join(playwrightRoot(), 'live-ui-private-current', 'summary.json');
}

function modelManifestPath() {
  return (
    process.env.RELEASE_MODEL_MANIFEST ||
    path.join(playwrightRoot(), 'model-provenance-round4', 'model-provenance-manifest.json')
  );
}

function node24ProofPath() {
  return process.env.RELEASE_NODE24_PROOF || path.join(playwrightRoot(), 'node24-current', 'node24-proof.json');
}

function evidenceManifestPath() {
  return process.env.RELEASE_EVIDENCE_MANIFEST || path.join(playwrightRoot(), 'round4-evidence-manifest.json');
}

function uiBrowserSummaryDefaultPath() {
  return path.join(playwrightRoot(), 'ui-browser-contract-current', 'summary.json');
}

function ciWorkflowPath() {
  return process.env.RELEASE_CI_WORKFLOW || path.join('.github', 'workflows', 'ci.yml');
}

function dockerComposePath() {
  return process.env.RELEASE_DOCKER_COMPOSE || 'docker-compose.yml';
}

function frontendDockerfilePath() {
  return process.env.RELEASE_FRONTEND_DOCKERFILE || path.join('frontend', 'Dockerfile');
}

function isPassingLiveUiSummary(summary) {
  return (
    summary?.passed === true &&
    Array.isArray(summary.findings) &&
    summary.findings.length === 0 &&
    summary?.single?.box_count > 0 &&
    summary?.batch?.files?.length >= 4 &&
    summary?.batch?.review_actions?.includes('go-export')
  );
}

function isPassingUiBrowserSummary(summary) {
  return (
    summary?.passed === true &&
    Array.isArray(summary.routes) &&
    summary.routes.length >= 6 &&
    Array.isArray(summary.failures) &&
    summary.failures.length === 0 &&
    Array.isArray(summary.blocked_requests) &&
    summary.blocked_requests.length === 0
  );
}

function liveUiBatchPdfPerformance(summary) {
  const pdfRecognition = summary?.performance_context?.batch?.pdf_recognition;
  if (!Array.isArray(pdfRecognition)) return [];
  return pdfRecognition.map((item, index) => {
    const parallelism = item?.page_parallelism ?? {};
    return {
      label: sanitizeLabel(item?.label, `pdf-${index + 1}`),
      file_type: item?.file_type ?? null,
      recognition_duration_ms: item?.recognition_duration_ms ?? null,
      cache_state: item?.cache?.state ?? null,
      page_concurrency: parallelism.page_concurrency ?? parallelism.page_concurrency_effective ?? null,
      page_concurrency_effective: parallelism.page_concurrency_effective ?? null,
      configured_page_concurrency:
        parallelism.configured_page_concurrency ?? parallelism.page_concurrency_configured ?? null,
      page_concurrency_configured: parallelism.page_concurrency_configured ?? null,
      page_duration_sum_ms: parallelism.page_duration_sum_ms ?? null,
      recognition_wall_clock_ms: parallelism.recognition_wall_clock_ms ?? null,
      page_sum_to_wall_clock_ratio: parallelism.page_sum_to_wall_clock_ratio ?? null,
      observed_parallelism: parallelism.observed_parallelism ?? null,
      cold_cache_supported: item?.cold_cache_supported ?? null,
      cold_start_supported: item?.cold_start_supported ?? null,
    };
  });
}

function liveUiBatchTimingDiagnostics(summary) {
  const diagnostics =
    summary?.performance_context?.batch?.phase_diagnostics ??
    summary?.batch?.phase_diagnostics ??
    null;
  if (!diagnostics || typeof diagnostics !== 'object') return null;
  return {
    recognition_wait_ms: diagnostics.recognition_wait_ms ?? null,
    first_reviewable_ui_ms: diagnostics.first_reviewable_ui_ms ?? null,
    first_reviewable_api_ms: diagnostics.first_reviewable_api_ms ?? null,
    first_reviewable_source: diagnostics.first_reviewable_source ?? null,
    all_recognition_complete_api_ms: diagnostics.all_recognition_complete_api_ms ?? null,
    all_recognition_complete_observed: diagnostics.all_recognition_complete_observed ?? null,
    all_recognition_complete_source: diagnostics.all_recognition_complete_source ?? null,
    background_continued_after_review_open: diagnostics.background_continued_after_review_open ?? null,
    review_waiting_for_background_ms: diagnostics.review_waiting_for_background_ms ?? null,
    review_blocked_wait_ms: diagnostics.review_blocked_wait_ms ?? null,
    api_status: diagnostics.api_status ?? null,
    api_poll_errors: diagnostics.api_poll_errors ?? null,
  };
}

function liveUiApiTiming(summary) {
  const timing = summary?.batch?.api_timing;
  if (!timing || typeof timing !== 'object') return null;
  return {
    job_id_present: Boolean(timing.job_id),
    first_reviewable_ms: timing.first_reviewable_ms ?? null,
    first_reviewable_timing_method: timing.first_reviewable_timing_method ?? null,
    all_recognition_complete_ms: timing.all_recognition_complete_ms ?? null,
    all_recognition_complete_timing_method: timing.all_recognition_complete_timing_method ?? null,
    poll_count: timing.poll_count ?? null,
    poll_errors: timing.poll_errors ?? null,
    last_status: timing.last_status ?? null,
  };
}

function pass(id, requirement, evidence, details = {}) {
  return { id, requirement, status: 'pass', evidence, ...details };
}

function fail(id, requirement, evidence, details = {}) {
  return { id, requirement, status: 'fail', evidence, ...details };
}

function warn(id, requirement, evidence, details = {}) {
  return { id, requirement, status: 'warn', evidence, ...details };
}

async function checkNodeContract() {
  const packageJson = await readJson('package.json');
  const nvmrc = (await readText('.nvmrc')).trim();
  const nodeVersion = (await readText('.node-version')).trim();
  const ok = packageJson?.engines?.node === '>=20 <25' && nvmrc === '24' && nodeVersion === '24';
  return ok
    ? pass('node-contract', 'Recommended Node 24 and supported engine are declared.', {
        engine: packageJson.engines.node,
        nvmrc,
        node_version_file: nodeVersion,
      })
    : fail('node-contract', 'Recommended Node 24 and supported engine are declared.', {
        engine: packageJson?.engines?.node ?? null,
        nvmrc,
        node_version_file: nodeVersion,
      });
}

async function checkNode24Proof() {
  const proofPath = node24ProofPath();
  const proof = await readJson(proofPath);
  const checks = proof?.checks ?? [];
  const allChecksPassed = checks.length >= 4 && checks.every((check) => check.status === 0);
  const ok =
    proof?.node?.version?.startsWith('24.') &&
    proof?.project_contract?.engine === '>=20 <25' &&
    allChecksPassed;
  return ok
    ? pass('node24-proof', 'Node 24 runtime can execute source-level gates.', {
        path: proofPath,
        version: proof.node.version,
        checks: checks.map((check) => check.command),
        limits: proof.limits ?? [],
      })
    : fail('node24-proof', 'Node 24 runtime can execute source-level gates.', {
        path: proofPath,
        exists: Boolean(proof),
      });
}

async function checkCiWorkflowContract() {
  const workflowPath = ciWorkflowPath();
  const source = existsSync(workflowPath) ? await readText(workflowPath) : '';
  const normalized = source.replace(/\r\n/g, '\n');
  const required = {
    node24: /\bnode-version:\s*['"]?24['"]?\b/.test(normalized),
    backend_requirements_ci: /\bbackend\/requirements-ci\.txt\b/.test(normalized),
    public_quality_fast: /\bnpm\s+run\s+quality:fast\b/.test(normalized),
    quality_frontend: /\bnpm\s+run\s+quality:frontend\b/.test(normalized),
  };
  const forbidden = {
    requirements_lock: /\brequirements\.lock\b/.test(normalized),
    node20: /\bnode-version:\s*['"]?20['"]?\b/.test(normalized),
  };
  const ok =
    Boolean(source) &&
    Object.values(required).every(Boolean) &&
    Object.values(forbidden).every((matched) => matched === false);
  const evidence = {
    path: workflowPath,
    exists: Boolean(source),
    required,
    forbidden,
  };
  return ok
    ? pass(
        'ci-workflow-contract',
        'CI workflow uses Node 24, requirements-ci, and public quality gates without stale release locks.',
        evidence,
      )
    : fail(
        'ci-workflow-contract',
        'CI workflow uses Node 24, requirements-ci, and public quality gates without stale release locks.',
        evidence,
      );
}

async function checkQualityFastContract() {
  const packageJson = await readJson('package.json');
  const qualitySource = existsSync(path.join('scripts', 'quality-local.mjs'))
    ? await readText(path.join('scripts', 'quality-local.mjs'))
    : '';
  const testScripts = String(packageJson?.scripts?.['test:scripts'] || '');
  const required = {
    quality_fast_alias: packageJson?.scripts?.['quality:fast'] === 'node scripts/quality-local.mjs --fast',
    readiness_contract: qualitySource.includes('scripts/test-release-readiness-report.mjs'),
    ui_browser_contract: qualitySource.includes('scripts/test-ui-browser-contract.mjs'),
    has_text_gpu_preflight: qualitySource.includes('scripts/test-has-text-gpu-preflight.mjs'),
    backend_vision_contracts:
      qualitySource.includes('tests/test_has_image_categories_contract.py') &&
      qualitySource.includes('tests/test_vision_no_regex_contract.py'),
    test_scripts_include_readiness: testScripts.includes('scripts/test-release-readiness-report.mjs'),
  };
  const forbidden = {
    default_private_real_files: /npm\s+run\s+eval:ceshi\s+--/.test(qualitySource),
    starts_model_services: /docker compose --profile gpu up -d|dev:models/.test(qualitySource),
  };
  const ok =
    Object.values(required).every(Boolean) &&
    Object.values(forbidden).every((matched) => matched === false);
  const evidence = { required, forbidden };
  return ok
    ? pass(
        'quality-fast-contract',
        'quality:fast is a public/temp-fixture gate that includes readiness, UI contract, GPU preflight, and backend vision contracts without starting private/model work.',
        evidence,
      )
    : fail(
        'quality-fast-contract',
        'quality:fast is a public/temp-fixture gate that includes readiness, UI contract, GPU preflight, and backend vision contracts without starting private/model work.',
        evidence,
      );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function composeServiceBlock(source, serviceName) {
  const match = source.match(
    new RegExp(
      `^  ${escapeRegExp(serviceName)}:\\s*\\n([\\s\\S]*?)(?=\\n  [A-Za-z0-9_-]+:\\s*\\n|\\n[A-Za-z0-9_-]+:\\s*\\n|(?![\\s\\S]))`,
      'm',
    ),
  );
  return match?.[1] ?? '';
}

function hasGpuProfile(block) {
  return /^\s{4}profiles:\s*\n(?:^\s{6}-\s+gpu\s*$)/m.test(block);
}

async function checkDockerComposeStartupContract() {
  const composePath = dockerComposePath();
  const dockerfilePath = frontendDockerfilePath();
  const compose = existsSync(composePath) ? await readText(composePath) : '';
  const dockerfile = existsSync(dockerfilePath) ? await readText(dockerfilePath) : '';
  const startupText = [compose, dockerfile].join('\n');
  const requiredServices = ['backend', 'frontend', 'ocr', 'ner', 'vision'];
  const defaultServices = ['backend', 'frontend'];
  const gpuServices = ['ocr', 'ner', 'vision'];
  const serviceBlocks = Object.fromEntries(
    requiredServices.map((service) => [service, composeServiceBlock(compose, service)]),
  );
  const required = {
    frontend_dockerfile_node24: /^FROM\s+node:24(?:[.\w-]*)?\b/im.test(dockerfile),
    compose_frontend_entry_3000:
      /"\$\{FRONTEND_PORT:-3000\}:8080"|'\$\{FRONTEND_PORT:-3000\}:8080'|\$\{FRONTEND_PORT:-3000\}:8080|["']?3000:8080["']?/m.test(
        compose,
      ),
    default_services_unprofiled: defaultServices.every(
      (service) => Boolean(serviceBlocks[service]) && !/^\s{4}profiles:\s*$/m.test(serviceBlocks[service]),
    ),
    gpu_services_profiled: gpuServices.every((service) => hasGpuProfile(serviceBlocks[service])),
  };
  const forbidden = {
    stale_vite_5173: /\b5173\b/.test(startupText),
    stale_playground_label: /\bPlayground\b/.test(startupText),
  };
  const ok =
    Boolean(compose) &&
    Boolean(dockerfile) &&
    Object.values(required).every(Boolean) &&
    Object.values(forbidden).every((matched) => matched === false);
  const evidence = {
    compose_path: composePath,
    frontend_dockerfile_path: dockerfilePath,
    exists: {
      compose: Boolean(compose),
      frontend_dockerfile: Boolean(dockerfile),
    },
    required,
    forbidden,
    default_services: defaultServices,
    gpu_profile_services: gpuServices,
  };
  return ok
    ? pass(
        'docker-compose-startup-contract',
        'Docker/Compose open-source startup uses Node 24, CPU-only default services, frontend port 3000, and no stale labels.',
        evidence,
      )
    : fail(
        'docker-compose-startup-contract',
        'Docker/Compose open-source startup uses Node 24, CPU-only default services, frontend port 3000, and no stale labels.',
        evidence,
      );
}

async function checkLiveUiEvidence() {
  const summaryPath = await findLiveUiSummaryPath();
  const summary = await readJson(summaryPath);
  const singleEvidence = summary?.single
    ? {
        elapsed_ms: summary.single.elapsed_ms,
        recognition_elapsed_ms: summary.single.recognition_elapsed_ms,
        box_count: summary.single.box_count,
        entity_count: summary.single.entity_count,
      }
    : null;
  const ok =
    summary?.passed === true &&
    Array.isArray(summary.findings) &&
    summary.findings.length === 0 &&
    summary?.single?.box_count > 0 &&
    summary?.batch?.files?.length >= 4 &&
    summary?.batch?.review_actions?.includes('go-export');
  return ok
    ? pass('live-ui-private-corpus', 'Real browser flow covers single and batch maintainer files.', {
        selected_summary: sanitizeLabel(path.basename(path.dirname(summaryPath)), 'live-ui-evidence'),
        path_sha256: shortHash(path.resolve(summaryPath)),
        single: singleEvidence,
        performance_context: summary.performance_context ?? null,
        batch_timing_diagnostics: liveUiBatchTimingDiagnostics(summary),
        api_timing: liveUiApiTiming(summary),
        batch_pdf_performance: liveUiBatchPdfPerformance(summary),
        batch_file_count: summary.batch.files.length,
        review_actions: summary.batch.review_actions,
      })
    : fail('live-ui-private-corpus', 'Real browser flow covers single and batch maintainer files.', {
        selected_summary: sanitizeLabel(path.basename(path.dirname(summaryPath)), 'live-ui-evidence'),
        path_sha256: shortHash(path.resolve(summaryPath)),
        exists: Boolean(summary),
        findings: summary?.findings ?? null,
      });
}

async function findUiBrowserSummaryPath() {
  if (process.env.RELEASE_UI_BROWSER_SUMMARY) return process.env.RELEASE_UI_BROWSER_SUMMARY;
  const root = playwrightRoot();
  const candidates = [];
  const defaultSummary = uiBrowserSummaryDefaultPath();
  if (existsSync(defaultSummary)) {
    const summary = await readJson(defaultSummary);
    if (isPassingUiBrowserSummary(summary)) return defaultSummary;
    candidates.push({ path: defaultSummary, summary, mtimeMs: 0 });
  }
  if (existsSync(root)) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('ui-browser-contract')) continue;
      const candidate = path.join(root, entry.name, 'summary.json');
      if (!existsSync(candidate) || candidate === defaultSummary) continue;
      const [summary, info] = await Promise.all([readJson(candidate), stat(candidate)]);
      candidates.push({ path: candidate, summary, mtimeMs: info.mtimeMs });
    }
  }
  const sortedCandidates = candidates
    .filter((candidate) => isPassingUiBrowserSummary(candidate.summary))
    .sort((left, right) => {
      const generatedDelta =
        Date.parse(right.summary?.generated_at || '') - Date.parse(left.summary?.generated_at || '');
      if (Number.isFinite(generatedDelta) && generatedDelta !== 0) return generatedDelta;
      const mtimeDelta = right.mtimeMs - left.mtimeMs;
      if (mtimeDelta !== 0) return mtimeDelta;
      return left.path.localeCompare(right.path);
    });
  return sortedCandidates[0]?.path || candidates[0]?.path || defaultSummary;
}

async function checkUiBrowserContractEvidence() {
  const summaryPath = await findUiBrowserSummaryPath();
  const summary = await readJson(summaryPath);
  const ok = isPassingUiBrowserSummary(summary);
  const evidence = {
    selected_summary: sanitizeLabel(path.basename(path.dirname(summaryPath)), 'ui-browser-contract'),
    path_sha256: shortHash(path.resolve(summaryPath)),
    exists: Boolean(summary),
    passed: summary?.passed ?? null,
    base_url: summary?.base_url ?? null,
    viewport: summary?.viewport ?? null,
    mock_api: summary?.mock_api ?? null,
    route_count: Array.isArray(summary?.routes) ? summary.routes.length : 0,
    routes: Array.isArray(summary?.routes) ? summary.routes.map((route) => route.name || route.path) : [],
    failures: Array.isArray(summary?.failures) ? summary.failures.length : null,
    page_errors: Array.isArray(summary?.page_errors) ? summary.page_errors.length : null,
    failed_requests: Array.isArray(summary?.failed_requests) ? summary.failed_requests.length : null,
    blocked_sensitive_api: Array.isArray(summary?.blocked_requests) ? summary.blocked_requests.length : null,
  };
  return ok
    ? pass(
        'ui-browser-contract',
        'Latest UI browser contract evidence covers the 3000 entry routes without overflow, page errors, failed requests, or blocked inference attempts.',
        evidence,
      )
    : warn(
        'ui-browser-contract',
        'Latest UI browser contract evidence covers the 3000 entry routes without overflow, page errors, failed requests, or blocked inference attempts.',
        evidence,
      );
}

async function findLiveUiSummaryPath() {
  if (process.env.RELEASE_LIVE_UI_SUMMARY) return process.env.RELEASE_LIVE_UI_SUMMARY;
  const root = playwrightRoot();
  const candidates = [];
  const defaultSummary = liveUiSummaryDefaultPath();
  if (existsSync(defaultSummary)) {
    const summary = await readJson(defaultSummary);
    if (isPassingLiveUiSummary(summary)) return defaultSummary;
    candidates.push({ path: defaultSummary, summary, mtimeMs: 0 });
  }
  if (existsSync(root)) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('live-ui-')) continue;
      const candidate = path.join(root, entry.name, 'summary.json');
      if (!existsSync(candidate) || candidate === defaultSummary) continue;
      const [summary, info] = await Promise.all([readJson(candidate), stat(candidate)]);
      candidates.push({ path: candidate, summary, mtimeMs: info.mtimeMs });
    }
  }
  const sortedCandidates = candidates
    .filter((candidate) => isPassingLiveUiSummary(candidate.summary))
    .sort((left, right) => {
      const generatedDelta =
        Date.parse(right.summary?.generated_at || '') - Date.parse(left.summary?.generated_at || '');
      if (Number.isFinite(generatedDelta) && generatedDelta !== 0) return generatedDelta;
      const mtimeDelta = right.mtimeMs - left.mtimeMs;
      if (mtimeDelta !== 0) return mtimeDelta;
      return left.path.localeCompare(right.path);
    });
  return sortedCandidates[0]?.path || candidates[0]?.path || defaultSummary;
}

async function checkModelManifest() {
  const manifestPath = modelManifestPath();
  const manifest = await readJson(manifestPath);
  const models = manifest?.models ?? [];
  const modelsWithRevision = models.filter((model) => Boolean(model?.upstream?.revision)).length;
  const allModelsHaveRevision =
    Array.isArray(models) && models.length > 0 && modelsWithRevision === models.length;
  const ok =
    manifest?.privacy?.absolutePathsIncluded === false &&
    manifest?.summary?.foundCount >= 2 &&
    Array.isArray(manifest?.summary?.requiredMissing) &&
    manifest.summary.requiredMissing.length === 0 &&
    allModelsHaveRevision;
  return ok
    ? pass('model-provenance', 'Required model files have local checksum provenance.', {
        path: manifestPath,
        summary: manifest.summary,
        upstream_revisions: {
          models_with_revision: modelsWithRevision,
          model_count: models.length,
        },
      })
    : fail('model-provenance', 'Required model files have local checksum provenance.', {
        path: manifestPath,
        exists: Boolean(manifest),
        upstream_revisions: {
          models_with_revision: modelsWithRevision,
          model_count: models.length,
        },
      });
}

async function checkEvidenceManifest() {
  const manifestPath = evidenceManifestPath();
  const manifest = await readJson(manifestPath);
  const artifacts = manifest?.artifacts ?? [];
  const labels = artifacts.map((artifact, index) => sanitizeLabel(artifact.label, `artifact-${index + 1}`));
  const includesLiveUi = artifacts.some(
    (artifact) =>
      artifact?.summary?.passed === true &&
      artifact?.summary?.single?.box_count > 0 &&
      artifact?.summary?.batch?.file_count >= 4,
  );
  const includesModelProvenance = artifacts.some(
    (artifact) =>
      String(artifact?.label || '').includes('model-provenance') ||
      (artifact?.files ?? []).some((file) => file.path === 'model-provenance-manifest.json'),
  );
  const includesNode24 = artifacts.some(
    (artifact) =>
      String(artifact?.label || '').includes('node24') ||
      (artifact?.files ?? []).some((file) => file.path === 'node24-proof.json'),
  );
  const includesReleaseReadiness = artifacts.some(
    (artifact) =>
      String(artifact?.label || '').includes('release-readiness') ||
      (artifact?.files ?? []).some((file) => file.path === 'release-readiness-report.json'),
  );
  const ok =
    manifest?.privacy?.private_paths_redacted === true &&
    includesLiveUi &&
    includesModelProvenance &&
    includesNode24 &&
    includesReleaseReadiness;
  return ok
    ? pass('evidence-manifest', 'Round evidence manifest includes UI, model, and Node 24 artifacts.', {
        path: manifestPath,
        labels,
        required_artifacts: {
          live_ui: includesLiveUi,
          model_provenance: includesModelProvenance,
          node24: includesNode24,
          release_readiness: includesReleaseReadiness,
        },
      })
    : fail('evidence-manifest', 'Round evidence manifest includes UI, model, and Node 24 artifacts.', {
        path: manifestPath,
        exists: Boolean(manifest),
        labels,
        required_artifacts: {
          live_ui: includesLiveUi,
          model_provenance: includesModelProvenance,
          node24: includesNode24,
          release_readiness: includesReleaseReadiness,
        },
      });
}

async function checkHasImageContract() {
  const source = await readText(path.join('backend', 'app', 'core', 'has_image_categories.py'));
  const ids = [...source.matchAll(/HasImageCategory\(\d+,\s*"([^"]+)"/g)].map((match) => match[1]);
  const ok =
    ids.length === HAS_IMAGE_SLUGS.length &&
    ids.every((slug, index) => slug === HAS_IMAGE_SLUGS[index]) &&
    source.includes('DEFAULT_EXCLUDED_HAS_IMAGE_SLUGS') &&
    source.includes('"paper"') &&
    !ids.some((slug) => /signature|handwrit/i.test(slug));
  return ok
    ? pass('has-image-21-contract', 'HaS Image keeps the fixed 21-class model contract.', {
        class_count: ids.length,
        paper_default_excluded: true,
      })
    : fail('has-image-21-contract', 'HaS Image keeps the fixed 21-class model contract.', {
        class_count: ids.length,
        ids,
      });
}

async function listFiles(root) {
  const output = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) output.push(fullPath);
    }
  }
  if (existsSync(root)) await walk(root);
  return output;
}

async function checkNoVisionRegex() {
  const files = [
    ...(await listFiles(path.join('backend', 'app', 'services', 'vision'))),
    path.join('backend', 'app', 'services', 'vision_service.py'),
  ];
  const matches = [];
  for (const file of files) {
    if (!file.endsWith('.py') || !existsSync(file)) continue;
    const text = await readText(file);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\bimport\s+re\b|\bfrom\s+re\s+import\b|\bre\./.test(line)) {
        matches.push({ file: file.replaceAll('\\', '/'), line: index + 1 });
      }
    });
  }
  return matches.length === 0
    ? pass('vision-no-regex', 'Image/vision pipeline does not import or call regex.', {
        checked_files: files.length,
      })
    : fail('vision-no-regex', 'Image/vision pipeline does not import or call regex.', { matches });
}

async function checkDocs() {
  const docs = [
    'README.md',
    'README_en.md',
    'docs/README.md',
    'docs/RUN_MODES.md',
    'docs/MODELS.md',
    'docs/MODEL_PROVENANCE.md',
    'docs/EVALUATION.md',
    'docs/QUALITY_AUDIT.md',
    'docs/TROUBLESHOOTING.md',
  ];
  const missing = docs.filter((doc) => !existsSync(doc));
  return missing.length === 0
    ? pass('docs-surface', 'Open-source handoff docs exist for setup, models, eval, and quality.', {
        docs,
      })
    : fail('docs-surface', 'Open-source handoff docs exist for setup, models, eval, and quality.', {
        missing,
      });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checks = [
    await checkNodeContract(),
    await checkNode24Proof(),
    await checkCiWorkflowContract(),
    await checkQualityFastContract(),
    await checkDockerComposeStartupContract(),
    await checkUiBrowserContractEvidence(),
    await checkLiveUiEvidence(),
    await checkModelManifest(),
    await checkEvidenceManifest(),
    await checkHasImageContract(),
    await checkNoVisionRegex(),
    await checkDocs(),
  ];
  const failures = checks.filter((check) => check.status === 'fail');
  const warnings = checks.filter((check) => check.status === 'warn');
  const report = {
    generated_at: new Date().toISOString(),
    status: failures.length === 0 ? 'pass' : 'fail',
    summary: {
      pass: checks.filter((check) => check.status === 'pass').length,
      warn: warnings.length,
      fail: failures.length,
    },
    checks,
    remaining_release_gaps: [
      'Run the same gates from a clean public checkout or CI image before tagging a release.',
      'Confirm the recorded Hugging Face revisions against the exact private mirror or deployment snapshot before publishing release artifacts.',
      'Add separate VLM signature provenance and quality gates before advertising signature detection as model-supported.',
    ],
  };

  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`release readiness report: ${args.out}`);
  console.log(`status=${report.status} pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail}`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
