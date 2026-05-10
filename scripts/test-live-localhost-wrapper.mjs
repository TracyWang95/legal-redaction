#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const missingTokenPath = path.join(os.tmpdir(), 'datainfra-live-localhost-missing-token.txt');

function spawnText(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/test-live-localhost.mjs', ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        DATAINFRA_PASSWORD: '',
        DATAINFRA_TOKEN: '',
        DATAINFRA_TOKEN_FILE: '',
        DATAINFRA_LIVE_DEFAULT_TOKEN_FILE: missingTokenPath,
        PLAYWRIGHT_BASE_URL: '',
        PLAYWRIGHT_SKIP_WEBSERVER: '',
        ...env,
      },
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

function startMockLiveServer(authStatusHandler) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>mock live frontend</title>');
        return;
      }
      if (url.pathname === '/api/v1/auth/status') {
        const body = authStatusHandler(req);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('mock server did not bind to a TCP port'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

async function testDryRunDefaultsToLiveLocalhost() {
  const result = await spawnText(['--dry-run']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PLAYWRIGHT_SKIP_WEBSERVER=1/);
  assert.match(result.stdout, /PLAYWRIGHT_BASE_URL=http:\/\/127\.0\.0\.1:3000/);
  assert.match(result.stdout, new RegExp(`DEFAULT_DATAINFRA_TOKEN_FILE=${escapeRegExp(missingTokenPath)}`));
  assert.match(result.stdout, /DATAINFRA_TOKEN_FILE=\s*$/m);
  assert.match(result.stdout, /preflight_only=false/);
  assert.match(result.stdout, /@playwright[\\/]test[\\/]cli\.js test e2e\/live-localhost\.spec\.ts/);
}

async function testDryRunCanShowPreflightOnlyMode() {
  const result = await spawnText(['--dry-run', '--preflight']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /preflight_only=true/);
  assert.doesNotMatch(result.stdout, /e2e\/live-localhost\.spec\.ts --preflight/);
}

async function testDryRunUsesDefaultTokenFileWhenPresent() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-live-localhost-'));
  const tokenPath = path.join(tmpDir, 'token.txt');
  try {
    await writeFile(tokenPath, 'token', 'utf8');
    const result = await spawnText(['--dry-run'], {
      DATAINFRA_LIVE_DEFAULT_TOKEN_FILE: tokenPath,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`DATAINFRA_TOKEN_FILE=${escapeRegExp(tokenPath)}`));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testExplicitEnvAndArgsWin() {
  const explicitTokenPath = path.join(rootDir, 'explicit-token.txt');
  const result = await spawnText(['--dry-run', '--headed'], {
    PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3999',
    PLAYWRIGHT_SKIP_WEBSERVER: 'true',
    DATAINFRA_TOKEN_FILE: 'explicit-token.txt',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PLAYWRIGHT_SKIP_WEBSERVER=true/);
  assert.match(result.stdout, /PLAYWRIGHT_BASE_URL=http:\/\/127\.0\.0\.1:3999/);
  assert.match(result.stdout, new RegExp(`DATAINFRA_TOKEN_FILE=${escapeRegExp(explicitTokenPath)}`));
  assert.match(result.stdout, /e2e\/live-localhost\.spec\.ts --headed/);
}

async function testPreflightFailsForMissingExplicitTokenFile() {
  const missingToken = path.join(os.tmpdir(), 'datainfra-live-localhost-no-token.txt');
  const result = await spawnText([], {
    DATAINFRA_TOKEN_FILE: missingToken,
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Live localhost E2E preflight failed/);
  assert.match(result.stderr, /DATAINFRA_TOKEN_FILE is set/);
  assert.match(result.stderr, /cannot be used/);
}

async function testPreflightFailsWhenFrontendOffline() {
  const result = await spawnText([], {
    PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:9',
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Frontend is not reachable/);
  assert.match(result.stderr, /npm run dev:attach/);
}

async function testPreflightExplainsOnboardingSetupBlock() {
  const server = await startMockLiveServer(() => ({
    auth_enabled: true,
    password_set: false,
    authenticated: false,
  }));
  try {
    const result = await spawnText([], {
      PLAYWRIGHT_BASE_URL: server.baseUrl,
      DATAINFRA_API: `${server.baseUrl}/api/v1`,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Auth setup is incomplete/);
    assert.match(result.stderr, /password_set=false/);
    assert.match(result.stderr, /npm run eval:login/);
  } finally {
    await server.close();
  }
}

async function testPreflightExplainsMissingCredential() {
  const server = await startMockLiveServer(() => ({
    auth_enabled: true,
    password_set: true,
    authenticated: false,
  }));
  try {
    const result = await spawnText([], {
      PLAYWRIGHT_BASE_URL: server.baseUrl,
      DATAINFRA_API: `${server.baseUrl}/api/v1`,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /No browser auth credential is configured/);
    assert.match(result.stderr, /tmp[/\\]eval-token\.txt/);
  } finally {
    await server.close();
  }
}

async function testPreflightPassesWhenAuthDisabledWithoutCredentials() {
  const server = await startMockLiveServer(() => ({
    auth_enabled: false,
    password_set: null,
    authenticated: false,
  }));
  try {
    const result = await spawnText(['--preflight'], {
      PLAYWRIGHT_BASE_URL: server.baseUrl,
      DATAINFRA_API: `${server.baseUrl}/api/v1`,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Live localhost E2E preflight passed/);
    assert.match(result.stdout, /credential=not required/);
  } finally {
    await server.close();
  }
}

async function testPreflightDoesNotRequirePlaywrightCli() {
  const server = await startMockLiveServer(() => ({
    auth_enabled: false,
    password_set: null,
    authenticated: false,
  }));
  try {
    const result = await spawnText(['--preflight'], {
      PLAYWRIGHT_BASE_URL: server.baseUrl,
      DATAINFRA_API: `${server.baseUrl}/api/v1`,
      DATAINFRA_PLAYWRIGHT_CLI: path.join(os.tmpdir(), 'missing-playwright-cli.js'),
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Live localhost E2E preflight passed/);
    assert.doesNotMatch(result.stderr, /Playwright CLI is missing/);
  } finally {
    await server.close();
  }
}

async function testLaunchRequiresPlaywrightCliAfterPreflight() {
  const server = await startMockLiveServer(() => ({
    auth_enabled: false,
    password_set: null,
    authenticated: false,
  }));
  try {
    const missingCli = path.join(os.tmpdir(), 'missing-playwright-cli.js');
    const result = await spawnText([], {
      PLAYWRIGHT_BASE_URL: server.baseUrl,
      DATAINFRA_API: `${server.baseUrl}/api/v1`,
      DATAINFRA_PLAYWRIGHT_CLI: missingCli,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Live localhost E2E launch failed/);
    assert.match(result.stderr, new RegExp(`Playwright CLI is missing at ${escapeRegExp(missingCli)}`));
  } finally {
    await server.close();
  }
}

async function testPreflightRejectsUnauthenticatedTokenFile() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-live-localhost-'));
  const tokenPath = path.join(tmpDir, 'token.txt');
  const server = await startMockLiveServer((req) => ({
    auth_enabled: true,
    password_set: true,
    authenticated: req.headers.authorization === 'Bearer valid-token',
  }));
  try {
    await writeFile(tokenPath, 'bad-token', 'utf8');
    const result = await spawnText([], {
      PLAYWRIGHT_BASE_URL: server.baseUrl,
      DATAINFRA_API: `${server.baseUrl}/api/v1`,
      DATAINFRA_TOKEN_FILE: tokenPath,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /DATAINFRA_TOKEN_FILE=.* is configured/);
    assert.match(result.stderr, /authenticated=false/);
    assert.match(result.stderr, /Regenerate the token/);
  } finally {
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testFrontendPlaywrightDefaultsUsePort3000() {
  const configPath = path.join(rootDir, 'frontend', 'playwright.config.ts');
  const authSetupPath = path.join(rootDir, 'frontend', 'e2e', 'support', 'auth-global-setup.ts');
  const config = await readFile(configPath, 'utf8');
  const authSetup = await readFile(authSetupPath, 'utf8');
  const staleVitePortPattern = new RegExp(['51' + '73', '51' + '74', '51' + '76', '51' + '79'].join('|'));

  assert.match(config, /defaultBaseURL = 'http:\/\/127\.0\.0\.1:3000'/);
  assert.match(config, /--port 3000 --strictPort/);
  assert.doesNotMatch(config, staleVitePortPattern);
  assert.match(authSetup, /DEFAULT_BROWSER_BASE_URL = 'http:\/\/127\.0\.0\.1:3000'/);
  assert.doesNotMatch(authSetup, staleVitePortPattern);
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

await testDryRunDefaultsToLiveLocalhost();
await testDryRunCanShowPreflightOnlyMode();
await testDryRunUsesDefaultTokenFileWhenPresent();
await testExplicitEnvAndArgsWin();
await testPreflightFailsForMissingExplicitTokenFile();
await testPreflightFailsWhenFrontendOffline();
await testPreflightExplainsOnboardingSetupBlock();
await testPreflightExplainsMissingCredential();
await testPreflightPassesWhenAuthDisabledWithoutCredentials();
await testPreflightDoesNotRequirePlaywrightCli();
await testLaunchRequiresPlaywrightCliAfterPreflight();
await testPreflightRejectsUnauthenticatedTokenFile();
await testFrontendPlaywrightDefaultsUsePort3000();

console.log('live localhost wrapper tests passed');
