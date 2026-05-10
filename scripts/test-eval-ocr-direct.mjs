#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-ocr-'));

async function withServer(handler, test) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await test(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
  const imagePath = path.join(tmpDir, 'ocr-smoke.png');
  const makeImage = spawnSync(
    process.platform === 'win32' ? 'python.exe' : 'python',
    [
      '-c',
      [
        'from PIL import Image, ImageDraw',
        'img=Image.new("RGB",(640,480),"white")',
        'd=ImageDraw.Draw(img)',
        'd.text((40,80),"Contract No: HT-2026-001",fill=(0,0,0))',
        `img.save(${JSON.stringify(imagePath)})`,
      ].join(';'),
    ],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(makeImage.status, 0, `${makeImage.stdout}\n${makeImage.stderr}`);

  let sawImagePayload = false;
  await withServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/structure') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'not found' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const payload = JSON.parse(body);
      sawImagePayload = typeof payload.image === 'string' && payload.image.length > 100;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          elapsed: 0.12,
          boxes: [
            {
              text: 'Contract No: HT-2026-001',
              x: 0.1,
              y: 0.2,
              width: 0.5,
              height: 0.08,
              confidence: 0.98,
              label: 'text',
            },
            {
              text: '[seal]',
              x: 0.72,
              y: 0.18,
              width: 0.12,
              height: 0.12,
              confidence: 0.91,
              label: 'seal',
            },
          ],
        }),
      );
    });
  }, async (baseUrl) => {
    const result = await spawnText(
      process.platform === 'win32' ? 'python.exe' : 'python',
      [
        'scripts/eval-ocr-direct.py',
        imagePath,
        tmpDir,
        '--base-url',
        baseUrl,
        '--pages',
        '1 1',
        '--write-pages',
      ],
      { cwd: rootDir, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /boxes=2/);
    assert.match(result.stdout, /review_items=1/);
  });

  assert.equal(sawImagePayload, true);
  const summary = JSON.parse(await readFile(path.join(tmpDir, 'summary.json'), 'utf8'));
  const report = await readFile(path.join(tmpDir, 'report.html'), 'utf8');
  const pageBoxes = JSON.parse(await readFile(path.join(tmpDir, 'page-01-structure.json'), 'utf8'));
  assert.equal(summary.page_count, 1);
  assert.deepEqual(summary.selected_pages, [1]);
  assert.equal(summary.total_boxes, 2);
  assert.equal(summary.total_chars, 'Contract No: HT-2026-001[seal]'.length);
  assert.equal(summary.quality_gate.passed, true);
  assert.equal(summary.quality_gate.total_boxes, 2);
  assert.deepEqual(summary.endpoints, ['structure']);
  assert.equal(summary.warnings.length, 1);
  assert.equal(summary.review_items.length, 1);
  assert.deepEqual(summary.pages[0].results[0].visual_labels, { seal: 1 });
  assert.equal(summary.pages[0].results[0].overlay_image, 'page-01-structure.png');
  assert.equal(pageBoxes[0].text, 'Contract No: HT-2026-001');
  assert.equal(pageBoxes[1].label, 'seal');
  await access(path.join(tmpDir, 'page-01-structure.png'));
  assert.match(report, /Direct OCR Evaluation/);
  assert.match(report, /Quality Gate/);
  assert.match(report, /PASS/);
  assert.match(report, /href="#page-01"/);
  assert.match(report, /Review Items/);
  assert.match(report, /visual OCR labels detected/);
  assert.match(report, /page-01-structure\.png/);
  assert.match(report, /Contract No: HT-2026-001/);

  await withServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/ocr') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'not found' }));
      return;
    }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          boxes: [
            {
              text: '<table>' + 'Amount 1684000 '.repeat(28) + '</table>',
              x: 0.08,
              y: 0.16,
              width: 0.86,
              height: 0.62,
              confidence: 0.88,
              label: 'table',
            },
            {
              text: '[seal]',
              x: 0.68,
              y: 0.74,
              width: 0.18,
              height: 0.16,
              confidence: 0.91,
              label: 'seal',
            },
          ],
        }),
      );
    });
  }, async (baseUrl) => {
    const result = await spawnText(
      process.platform === 'win32' ? 'python.exe' : 'python',
      [
        'scripts/eval-ocr-direct.py',
        imagePath,
        tmpDir,
        '--base-url',
        baseUrl,
        '--mode',
        'vl',
        '--pages',
        '1',
      ],
      { cwd: rootDir, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  const coarseSummary = JSON.parse(await readFile(path.join(tmpDir, 'summary.json'), 'utf8'));
  assert(
    coarseSummary.warnings.some((item) => item.includes('coarse table layout')),
    JSON.stringify(coarseSummary.warnings),
  );
  assert(
    coarseSummary.warnings.some((item) => item.includes('very large table box')),
    JSON.stringify(coarseSummary.warnings),
  );
  assert.equal(coarseSummary.quality_gate.passed, true);

  await withServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/structure') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'not found' }));
      return;
    }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ boxes: [] }));
    });
  }, async (baseUrl) => {
    const failDir = path.join(tmpDir, 'zero-box-fail');
    const result = await spawnText(
      process.platform === 'win32' ? 'python.exe' : 'python',
      [
        'scripts/eval-ocr-direct.py',
        imagePath,
        failDir,
        '--base-url',
        baseUrl,
        '--mode',
        'structure',
      ],
      { cwd: rootDir, encoding: 'utf8' },
    );
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /quality=fail/);
    assert.match(result.stderr, /quality gate failed: total boxes 0 < 1/);
    const failSummary = JSON.parse(await readFile(path.join(failDir, 'summary.json'), 'utf8'));
    assert.equal(failSummary.quality_gate.passed, false);
    assert.equal(failSummary.quality_gate.total_boxes, 0);
  });
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval OCR direct tests passed');
