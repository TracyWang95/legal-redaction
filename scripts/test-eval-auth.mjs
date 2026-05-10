#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { authHeaders, requestJson, resolveAuthToken } from './eval-auth.mjs';
import { loadDotEnvFiles, parseDotEnv } from './env.mjs';

async function withServer(handler, test) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await test(`http://127.0.0.1:${port}/api/v1`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function testAuthDisabledSkipsCredentials() {
  let loginHits = 0;
  await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: false, authenticated: true, password_set: null });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      loginHits += 1;
      return sendJson(res, 200, { access_token: 'unexpected' });
    }
    sendJson(res, 404, { detail: 'not found' });
  }, async (apiBase) => {
    const result = await resolveAuthToken(apiBase, {});
    assert.equal(result.token, null);
    assert.equal(result.authStatus.auth_enabled, false);
    assert.equal(loginHits, 0);
  });
}

async function testAuthDisabledIgnoresTokenFile() {
  let loginHits = 0;
  await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: false, authenticated: true, password_set: null });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      loginHits += 1;
      return sendJson(res, 200, { access_token: 'unexpected' });
    }
    sendJson(res, 404, { detail: 'not found' });
  }, async (apiBase) => {
    const result = await resolveAuthToken(apiBase, {
      AUTH_ENABLED: 'false',
      DATAINFRA_TOKEN_FILE: path.join(os.tmpdir(), 'missing-disabled-token.txt'),
    });
    assert.equal(result.token, null);
    assert.equal(result.authStatus.auth_enabled, false);
    assert.equal(loginHits, 0);
  });
}

async function testAuthDisabledEnvSkipsCredentialsWhenStatusUnavailable() {
  let loginHits = 0;
  await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      loginHits += 1;
      return sendJson(res, 200, { access_token: 'unexpected' });
    }
    sendJson(res, 404, { detail: 'not found' });
  }, async (apiBase) => {
    const result = await resolveAuthToken(apiBase, { AUTH_ENABLED: 'false' });
    assert.equal(result.token, null);
    assert.equal(result.authDisabledByEnv, true);
    assert.match(result.authStatus.error, /HTTP 404/);
    assert.equal(loginHits, 0);
  });
}

async function testTokenTakesPriorityOverPassword() {
  let loginHits = 0;
  await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      loginHits += 1;
      return sendJson(res, 200, { access_token: 'login-token' });
    }
    sendJson(res, 404, { detail: 'not found' });
  }, async (apiBase) => {
    const result = await resolveAuthToken(apiBase, {
      DATAINFRA_TOKEN: 'existing-token',
      DATAINFRA_PASSWORD: 'should-not-be-used',
    });
    assert.equal(result.token, 'existing-token');
    assert.equal(loginHits, 0);
  });
}

async function testPasswordLoginFallback() {
  let loginBody = null;
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
        sendJson(res, 200, { access_token: 'login-token' });
      });
      return;
    }
    sendJson(res, 404, { detail: 'not found' });
  }, async (apiBase) => {
    const result = await resolveAuthToken(apiBase, { DATAINFRA_PASSWORD: 'local-password' });
    assert.equal(result.token, 'login-token');
    assert.deepEqual(loginBody, { password: 'local-password' });
  });
}

