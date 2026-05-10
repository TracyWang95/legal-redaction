#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-text-direct-'));

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
  const inputPath = path.join(tmpDir, 'sample.txt');
  await writeFile(
    inputPath,
    [
      'Vendor contact: privacy@example.test',
      'Mobile: 13800138000',
      'Backup phone: 010-87654321',
    ].join('\n'),
    'utf8',
  );

  const passOutDir = path.join(tmpDir, 'out-pass');
  const passResult = await spawnText(
    'python',
    ['scripts/eval-text-direct.py', inputPath, passOutDir],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVAL_TEXT_DIRECT_TYPES: 'EMAIL,PHONE',
      },
    },
  );
  assert.equal(passResult.status, 0, `${passResult.stdout}\n${passResult.stderr}`);
  assert.match(passResult.stdout, /quality=pass/);
  const passSummary = JSON.parse(await readFile(path.join(passOutDir, 'summary.json'), 'utf8'));
  assert.equal(passSummary.quality_gate.passed, true);
  assert.equal(passSummary.quality_gate.thresholds.min_entities, 1);
  assert.ok(passSummary.entity_count >= 2);
  assert.ok(passSummary.entity_summary.EMAIL >= 1);
  assert.ok(passSummary.entity_summary.PHONE >= 1);

  const strictOutDir = path.join(tmpDir, 'out-strict');
  const strictResult = await spawnText(
    'python',
    ['scripts/eval-text-direct.py', inputPath, strictOutDir],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVAL_TEXT_DIRECT_TYPES: 'EMAIL,PHONE',
        EVAL_TEXT_DIRECT_MIN_ENTITIES: '10',
      },
    },
  );
  assert.notEqual(strictResult.status, 0, `${strictResult.stdout}\n${strictResult.stderr}`);
  assert.match(strictResult.stdout, /quality=fail/);
  assert.match(strictResult.stderr, /entity count \d+ < 10/);
  const strictSummary = JSON.parse(await readFile(path.join(strictOutDir, 'summary.json'), 'utf8'));
  assert.equal(strictSummary.quality_gate.passed, false);

  const htmlInputPath = path.join(tmpDir, 'sample.html');
  await writeFile(htmlInputPath, '<main><p>Email: ops@example.test</p><p>Phone: 13900139000</p></main>', 'utf8');
  const htmlOutDir = path.join(tmpDir, 'out-html');
  const htmlResult = await spawnText(
    'python',
    ['scripts/eval-text-direct.py', htmlInputPath, htmlOutDir],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVAL_TEXT_DIRECT_TYPES: 'EMAIL,PHONE',
      },
    },
  );
  assert.equal(htmlResult.status, 0, `${htmlResult.stdout}\n${htmlResult.stderr}`);
  const htmlContent = await readFile(path.join(htmlOutDir, 'content.txt'), 'utf8');
  assert.match(htmlContent, /ops@example\.test/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval text direct tests passed');
