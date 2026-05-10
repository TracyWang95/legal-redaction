#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-seal-'));
const python = process.platform === 'win32' ? 'python.exe' : 'python';

try {
  const imagePath = path.join(tmpDir, 'seal-smoke.png');
  const makeImage = spawnSync(
    python,
    [
      '-c',
      [
        'from PIL import Image, ImageDraw',
        `img=Image.new("RGB",(800,1000),"white")`,
        'd=ImageDraw.Draw(img)',
        'd.arc([792,300,980,560], start=100, end=260, fill=(220,0,0), width=8)',
        'd.line([20,940,180,945], fill=(45,45,45), width=10)',
        `img.save(${JSON.stringify(imagePath)})`,
      ].join(';'),
    ],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(makeImage.status, 0, `${makeImage.stdout}\n${makeImage.stderr}`);

  const result = spawnSync(
    python,
    ['scripts/eval-seal-offline.py', imagePath, tmpDir, '--write-pages'],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const summary = JSON.parse(await readFile(path.join(tmpDir, 'summary.json'), 'utf8'));
  const report = await readFile(path.join(tmpDir, 'report.html'), 'utf8');
  assert.equal(summary.page_count, 1);
  assert.equal(summary.red_count, 1);
  assert.equal(summary.dark_count, 0);
  assert.equal(summary.total_regions, 1);
  assert.equal(summary.warning_details.length, 1);
  assert.equal(summary.warning_details[0].severity, 'medium');
  assert.equal(summary.quality_gate.passed, true);
  assert.equal(summary.quality_gate.thresholds.min_total_regions, 1);
  assert.equal(summary.quality_gate.thresholds.max_region_area, 0.05);
  assert.equal(summary.quality_gate.high_warning_count, 0);
  assert.match(summary.warnings[0], /^page 1:/);
  assert.match(result.stdout, /regions=1/);
  assert.match(result.stdout, /quality=pass/);
  assert.match(result.stdout, /report\.html/);
  assert.match(report, /Offline Seal Evaluation/);
  assert.match(report, /Quality Gate/);
  assert.match(report, /PASS/);
  assert.match(report, /Review Queue/);
  assert.match(report, /severity-medium/);
  assert.match(report, /href="#page-01"/);
  assert.match(report, /page-01-seal\.png/);
  assert.match(report, /right-edge seam\/fragment seal candidates|edge seal candidates present/);

  const failDir = path.join(tmpDir, 'threshold-fail');
  const failResult = spawnSync(
    python,
    ['scripts/eval-seal-offline.py', imagePath, failDir, '--min-total-regions', '99'],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(failResult.status, 1, `${failResult.stdout}\n${failResult.stderr}`);
  assert.match(failResult.stdout, /quality=fail/);
  assert.match(failResult.stderr, /quality gate failed: total seal candidates 1 < 99/);
  const failSummary = JSON.parse(await readFile(path.join(failDir, 'summary.json'), 'utf8'));
  const failReport = await readFile(path.join(failDir, 'report.html'), 'utf8');
  assert.equal(failSummary.quality_gate.passed, false);
  assert.equal(failSummary.quality_gate.thresholds.min_total_regions, 99);
  assert.match(failReport, /FAIL/);
  assert.match(failReport, /total seal candidates 1 &lt; 99/);

  const publicFixtureDir = path.join(tmpDir, 'public-fixture');
  const publicFixtureResult = spawnSync(
    python,
    ['scripts/eval-seal-offline.py', 'fixtures/eval/sample-visual.png', publicFixtureDir],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(publicFixtureResult.status, 0, `${publicFixtureResult.stdout}\n${publicFixtureResult.stderr}`);
  const publicFixtureSummary = JSON.parse(await readFile(path.join(publicFixtureDir, 'summary.json'), 'utf8'));
  assert.equal(publicFixtureSummary.quality_gate.passed, true);
  assert.equal(publicFixtureSummary.quality_gate.high_warning_count, 0);
  assert.ok(publicFixtureSummary.total_regions >= 1);
  assert.match(publicFixtureResult.stdout, /quality=pass/);

  const oversizedImagePath = path.join(tmpDir, 'oversized-seal.png');
  const makeOversizedImage = spawnSync(
    python,
    [
      '-c',
      [
        'from PIL import Image, ImageDraw',
        `img=Image.new("RGB",(800,1000),"white")`,
        'd=ImageDraw.Draw(img)',
        'red=(205,25,30)',
        'cx,cy,r=400,420,150',
        'd.ellipse([cx-r,cy-r,cx+r,cy+r], outline=red, width=24)',
        'd.ellipse([cx-r//2,cy-r//2,cx+r//2,cy+r//2], outline=red, width=10)',
        'd.line([cx-r+55,cy,cx+r-55,cy], fill=red, width=12)',
        'd.line([cx,cy-r+55,cx,cy+r-55], fill=red, width=12)',
        `img.save(${JSON.stringify(oversizedImagePath)})`,
      ].join(';'),
    ],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(makeOversizedImage.status, 0, `${makeOversizedImage.stdout}\n${makeOversizedImage.stderr}`);
  const oversizedDir = path.join(tmpDir, 'oversized-fail');
  const oversizedResult = spawnSync(
    python,
    ['scripts/eval-seal-offline.py', oversizedImagePath, oversizedDir],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(oversizedResult.status, 1, `${oversizedResult.stdout}\n${oversizedResult.stderr}`);
  assert.match(oversizedResult.stdout, /quality=fail/);
  assert.match(oversizedResult.stderr, /seal candidate area \d+\.\d% > max 5\.0%/);
  const oversizedSummary = JSON.parse(await readFile(path.join(oversizedDir, 'summary.json'), 'utf8'));
  const oversizedReport = await readFile(path.join(oversizedDir, 'report.html'), 'utf8');
  assert.equal(oversizedSummary.quality_gate.passed, false);
  assert.equal(oversizedSummary.quality_gate.high_warning_count, 1);
  assert.equal(oversizedSummary.warning_details[0].severity, 'high');
  assert.match(oversizedSummary.warning_details[0].message, /whole-block seal bbox|over-redaction/);
  assert.match(oversizedReport, /FAIL/);
  assert.match(oversizedReport, /oversized seal candidate area/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval seal offline tests passed');
