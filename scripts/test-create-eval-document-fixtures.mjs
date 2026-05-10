#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonBin = resolvePythonBin();
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-fixtures-contract-'));

function venvPython(venvDir) {
  return path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

function resolvePythonBin() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const configuredVenv = process.env.VENV_DIR ? path.resolve(process.env.VENV_DIR) : null;
  const candidates = [
    configuredVenv ? venvPython(configuredVenv) : null,
    venvPython(path.join(rootDir, '.venv')),
    venvPython(path.join(rootDir, 'backend/.venv')),
  ].filter(Boolean);
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing) return existing;
  return process.platform === 'win32' ? 'python.exe' : 'python3';
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
  const args = ['scripts/create-eval-document-fixtures.py', tmpDir];
  const [first, second] = await Promise.all([
    spawnText(pythonBin, args, { cwd: rootDir, env: process.env }),
    spawnText(pythonBin, args, { cwd: rootDir, env: process.env }),
  ]);

  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.match(first.stdout, /document fixtures:/);
  assert.match(second.stdout, /document fixtures:/);

  const docx = await stat(path.join(tmpDir, 'sample-redaction.docx'));
  const pdf = await stat(path.join(tmpDir, 'sample-redaction.pdf'));
  assert.equal(docx.size > 0, true);
  assert.equal(pdf.size > 0, true);

  await assert.rejects(readFile(path.join(tmpDir, '.create-eval-document-fixtures.lock')));
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('create eval document fixtures tests passed');
