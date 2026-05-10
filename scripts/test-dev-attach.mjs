#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasImageClassList = [
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
const hasImageClassListText = hasImageClassList.map((slug) => `\`${slug}\``).join(', ');

function extractBacktickedSlugs(source) {
  return [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function extractHasImageClassListBlocks(source) {
  return source
    .split(/\r?\n\s*\r?\n/)
    .filter((block) => block.includes('`face`') && block.includes('`paper`') && block.includes('`qr_code`'));
}

async function readRepoFile(relativePath) {
  return readFile(path.join(rootDir, relativePath), 'utf8');
}

async function readTestScriptNames() {
  const entries = await readdir(path.join(rootDir, 'scripts'), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^test-.*\.mjs$/.test(entry.name))
    .map((entry) => `scripts/${entry.name}`)
    .sort();
}

async function testNodeVersionHintsStayAligned() {
  const packageJson = JSON.parse(await readRepoFile('package.json'));
  const nvmrc = (await readRepoFile('.nvmrc')).trim();
  const nodeVersion = (await readRepoFile('.node-version')).trim();
  assert.equal(packageJson.engines.node, '>=20 <25');
  assert.equal(nvmrc, '24');
  assert.equal(nodeVersion, nvmrc);
  assert.equal(packageJson.scripts.setup, 'node scripts/dev.mjs --setup');
  assert.equal(packageJson.scripts.dev, 'node scripts/dev.mjs');
  assert.equal(packageJson.scripts['dev:attach'], 'node scripts/dev.mjs --attach-existing');

  for (const docsPath of ['README.md', 'README_en.md', 'docs/RUN_MODES.md', 'CONTRIBUTING.md']) {
    const source = await readRepoFile(docsPath);
    assert.match(source, /npm run setup/, `${docsPath} should keep npm run setup as the fresh-clone entry`);
  }

  for (const docsPath of ['README.md', 'docs/README.md', 'docs/RUN_MODES.md', 'CONTRIBUTING.md']) {
    const source = await readRepoFile(docsPath);
    assert.match(source, /npm run dev:attach/, `${docsPath} should document the attach-existing dev entry`);
  }

  for (const docsPath of ['README.md', 'README_en.md', 'docs/README.md', 'docs/RUN_MODES.md', 'CONTRIBUTING.md']) {
    const source = await readRepoFile(docsPath);
    assert.match(
      source,
      /Node(?:\.js)?[^\n]*(24|20\+ and <25)/,
      `${docsPath} should document supported Node versions`,
    );
    assert.match(source, />=20 <25/, `${docsPath} should document the package engine`);
    assert.match(source, /\.nvmrc/, `${docsPath} should mention .nvmrc`);
    assert.match(source, /\.node-version/, `${docsPath} should mention .node-version`);
  }
}

async function testHasImageDocsStayAligned() {
  const classListDocs = ['README.md', 'README_en.md', 'docs/MODELS.md'];
  for (const docsPath of classListDocs) {
    const source = await readRepoFile(docsPath);
    const normalizedSource = source.replace(/\s+/g, ' ');
    assert.match(
      source,
      /21(?:[- ]class| visual target)|21\s*类视觉目标/,
      `${docsPath} should document the fixed 21-class contract`,
    );
    assert.ok(normalizedSource.includes(hasImageClassListText), `${docsPath} should include the exact HaS Image class list`);
    assert.match(source, /`paper`/, `${docsPath} should document paper explicitly`);
    assert.match(
      source,
      /off by default|leaves `paper` off|默认[\s\S]{0,80}(?:关闭|禁用)\s*`paper`/,
      `${docsPath} should say paper is off by default`,
    );
    const classListBlocks = extractHasImageClassListBlocks(source);
    assert.ok(classListBlocks.length > 0, `${docsPath} should include a backticked HaS Image class list block`);
    for (const block of classListBlocks) {
      assert.deepEqual(
        extractBacktickedSlugs(block),
        hasImageClassList,
        `${docsPath} should not add signature or handwriting to HaS Image class-list blocks`,
      );
    }
  }

  for (const docsPath of ['README.md', 'README_en.md', 'docs/MODELS.md', 'docs/EVALUATION.md']) {
    const source = await readRepoFile(docsPath);
    assert.match(
      source,
      /not HaS Image classes|not be reported as new HaS Image classes|不是当前\s+HaS Image\s+类别/,
      `${docsPath} should separate signature fallback evidence from HaS Image classes`,
    );
    assert.match(
      source,
      /fallback|OCR visual labels|OCR 瑙嗚鏍囩/,
      `${docsPath} should document OCR or local fallback as the signature evidence source`,
    );
  }
}

async function testExportReportVisualReviewContractStaysClear() {
  const evaluationDoc = await readRepoFile('docs/EVALUATION.md');
  assert.match(evaluationDoc, /visual_review/, 'docs/EVALUATION.md should name the export report field');
  assert.match(
    evaluationDoc,
    /review hint and quality-risk\s+signal/,
    'visual_review should be documented as a review hint and quality-risk signal',
  );
  assert.match(
    evaluationDoc,
    /does not mean the file failed delivery/,
    'visual_review should not be documented as delivery failure',
  );
  assert.match(
    evaluationDoc,
    /must not be described as a new\s+model category or HaS Image class/,
    'visual_review should not be documented as a model category',
  );

  const batchContract = await readRepoFile('scripts/test-eval-batch-e2e.mjs');
  assert.match(batchContract, /visual_review_issue_count/, 'batch contract should keep visual review issue coverage');
  assert.match(
    batchContract,
    /summary\.quality_gate\.passed, true/,
    'visual review issues should coexist with a passing quality gate in the batch contract',
  );
  assert.match(
    batchContract,
    /ready_for_delivery, true/,
    'visual review issues should coexist with ready_for_delivery=true in the batch contract',
  );
}

async function testPublicDocsAndScriptTestsDoNotLeakPrivateSampleNames() {
  const docsPaths = [
    'README.md',
    'README_en.md',
    'CONTRIBUTING.md',
    ...(await readdir(path.join(rootDir, 'docs'))).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`),
  ];
  const checkedPaths = [...docsPaths, ...(await readTestScriptNames())];
  const privateSampleNeedles = [
    [0x6570, 0x636e, 0x63d0, 0x4f9b, 0x5408, 0x540c],
    [0x4fe1, 0x521b, 0x41, 0x49],
    [0x56fe, 0x7247, 0x5f, 0x32, 0x30, 0x32, 0x36, 0x30, 0x31],
    [0x93c1, 0x7248, 0x5d41],
    [0x6dc7, 0x57b1],
    [0x934f, 0x5287, 0x58a6],
  ].map((codes) => String.fromCodePoint(...codes));

  for (const relativePath of checkedPaths) {
    const source = await readRepoFile(relativePath);
    for (const needle of privateSampleNeedles) {
      assert.equal(source.includes(needle), false, `${relativePath} should not contain private sample name ${needle}`);
    }
  }
}

async function withServer(handler, test) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await test(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function sendText(res, status, text = 'ok') {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(text);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function healthyBackend(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') return sendJson(res, 200, { status: 'healthy', version: '0.1.0' });
  if (url.pathname === '/openapi.json') {
    return sendJson(res, 200, {
      openapi: '3.1.0',
      paths: {
        '/api/v1/auth/status': {},
        '/api/v1/jobs': {},
        '/api/v1/files/upload': {},
      },
    });
  }
  return sendText(res, 404, 'not found');
}

function staleBackend(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') return sendJson(res, 200, { status: 'healthy' });
  if (url.pathname === '/openapi.json') {
    return sendJson(res, 200, { openapi: '3.1.0', paths: { '/other': {} } });
  }
  return sendText(res, 404, 'not found');
}

function authDoctorBackend(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') return sendJson(res, 200, { status: 'healthy', version: '0.1.0' });
  if (url.pathname === '/openapi.json') {
    return sendJson(res, 200, {
      openapi: '3.1.0',
      paths: {
        '/api/v1/auth/status': {},
        '/api/v1/jobs': {},
        '/api/v1/files/upload': {},
      },
    });
  }
  if (url.pathname === '/api/v1/auth/status') {
    const authenticated = req.headers.authorization === 'Bearer valid-token';
    return sendJson(res, 200, {
      auth_enabled: true,
      password_set: true,
      authenticated,
    });
  }
  return sendText(res, 404, 'not found');
}

function disabledAuthDoctorBackend(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') return sendJson(res, 200, { status: 'healthy', version: '0.1.0' });
  if (url.pathname === '/openapi.json') {
    return sendJson(res, 200, {
      openapi: '3.1.0',
      paths: {
        '/api/v1/auth/status': {},
        '/api/v1/jobs': {},
        '/api/v1/files/upload': {},
      },
    });
  }
  if (url.pathname === '/api/v1/auth/status') {
    return sendJson(res, 200, {
      auth_enabled: false,
      password_set: null,
      authenticated: true,
    });
  }
  return sendText(res, 404, 'not found');
}

function unhealthyBackend(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') return sendText(res, 503, 'warming up');
  return sendText(res, 404, 'not found');
}

function healthyFrontend(_req, res) {
  const url = new URL(_req.url, 'http://127.0.0.1');
  if (url.pathname === '/src/router.tsx') {
    return sendText(
      res,
      200,
      "import('./features/home'); const StartPage = true; const route = { path: 'playground' };",
    );
  }
  return sendText(res, 200, '<html></html>');
}

function staleFrontend(_req, res) {
  const url = new URL(_req.url, 'http://127.0.0.1');
  if (url.pathname === '/src/router.tsx') {
    return sendText(res, 200, "const Playground = true; const route = { path: '/' };");
  }
  return sendText(res, 200, '<html></html>');
}

function unverifiableFrontend(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/src/router.tsx') return sendText(res, 404, 'not found');
  return sendText(res, 200, '<html></html>');
}

function runDev(args, env, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/dev.mjs', ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        DATAINFRA_SKIP_MODEL_WARMUP: '1',
        GLM_FLASH_ENABLED: '0',
        GLM_FLASH_START_DELAY_SEC: '0',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`dev.mjs timed out. stdout=${stdout} stderr=${stderr}`));
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

async function withAppServers(backendHandler, frontendHandler, test) {
  await withServer(backendHandler, async (backendPort) => {
    await withServer(frontendHandler, async (frontendPort) => {
      await test({ backendPort, frontendPort });
    });
  });
}

async function withModelServers(handlers, test) {
  await withServer(handlers.ner, async (nerPort) => {
    await withServer(handlers.vision, async (visionPort) => {
      await withServer(handlers.ocr, async (ocrPort) => {
        await withServer(handlers.vlm, async (vlmPort) => {
          await test({ nerPort, visionPort, ocrPort, vlmPort });
        });
      });
    });
  });
}

function healthyVlm(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/v1/models') {
    return sendJson(res, 200, { object: 'list', data: [{ id: 'PaddleOCR-VL-1.5-0.9B' }] });
  }
  return sendText(res, 404, 'not found');
}

function staleVlm(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/v1/models') {
    return sendJson(res, 200, { object: 'list', data: [{ id: 'other-model' }] });
  }
  return sendText(res, 404, 'not found');
}

function healthyOcr(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') {
    return sendJson(res, 200, { status: 'online', model: 'PaddleOCR-VL-1.5-0.9B', ready: true });
  }
  return sendText(res, 404, 'not found');
}

function staleOcr(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') {
    return sendJson(res, 200, { status: 'online', model: 'Other OCR', ready: true });
  }
  return sendText(res, 404, 'not found');
}

function healthyVision(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', model: 'HaS-Image-YOLO11', ready: true });
  }
  return sendText(res, 404, 'not found');
}

function staleVision(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', model: 'Other Vision', ready: true });
  }
  return sendText(res, 404, 'not found');
}

function healthyNer(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/v1/models') {
    return sendJson(res, 200, {
      object: 'list',
      data: [{ id: 'HaS_4.0_0.6B' }],
    });
  }
  return sendText(res, 404, 'not found');
}

function flakyThenHealthyNer() {
  let hits = 0;
  return (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/v1/models') {
      hits += 1;
      if (hits === 1) {
        setTimeout(() => {
          if (!res.destroyed) sendText(res, 503, 'temporary model busy');
        }, 3000);
        return;
      }
      return healthyNer(req, res);
    }
    return sendText(res, 404, 'not found');
  };
}

function staleNer(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/v1/models') {
    return sendJson(res, 200, { object: 'list', data: [{ id: '/tmp/other.gguf' }] });
  }
  return sendText(res, 404, 'not found');
}

function externalServerPathNer(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/v1/models') {
    return sendJson(res, 200, { object: 'list', data: [{ id: 'D:\\models\\server-path-model.gguf' }] });
  }
  return sendText(res, 404, 'not found');
}

async function testStrictModeRejectsOccupiedPorts() {
  await withAppServers(healthyBackend, healthyFrontend, async ({ backendPort, frontendPort }) => {
    const result = await runDev(['--app-only'], {
      BACKEND_PORT: String(backendPort),
      FRONTEND_PORT: String(frontendPort),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /ports already in use/);
    assert.match(result.output, /--attach-existing/);
  });
}

async function testAttachExistingReusesHealthyServices() {
  await withAppServers(healthyBackend, healthyFrontend, async ({ backendPort, frontendPort }) => {
    const result = await runDev(['--app-only', '--attach-existing'], {
      BACKEND_PORT: String(backendPort),
      FRONTEND_PORT: String(frontendPort),
    });
    assert.equal(result.code, 0);
    assert.match(result.output, /reusing healthy services/);
    assert.match(result.output, /all requested services are already healthy/);
  });
}

async function testAttachExistingRejectsUnhealthyOccupiedPorts() {
  await withAppServers(unhealthyBackend, healthyFrontend, async ({ backendPort, frontendPort }) => {
    const result = await runDev(['--app-only', '--attach-existing'], {
      BACKEND_PORT: String(backendPort),
      FRONTEND_PORT: String(frontendPort),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /ports are occupied but health checks failed/);
    assert.match(result.output, /warming up/);
  });
}

async function testAttachExistingRejectsStaleBackend() {
  await withAppServers(staleBackend, healthyFrontend, async ({ backendPort, frontendPort }) => {
    const result = await runDev(['--app-only', '--attach-existing'], {
      BACKEND_PORT: String(backendPort),
      FRONTEND_PORT: String(frontendPort),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /ports are occupied but health checks failed/);
    assert.match(result.output, /DataInfra backend API stale/);
  });
}

async function testAttachExistingRejectsStaleFrontend() {
  await withAppServers(healthyBackend, staleFrontend, async ({ backendPort, frontendPort }) => {
    const result = await runDev(['--app-only', '--attach-existing'], {
      BACKEND_PORT: String(backendPort),
      FRONTEND_PORT: String(frontendPort),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /ports are occupied but health checks failed/);
    assert.match(result.output, /current start and single-file router stale/);
  });
}

async function testAttachExistingRejectsUnverifiableFrontend() {
  await withAppServers(healthyBackend, unverifiableFrontend, async ({ backendPort, frontendPort }) => {
    const result = await runDev(['--app-only', '--attach-existing'], {
      BACKEND_PORT: String(backendPort),
      FRONTEND_PORT: String(frontendPort),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /ports are occupied but health checks failed/);
    assert.match(result.output, /current start and single-file router unavailable/);
  });
}

async function testAttachExistingReusesHealthyModelServices() {
  await withModelServers(
    { ner: healthyNer, vision: healthyVision, ocr: healthyOcr, vlm: healthyVlm },
    async ({ nerPort, visionPort, ocrPort, vlmPort }) => {
      const result = await runDev(['--models-only', '--attach-existing'], {
        HAS_TEXT_PORT: String(nerPort),
        HAS_IMAGE_PORT: String(visionPort),
        OCR_PORT: String(ocrPort),
        OCR_VLLM_PORT: String(vlmPort),
      });
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /reusing healthy services/);
      assert.match(result.output, /all requested services are already healthy/);
    },
  );
}

async function testAttachExistingKeepsHasTextVllmContractWhenServerPathIsSet() {
  await withModelServers(
    { ner: healthyNer, vision: healthyVision, ocr: healthyOcr, vlm: healthyVlm },
    async ({ nerPort, visionPort, ocrPort, vlmPort }) => {
      const result = await runDev(['--models-only', '--attach-existing'], {
        HAS_TEXT_PORT: String(nerPort),
        HAS_IMAGE_PORT: String(visionPort),
        OCR_PORT: String(ocrPort),
        OCR_VLLM_PORT: String(vlmPort),
        HAS_TEXT_MODEL_PATH_FOR_SERVER: 'D:\\models\\server-path-model.gguf',
      });
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /reusing healthy services/);
      assert.match(result.output, /all requested services are already healthy/);
    },
  );
}

async function testAttachExistingRetriesTransientModelHealthTimeout() {
  await withModelServers(
    { ner: flakyThenHealthyNer(), vision: healthyVision, ocr: healthyOcr, vlm: healthyVlm },
    async ({ nerPort, visionPort, ocrPort, vlmPort }) => {
      const result = await runDev(['--models-only', '--attach-existing'], {
        HAS_TEXT_PORT: String(nerPort),
        HAS_IMAGE_PORT: String(visionPort),
        OCR_PORT: String(ocrPort),
        OCR_VLLM_PORT: String(vlmPort),
        DOCTOR_SERVICE_HEALTH_RETRY_DELAY_MS: '10',
      }, 30_000);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /reusing healthy services/);
      assert.match(result.output, /all requested services are already healthy/);
    },
  );
}

async function testAttachExistingRejectsWrongVlmService() {
  await withModelServers(
    { ner: healthyNer, vision: healthyVision, ocr: healthyOcr, vlm: staleVlm },
    async ({ nerPort, visionPort, ocrPort, vlmPort }) => {
      const result = await runDev(['--models-only', '--attach-existing'], {
        HAS_TEXT_PORT: String(nerPort),
        HAS_IMAGE_PORT: String(visionPort),
        OCR_PORT: String(ocrPort),
        OCR_VLLM_PORT: String(vlmPort),
      });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /PaddleOCR-VL vLLM model list stale/);
    },
  );
}

async function testAttachExistingRejectsWrongOcrService() {
  await withModelServers(
    { ner: healthyNer, vision: healthyVision, ocr: staleOcr, vlm: healthyVlm },
    async ({ nerPort, visionPort, ocrPort, vlmPort }) => {
      const result = await runDev(['--models-only', '--attach-existing'], {
        HAS_TEXT_PORT: String(nerPort),
        HAS_IMAGE_PORT: String(visionPort),
        OCR_PORT: String(ocrPort),
        OCR_VLLM_PORT: String(vlmPort),
      });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /PaddleOCR service health stale/);
    },
  );
}

async function testAttachExistingRejectsWrongVisionService() {
  await withModelServers(
    { ner: healthyNer, vision: staleVision, ocr: healthyOcr, vlm: healthyVlm },
    async ({ nerPort, visionPort, ocrPort, vlmPort }) => {
      const result = await runDev(['--models-only', '--attach-existing'], {
        HAS_TEXT_PORT: String(nerPort),
        HAS_IMAGE_PORT: String(visionPort),
        OCR_PORT: String(ocrPort),
        OCR_VLLM_PORT: String(vlmPort),
      });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /HaS Image service health stale/);
    },
  );
}

async function testAttachExistingRejectsWrongNerService() {
  await withModelServers(
    { ner: staleNer, vision: healthyVision, ocr: healthyOcr, vlm: healthyVlm },
    async ({ nerPort, visionPort, ocrPort, vlmPort }) => {
      const result = await runDev(['--models-only', '--attach-existing'], {
        HAS_TEXT_PORT: String(nerPort),
        HAS_IMAGE_PORT: String(visionPort),
        OCR_PORT: String(ocrPort),
        OCR_VLLM_PORT: String(vlmPort),
      });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /HaS Text model list stale/);
    },
  );
}

async function testFirstRunPrintsReproduciblePath() {
  const result = await runDev(['--first-run'], {
    BACKEND_PORT: '19180',
    FRONTEND_PORT: '19181',
    HAS_TEXT_PORT: '19182',
    HAS_IMAGE_PORT: '19183',
    OCR_PORT: '19184',
    OCR_VLLM_PORT: '19185',
  }, 45_000);
  assert.equal(result.code, 0);
  assert.match(result.output, /first-run: environment audit/);
  assert.match(result.output, /first-run: gate taxonomy/);
  assert.match(result.output, /contract gate: npm run test:scripts/);
  assert.match(result.output, /public no-auth quality gate: npm run eval:public/);
  assert.match(result.output, /public workflow gate: eval:batch-e2e with fixtures\/eval/);
  assert.match(result.output, /private regression gate: eval:ceshi with private corpus files/);
  assert.match(result.output, /npm run setup/);
  assert.match(result.output, /npm run dev -- --attach-existing/);
  assert.match(result.output, /fixtures\/eval\/sample-contract\.txt/);
  assert.match(result.output, /npm run fixtures:visual/);
  assert.match(result.output, /fixtures\/eval\/sample-visual\.png/);
  assert.match(result.output, /eval-vision-direct-public-services/);
  assert.match(result.output, /npm run eval:public -- output\/playwright\/eval-public-current/);
  assert.match(result.output, /npm run eval:batch-e2e -- output\/playwright\/eval-batch-current/);
  assert.match(result.output, /public batch workflow gate/);
  assert.match(result.output, /fixtures\/local-real-files\.example\.json/);
  assert.match(result.output, /EVAL_CESHI_MANIFEST=fixtures\/local-real-files\.json/);
  assert.match(result.output, /npm run eval:ceshi -- output\/playwright\/eval-ceshi-current/);
}

async function testDoctorJsonAndStrictMode() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-doctor-'));
  const reportPath = path.join(tmpDir, 'doctor-report.json');
  try {
    const jsonResult = await runDev(['--doctor', '--json'], {
      DOCTOR_REPORT_PATH: reportPath,
      BACKEND_PORT: '19280',
      FRONTEND_PORT: '19281',
      HAS_TEXT_PORT: '19282',
      HAS_IMAGE_PORT: '19283',
      OCR_PORT: '19284',
      OCR_VLLM_PORT: '19285',
      VENV_DIR: path.join(tmpDir, 'missing-app-venv'),
      VLLM_VENV_DIR: path.join(tmpDir, 'missing-vllm-venv'),
      HAS_MODEL_PATH: path.join(tmpDir, 'missing-model.gguf'),
      HAS_IMAGE_WEIGHTS: path.join(tmpDir, 'missing-weights.pt'),
    }, 45_000);
    assert.equal(jsonResult.code, 0, jsonResult.output);
    assert.match(jsonResult.output, /doctor json:/);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.strict, false);
    assert.ok(report.summary.failed_checks > 0);
    assert.ok(report.summary.unhealthy_services > 0);
    assert.equal(report.summary.strict_pass, false);
    assert.ok(report.checks.some((check) => check.label === 'app venv python' && check.ok === false));
    assert.match(report.paths.model_provenance, /MODEL_PROVENANCE\.md$/);
    assert.ok(report.checks.some((check) => check.label === 'model provenance doc' && check.ok === true));
    assert.match(jsonResult.output, /doctor next steps:/);
    assert.match(jsonResult.output, /CPU browser UI\/API smoke: docker compose up -d/);
    assert.match(jsonResult.output, /GPU full recognition stack: docker compose --profile gpu up -d/);
    assert.match(jsonResult.output, /reuse already-running local services: npm run dev:attach/);
    assert.match(jsonResult.output, /real-file eval with your own manifest: EVAL_CESHI_MANIFEST=fixtures\/local-real-files\.json DATAINFRA_TOKEN_FILE=tmp\/eval-token\.txt npm run eval:ceshi -- output\/playwright\/eval-local-real-current/);
    assert.ok(report.next_steps.some((step) => step.label === 'install or refresh local dependencies' && step.command === 'npm run setup'));
    assert.ok(report.next_steps.some((step) => step.label === 'CPU browser UI/API smoke' && step.command === 'docker compose up -d'));
    assert.ok(report.next_steps.some((step) => step.label === 'GPU full recognition stack' && step.command === 'docker compose --profile gpu up -d'));
    assert.ok(report.next_steps.some((step) => step.label === 'reuse already-running local services' && step.command === 'npm run dev:attach'));
    assert.ok(report.next_steps.some((step) => step.label === 'real-file eval with your own manifest' && step.command.includes('EVAL_CESHI_MANIFEST=fixtures/local-real-files.json')));

    const strictResult = await runDev(['--doctor', '--json', '--strict'], {
      DOCTOR_REPORT_PATH: reportPath,
      BACKEND_PORT: '19290',
      FRONTEND_PORT: '19291',
      HAS_TEXT_PORT: '19292',
      HAS_IMAGE_PORT: '19293',
      OCR_PORT: '19294',
      OCR_VLLM_PORT: '19295',
      VENV_DIR: path.join(tmpDir, 'missing-app-venv'),
      VLLM_VENV_DIR: path.join(tmpDir, 'missing-vllm-venv'),
      HAS_MODEL_PATH: path.join(tmpDir, 'missing-model.gguf'),
      HAS_IMAGE_WEIGHTS: path.join(tmpDir, 'missing-weights.pt'),
    }, 45_000);
    assert.notEqual(strictResult.code, 0);
    assert.match(strictResult.output, /doctor strict failed/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testDoctorWarnsUnsupportedNodeMajor() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-doctor-node-'));
  const reportPath = path.join(tmpDir, 'doctor-node-report.json');
  try {
    const result = await runDev(['--doctor', '--json'], {
      DOCTOR_REPORT_PATH: reportPath,
      BACKEND_PORT: '19300',
      FRONTEND_PORT: '19301',
      HAS_TEXT_PORT: '19302',
      HAS_IMAGE_PORT: '19303',
      OCR_PORT: '19304',
      OCR_VLLM_PORT: '19305',
      DATAINFRA_DOCTOR_NODE_VERSION: '25.0.0',
      VENV_DIR: path.join(tmpDir, 'missing-app-venv'),
      VLLM_VENV_DIR: path.join(tmpDir, 'missing-vllm-venv'),
      HAS_MODEL_PATH: path.join(tmpDir, 'missing-model.gguf'),
      HAS_IMAGE_WEIGHTS: path.join(tmpDir, 'missing-weights.pt'),
    }, 45_000);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Node 25\.0\.0 is outside project engine >=20 <25/);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.config.node_version, '25.0.0');
    assert.equal(report.config.node_engine, '>=20 <25');
    assert.equal(report.config.node_recommended, '24');
    assert.equal(report.config.node_version_file, '24');
    assert.match(result.output, /recommended Node 24 is recorded in \.nvmrc and \.node-version/);
    assert.match(result.output, /already-running services can still be verified/);
    assert.match(result.output, /switch this shell to Node 24 before npm install or npm run setup/);
    assert.ok(report.warnings.includes('Node 25.0.0 is outside project engine >=20 <25'));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testDoctorReportsExternalHasTextServer() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-doctor-has-text-server-'));
  const reportPath = path.join(tmpDir, 'doctor-has-text-server-report.json');
  try {
    const fakeServer = path.join(tmpDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    const fakeModel = path.join(tmpDir, 'HaS_Text_0209_0.6B_Q4_K_M.gguf');
    const fakeServerModel = path.join(tmpDir, 'server-path-model.gguf');
    await writeFile(fakeServer, '#!/bin/sh\n', 'utf8');
    await writeFile(fakeModel, 'fake model placeholder', 'utf8');
    await writeFile(fakeServerModel, 'fake server model placeholder', 'utf8');
    const result = await runDev(['--doctor', '--json'], {
      DOCTOR_REPORT_PATH: reportPath,
      BACKEND_PORT: '19320',
      FRONTEND_PORT: '19321',
      HAS_TEXT_PORT: '19322',
      HAS_IMAGE_PORT: '19323',
      OCR_PORT: '19324',
      OCR_VLLM_PORT: '19325',
      HAS_TEXT_SERVER_BIN: fakeServer,
      HAS_TEXT_RUNTIME: 'llamacpp',
      HAS_MODEL_PATH: fakeModel,
      HAS_TEXT_MODEL_PATH_FOR_SERVER: fakeServerModel,
      HAS_TEXT_DEVICE: '0',
      VENV_DIR: path.join(tmpDir, 'missing-app-venv'),
      VLLM_VENV_DIR: path.join(tmpDir, 'missing-vllm-venv'),
      HAS_IMAGE_WEIGHTS: path.join(tmpDir, 'missing-weights.pt'),
    }, 45_000);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /HaS Text command preview:/);
    assert.match(result.output, /doctor does not start llama-server or run inference/);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.paths.has_text_server_bin, fakeServer);
    assert.equal(report.has_text_server.enabled, true);
    assert.equal(report.has_text_server.server_bin, fakeServer);
    assert.equal(report.has_text_server.model_path, fakeServerModel);
    assert.equal(report.has_text_server.device, '0');
    assert.match(report.has_text_server.command, /--chat-template chatml/);
    assert.match(report.has_text_server.command, /--device/);
    assert.ok(
      report.checks.some((check) =>
        check.label === 'HaS Text external server' &&
        check.ok === true &&
        check.detail === fakeServer,
      ),
    );
    assert.ok(
      report.checks.some((check) =>
        check.label === 'HaS Text external server model' &&
        check.ok === true &&
        check.detail === fakeServerModel,
      ),
    );
    assert.ok(
      report.checks.some((check) =>
        check.label === 'llama_cpp import' &&
        check.required === false,
      ),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testHasTextServerDoctorCommandPreview() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-has-text-server-doctor-'));
  const reportPath = path.join(tmpDir, 'has-text-server-doctor.json');
  try {
    const fakeServer = path.join(tmpDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    const fakeModel = path.join(tmpDir, 'HaS_Text_0209_0.6B_Q4_K_M.gguf');
    await writeFile(fakeServer, '#!/bin/sh\n', 'utf8');
    await writeFile(fakeModel, 'fake model placeholder', 'utf8');
    const result = await runDev(['--doctor-has-text-server', '--json', '--strict'], {
      DOCTOR_REPORT_PATH: reportPath,
      HAS_TEXT_PORT: '19422',
      HAS_TEXT_SERVER_BIN: fakeServer,
      HAS_TEXT_RUNTIME: 'llamacpp',
      HAS_TEXT_MODEL_PATH_FOR_SERVER: fakeModel,
      HAS_TEXT_N_GPU_LAYERS: '0',
      HAS_TEXT_N_CTX: '4096',
    }, 15_000);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /HaS Text external llama-server doctor/);
    assert.match(result.output, /command preview:/);
    assert.match(result.output, /--port 19422/);
    assert.match(result.output, /-ngl 0/);
    assert.match(result.output, /-c 4096/);
    assert.match(result.output, /CPU fallback risk: yes/);
    assert.match(result.output, /does not start llama-server or run model inference/);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.has_text_server.enabled, true);
    assert.equal(report.has_text_server.server_bin_exists, true);
    assert.equal(report.has_text_server.model_path_exists, true);
    assert.equal(report.has_text_server.port, 19422);
    assert.equal(report.has_text_server.gpu_only_mode, false);
    assert.equal(report.has_text_server.cpu_fallback_risk, true);
    assert.equal(report.summary.failed_checks, 0);
    assert.equal(report.summary.strict_pass, true);

    const packageJson = JSON.parse(await readRepoFile('package.json'));
    assert.equal(
      packageJson.scripts['doctor:has-text-server'],
      'node scripts/dev.mjs --doctor-has-text-server --json',
    );
    assert.equal(
      packageJson.scripts['doctor:has-text-server:strict'],
      'node scripts/dev.mjs --doctor-has-text-server --json --strict',
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function runAuthDoctorWithBackend(backendPort, tmpDir, extraEnv = {}) {
  const reportPath = path.join(tmpDir, `doctor-auth-${Date.now()}-${Math.random()}.json`);
  const result = await runDev(['--doctor', '--json'], {
    DOCTOR_REPORT_PATH: reportPath,
    BACKEND_PORT: String(backendPort),
    FRONTEND_PORT: '19381',
    HAS_TEXT_PORT: '19382',
    HAS_IMAGE_PORT: '19383',
    OCR_PORT: '19384',
    OCR_VLLM_PORT: '19385',
    DATAINFRA_PASSWORD: '',
    DATAINFRA_TOKEN: '',
    DATAINFRA_TOKEN_FILE: '',
    VENV_DIR: path.join(tmpDir, 'missing-app-venv'),
    VLLM_VENV_DIR: path.join(tmpDir, 'missing-vllm-venv'),
    HAS_MODEL_PATH: path.join(tmpDir, 'HaS_Text_0209_0.6B_Q4_K_M.gguf'),
    HAS_IMAGE_WEIGHTS: path.join(tmpDir, 'missing-weights.pt'),
    ...extraEnv,
  }, 45_000);
  assert.equal(result.code, 0, result.output);
  return {
    result,
    report: JSON.parse(await readFile(reportPath, 'utf8')),
  };
}

async function testDoctorWarnsUnreadableTokenFile() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-auth-doctor-'));
  try {
    await withServer(authDoctorBackend, async (backendPort) => {
      const missingPath = path.join(tmpDir, 'missing-token.txt');
      const { result, report } = await runAuthDoctorWithBackend(backendPort, tmpDir, {
        DATAINFRA_TOKEN_FILE: missingPath,
      });
      assert.match(result.output, /DATAINFRA_TOKEN_FILE cannot be read/);
      assert.equal(report.auth.eval_token_source, 'DATAINFRA_TOKEN_FILE');
      assert.equal(report.auth.eval_token_file_readable, false);
      assert.equal(report.auth.eval_token_file_nonempty, false);
      assert.ok(report.auth.warnings.some((warning) => warning.includes('DATAINFRA_TOKEN_FILE cannot be read')));
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testDoctorWarnsEmptyTokenFile() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-auth-doctor-'));
  try {
    const tokenPath = path.join(tmpDir, 'empty-token.txt');
    await writeFile(tokenPath, ' \n', 'utf8');
    await withServer(authDoctorBackend, async (backendPort) => {
      const { result, report } = await runAuthDoctorWithBackend(backendPort, tmpDir, {
        DATAINFRA_TOKEN_FILE: tokenPath,
      });
      assert.match(result.output, /DATAINFRA_TOKEN_FILE is empty/);
      assert.equal(report.auth.eval_token_source, 'DATAINFRA_TOKEN_FILE');
      assert.equal(report.auth.eval_token_file_readable, true);
      assert.equal(report.auth.eval_token_file_nonempty, false);
      assert.ok(report.auth.warnings.includes('DATAINFRA_TOKEN_FILE is empty'));
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testDoctorAuthDisabledDoesNotReadTokenFile() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-auth-doctor-'));
  try {
    const missingPath = path.join(tmpDir, 'missing-token.txt');
    await withServer(disabledAuthDoctorBackend, async (backendPort) => {
      const { result, report } = await runAuthDoctorWithBackend(backendPort, tmpDir, {
        AUTH_ENABLED: 'false',
        DATAINFRA_TOKEN_FILE: missingPath,
      });
      assert.match(result.output, /auth decision: auth is disabled/);
      assert.match(result.output, /DATAINFRA_\* is configured but ignored because backend auth is disabled/);
      assert.doesNotMatch(result.output, /DATAINFRA_TOKEN_FILE cannot be read/);
      assert.equal(report.auth.auth_enabled, false);
      assert.equal(report.auth.eval_token_source, 'DATAINFRA_TOKEN_FILE');
      assert.equal(report.auth.eval_token_file_readable, null);
      assert.ok(!report.auth.warnings.some((warning) => warning.includes('DATAINFRA_TOKEN_FILE')));
      assert.ok(!report.next_steps.some((step) => /eval:login/.test(step.command)));
      assert.ok(!report.next_steps.some((step) => /DATAINFRA_TOKEN_FILE=tmp\/eval-token\.txt/.test(step.command)));
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testDoctorWarnsUnauthenticatedToken() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-auth-doctor-'));
  try {
    const tokenPath = path.join(tmpDir, 'bad-token.txt');
    await writeFile(tokenPath, 'bad-token\n', 'utf8');
    await withServer(authDoctorBackend, async (backendPort) => {
      const { result, report } = await runAuthDoctorWithBackend(backendPort, tmpDir, {
        DATAINFRA_TOKEN_FILE: tokenPath,
      });
      assert.match(result.output, /DATAINFRA_TOKEN_FILE is configured but \/auth\/status still reports authenticated=false/);
      assert.doesNotMatch(result.output, /bad-token/);
      assert.equal(report.auth.eval_token_authenticated, false);
      assert.ok(report.auth.warnings.includes('DATAINFRA_TOKEN_FILE is configured but not authenticated'));
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testDoctorAcceptsAuthenticatedTokenWithoutPrintingIt() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-auth-doctor-'));
  try {
    const tokenPath = path.join(tmpDir, 'valid-token.txt');
    await writeFile(tokenPath, 'valid-token\n', 'utf8');
    await withServer(authDoctorBackend, async (backendPort) => {
      const { result, report } = await runAuthDoctorWithBackend(backendPort, tmpDir, {
        DATAINFRA_TOKEN_FILE: tokenPath,
      });
      assert.match(result.output, /auth token: source=DATAINFRA_TOKEN_FILE authenticated=true/);
      assert.doesNotMatch(result.output, /valid-token/);
      assert.equal(report.auth.eval_token_authenticated, true);
      assert.equal(report.auth.eval_token_file_readable, true);
      assert.equal(report.auth.eval_token_file_nonempty, true);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testDoctorUsesDefaultEvalTokenFile() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-auth-doctor-'));
  try {
    const tokenPath = path.join(tmpDir, 'eval-token.txt');
    await writeFile(tokenPath, 'valid-token\n', 'utf8');
    await withServer(authDoctorBackend, async (backendPort) => {
      const { result, report } = await runAuthDoctorWithBackend(backendPort, tmpDir, {
        DATAINFRA_DEFAULT_TOKEN_FILE: tokenPath,
      });
      assert.match(result.output, /auth token: source=default-token-file authenticated=true/);
      assert.doesNotMatch(result.output, /auth decision: authenticated eval scripts and browser automation are blocked/);
      assert.doesNotMatch(result.output, /valid-token/);
      assert.equal(report.auth.eval_token_source, 'default-token-file');
      assert.equal(report.auth.eval_token_file, tokenPath);
      assert.equal(report.auth.eval_token_authenticated, true);
      assert.equal(report.auth.eval_token_file_readable, true);
      assert.equal(report.auth.eval_token_file_nonempty, true);
      assert.ok(!report.auth.warnings.includes('auth enabled and no eval credential is configured'));
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

await testNodeVersionHintsStayAligned();
await testHasImageDocsStayAligned();
await testExportReportVisualReviewContractStaysClear();
await testPublicDocsAndScriptTestsDoNotLeakPrivateSampleNames();
await testStrictModeRejectsOccupiedPorts();
await testAttachExistingReusesHealthyServices();
await testAttachExistingRejectsUnhealthyOccupiedPorts();
await testAttachExistingRejectsStaleBackend();
await testAttachExistingRejectsStaleFrontend();
await testAttachExistingRejectsUnverifiableFrontend();
await testAttachExistingReusesHealthyModelServices();
await testAttachExistingKeepsHasTextVllmContractWhenServerPathIsSet();
await testAttachExistingRetriesTransientModelHealthTimeout();
await testAttachExistingRejectsWrongVlmService();
await testAttachExistingRejectsWrongOcrService();
await testAttachExistingRejectsWrongVisionService();
await testAttachExistingRejectsWrongNerService();
await testFirstRunPrintsReproduciblePath();
await testDoctorJsonAndStrictMode();
await testDoctorWarnsUnsupportedNodeMajor();
await testDoctorReportsExternalHasTextServer();
await testHasTextServerDoctorCommandPreview();
await testDoctorWarnsUnreadableTokenFile();
await testDoctorWarnsEmptyTokenFile();
await testDoctorAuthDisabledDoesNotReadTokenFile();
await testDoctorWarnsUnauthenticatedToken();
await testDoctorAcceptsAuthenticatedTokenWithoutPrintingIt();
await testDoctorUsesDefaultEvalTokenFile();

console.log('dev attach tests passed');
