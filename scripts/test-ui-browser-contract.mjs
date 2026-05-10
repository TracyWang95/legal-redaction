#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function runScript(args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/ui-browser-contract.mjs', ...args], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: '',
        UI_BROWSER_CONTRACT_OUT_DIR: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`ui-browser-contract timed out. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, output: `${stdout}${stderr}` });
    });
  });
}

async function testHelp() {
  const result = await runScript(['--help']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /1920x1080 UI contract/);
  assert.match(result.output, /Blocks upload, recognition, redaction, job submit, and inference/);
}

async function testDryRunWritesPlanWithoutBrowser() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-ui-contract-'));
  try {
    const result = await runScript([
      '--dry-run',
      '--base-url',
      'http://127.0.0.1:3000',
      '--out-dir',
      tmpDir,
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /browser=false upload=false recognition=false inference=false/);

    const plan = JSON.parse(await readFile(path.join(tmpDir, 'dry-run.json'), 'utf8'));
    assert.equal(plan.mode, 'dry-run');
    assert.equal(plan.base_url, 'http://127.0.0.1:3000');
    assert.equal(plan.out_dir, tmpDir);
    assert.equal(plan.mock_api, true);
    assert.equal(plan.no_gpu, true);
    assert.deepEqual(
      plan.routes.map((route) => route.path),
      ['/', '/single', '/batch', '/jobs', '/history', '/settings'],
    );
    assert.equal(plan.skipped_when_dry_run.recognition, true);
    assert.equal(plan.skipped_when_dry_run.inference, true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testPreflightExplainsOfflineFrontend() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-ui-contract-offline-'));
  try {
    const result = await runScript([
      '--preflight-only',
      '--base-url',
      'http://127.0.0.1:9',
      '--out-dir',
      tmpDir,
      '--timeout-ms',
      '250',
    ]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.stderr, /UI browser contract failed/);
    assert.match(result.stderr, /Frontend is not reachable at http:\/\/127\.0\.0\.1:9/);
    assert.match(result.stderr, /Start the frontend on port 3000/);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testViteProxyUsesIpv4BackendTarget() {
  const viteConfig = await readFile(path.join(ROOT_DIR, 'frontend', 'vite.config.ts'), 'utf8');
  assert.match(viteConfig, /target:\s*'http:\/\/127\.0\.0\.1:8000'/);
  assert.doesNotMatch(viteConfig, /target:\s*'http:\/\/localhost:8000'/);
}

await testHelp();
await testDryRunWritesPlanWithoutBrowser();
await testPreflightExplainsOfflineFrontend();
await testViteProxyUsesIpv4BackendTarget();

console.log('ui-browser-contract script tests passed');
