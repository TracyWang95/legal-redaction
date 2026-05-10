#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function spawnText(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/doctor-storage.mjs', ...args], {
      cwd: rootDir,
      env: process.env,
    });
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

const textResult = await spawnText(['--dry-run']);
assert.equal(textResult.status, 0, `${textResult.stdout}\n${textResult.stderr}`);
assert.match(textResult.stdout, /storage doctor: dry run fixture/);
assert.match(textResult.stdout, /scope: reports sizes only; no files are deleted or changed/);
assert.match(textResult.stdout, /C:/);
assert.match(textResult.stdout, /WSL ext4\.vhdx/);
assert.match(textResult.stdout, /Hugging Face cache/);
assert.match(textResult.stdout, /WSL uv cache/);
assert.match(textResult.stdout, /app venv/);
assert.match(textResult.stdout, /vLLM venv/);
assert.match(textResult.stdout, /Safe first targets: pip, npm, pnpm, uv, Hugging Face, Paddle\/PaddleX, Gemini, and Temp caches/);
assert.match(textResult.stdout, /Keep the current app venv and vLLM venv/);
assert.match(textResult.stdout, /Leave Codex and Claude application data alone/);
assert.match(textResult.stdout, /WSL VHD compaction interrupts running WSL shells/);

const jsonResult = await spawnText(['--dry-run', '--json']);
assert.equal(jsonResult.status, 0, `${jsonResult.stdout}\n${jsonResult.stderr}`);
const report = JSON.parse(jsonResult.stdout);
assert.equal(report.mode, 'dry-run');
assert.equal(report.disks[0].mount, 'C:');
assert.ok(report.wslVhdx.some((item) => item.path.endsWith('ext4.vhdx')));
assert.ok(report.caches.some((item) => item.label === 'Hugging Face cache'));
assert.ok(report.caches.some((item) => item.label === 'WSL uv cache'));
assert.ok(report.protected.some((item) => item.label === 'app venv'));
assert.ok(report.protected.some((item) => item.label === 'vLLM venv'));

console.log('doctor storage tests passed');
