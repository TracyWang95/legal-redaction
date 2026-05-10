#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
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

async function withServer(handler, test) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await test(`http://127.0.0.1:${server.address().port}/api/v1`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testPasswordWritesToken() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-login-'));
  const tokenPath = path.join(tmpDir, 'token.txt');
  let loginBody = null;
  try {
    await withServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
        return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          loginBody = JSON.parse(body);
          sendJson(res, 200, { access_token: 'created-token', token_type: 'bearer' });
        });
        return;
      }
      sendJson(res, 404, { detail: 'not found' });
    }, async (apiBase) => {
      const result = await spawnText(
        process.platform === 'win32' ? 'node.exe' : 'node',
        ['scripts/eval-login.mjs', tokenPath],
        {
          cwd: rootDir,
          encoding: 'utf8',
          env: { ...process.env, DATAINFRA_API: apiBase, DATAINFRA_PASSWORD: 'local-password' },
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /token_file=/);
      assert.match(result.stdout, /DATAINFRA_TOKEN_FILE=/);
      assert.deepEqual(loginBody, { password: 'local-password' });
      assert.equal((await readFile(tokenPath, 'utf8')).trim(), 'created-token');
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testInlineTokenSkipsLogin() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-login-'));
  const tokenPath = path.join(tmpDir, 'token.txt');
  let loginHits = 0;
  try {
    await withServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
        return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        loginHits += 1;
        return sendJson(res, 200, { access_token: 'unexpected' });
      }
      sendJson(res, 404, { detail: 'not found' });
    }, async (apiBase) => {
      const result = await spawnText(
        process.platform === 'win32' ? 'node.exe' : 'node',
        ['scripts/eval-login.mjs', tokenPath],
        {
          cwd: rootDir,
          encoding: 'utf8',
          env: { ...process.env, DATAINFRA_API: apiBase, DATAINFRA_TOKEN: 'inline-token' },
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(loginHits, 0);
      assert.equal((await readFile(tokenPath, 'utf8')).trim(), 'inline-token');
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testDefaultTokenOutputPath() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-login-'));
  const tokenPath = path.join(tmpDir, 'default-token.txt');
  try {
    await withServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
        return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
      }
      sendJson(res, 404, { detail: 'not found' });
    }, async (apiBase) => {
      const result = await spawnText(
        process.platform === 'win32' ? 'node.exe' : 'node',
        ['scripts/eval-login.mjs'],
        {
          cwd: rootDir,
          encoding: 'utf8',
          env: {
            ...process.env,
            DATAINFRA_API: apiBase,
            DATAINFRA_TOKEN: 'inline-token',
            DATAINFRA_DEFAULT_TOKEN_FILE: tokenPath,
          },
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, new RegExp(`token_file=${escapeRegExp(tokenPath)}`));
      assert.equal((await readFile(tokenPath, 'utf8')).trim(), 'inline-token');
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testMissingPasswordExplainsDefaultTokenFile() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-login-'));
  const tokenPath = path.join(tmpDir, 'default-token.txt');
  try {
    await withServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
        return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: false });
      }
      sendJson(res, 404, { detail: 'not found' });
    }, async (apiBase) => {
      const result = await spawnText(
        process.platform === 'win32' ? 'node.exe' : 'node',
        ['scripts/eval-login.mjs'],
        {
          cwd: rootDir,
          encoding: 'utf8',
          env: {
            ...process.env,
            DATAINFRA_API: apiBase,
            DATAINFRA_PASSWORD: '',
            DATAINFRA_TOKEN: '',
            DATAINFRA_TOKEN_FILE: '',
            DATAINFRA_DEFAULT_TOKEN_FILE: tokenPath,
          },
        },
      );
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /Set DATAINFRA_PASSWORD/);
      assert.match(result.stderr, /password_set=false/);
      assert.match(result.stderr, new RegExp(escapeRegExp(tokenPath)));
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function testAuthDisabledWritesEmptyFile() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-login-'));
  const tokenPath = path.join(tmpDir, 'token.txt');
  try {
    await withServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
        return sendJson(res, 200, { auth_enabled: false, authenticated: true, password_set: null });
      }
      sendJson(res, 404, { detail: 'not found' });
    }, async (apiBase) => {
      const result = await spawnText(
        process.platform === 'win32' ? 'node.exe' : 'node',
        ['scripts/eval-login.mjs', tokenPath],
        { cwd: rootDir, encoding: 'utf8', env: { ...process.env, DATAINFRA_API: apiBase } },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /auth is disabled/);
      assert.equal(await readFile(tokenPath, 'utf8'), '');
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

await testPasswordWritesToken();
await testInlineTokenSkipsLogin();
await testDefaultTokenOutputPath();
await testMissingPasswordExplainsDefaultTokenFile();
await testAuthDisabledWritesEmptyFile();

console.log('eval login tests passed');
