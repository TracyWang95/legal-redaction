#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.join(rootDir, 'frontend');
const vitestCli = path.join(frontendDir, 'node_modules', 'vitest', 'vitest.mjs');

const tests = [
  'src/features/playground/components/__tests__/playground-upload-config.test.tsx',
  'src/features/batch/lib/__tests__/review-navigation.test.ts',
  'src/features/batch/components/__tests__/review-page-risk-rail.test.tsx',
  'src/features/batch/lib/__tests__/batch-export-report.test.ts',
  'src/features/batch/components/__tests__/batch-step5-export.test.tsx',
];

const result = spawnSync(process.execPath, [vitestCli, 'run', ...tests], {
  cwd: frontendDir,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
