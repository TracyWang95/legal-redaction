#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsPaths = [
  'README.md',
  'README_en.md',
  'docs/QUICKSTART_ZH.md',
  'docs/README.md',
  'docs/API.md',
  'docs/EVALUATION.md',
  'docs/MODELS.md',
  'docs/MODEL_PROVENANCE.md',
  'docs/QUALITY_AUDIT.md',
  'docs/RUN_MODES.md',
  'docs/TROUBLESHOOTING.md',
  'docs/UI_BROWSER_ACCEPTANCE.md',
];

const userFacingDocsPaths = [
  'README.md',
  'README_en.md',
  'docs/QUICKSTART_ZH.md',
  'docs/README.md',
  'docs/RUN_MODES.md',
  'docs/TROUBLESHOOTING.md',
];

const publicApiDescriptionPaths = [
  'backend/app/models/file_schemas.py',
  'backend/app/api/files.py',
  'backend/app/api/presets.py',
  'backend/app/services/preset_service.py',
  'backend/app/services/redaction/replacement_strategy.py',
  'scripts/dev.mjs',
];

const modelHandoffDocsPaths = [
  'README.md',
  'docs/README.md',
  'docs/MODEL_PROVENANCE.md',
  'docs/QUALITY_AUDIT.md',
];

async function readRepoFile(relativePath) {
  return readFile(path.join(rootDir, relativePath), 'utf8');
}

