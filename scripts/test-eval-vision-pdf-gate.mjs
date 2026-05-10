#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-vision-gate-'));

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

try {
  const inputPath = path.join(tmpDir, 'one-page.png');
  await writeFile(inputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'binary');

  const state = { mode: 'visual', uploadCount: 0, pageCount: 1, requestedPages: [] };
  const png1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: false, authenticated: true, password_set: null });
    }
    if (req.method === 'GET' && url.pathname === '/health/services') {
      return sendJson(res, 200, { all_online: true, services: {}, probe_ms: 1 });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/vision-pipelines') {
      return sendJson(res, 200, [
        { mode: 'ocr_has', enabled: true, types: [{ id: 'seal_text', enabled: true }] },
        { mode: 'has_image', enabled: true, types: [{ id: 'official_seal', enabled: true }] },
      ]);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/files/upload') {
      req.on('data', () => {});
      req.on('end', () => {
        state.uploadCount += 1;
        sendJson(res, 200, {
          file_id: `file-${state.uploadCount}`,
          file_type: 'image',
          page_count: state.pageCount,
        });
      });
      return;
    }
    const parseMatch = url.pathname.match(/^\/api\/v1\/files\/([^/]+)\/parse$/);
    if (req.method === 'GET' && parseMatch) {
      return sendJson(res, 200, { file_id: parseMatch[1], page_count: state.pageCount });
    }
    const visionMatch = url.pathname.match(/^\/api\/v1\/redaction\/([^/]+)\/vision$/);
    if (req.method === 'POST' && visionMatch) {
      req.on('data', () => {});
      req.on('end', () => {
        state.requestedPages.push(Number(url.searchParams.get('page') || 0));
        sendJson(res, 200, {
          bounding_boxes: state.mode === 'empty'
            ? []
            : state.mode === 'text'
              ? [
                  {
                    id: 'box-1',
                    x: 0.1,
                    y: 0.1,
                    width: 0.2,
                    height: 0.1,
                    page: 1,
                    type: 'PERSON',
                    source: 'ocr_has',
                  },
                ]
              : [
                {
                  id: 'box-1',
                  x: 0.1,
                  y: 0.1,
                  width: 0.2,
                  height: 0.1,
                  page: 1,
                  type: 'official_seal',
                  source: 'has_image',
                },
              ],
          result_image: png1x1,
        });
      });
      return;
    }
    sendJson(res, 404, { detail: `not found: ${req.method} ${url.pathname}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const passOutDir = path.join(tmpDir, 'out-pass');
    const passResult = await spawnText(
      process.execPath,
      ['scripts/eval-vision-pdf.mjs', inputPath, passOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_REDACTION_PREVIEW: 'false',
        },
      },
    );
    assert.equal(passResult.status, 0, `${passResult.stdout}\n${passResult.stderr}`);
    assert.match(passResult.stdout, /quality=pass/);
    const passSummary = JSON.parse(await readFile(path.join(passOutDir, 'summary.json'), 'utf8'));
    assert.equal(passSummary.quality_gate.passed, true);
    assert.equal(passSummary.quality_gate.total_boxes, 1);
    assert.equal(passSummary.quality_gate.total_visual_boxes, 1);
    assert.equal(passSummary.quality_gate.total_has_image_boxes, 1);

    state.mode = 'visual';
    state.pageCount = 3;
    state.requestedPages = [];
    const pagesOutDir = path.join(tmpDir, 'out-pages');
    const pagesResult = await spawnText(
      process.execPath,
      ['scripts/eval-vision-pdf.mjs', inputPath, pagesOutDir, '--pages', '1', '3'],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_REDACTION_PREVIEW: 'false',
        },
      },
    );
    assert.equal(pagesResult.status, 0, `${pagesResult.stdout}\n${pagesResult.stderr}`);
    assert.deepEqual(state.requestedPages, [1, 3]);
    const pagesSummary = JSON.parse(await readFile(path.join(pagesOutDir, 'summary.json'), 'utf8'));
    assert.deepEqual(pagesSummary.selected_pages, [1, 3]);
    assert.equal(pagesSummary.page_count, 3);
    assert.equal(pagesSummary.evaluated_page_count, 2);
    assert.equal(pagesSummary.quality_gate.expected_pages, 2);
    assert.equal(pagesSummary.quality_gate.total_boxes, 2);
    assert.equal(pagesSummary.quality_gate.total_has_image_boxes, 2);

    state.mode = 'empty';
    state.pageCount = 1;
    const failOutDir = path.join(tmpDir, 'out-fail');
    const failResult = await spawnText(
      process.execPath,
      ['scripts/eval-vision-pdf.mjs', inputPath, failOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_REDACTION_PREVIEW: 'false',
        },
      },
    );
    assert.notEqual(failResult.status, 0, `${failResult.stdout}\n${failResult.stderr}`);
    assert.match(failResult.stdout, /quality=fail/);
    assert.match(failResult.stderr, /total boxes 0 < 1/);
    assert.match(failResult.stderr, /page 1 boxes 0 < 1/);
    const failSummary = JSON.parse(await readFile(path.join(failOutDir, 'summary.json'), 'utf8'));
    assert.equal(failSummary.quality_gate.passed, false);
    assert.equal(failSummary.quality_gate.total_boxes, 0);
    const failReport = await readFile(path.join(failOutDir, 'report.html'), 'utf8');
    assert.match(failReport, /质量门槛/);
    assert.match(failReport, /FAIL/);
    assert.match(failReport, /total boxes 0 &lt; 1/);
    assert.match(failReport, /href="#page-01"/);

    state.mode = 'text';
    state.pageCount = 1;
    const visualFailOutDir = path.join(tmpDir, 'out-visual-fail');
    const visualFailResult = await spawnText(
      process.execPath,
      ['scripts/eval-vision-pdf.mjs', inputPath, visualFailOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_REDACTION_PREVIEW: 'false',
          EVAL_VISION_MIN_TOTAL_VISUAL_BOXES: '1',
        },
      },
    );
    assert.notEqual(visualFailResult.status, 0, `${visualFailResult.stdout}\n${visualFailResult.stderr}`);
    assert.match(visualFailResult.stdout, /quality=fail/);
    assert.match(visualFailResult.stderr, /total visual boxes 0 < 1/);
    const visualFailSummary = JSON.parse(await readFile(path.join(visualFailOutDir, 'summary.json'), 'utf8'));
    assert.equal(visualFailSummary.quality_gate.passed, false);
    assert.equal(visualFailSummary.quality_gate.total_boxes, 1);
    assert.equal(visualFailSummary.quality_gate.total_visual_boxes, 0);
    assert.equal(visualFailSummary.quality_gate.total_has_image_boxes, 0);

    const hasImageFailOutDir = path.join(tmpDir, 'out-has-image-fail');
    const hasImageFailResult = await spawnText(
      process.execPath,
      ['scripts/eval-vision-pdf.mjs', inputPath, hasImageFailOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_REDACTION_PREVIEW: 'false',
          EVAL_VISION_MIN_TOTAL_HAS_IMAGE_BOXES: '1',
        },
      },
    );
    assert.notEqual(hasImageFailResult.status, 0, `${hasImageFailResult.stdout}\n${hasImageFailResult.stderr}`);
    assert.match(hasImageFailResult.stdout, /quality=fail/);
    assert.match(hasImageFailResult.stderr, /total HaS Image boxes 0 < 1/);
    const hasImageFailSummary = JSON.parse(await readFile(path.join(hasImageFailOutDir, 'summary.json'), 'utf8'));
    assert.equal(hasImageFailSummary.quality_gate.passed, false);
    assert.equal(hasImageFailSummary.quality_gate.total_boxes, 1);
    assert.equal(hasImageFailSummary.quality_gate.total_has_image_boxes, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval vision PDF gate tests passed');
