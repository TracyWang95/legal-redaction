#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-text-gate-'));

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

try {
  const inputPath = path.join(tmpDir, 'contract.txt');
  await writeFile(inputPath, '甲方：苏州人工智能有限公司\n联系人：沈阳漾\n', 'utf8');

  const state = { mode: 'pass', uploadCount: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: false, authenticated: true, password_set: null });
    }
    if (req.method === 'GET' && url.pathname === '/health/services') {
      return sendJson(res, 200, { all_online: true, services: {}, probe_ms: 1 });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/custom-types') {
      return sendJson(res, 200, {
        custom_types: [
          { id: 'PERSON', enabled: true },
          { id: 'ORG', enabled: true },
        ],
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/files/upload') {
      req.on('data', () => {});
      req.on('end', () => {
        state.uploadCount += 1;
        sendJson(res, 200, {
          file_id: `file-${state.uploadCount}`,
          file_type: 'text',
          page_count: 1,
        });
      });
      return;
    }
    const parseMatch = url.pathname.match(/^\/api\/v1\/files\/([^/]+)\/parse$/);
    if (req.method === 'GET' && parseMatch) {
      return sendJson(res, 200, {
        file_id: parseMatch[1],
        page_count: 1,
        content: '甲方：苏州人工智能有限公司\n联系人：沈阳漾\n',
      });
    }
    const nerMatch = url.pathname.match(/^\/api\/v1\/files\/([^/]+)\/ner\/hybrid$/);
    if (req.method === 'POST' && nerMatch) {
      req.on('data', () => {});
      req.on('end', () => {
        sendJson(res, 200, {
          entities: state.mode === 'empty'
            ? []
            : [
                { type: 'ORG', source: 'has', text: '苏州人工智能有限公司', start: 3, end: 13 },
                { type: 'PERSON', source: 'has', text: '沈阳漾', start: 18, end: 21 },
              ],
          recognition_failed: false,
          warnings: [],
        });
      });
      return;
    }
    sendJson(res, 404, { detail: `not found: ${req.method} ${url.pathname}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const passOutDir = path.join(tmpDir, 'out-pass');
    const passResult = await spawnText(
      process.execPath,
      ['scripts/eval-text-file.mjs', inputPath, passOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_TEXT_TYPES: 'PERSON,ORG',
        },
      },
    );
    assert.equal(passResult.status, 0, `${passResult.stdout}\n${passResult.stderr}`);
    assert.match(passResult.stdout, /quality=pass/);
    const passSummary = JSON.parse(await readFile(path.join(passOutDir, 'summary.json'), 'utf8'));
    assert.equal(passSummary.quality_gate.passed, true);
    assert.equal(passSummary.quality_gate.entity_count, 2);
    assert.equal(passSummary.quality_gate.thresholds.min_entities, 1);

    state.mode = 'empty';
    const failOutDir = path.join(tmpDir, 'out-fail');
    const failResult = await spawnText(
      process.execPath,
      ['scripts/eval-text-file.mjs', inputPath, failOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_TEXT_TYPES: 'PERSON,ORG',
        },
      },
    );
    assert.notEqual(failResult.status, 0, `${failResult.stdout}\n${failResult.stderr}`);
    assert.match(failResult.stdout, /quality=fail/);
    assert.match(failResult.stderr, /entity count 0 < 1/);
    const failSummary = JSON.parse(await readFile(path.join(failOutDir, 'summary.json'), 'utf8'));
    assert.equal(failSummary.quality_gate.passed, false);
    assert.equal(failSummary.quality_gate.entity_count, 0);

    state.mode = 'pass';
    const strictOutDir = path.join(tmpDir, 'out-strict');
    const strictResult = await spawnText(
      process.execPath,
      ['scripts/eval-text-file.mjs', inputPath, strictOutDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_TEXT_TYPES: 'PERSON,ORG',
          EVAL_TEXT_MIN_ENTITIES: '3',
        },
      },
    );
    assert.notEqual(strictResult.status, 0, `${strictResult.stdout}\n${strictResult.stderr}`);
    assert.match(strictResult.stdout, /quality=fail/);
    assert.match(strictResult.stderr, /entity count 2 < 3/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval text file gate tests passed');
