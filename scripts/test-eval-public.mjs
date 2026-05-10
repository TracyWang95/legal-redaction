#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-public-'));

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
  const outDir = path.join(tmpDir, 'public-gate');
  const result = await spawnText(
    process.execPath,
    ['scripts/eval-public.mjs', outDir],
    { cwd: rootDir, env: process.env },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /public gate: document-fixtures/);
  assert.match(result.stdout, /public gate: redaction-safety/);
  assert.match(result.stdout, /coverage: text_entities=\d+ visual_regions=\d+ redacted_exports=\d+/);
  assert.match(result.stdout, /quality=pass/);

  const summary = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
  assert.equal(summary.passed, true);
  assert.equal(summary.steps.length, 6);
  assert.equal(summary.steps.every((step) => step.passed), true);
  assert.equal(summary.coverage.passed, true);
  assert.equal(summary.coverage.totals.text_entities >= 1, true);
  assert.equal(summary.coverage.totals.visual_regions >= 1, true);
  assert.equal(summary.coverage.totals.redacted_exports, 2);
  assert.equal(summary.coverage.text.every((item) => item.passed && item.entity_count >= 1), true);
  assert.equal(summary.coverage.vision.passed, true);
  assert.equal(summary.coverage.vision.total_visual_regions >= 1, true);
  assert.equal(summary.coverage.vision.detector_contract.class_count, 21);
  assert.deepEqual(summary.coverage.vision.detector_contract.class_id_range, [0, 20]);
  assert.equal(summary.coverage.vision.detector_contract.model_source, 'has_image');
  assert.equal(summary.coverage.vision.detector_contract.model_slug_count, 21);
  assert.equal(summary.coverage.vision.overlays.every((item) => item.exists && item.bytes > 0), true);
  assert.equal(summary.coverage.redaction.passed, true);
  assert.equal(summary.coverage.redaction.exports.every((item) => item.passed && item.output.bytes > 0), true);

  const safety = JSON.parse(await readFile(path.join(outDir, 'redaction-safety', 'summary.json'), 'utf8'));
  assert.equal(safety.passed, true);
  assert.equal(safety.results.length, 2);
  assert.equal(safety.results.every((item) => item.leaked_originals.length === 0), true);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval public tests passed');
