#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-evidence-manifest-'));

try {
  const artifactDir = path.join(tmpDir, 'live-ui-private');
  const outPath = path.join(tmpDir, 'manifest.json');
  const privatePath = (...parts) => path.win32.join(`C:${path.win32.sep}`, 'private-corpus', ...parts);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, 'summary.json'),
    JSON.stringify({
      passed: true,
      out_dir: path.join('output', 'playwright', 'live-ui-ceshi-current'),
      single: {
        image: privatePath('input-01.png'),
        box_count: 3,
      },
      batch: {
        files: [privatePath('input-02.docx'), privatePath('input-03.pdf')],
        elapsed_ms: 1234,
      },
      performance_context: {
        batch: {
          pdf_recognition: [
            {
              label: 'pdf-evidence',
              recognition_duration_ms: 4000,
              private_debug_path: privatePath('input-03.pdf'),
              cache: { state: 'warm_cache_hit_observed' },
              page_parallelism: {
                page_concurrency_effective: 2,
                page_concurrency_configured: 2,
                page_duration_sum_ms: 6100,
                recognition_wall_clock_ms: 4000,
                page_sum_to_wall_clock_ratio: 1.53,
                observed_parallelism: 'parallel_overlap_observed',
              },
            },
          ],
        },
      },
    }),
    'utf8',
  );
  await writeFile(path.join(artifactDir, 'report.html'), '<html>ok</html>', 'utf8');

  const result = spawnSync(
    process.execPath,
    ['scripts/create-eval-evidence-manifest.mjs', '--out', outPath, artifactDir],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /evidence manifest:/);

  const manifest = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(manifest.privacy.private_inputs_read, false);
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].files.length, 2);
  assert.equal(manifest.artifacts[0].summary.passed, true);
  assert.equal(manifest.artifacts[0].summary.single.box_count, 3);
  assert.equal(manifest.artifacts[0].summary.single.image, undefined);
  assert.equal(manifest.artifacts[0].summary.out_dir, undefined);
  assert.equal(typeof manifest.artifacts[0].summary.out_dir_sha256, 'string');
  assert.equal(typeof manifest.artifacts[0].summary.single.image_sha256, 'string');
  assert.equal(manifest.artifacts[0].summary.batch.file_count, 2);
  assert.equal(typeof manifest.artifacts[0].summary.batch.files_sha256, 'string');
  assert.equal(
    manifest.artifacts[0].summary.performance_context.batch.pdf_recognition[0].page_parallelism.page_duration_sum_ms,
    6100,
  );
  assert.equal(
    manifest.artifacts[0].summary.performance_context.batch.pdf_recognition[0].page_parallelism.observed_parallelism,
    'parallel_overlap_observed',
  );
  assert.equal(
    typeof manifest.artifacts[0].summary.performance_context.batch.pdf_recognition[0].private_debug_path_sha256,
    'string',
  );
  assert.equal(
    manifest.artifacts[0].summary.performance_context.batch.pdf_recognition[0].private_debug_path,
    undefined,
  );
  assert.doesNotMatch(JSON.stringify(manifest), /private-corpus|input-0[123]\.(png|docx|pdf)|ceshi|[A-Z]:\\\\/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('create-eval-evidence-manifest tests passed');
