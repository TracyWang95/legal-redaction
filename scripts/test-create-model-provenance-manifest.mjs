#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runManifest(args) {
  return spawnSync(process.execPath, ['scripts/create-model-provenance-manifest.mjs', ...args], {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

async function testManifestIncludesHashesAndNoAbsolutePaths() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-model-provenance-'));
  try {
    const modelsDir = path.join(tmpDir, 'private-models');
    const outPath = path.join(tmpDir, 'manifest.json');
    await mkdir(modelsDir, { recursive: true });

    await writeFile(path.join(modelsDir, 'HaS_Text_0209_0.6B_Q4_K_M.gguf'), 'has text model', 'utf8');
    await writeFile(path.join(modelsDir, 'sensitive_seg_best.pt'), 'has image model', 'utf8');
    await writeFile(path.join(modelsDir, 'GLM-4.6V-Flash-Q4_K_M.gguf'), 'vlm model', 'utf8');
    await writeFile(path.join(modelsDir, 'mmproj-F16.gguf'), 'mmproj model', 'utf8');
    await writeFile(path.join(modelsDir, 'unrelated.bin'), 'ignore me', 'utf8');

    const result = runManifest(['--out', outPath, '--models-dir', modelsDir]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /models=4 found=4 required_missing=0/);

    const manifestText = await readFile(outPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.privacy.absolutePathsIncluded, false);
    assert.equal(manifest.summary.modelCount, 4);
    assert.deepEqual(manifest.summary.requiredMissing, []);

    const hasText = manifest.models.find((model) => model.basename === 'HaS_Text_0209_0.6B_Q4_K_M.gguf');
    assert.equal(hasText.role, 'has_text');
    assert.equal(hasText.requirement, 'required');
    assert.equal(hasText.required, true);
    assert.equal(hasText.sizeBytes, Buffer.byteLength('has text model'));
    assert.equal(hasText.sha256, sha256('has text model'));
    assert.equal(hasText.upstream.repo, 'xuanwulab/HaS_4.0_0.6B_GGUF');
    assert.equal(hasText.upstream.revision, '39a643aa8f19ad6c324fe96dacb1fc292fbe6095');
    assert.equal(hasText.upstream.revisionSource, 'huggingface-api');
    assert.equal(hasText.upstream.revisionCheckedAt, '2026-05-06');
    assert.equal(hasText.upstream.license, 'MIT');
    assert.equal(hasText.upstream.sourceDoc, 'docs/MODEL_PROVENANCE.md');

    const mmproj = manifest.models.find((model) => model.basename === 'mmproj-F16.gguf');
    assert.equal(mmproj.role, 'vlm_mmproj');
    assert.equal(mmproj.requirement, 'optional');
    assert.equal(mmproj.required, false);
    assert.match(mmproj.upstream.url, /unsloth\/GLM-4\.6V-Flash-GGUF/);
    assert.equal(mmproj.upstream.revision, 'c78a0727cb5ee489db2f218a212f613943023ee8');
    assert.equal(mmproj.upstream.sourceDoc, 'docs/MODEL_PROVENANCE.md');

    assert.doesNotMatch(manifestText, /private-models/);
    assert.doesNotMatch(manifestText, /datainfra-model-provenance/);
    assert.doesNotMatch(manifestText, /[A-Za-z]:\\\\|\/tmp\/|\/var\/|\/mnt\/d\/has_models/);
    assert.doesNotMatch(manifestText, /unrelated\.bin/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testMissingRequiredArtifactsAreReportedWithoutPaths() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-model-provenance-empty-'));
  try {
    const modelsDir = path.join(tmpDir, 'empty-models');
    const outPath = path.join(tmpDir, 'manifest.json');
    await mkdir(modelsDir, { recursive: true });

    const result = runManifest(['--out', outPath, '--models-dir', modelsDir]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /required_missing=2/);

    const manifestText = await readFile(outPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.deepEqual(manifest.summary.requiredMissing, [
      'HaS_Text_0209_0.6B_Q4_K_M.gguf',
      'sensitive_seg_best.pt',
    ]);
    const missing = manifest.models.filter((model) => model.required && !model.found);
    assert.equal(missing.length, 2);
    assert.equal(missing[0].sizeBytes, null);
    assert.equal(missing[0].sha256, null);
    assert.doesNotMatch(manifestText, /empty-models/);
    assert.doesNotMatch(manifestText, /datainfra-model-provenance-empty/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

await testManifestIncludesHashesAndNoAbsolutePaths();
await testMissingRequiredArtifactsAreReportedWithoutPaths();

console.log('create-model-provenance-manifest tests passed');