async function testTokenFileFallback() {
  let loginHits = 0;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-auth-'));
  const tokenPath = path.join(dir, 'token.txt');
  await writeFile(tokenPath, ' file-token\n', 'utf8');
  try {
    await withServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
        return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        loginHits += 1;
        return sendJson(res, 200, { access_token: 'login-token' });
      }
      sendJson(res, 404, { detail: 'not found' });
    }, async (apiBase) => {
      const result = await resolveAuthToken(apiBase, { DATAINFRA_TOKEN_FILE: tokenPath });
      assert.equal(result.token, 'file-token');
      assert.equal(loginHits, 0);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testDefaultTokenFileFallback() {
  let loginHits = 0;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-auth-'));
  const tokenPath = path.join(dir, 'eval-token.txt');
  await writeFile(tokenPath, ' default-file-token\n', 'utf8');
  try {
    await withServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
        return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        loginHits += 1;
        return sendJson(res, 200, { access_token: 'login-token' });
      }
      sendJson(res, 404, { detail: 'not found' });
    }, async (apiBase) => {
      const result = await resolveAuthToken(apiBase, { DATAINFRA_DEFAULT_TOKEN_FILE: tokenPath });
      assert.equal(result.token, 'default-file-token');
      assert.equal(result.tokenFile, tokenPath);
      assert.equal(result.tokenSource, 'default-token-file');
      assert.equal(loginHits, 0);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testInlineTokenBeatsTokenFile() {
  let loginHits = 0;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-auth-'));
  const tokenPath = path.join(dir, 'token.txt');
  await writeFile(tokenPath, 'file-token', 'utf8');
  try {
    await withServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
        return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        loginHits += 1;
        return sendJson(res, 200, { access_token: 'login-token' });
      }
      sendJson(res, 404, { detail: 'not found' });
    }, async (apiBase) => {
      const result = await resolveAuthToken(apiBase, {
        DATAINFRA_TOKEN: 'inline-token',
        DATAINFRA_TOKEN_FILE: tokenPath,
      });
      assert.equal(result.token, 'inline-token');
      assert.equal(loginHits, 0);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testTokenFileReadFailureHasRecoveryCommand() {
  await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
    }
    sendJson(res, 404, { detail: 'not found' });
  }, async (apiBase) => {
    await assert.rejects(
      () => resolveAuthToken(apiBase, { DATAINFRA_TOKEN_FILE: path.join(os.tmpdir(), 'missing-token.txt') }),
      /DATAINFRA_TOKEN_FILE is set but cannot be read: .*npm run eval:login -- tmp\/eval-token\.txt/s,
    );
  });
}

async function testMissingCredentialsMessage() {
  await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: true, authenticated: false, password_set: true });
    }
    sendJson(res, 404, { detail: 'not found' });
  }, async (apiBase) => {
    const missingDefaultTokenFile = path.join(os.tmpdir(), 'datainfra-eval-auth-no-default-token.txt');
    await assert.rejects(
      () => resolveAuthToken(apiBase, { DATAINFRA_DEFAULT_TOKEN_FILE: missingDefaultTokenFile }),
      /Set DATAINFRA_PASSWORD, DATAINFRA_TOKEN, or DATAINFRA_TOKEN_FILE before running eval/,
    );
  });
}

async function testRequestJsonErrorDetail() {
  await withServer((req, res) => {
    sendJson(res, 418, { detail: 'short and useful' });
  }, async (apiBase) => {
    await assert.rejects(
      () => requestJson(`${apiBase}/broken`),
      /GET .* failed: HTTP 418 short and useful/,
    );
  });
}

function testDotEnvParserStripsInlineComments() {
  const parsed = parseDotEnv(`
AUTH_ENABLED=false                   # Keep true for shared deployments
DATAINFRA_PASSWORD='local # password'
DATAINFRA_TOKEN="token # value"
EMPTY_VALUE=
`);
  assert.deepEqual(parsed, {
    AUTH_ENABLED: 'false',
    DATAINFRA_PASSWORD: 'local # password',
    DATAINFRA_TOKEN: 'token # value',
    EMPTY_VALUE: '',
  });
}

async function testLoadDotEnvFilesKeepsExplicitEnv() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-dotenv-'));
  try {
    await writeFile(path.join(dir, '.env'), 'DATAINFRA_PASSWORD=file-password\nAUTH_ENABLED=false # local\n', 'utf8');
    const env = { DATAINFRA_PASSWORD: 'explicit-password' };
    const loaded = loadDotEnvFiles(dir, { env });
    assert.equal(loaded.DATAINFRA_PASSWORD, 'file-password');
    assert.equal(env.DATAINFRA_PASSWORD, 'explicit-password');
    assert.equal(env.AUTH_ENABLED, 'false');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function testAuthHeaders() {
  assert.deepEqual(authHeaders(null, { Accept: 'application/json' }), { Accept: 'application/json' });
  assert.deepEqual(authHeaders('abc', { Accept: 'application/json' }), {
    Authorization: 'Bearer abc',
    Accept: 'application/json',
  });
}

await testAuthDisabledSkipsCredentials();
await testAuthDisabledIgnoresTokenFile();
await testAuthDisabledEnvSkipsCredentialsWhenStatusUnavailable();
await testTokenTakesPriorityOverPassword();
await testPasswordLoginFallback();
await testTokenFileFallback();
await testDefaultTokenFileFallback();
await testInlineTokenBeatsTokenFile();
await testTokenFileReadFailureHasRecoveryCommand();
await testMissingCredentialsMessage();
await testRequestJsonErrorDetail();
testDotEnvParserStripsInlineComments();
await testLoadDotEnvFilesKeepsExplicitEnv();
testAuthHeaders();

console.log('eval auth tests passed');
