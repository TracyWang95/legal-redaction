#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-report-'));

try {
  const summaryPath = path.join(tmpDir, 'summary.json');
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        input: '/path/to/local-real-files/sample-contract.pdf',
        page_count: 2,
        total_boxes: 4,
        total_has_image_boxes: 3,
        average_ms: 1200,
        wall_ms: 2500,
        page_concurrency: 1,
        redaction_preview_enabled: true,
        service_health: { all_online: true, services: {}, probe_ms: 1 },
        qa_warnings: ['第 2 页右侧存在骑缝章候选。'],
        quality_gate: {
          passed: false,
          failed_checks: ['page 1 boxes 0 < 1', 'total HaS Image boxes 0 < 1'],
          thresholds: { min_page_boxes: 1, min_total_has_image_boxes: 1 },
          warning_count: 1,
          total_boxes: 0,
          total_visual_boxes: 0,
          total_has_image_boxes: 0,
          expected_pages: 2,
        },
        pages: [
          {
            page: 1,
            elapsed_ms: 1000,
            redaction_preview_ms: 50,
            redaction_preview: false,
            preview_image: false,
            box_count: 1,
            has_image_box_count: 0,
            qa_warnings: ['第 1 页需要复核但未生成预览图和脱敏预览。'],
            byType: { PERSON: 1 },
            bySource: { ocr_has: 1 },
          },
          {
            page: 2,
            elapsed_ms: 1400,
            redaction_preview_ms: 60,
            redaction_preview: true,
            preview_image: true,
            box_count: 3,
            has_image_box_count: 3,
            qa_warnings: ['第 2 页右侧存在骑缝章候选。'],
            byType: { official_seal: 3 },
            bySource: { has_image: 3 },
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = spawnSync(
    process.execPath,
    ['scripts/eval-vision-pdf.mjs', '--render-report', summaryPath],
    {
      cwd: rootDir,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const report = await readFile(path.join(tmpDir, 'report.html'), 'utf8');
  assert.match(report, /重点复核队列/);
  assert.match(report, /需复核页/);
  assert.match(report, /质检提示/);
  assert.match(report, /HaS Image/);
  assert.match(report, /3 HaS Image/);
  assert.match(report, /href="#page-01"/);
  assert.match(report, /href="#page-02"/);
  assert.match(report, /id="page-02"/);
  assert.match(report, /src="page-02-preview\.png"/);
  assert.match(report, /未生成识别框预览图/);
  assert.match(report, /href="page-02-redacted\.png"/);
  assert.match(report, /href="page-02\.json"/);
  assert.match(report, /Quality failure diagnosis/);
  assert.match(report, /Next action:/);
  assert.match(report, /page boxes/);
  assert.match(report, /page-01/);
  assert.match(report, /total has_image/);
  assert.match(report, /第 2 页右侧存在骑缝章候选/);
  assert.doesNotMatch(report, /src="page-01-preview\.png"/);
  assert.doesNotMatch(report, /href="page-01-preview\.png"/);
  assert.doesNotMatch(report, /href="page-01-redacted\.png"/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval vision report tests passed');
