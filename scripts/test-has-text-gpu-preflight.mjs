#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function withServer(handler, test) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await test(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function healthyHasText(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/v1/models') {
    return sendJson(res, 200, {
      object: 'list',
      data: [{ id: 'temporary-cpu-HaS-Text' }],
    });
  }
  return sendJson(res, 404, { detail: 'not found' });
}

function runPreflight(env, args = [], timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/has-text-gpu-preflight.mjs', ...args], {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`preflight timed out. stdout=${stdout} stderr=${stderr}`));
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

async function testDryRunReportsListenerHealthConfigAndBusyGpu() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-has-text-gpu-preflight-'));
  try {
    const fakeServer = path.join(tmpDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    const fakeModel = path.join(tmpDir, 'HaS_Text_0209_0.6B_Q4_K_M.gguf');
    await writeFile(fakeServer, '#!/bin/sh\n', 'utf8');
    await writeFile(fakeModel, 'fake model placeholder', 'utf8');

    await withServer(healthyHasText, async (port) => {
      const result = await runPreflight({
        HAS_TEXT_PORT: String(port),
        HAS_TEXT_SERVER_BIN: fakeServer,
        HAS_TEXT_MODEL_PATH_FOR_SERVER: fakeModel,
        HAS_TEXT_DEVICE: 'Vulkan1',
        HAS_TEXT_N_GPU_LAYERS: '-1',
        HAS_TEXT_GPU_PREFLIGHT_GPU_MOCK: 'busy',
      });
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /mode: dry-run \(no kill, no start, no model load\)/);
      assert.match(result.output, /listener: pid|listener: none detected/);
      assert.match(result.output, /health models: temporary-cpu-HaS-Text/);
      assert.match(result.output, /ok\s+HAS_TEXT_SERVER_BIN exists/);
      assert.match(result.output, /HAS_TEXT_DEVICE: Vulkan1/);
      assert.match(result.output, /HAS_TEXT_N_GPU_LAYERS: -1/);
      assert.match(result.output, /gpu processes:/);
      assert.match(result.output, /ModelWorker/);
      assert.match(result.output, /GPU decision: busy; do not switch HaS Text to GPU now\./);
      assert.match(result.output, /runtime expectation: cuda-gpu/);
      assert.match(result.output, /runtime policy: gpu \(provider: vulkan\)/);
      assert.match(result.output, /external llama-server command preview:/);
      assert.match(result.output, /-ngl -1/);
      assert.match(result.output, /--device/);
      assert.match(result.output, /Vulkan1/);
      assert.match(result.output, /dry-run guard: this script did not stop 8080 and did not start llama-server\./);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testStrictFailsWhenGpuBusy() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-has-text-gpu-preflight-'));
  try {
    const fakeServer = path.join(tmpDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    const fakeModel = path.join(tmpDir, 'HaS_Text_0209_0.6B_Q4_K_M.gguf');
    await writeFile(fakeServer, '#!/bin/sh\n', 'utf8');
    await writeFile(fakeModel, 'fake model placeholder', 'utf8');

    await withServer(healthyHasText, async (port) => {
      const result = await runPreflight({
        HAS_TEXT_PORT: String(port),
        HAS_TEXT_SERVER_BIN: fakeServer,
        HAS_TEXT_MODEL_PATH_FOR_SERVER: fakeModel,
        HAS_TEXT_GPU_PREFLIGHT_GPU_MOCK: 'busy',
      }, ['--strict']);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /GPU decision: busy/);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testStrictFailsWhenCpuFallbackRiskDetected() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-has-text-gpu-preflight-cpu-'));
  try {
    const fakeServer = path.join(tmpDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    const fakeModel = path.join(tmpDir, 'HaS_Text_0209_0.6B_Q4_K_M.gguf');
    await writeFile(fakeServer, '#!/bin/sh\n', 'utf8');
    await writeFile(fakeModel, 'fake model placeholder', 'utf8');

    await withServer(healthyHasText, async (port) => {
      const result = await runPreflight({
        HAS_TEXT_PORT: String(port),
        HAS_TEXT_SERVER_BIN: fakeServer,
        HAS_TEXT_MODEL_PATH_FOR_SERVER: fakeModel,
        HAS_TEXT_DEVICE: 'cpu',
        HAS_TEXT_N_GPU_LAYERS: '0',
        HAS_TEXT_GPU_PREFLIGHT_GPU_MOCK: 'idle',
      }, ['--strict']);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /runtime warning: HAS_TEXT_N_GPU_LAYERS=0 disables GPU offload; HAS_TEXT_DEVICE targets CPU/);
      assert.match(result.output, /warn Has Text runtime policy aims CUDA\/GPU/);
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testExecuteFlagIsRejectedBeforeAnyAction() {
  const result = await runPreflight({
    HAS_TEXT_PORT: '19580',
    HAS_TEXT_GPU_PREFLIGHT_SKIP_GPU: '1',
  }, ['--execute']);
  assert.equal(result.code, 2, result.output);
  assert.match(result.output, /--execute is intentionally unsupported/);
}

await testDryRunReportsListenerHealthConfigAndBusyGpu();
await testStrictFailsWhenGpuBusy();
await testStrictFailsWhenCpuFallbackRiskDetected();
await testExecuteFlagIsRejectedBeforeAnyAction();

console.log('has text gpu preflight tests passed');
