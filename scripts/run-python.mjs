#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function venvPython(venvDir) {
  return path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

function resolvePythonBin() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = [];
  if (process.env.VENV_DIR) candidates.push(venvPython(process.env.VENV_DIR));
  candidates.push(venvPython(path.join(rootDir, '.venv')));
  candidates.push(venvPython(path.join(rootDir, 'backend', '.venv')));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-python.mjs <python-script-or-module> [...args]');
  process.exit(2);
}

const python = resolvePythonBin();
const result = spawnSync(python, args, {
  cwd: rootDir,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to start Python: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
