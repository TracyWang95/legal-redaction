#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const result = await spawnText(
  process.execPath,
  ['scripts/quality-local.mjs', '--dry-run'],
  { cwd: rootDir, env: process.env },
);

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /local quality gate: dry run/);
assert.match(result.stdout, /scripts\/check-i18n\.mjs/);
assert.match(result.stdout, /scripts\/test-docs-contract\.mjs/);
assert.match(result.stdout, /scripts\/test-create-eval-document-fixtures\.mjs/);
assert.match(result.stdout, /scripts\/test-create-model-provenance-manifest\.mjs/);
assert.match(result.stdout, /scripts\/test-release-readiness-report\.mjs/);
assert.match(result.stdout, /scripts\/test-has-text-gpu-preflight\.mjs/);
assert.match(result.stdout, /scripts\/test-ui-browser-contract\.mjs/);
assert.match(result.stdout, /scripts\/test-dev-attach\.mjs/);
assert.match(result.stdout, /scripts\/test-frontend-batch-review\.mjs/);
assert.match(result.stdout, /backend-vision-contracts/);
assert.match(result.stdout, /cd backend && .*pytest .*tests\/test_vision_ocr_pipeline\.py/);
assert.match(result.stdout, /tests\/test_type_mapping\.py/);
assert.match(result.stdout, /tests\/test_has_image_categories_contract\.py/);
assert.match(result.stdout, /tests\/test_warmup_models\.py/);
assert.match(result.stdout, /scripts\/test-eval-public\.mjs/);
assert.match(result.stdout, /scripts\/test-eval-batch-e2e\.mjs/);
assert.match(result.stdout, /scripts\/test-eval-ceshi\.mjs/);
assert.match(result.stdout, /scripts\/test-eval-ceshi-perf\.mjs/);
assert.match(result.stdout, /script\/unit-style checks and public\/temp fixtures only/);
assert.match(result.stdout, /no private corpus real-file or wrapper diagnostics gate/);
assert.match(result.stdout, /no model or GPU services by default/);
assert.match(result.stdout, /npm run quality:frontend/);
assert.match(result.stdout, /npm run quality:backend/);
assert.match(result.stdout, /npm run quality:full/);
assert.doesNotMatch(result.stdout, /npm run eval:ceshi --/);
assert.doesNotMatch(result.stdout, /eval-ceshi\.mjs --diagnostics/);
assert.doesNotMatch(result.stdout, /EVAL_BATCH_USE_LOCAL_CESHI=1/);

const optionalResult = await spawnText(
  process.execPath,
  ['scripts/quality-local.mjs', '--dry-run', '--with-frontend-build', '--with-backend-pytest'],
  { cwd: rootDir, env: process.env },
);

assert.equal(optionalResult.status, 0, `${optionalResult.stdout}\n${optionalResult.stderr}`);
assert.match(optionalResult.stdout, /cd frontend && .*npm(?:\.cmd)? run build/);
assert.match(optionalResult.stdout, /cd backend && .*pytest .*tests\/test_auth_api\.py/);

console.log('quality local tests passed');
