#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_OUT_DIR = path.join('output', 'playwright', 'eval-public-current');

function usage() {
  console.log(`Usage:
  npm run eval:public
  npm run eval:public -- output/playwright/eval-public-current

Runs only public synthetic fixtures. It does not require backend auth or
private private corpus files. OCR/HaS Image model services are optional because the
visual check uses the offline public fixture mode. The top-level summary
requires at least one text entity, one visual target, and non-empty redacted
DOCX/PDF export artifacts.
`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  return argv.find((arg) => !arg.startsWith('-')) || DEFAULT_OUT_DIR;
}

function pythonCmd() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = [];
  if (process.env.VENV_DIR) {
    candidates.push(
      process.platform === 'win32'
        ? path.join(process.env.VENV_DIR, 'Scripts', 'python.exe')
        : path.join(process.env.VENV_DIR, 'bin', 'python'),
    );
  }
  candidates.push(
    process.platform === 'win32'
      ? path.join('.venv', 'Scripts', 'python.exe')
      : path.join('.venv', 'bin', 'python'),
    process.platform === 'win32'
      ? path.join('backend', '.venv', 'Scripts', 'python.exe')
      : path.join('backend', '.venv', 'bin', 'python'),
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

function runStep(step) {
  console.log(`\npublic gate: ${step.id}`);
  console.log(`$ ${step.command.join(' ')}`);
  const [cmd, ...args] = step.command;
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(step.env || {}) },
    stdio: 'inherit',
  });
  return {
    id: step.id,
    command: step.command,
    output_dir: step.output_dir || null,
    status: result.status ?? 1,
    passed: result.status === 0,
  };
}

function readJsonArtifact(filePath, failedChecks) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    failedChecks.push(`missing or invalid artifact: ${filePath} (${error.message})`);
    return null;
  }
}

function outputFileInfo(filePath) {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    return { path: resolved, exists: false, bytes: 0 };
  }
  const stats = statSync(resolved);
  return { path: resolved, exists: true, bytes: stats.size };
}

function asCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function collectCoverage(outDir) {
  const failedChecks = [];
  const textDirs = ['text-direct-txt', 'text-direct-docx'];
  const text = textDirs.map((id) => {
    const summaryPath = path.join(outDir, id, 'summary.json');
    const summary = readJsonArtifact(summaryPath, failedChecks);
    return {
      id,
      summary_path: path.resolve(summaryPath),
      passed: Boolean(summary?.quality_gate?.passed),
      entity_count: asCount(summary?.entity_count),
      content_chars: asCount(summary?.content_chars),
      entity_summary: summary?.entity_summary || {},
      report: path.resolve(outDir, id, 'report.html'),
    };
  });

  const visionSummaryPath = path.join(outDir, 'vision-offline', 'summary.json');
  const visionSummary = readJsonArtifact(visionSummaryPath, failedChecks);
  const vision = {
    id: 'vision-offline',
    summary_path: path.resolve(visionSummaryPath),
    passed: Boolean(visionSummary?.quality_gate?.passed),
    total_visual_regions: asCount(visionSummary?.total_visual_regions),
    total_seal_fallback_regions: asCount(visionSummary?.total_seal_fallback_regions),
    detector_contract: {
      class_count: asCount(visionSummary?.detector_contract?.class_count),
      class_id_range: Array.isArray(visionSummary?.detector_contract?.class_id_range)
        ? visionSummary.detector_contract.class_id_range
        : [],
      model_source: visionSummary?.detector_contract?.model_source || null,
      model_slug_count: Array.isArray(visionSummary?.detector_contract?.model_slugs)
        ? visionSummary.detector_contract.model_slugs.length
        : 0,
    },
    page_count: asCount(visionSummary?.page_count),
    report: path.resolve(outDir, 'vision-offline', 'report.html'),
    overlays: (visionSummary?.pages || [])
      .map((page) => page.overlay_image)
      .filter(Boolean)
      .map((name) => outputFileInfo(path.join(outDir, 'vision-offline', name))),
  };

  const safetySummaryPath = path.join(outDir, 'redaction-safety', 'summary.json');
  const safetySummary = readJsonArtifact(safetySummaryPath, failedChecks);
  const redactionExports = (safetySummary?.results || []).map((result) => ({
    kind: result.kind,
    passed: Boolean(result.passed),
    redacted_count: asCount(result.redacted_count),
    expected_redactions: asCount(result.expected_redactions),
    output: outputFileInfo(result.output),
  }));
  const redaction = {
    id: 'redaction-safety',
    summary_path: path.resolve(safetySummaryPath),
    passed: Boolean(safetySummary?.passed),
    export_count: redactionExports.filter((item) => item.passed && item.output.exists && item.output.bytes > 0).length,
    exports: redactionExports,
  };

  const totals = {
    text_entities: text.reduce((sum, item) => sum + item.entity_count, 0),
    visual_regions: vision.total_visual_regions,
    redacted_exports: redaction.export_count,
  };

  for (const item of text) {
    if (!item.passed) failedChecks.push(`${item.id} quality gate did not pass`);
  }
  if (totals.text_entities < 1) failedChecks.push('public eval found no text entities');
  if (!vision.passed) failedChecks.push('vision-offline quality gate did not pass');
  if (totals.visual_regions < 1) failedChecks.push('public eval found no visual targets');
  if (vision.detector_contract.class_count !== 21) {
    failedChecks.push(`vision-offline HaS Image contract class_count ${vision.detector_contract.class_count} != 21`);
  }
  if (vision.detector_contract.model_slug_count !== 21) {
    failedChecks.push(`vision-offline HaS Image contract model_slug_count ${vision.detector_contract.model_slug_count} != 21`);
  }
  if (vision.detector_contract.model_source !== 'has_image') {
    failedChecks.push(`vision-offline HaS Image contract model_source is ${vision.detector_contract.model_source || 'missing'}`);
  }
  if (!redaction.passed) failedChecks.push('redaction-safety quality gate did not pass');
  if (totals.redacted_exports < 2) failedChecks.push('public eval did not produce both redacted DOCX and PDF exports');

  return {
    passed: failedChecks.length === 0,
    failed_checks: failedChecks,
    totals,
    text,
    vision,
    redaction,
  };
}

