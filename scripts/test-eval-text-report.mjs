#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-text-report-'));

function shortHash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

try {
  const summaryPath = path.join(tmpDir, 'summary.json');
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        input: '/path/to/local-real-files/sample-a.docx',
        page_count: 1,
        content_chars: 34,
        selected_entity_types: ['PERSON', 'ORG'],
        service_health: { all_online: true, services: {}, probe_ms: 1 },
        parse_ms: 10,
        ner_ms: 20,
        entity_count: 2,
        entity_summary: { PERSON: 1, ORG: 1 },
        source_summary: { has: 2 },
        recognition_failed: false,
        warnings: [],
        qa_warnings: ['text eval warning'],
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    path.join(tmpDir, 'parse.json'),
    JSON.stringify({ content: 'Party: Acme Confidential LLC; contact: Alice Example' }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(tmpDir, 'entities.json'),
    JSON.stringify(
      [
        { type: 'ORG', source: 'has', text: 'Acme Confidential LLC', start: 7, end: 28 },
        { type: 'PERSON', source: 'has', text: 'Alice Example', start: 39, end: 52 },
      ],
      null,
      2,
    ),
    'utf8',
  );

  const result = spawnSync(
    process.execPath,
    ['scripts/eval-text-file.mjs', '--render-report', summaryPath],
    {
      cwd: rootDir,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const report = await readFile(path.join(tmpDir, 'report.html'), 'utf8');
  assert.match(report, /Text Eval/);
  assert.match(report, /text hash/);
  assert.match(report, /length/);
  assert.match(report, new RegExp(shortHash('Acme Confidential LLC')));
  assert.match(report, new RegExp(shortHash('Alice Example')));
  assert.doesNotMatch(report, /Acme Confidential LLC/);
  assert.doesNotMatch(report, /Alice Example/);
  assert.doesNotMatch(report, /<mark>/);
  assert.match(report, /text eval warning/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval text report tests passed');