function assertMentions(source, pattern, label) {
  assert.match(source, pattern, label);
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

function assertGpuProfiledService(compose, serviceName) {
  const block = composeServiceBlock(compose, serviceName);
  assert.ok(block, `${serviceName} service should exist in docker-compose.yml`);
  assert.match(block, /^\s{4}profiles:\s*\n(?:^\s{6}-\s+gpu\s*$)/m, `${serviceName} should be in the gpu profile`);
}

async function testFrontendPortContract() {
  const staleVitePort = String(5000 + 173);
  const combinedDocs = (await Promise.all(docsPaths.map(readRepoFile))).join('\n');
  const userFacingDocs = (await Promise.all(userFacingDocsPaths.map(readRepoFile))).join('\n');
  assert.doesNotMatch(
    combinedDocs,
    new RegExp(staleVitePort),
    'public docs should not mention the stale Vite dev port',
  );
  assert.doesNotMatch(
    userFacingDocs,
    /\bPlayground\b/,
    'user-facing docs should call the first workflow single-file processing, not Playground',
  );
  assertMentions(
    combinedDocs,
    /http:\/\/localhost:3000|http:\/\/127\.0\.0\.1:3000/,
    'public docs should identify 3000 as the frontend entry point',
  );

  const packageJson = JSON.parse(await readRepoFile('package.json'));
  assert.doesNotMatch(
    JSON.stringify(packageJson.scripts),
    new RegExp(staleVitePort),
    'root npm scripts should not mention the stale frontend port',
  );
  assert.equal(packageJson.scripts.dev, 'node scripts/dev.mjs');
  assert.equal(packageJson.scripts['dev:attach'], 'node scripts/dev.mjs --attach-existing');
  assert.equal(packageJson.scripts.doctor, 'node scripts/dev.mjs --doctor');
  assert.equal(
    packageJson.scripts['doctor:has-text-server'],
    'node scripts/dev.mjs --doctor-has-text-server --json',
  );
  assert.equal(packageJson.scripts['eval:ceshi:preflight'], 'node scripts/eval-ceshi.mjs --preflight');
  assert.match(
    packageJson.scripts['eval:text-direct'],
    /node scripts\/run-python\.mjs scripts\/eval-text-direct\.py/,
    'public Python npm scripts should use the cross-platform Python launcher',
  );
  assert.equal(packageJson.scripts['eval:ceshi:diagnostics-only'], 'node scripts/eval-ceshi.mjs --diagnostics-only');
  assert.equal(
    packageJson.scripts['eval:ceshi:diagnostics-plan'],
    'node scripts/eval-ceshi.mjs --diagnostics-only --dry-run',
  );
  assert.match(packageJson.scripts['test:scripts'], /scripts\/test-docs-contract\.mjs/);
  assert.match(packageJson.scripts['test:scripts'], /scripts\/test-create-model-provenance-manifest\.mjs/);
  assert.match(packageJson.scripts['test:scripts'], /scripts\/test-has-text-gpu-preflight\.mjs/);
  assert.match(packageJson.scripts['test:scripts'], /scripts\/test-ui-browser-contract\.mjs/);
  assert.equal(packageJson.scripts['quality:fast'], 'node scripts/quality-local.mjs --fast');
  assert.equal(packageJson.scripts['quality:dry'], 'node scripts/quality-local.mjs --dry-run');
  assert.equal(
    packageJson.scripts['quality:frontend'],
    'node scripts/quality-local.mjs --with-frontend-build',
  );
  assert.equal(
    packageJson.scripts['quality:backend'],
    'node scripts/quality-local.mjs --with-backend-pytest',
  );
  assert.equal(
    packageJson.scripts['quality:full'],
    'node scripts/quality-local.mjs --with-frontend-build --with-backend-pytest',
  );
}

async function testLegacyPlaygroundNameNotExposedInPublicDescriptions() {
  const publicDescriptions = (
    await Promise.all(publicApiDescriptionPaths.map(readRepoFile))
  ).join('\n');
  assert.doesNotMatch(
    publicDescriptions,
    /\bPlayground\b/,
    'OpenAPI descriptions and startup diagnostics should use single-file processing, not the old Playground label',
  );
}

async function testDockerComposeStartupContract() {
  const compose = await readRepoFile('docker-compose.yml');
  const startupDocs = (await Promise.all(userFacingDocsPaths.map(readRepoFile))).join('\n');

  const backendBlock = composeServiceBlock(compose, 'backend');
  const frontendBlock = composeServiceBlock(compose, 'frontend');
  assert.ok(backendBlock, 'backend service should exist in docker-compose.yml');
  assert.ok(frontendBlock, 'frontend service should exist in docker-compose.yml');
  assert.doesNotMatch(backendBlock, /^\s{4}profiles:\s*$/m, 'backend should start in the default compose profile');
  assert.doesNotMatch(frontendBlock, /^\s{4}profiles:\s*$/m, 'frontend should start in the default compose profile');
  for (const serviceName of ['ocr', 'ner', 'vision']) assertGpuProfiledService(compose, serviceName);

  assertMentions(
    compose,
    /\$\{FRONTEND_PORT:-3000\}:8080/,
    'docker-compose should expose the frontend entry through port 3000 by default',
  );
  assert.doesNotMatch(compose, /\b5173\b/, 'docker-compose should not mention the stale Vite dev port');
  assert.doesNotMatch(compose, /\bPlayground\b/, 'docker-compose should not use the old Playground label');
  assertMentions(
    startupDocs,
    /docker compose up -d/,
    'public startup docs should include the CPU-only default compose command',
  );
  assertMentions(
    startupDocs,
    /docker compose --profile gpu up -d/,
    'public startup docs should put GPU/model services behind the gpu profile command',
  );
}

async function testScriptTargetsExist() {
  const packageJson = JSON.parse(await readRepoFile('package.json'));
  const commands = Object.values(packageJson.scripts).join(' && ');
  for (const match of commands.matchAll(/\b(?:node|python)\s+(scripts\/[^\s&]+)/g)) {
    const scriptPath = match[1].replace(/\//g, path.sep);
    assert.ok(existsSync(path.join(rootDir, scriptPath)), `${match[1]} should exist`);
  }
}

async function testCiWorkflowContract() {
  const ci = await readRepoFile('.github/workflows/ci.yml');
  assert.doesNotMatch(ci, /node-version:\s*20\b/, 'CI should use the documented Node 24 runtime');
  assert.doesNotMatch(
    ci,
    /requirements\.lock/,
    'CI should not install the heavy local runtime lock file',
  );
  assertMentions(ci, /node-version:\s*24\b/, 'CI should pin Node 24 for public gates');
  assertMentions(
    ci,
    /requirements-ci\.txt/,
    'CI should install the lightweight backend requirements for public gates',
  );
  assertMentions(ci, /npm run quality:fast/, 'CI should run the fast public quality gate');
  assertMentions(ci, /npm run quality:frontend/, 'CI should run the frontend production build gate');
}

async function testModelProvenanceDocs() {
  const readme = await readRepoFile('README.md');
  const docsReadme = await readRepoFile('docs/README.md');
  const provenance = await readRepoFile('docs/MODEL_PROVENANCE.md');
  const qualityAudit = await readRepoFile('docs/QUALITY_AUDIT.md');
  const manifestScript = await readRepoFile('scripts/create-model-provenance-manifest.mjs');
  const combinedEntryDocs = [readme, docsReadme].join('\n');

  assertMentions(
    combinedEntryDocs,
    /MODEL_PROVENANCE\.md[\s\S]{0,120}(model|妯″瀷|provenance|鏉ユ簮|璁稿彲)/,
    'README entry points should link to model provenance guidance',
  );
  assertMentions(
    combinedEntryDocs,
    /QUALITY_AUDIT\.md[\s\S]{0,160}(quality|璐ㄩ噺|audit|瀹¤|handoff|浜や粯)/,
    'README entry points should link to the quality audit handoff note',
  );
  assertMentions(
    combinedEntryDocs,
    /models:manifest[\s\S]{0,180}without absolute paths/,
    'README entry points should describe the sanitized model manifest boundary',
  );
  assertMentions(
    provenance,
    /unsloth\/GLM-4\.6V-Flash-GGUF[\s\S]{0,500}optional/i,
    'MODEL_PROVENANCE should document optional GLM/VLM artifacts discovered by the manifest script',
  );
  assertMentions(
    provenance,
    /<models-dir>\/HaS_Text_0209_0\.6B_Q4_K_M\.gguf/,
    'MODEL_PROVENANCE hash examples should use placeholders instead of copy-paste local paths',
  );
  assertMentions(
    manifestScript,
    /repo: 'unsloth\/GLM-4\.6V-Flash-GGUF'[\s\S]{0,420}sourceDoc: SOURCE_DOC/,
    'optional GLM manifest metadata should point back to MODEL_PROVENANCE',
  );
  assertMentions(
    qualityAudit,
    /npm run test:docs[\s\S]{0,120}node scripts\/test-quality-local\.mjs[\s\S]{0,120}npm run quality:dry/,
    'QUALITY_AUDIT should keep the lightweight audit commands together',
  );
}

async function testDocsDoNotLeakPrivateAbsolutePaths() {
  const allowedPathPatterns = [
    /^D:\\has_models$/,
    /^\/mnt\/d\/has_models$/,
  ];
  const docs = await Promise.all(modelHandoffDocsPaths.map(async (relativePath) => ({
    relativePath,
    text: await readRepoFile(relativePath),
  })));

  for (const { relativePath, text } of docs) {
    const pathMatches = [
      ...text.matchAll(/[A-Za-z]:\\[^\s`),]+|\/mnt\/d\/[^\s`),]+|\/home\/[^\s`),]+|\/Users\/[^\s`),]+/g),
    ].map((match) => match[0].replace(/['"?:.]+$/g, ''));
    for (const matchedPath of pathMatches) {
      assert.ok(
        allowedPathPatterns.some((pattern) => pattern.test(matchedPath)),
        `${relativePath} should not expose private absolute path ${matchedPath}`,
      );
    }
  }
}

async function testAuthAndDoctorDocs() {
  const readmeEn = await readRepoFile('README_en.md');
  const docsReadme = await readRepoFile('docs/README.md');
  const runModes = await readRepoFile('docs/RUN_MODES.md');
  const troubleshooting = await readRepoFile('docs/TROUBLESHOOTING.md');
  const combinedDocs = [readmeEn, docsReadme, runModes, troubleshooting].join('\n');

  assertMentions(
    combinedDocs,
    /AUTH_ENABLED=false[\s\S]{0,260}(do not require a token|do not need `DATAINFRA_TOKEN_FILE`|omit token env vars)/,
    'docs should say auth-disabled evals do not need token env vars',
  );
  assertMentions(
    combinedDocs,
    /auth is enabled[\s\S]{0,220}(tmp\/eval-token\.txt|DATAINFRA_TOKEN_FILE)/,
    'docs should scope eval token guidance to auth-enabled runs',
  );
  assertMentions(
    runModes,
    /HAS_TEXT_SERVER_BIN[\s\S]{0,700}npm run doctor:has-text-server[\s\S]{0,300}(does not start `llama-server`|configuration validation only)/,
    'run modes should document the external llama-server doctor as non-inference validation',
  );
}

async function testHasImageAndCeshiDocs() {
  const combinedDocs = (await Promise.all(docsPaths.map(readRepoFile))).join('\n');
  assertMentions(
    combinedDocs,
    /fixed 21|鍥哄畾 21|exactly 21/,
    'docs should document the fixed 21-class HaS Image contract',
  );
  assertMentions(
    combinedDocs,
    /private corpus[\s\S]{0,600}(GPU is idle|GPU 绌洪棽|healthy model services|model services are healthy|鏈嶅姟鍋ュ悍)/i,
    'docs should warn that the real private corpus flow needs healthy services and an idle GPU',
  );

  const runModes = await readRepoFile('docs/RUN_MODES.md');
  assertMentions(
    runModes,
    /default page-level concurrency is `2`/,
    'RUN_MODES should match dev.mjs default BATCH_RECOGNITION_PAGE_CONCURRENCY=2',
  );
  assertMentions(
    runModes,
    /BATCH_RECOGNITION_PAGE_CONCURRENCY=1[\s\S]{0,160}VISION_DUAL_PIPELINE_PARALLEL=false[\s\S]{0,160}HAS_TEXT_N_GPU_LAYERS=-1/,
    'RUN_MODES should document the low-risk GPU-busy concurrency override',
  );
  assertMentions(
    runModes,
    /eval:ceshi:preflight|--check-only/,
    'RUN_MODES should point users to non-mutating private corpus checks',
  );
}

async function testPerformanceDocsDescribeSparseTextLayerDiagnostics() {
  const evaluation = await readRepoFile('docs/EVALUATION.md');
  assertMentions(
    evaluation,
    /pdf_text_layer_skipped_sparse_file[\s\S]{0,180}skipped sparse file/,
    'performance docs should explain sparse text-layer skip diagnostics',
  );
  assertMentions(
    evaluation,
    /include_result_image=false/,
    'performance docs should keep recognition timing separate from preview rendering',
  );
  assertMentions(
    evaluation,
    /Preview image\s+timing is measured separately/,
    'performance docs should keep recognition timing separate from preview rendering',
  );
}

await testFrontendPortContract();
await testLegacyPlaygroundNameNotExposedInPublicDescriptions();
await testDockerComposeStartupContract();
await testScriptTargetsExist();
await testCiWorkflowContract();
await testModelProvenanceDocs();
await testDocsDoNotLeakPrivateAbsolutePaths();
await testAuthAndDoctorDocs();
await testHasImageAndCeshiDocs();
await testPerformanceDocsDescribeSparseTextLayerDiagnostics();

console.log('docs contract tests passed');