const outDir = parseArgs(process.argv.slice(2));
const py = pythonCmd();
const fixtureDir = path.join('fixtures', 'benchmark');
const publicTextRegexes = JSON.stringify({
  CUSTOM_PUBLIC_EMAIL: {
    name: 'Public fixture email',
    pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
  },
  CUSTOM_PUBLIC_PHONE: {
    name: 'Public fixture phone',
    pattern: '(?:\\+?1[-\\s]?)?(?:\\d{3}[-\\s]?){2}\\d{4}|1\\d{10}',
  },
});
mkdirSync(outDir, { recursive: true });

const steps = [
  {
    id: 'document-fixtures',
    command: [py, 'scripts/create-eval-document-fixtures.py', fixtureDir],
  },
  {
    id: 'visual-fixture',
    command: [py, 'scripts/create-eval-visual-fixture.py'],
  },
  {
    id: 'text-direct-txt',
    output_dir: path.join(outDir, 'text-direct-txt'),
    command: [
      py,
      'scripts/eval-text-direct.py',
      path.join('fixtures', 'eval', 'sample-contract.txt'),
      path.join(outDir, 'text-direct-txt'),
    ],
    env: {
      EVAL_TEXT_DIRECT_TYPES: 'CUSTOM_PUBLIC_EMAIL,CUSTOM_PUBLIC_PHONE',
      EVAL_TEXT_DIRECT_CUSTOM_REGEX_JSON: publicTextRegexes,
      EVAL_TEXT_DIRECT_MIN_ENTITIES: '1',
    },
  },
  {
    id: 'text-direct-docx',
    output_dir: path.join(outDir, 'text-direct-docx'),
    command: [
      py,
      'scripts/eval-text-direct.py',
      path.join(fixtureDir, 'sample-redaction.docx'),
      path.join(outDir, 'text-direct-docx'),
    ],
    env: {
      EVAL_TEXT_DIRECT_TYPES: 'CUSTOM_PUBLIC_EMAIL,CUSTOM_PUBLIC_PHONE',
      EVAL_TEXT_DIRECT_CUSTOM_REGEX_JSON: publicTextRegexes,
      EVAL_TEXT_DIRECT_MIN_ENTITIES: '1',
    },
  },
  {
    id: 'redaction-safety',
    output_dir: path.join(outDir, 'redaction-safety'),
    command: [
      py,
      'scripts/eval-redaction-safety.py',
      '--fixture-dir',
      fixtureDir,
      path.join(outDir, 'redaction-safety'),
    ],
  },
  {
    id: 'vision-offline',
    output_dir: path.join(outDir, 'vision-offline'),
    command: [
      py,
      'scripts/eval-vision-direct.py',
      path.join('fixtures', 'eval', 'sample-visual.png'),
      path.join(outDir, 'vision-offline'),
      '--ocr-mode',
      'off',
      '--skip-has-image',
      '--write-pages',
      '--max-warnings',
      '-1',
      '--min-total-visual-regions',
      '1',
      '--min-page-visual-regions',
      '1',
    ],
  },
];

const results = [];
for (const step of steps) {
  const result = runStep(step);
  results.push(result);
  if (!result.passed) break;
}

const coverage = collectCoverage(outDir);
const summary = {
  generated_at: new Date().toISOString(),
  output_dir: path.resolve(outDir),
  fixture_dir: path.resolve(fixtureDir),
  passed: results.length === steps.length && results.every((result) => result.passed) && coverage.passed,
  steps: results,
  coverage,
};
const summaryPath = path.join(outDir, 'summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

console.log(`\nsummary: ${summaryPath}`);
console.log(`quality=${summary.passed ? 'pass' : 'fail'}`);
if (!summary.passed) {
  const failed = results.find((result) => !result.passed);
  for (const check of coverage.failed_checks) {
    console.error(`public coverage failed: ${check}`);
  }
  console.error(`public gate failed: ${failed?.id || 'coverage'}`);
  process.exit(1);
}

console.log(
  `coverage: text_entities=${coverage.totals.text_entities} ` +
    `visual_regions=${coverage.totals.visual_regions} ` +
    `redacted_exports=${coverage.totals.redacted_exports}`,
);

const safetySummaryPath = path.join(outDir, 'redaction-safety', 'summary.json');
try {
  const safety = JSON.parse(readFileSync(safetySummaryPath, 'utf8'));
  console.log(`redaction safety=${safety.passed ? 'pass' : 'fail'}`);
} catch {
  // Best effort summary; the step status above is authoritative.
}
