#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-public-visual-'));
const python = process.platform === 'win32' ? 'python.exe' : 'python';

function spawnText(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeout ?? 60_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function withServer(handler) {
  const server = http.createServer(handler);
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

try {
  const fixturePath = path.join(tmpDir, 'sample-visual.png');
  const createResult = spawnSync(
    python,
    ['scripts/create-eval-visual-fixture.py', fixturePath],
    { cwd: rootDir, encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(createResult.status, 0, `${createResult.stdout}\n${createResult.stderr}`);
  assert.match(createResult.stdout, /visual fixture:/);

  const outDir = path.join(tmpDir, 'vision-direct');
  const evalResult = spawnSync(
    python,
    [
      'scripts/eval-vision-direct.py',
      fixturePath,
      outDir,
      '--ocr-mode',
      'off',
      '--skip-has-image',
      '--write-pages',
      '--max-warnings',
      '-1',
      '--min-total-visual-regions',
      '1',
      '--min-page-visual-regions',
      '1',
    ],
    { cwd: rootDir, encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(evalResult.status, 0, `${evalResult.stdout}\n${evalResult.stderr}`);
  assert.match(evalResult.stdout, /quality=pass/);

  const summary = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
  const report = await readFile(path.join(outDir, 'report.html'), 'utf8');
  assert.equal(summary.page_count, 1);
  assert.equal(summary.total_visual_regions >= 1, true);
  assert.equal(summary.quality_gate.passed, true);
  assert(
    summary.pages[0].regions.some((region) => region.source === 'red_seal_fallback'),
    JSON.stringify(summary.pages[0].regions),
  );
  assert.match(report, /Direct Vision Evaluation/);
  assert.match(report, /PASS/);
  assert.match(report, /page-01-vision\.png/);

  const ocrServer = await withServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/structure') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'not found' }));
      return;
    }
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          boxes: [
            {
              text: 'Synthetic Procurement Contract',
              x: 0.08,
              y: 0.07,
              width: 0.62,
              height: 0.08,
              confidence: 0.95,
              label: 'text',
            },
          ],
        }),
      );
    });
  });
  const hasImageServer = await withServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/detect') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'not found' }));
      return;
    }
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          boxes: [
            {
              x: 0.64,
              y: 0.28,
              width: 0.22,
              height: 0.26,
              category: 'official_seal',
              confidence: 0.9,
            },
          ],
        }),
      );
    });
  });

  try {
    const serviceDir = path.join(tmpDir, 'vision-direct-services');
    const serviceEval = await spawnText(
      python,
      [
        'scripts/eval-vision-direct.py',
        fixturePath,
        serviceDir,
        '--ocr-base-url',
        ocrServer.baseUrl,
        '--has-image-base-url',
        hasImageServer.baseUrl,
        '--ocr-mode',
        'structure',
        '--write-pages',
        '--max-warnings',
        '-1',
        '--min-total-visual-regions',
        '1',
        '--min-page-visual-regions',
        '1',
        '--min-total-has-image-regions',
        '1',
      ],
      { cwd: rootDir, env: process.env, timeout: 30_000 },
    );
    assert.equal(serviceEval.status, 0, `${serviceEval.stdout}\n${serviceEval.stderr}`);
    assert.match(serviceEval.stdout, /has_image=1/);
    assert.match(serviceEval.stdout, /quality=pass/);
    const serviceSummary = JSON.parse(await readFile(path.join(serviceDir, 'summary.json'), 'utf8'));
    assert.equal(serviceSummary.total_has_image_regions, 1);
    assert.equal(serviceSummary.ocr_text_filter.diagnostic_by_source.ocr_structure, 1);
    assert.equal(serviceSummary.pages[0].ocr_diagnostic_regions[0].source, 'ocr_structure');
    assert.equal(serviceSummary.pages[0].by_source.has_image, 1);
    assert.equal(serviceSummary.quality_gate.passed, true);
  } finally {
    await ocrServer.close();
    await hasImageServer.close();
  }
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('public visual fixture tests passed');
