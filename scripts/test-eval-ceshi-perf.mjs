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
const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'datainfra-eval-ceshi-perf-'));

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
  const inputPath = path.join(tmpDir, 'input-contract.pdf');
  await writeFile(inputPath, Buffer.from('%PDF-1.4\n% mock\n', 'utf8'));

  const dryRun = await spawnText(
    process.execPath,
    [
      'scripts/eval-ceshi-perf.mjs',
      inputPath,
      path.join(tmpDir, 'dry-out'),
      '--dry-run',
      '--pages',
      '1-2',
      '--concurrency',
      '1,3',
      '--preview-concurrency',
      '2',
      '--cache-concurrency',
      '3',
    ],
    { cwd: rootDir, encoding: 'utf8', env: { ...process.env } },
  );
  assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
  assert.match(dryRun.stdout, /private PDF perf plan/);
  assert.match(dryRun.stdout, /upload, parse, forced vision, expected cache hit, preview-image/);
  assert.match(dryRun.stdout, /vision concurrency: 1,3/);
  assert.match(dryRun.stdout, /cache concurrency: 3/);
  assert.match(dryRun.stdout, /preview concurrency: 2/);
  assert.match(dryRun.stdout, /vision include_result_image: false/);
  assert.match(dryRun.stdout, /forced vision: force=true/);
  assert.match(dryRun.stdout, /expected cache hit: force omitted/);
  assert.doesNotMatch(dryRun.stdout, /private-contract\.pdf/);

  const state = {
    uploadCount: 0,
    parseCount: 0,
    previewCount: 0,
    visionCalls: [],
  };
  const png1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return sendJson(res, 200, { auth_enabled: false, authenticated: true, password_set: null });
    }
    if (req.method === 'GET' && url.pathname === '/health/services') {
      return sendJson(res, 200, { all_online: true, services: {}, probe_ms: 1 });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/vision-pipelines') {
      return sendJson(res, 200, [
        { mode: 'ocr_has', enabled: true, types: [{ id: 'seal_text', enabled: true }] },
        { mode: 'has_image', enabled: true, types: [{ id: 'official_seal', enabled: true }, { id: 'paper', enabled: true }] },
      ]);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/files/upload') {
      req.on('data', () => {});
      req.on('end', () => {
        state.uploadCount += 1;
        sendJson(res, 200, {
          file_id: `file-${state.uploadCount}`,
          file_type: 'pdf',
          file_size: 17,
          page_count: 3,
        });
      });
      return;
    }
    const parseMatch = url.pathname.match(/^\/api\/v1\/files\/([^/]+)\/parse$/);
    if (req.method === 'GET' && parseMatch) {
      state.parseCount += 1;
      return sendJson(res, 200, { file_id: parseMatch[1], file_type: 'pdf', page_count: 3, pages: [] });
    }
    const visionMatch = url.pathname.match(/^\/api\/v1\/redaction\/([^/]+)\/vision$/);
    if (req.method === 'POST' && visionMatch) {
      req.on('data', () => {});
      req.on('end', () => {
        const page = Number(url.searchParams.get('page') || 0);
        const forceParam = url.searchParams.get('force');
        const force = forceParam === 'true';
        const includeResultImage = url.searchParams.get('include_result_image');
        state.visionCalls.push({ page, force, forceParam, includeResultImage });
        sendJson(res, 200, {
          file_id: visionMatch[1],
          page,
          bounding_boxes: [
            {
              id: `box-${page}`,
              x: 0.1,
              y: 0.1,
              width: 0.2,
              height: 0.1,
              page,
              type: 'official_seal',
              source: 'has_image',
              source_detail: 'has_image',
              evidence_source: 'has_image_model',
            },
            {
              id: `ocr-${page}`,
              x: 0.3,
              y: 0.2,
              width: 0.1,
              height: 0.05,
              page,
              type: 'name',
              source: 'ocr_has',
              source_detail: 'image_ocr',
              evidence_source: 'ocr_has',
            },
          ],
          result_image: includeResultImage === 'false' ? null : png1x1,
          warnings: [],
          pipeline_status: {
            ocr_has: {
              ran: true,
              skipped: false,
              failed: false,
              region_count: 1,
              duration_ms: 21,
              stage_duration_ms: { ocr: 11, has_ner: 6, match: 4, total: 21 },
            },
            has_image: {
              ran: true,
              skipped: false,
              failed: false,
              region_count: 1,
              duration_ms: 34,
              stage_duration_ms: { prepare: 4, model: 20, local_fallback: 5, total: 34 },
            },
          },
          duration_ms: {
            ocr_has: 21,
            has_image: 34,
            total: 58,
            pdf_render_ms: 7,
            pdf_render_cache_hit: page > 1,
            pdf_text_layer_ms: 3,
            pdf_text_layer: { block_count: 1, char_count: 4, page_width: 612, page_height: 792 },
            pdf_text_layer_skipped_sparse_file: page === 3,
            request_total_ms: 66,
          },
          duration_breakdown_ms: {
            ocr: 11,
            has_text: 6,
            match: 4,
            has_image: 34,
            structure: 3,
            ocr_vl: 8,
            total: 58,
            request_total_ms: 66,
            pdf_render_cache_hit: page > 1,
            ocr_structure_cache_status: page > 1 ? 'hit' : 'miss',
            ocr_vl_cache_status: 'hit',
            pdf_text_layer: { cache_hit: true, char_count: 4 },
            private_path: 'D:\\ceshi\\private-contract.pdf',
            original_filename: 'private-contract.pdf',
          },
          cache_status: {
            vision_result: force ? 'force_refresh' : 'hit',
            force,
            signature_version: 1,
          },
        });
      });
      return;
    }
    const previewMatch = url.pathname.match(/^\/api\/v1\/redaction\/([^/]+)\/preview-image$/);
    if (req.method === 'POST' && previewMatch) {
      req.on('data', () => {});
      req.on('end', () => {
        state.previewCount += 1;
        sendJson(res, 200, {
          file_id: previewMatch[1],
          page: Number(url.searchParams.get('page') || 0),
          image_base64: png1x1,
        });
      });
      return;
    }
    sendJson(res, 404, { detail: `not found: ${req.method} ${url.pathname}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const preflightOutDir = path.join(tmpDir, 'preflight-out');
    const preflight = await spawnText(
      process.execPath,
      [
        'scripts/eval-ceshi-perf.mjs',
        inputPath,
        preflightOutDir,
        '--preflight',
        '--pages',
        '1-2',
      ],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
        },
      },
    );
    assert.equal(preflight.status, 0, `${preflight.stdout}\n${preflight.stderr}`);
    assert.match(preflight.stdout, /private PDF perf preflight/);
    assert.match(preflight.stdout, /auth: disabled; credentials for real run: not needed/);
    assert.match(preflight.stdout, /skipped real work: preflight does not upload/);
    assert.doesNotMatch(preflight.stdout, /private-contract\.pdf/);
    const preflightSummary = JSON.parse(await readFile(path.join(preflightOutDir, 'preflight-summary.json'), 'utf8'));
    assert.equal(preflightSummary.mode, 'preflight');
    assert.equal(preflightSummary.input_exists, true);
    assert.equal(preflightSummary.auth.needs_credentials_for_real_run, false);
    assert.equal(preflightSummary.skips[0].stage, 'upload_parse_vision_preview');
    assert.match(preflightSummary.skips[0].reason, /does not read a token/);
    assert.ok(!JSON.stringify(preflightSummary).includes('input-contract.pdf'));

    const outputOnlyPreflightOutDir = path.join(tmpDir, 'preflight-output-only');
    const outputOnlyPreflight = await spawnText(
      process.execPath,
      [
        'scripts/eval-ceshi-perf.mjs',
        '--preflight',
        outputOnlyPreflightOutDir,
      ],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
          EVAL_CESHI_PERF_PDF: inputPath,
        },
      },
    );
    assert.equal(outputOnlyPreflight.status, 0, `${outputOnlyPreflight.stdout}\n${outputOnlyPreflight.stderr}`);
    assert.ok(outputOnlyPreflight.stdout.includes(outputOnlyPreflightOutDir));
    const outputOnlySummary = JSON.parse(await readFile(path.join(outputOnlyPreflightOutDir, 'preflight-summary.json'), 'utf8'));
    assert.equal(outputOnlySummary.input_exists, true);
    assert.equal(outputOnlySummary.output_dir, outputOnlyPreflightOutDir);

    const outDir = path.join(tmpDir, 'out');
    const result = await spawnText(
      process.execPath,
      [
        'scripts/eval-ceshi-perf.mjs',
        inputPath,
        outDir,
        '--pages',
        '1-3',
        '--concurrency',
        '1,2,3',
        '--preview-concurrency',
        '1,2',
        '--cache-concurrency',
        '2',
      ],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATAINFRA_API: apiBase,
        },
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /upload: \d+ms/);
    assert.match(result.stdout, /parse: \d+ms, pages=3, selected=1,2,3/);
    assert.match(result.stdout, /vision forced c=1/);
    assert.match(result.stdout, /vision forced c=2/);
    assert.match(result.stdout, /vision forced c=3/);
    assert.match(result.stdout, /vision expected cache hit c=2/);
    assert.match(result.stdout, /preview c=1/);
    assert.match(result.stdout, /preview c=2/);

    assert.equal(state.uploadCount, 1);
    assert.equal(state.parseCount, 1);
    assert.equal(state.visionCalls.length, 12);
    assert.equal(state.visionCalls.filter((call) => call.force).length, 9);
    assert.equal(state.visionCalls.filter((call) => !call.force).length, 3);
    assert.ok(state.visionCalls.filter((call) => call.force).every((call) => call.forceParam === 'true'));
    assert.ok(state.visionCalls.filter((call) => !call.force).every((call) => call.forceParam === null));
    assert.ok(state.visionCalls.every((call) => call.includeResultImage === 'false'));
    assert.equal(state.previewCount, 6);

    const summary = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
    assert.equal(summary.upload.bytes, 16);
    assert.equal(summary.parse.ok, true);
    assert.deepEqual(summary.selected_pages, [1, 2, 3]);
    assert.deepEqual(summary.selected_has_image_types, ['official_seal']);
  assert.deepEqual(summary.request_profile, {
    vision_include_result_image: false,
    forced_vision_force: true,
    cache_hit_vision_force: false,
    default_frontend_path: true,
    cache_hit_is_expected_reuse_probe: true,
    cache_hit_supports_cold_start: false,
    cache_hit_interpretation: 'expected-reuse-only: warm-cache reuse path without a proven cold baseline',
  });
    assert.equal(summary.vision_runs.length, 3);
    assert.deepEqual(summary.vision_runs.map((run) => run.concurrency), [1, 2, 3]);
    assert.ok(
      summary.vision_runs.every((run) => run.pages.every((page) => page.result_image_present === false)),
      JSON.stringify(summary.vision_runs[0].pages[0], null, 2),
    );
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.ocr_has.ran, true);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.has_image.ran, true);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.pdf_render.ms, 7);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.pdf_text_layer.char_count, 4);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.pdf_text_layer.sparse_fallback, true);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.pdf_text_layer.skipped_sparse_file, false);
    assert.equal(summary.vision_runs[0].pages[2].stage_diagnostics.pdf_text_layer.skipped_sparse_file, true);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.request_total_ms, 66);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.cache_status.vision_result, 'force_refresh');
    assert.equal(summary.vision_runs[0].pages[0].duration_breakdown_ms.private_path, undefined);
    assert.equal(summary.vision_runs[0].pages[0].duration_breakdown_ms.original_filename, undefined);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.source, 'duration_breakdown_ms');
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.ocr.total_ms, 11);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.has_text.total_ms, 6);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.has_image.total_ms, 34);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.structure.total_ms, 3);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.vl.total_ms, 8);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.cache.hit_count, 2);
    assert.equal(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.cache.miss_or_disabled_count, 2);
    assert.deepEqual(summary.vision_runs[0].pages[0].stage_diagnostics.single_page_stage_summary.bottleneck, {
      stage: 'HaS Image',
      total_ms: 34,
    });
    assert.deepEqual(summary.vision_runs[0].pages[0].stage_diagnostics.box_source_counts, { has_image: 1, ocr_has: 1 });
    assert.equal(summary.cache_hit_run.stage, 'vision_cache_hit');
    assert.equal(summary.cache_hit_run.concurrency, 2);
    assert.equal(summary.cache_hit_run.pages.length, 3);
    assert.equal(summary.cache_hit_run.pages[0].stage_diagnostics.cache_status.vision_result, 'hit');
    assert.equal(summary.cache_hit_run.pages[0].stage_diagnostics.single_page_stage_summary.bottleneck.stage, 'HaS Image');
    assert.equal(summary.preview_runs.length, 2);
    assert.deepEqual(summary.preview_runs.map((run) => run.concurrency), [1, 2]);
    assert.equal(typeof summary.comparison.vision_3_vs_1_speedup, 'number');
    assert.ok(!JSON.stringify(summary).includes('input-contract.pdf'));
    assert.ok(!JSON.stringify(summary).includes('private-contract.pdf'));
    assert.ok(!JSON.stringify(summary).includes('D:\\ceshi'));

    const csv = await readFile(path.join(outDir, 'timings.csv'), 'utf8');
    assert.match(csv, /^stage,concurrency,page,ok,elapsed_ms,detail/m);
    assert.match(csv, /upload,1,,true,/);
    assert.match(csv, /parse,1,,true,/);
    assert.match(csv, /vision_forced,1,1,true,/);
    assert.match(csv, /vision_cache_hit,2,1,true,/);
    assert.match(csv, /preview_image,1,1,true,/);
    assert.match(csv, /ocr_has=ran:1:21:ocr=11\|has_ner=6\|match=4\|total=21;has_image=ran:1:34:prepare=4\|model=20\|local_fallback=5\|total=34/);
    assert.match(csv, /pdf_text_layer_sparse_fallback=true/);
    assert.match(csv, /pdf_text_layer_skipped_sparse_file=true/);
    assert.match(csv, /request_total_ms=66/);
    assert.match(csv, /backend_total_ms=58/);
    assert.match(csv, /cache_status=force_refresh/);
    assert.match(csv, /single_page_stage_summary=OCR=11\|HaS_Text=6\|HaS_Image=34\|structure=3\|VL=8\|cache=hit:2\/miss_or_disabled:2\|bottleneck=HaS Image:34ms/);
    assert.doesNotMatch(csv, /private-contract\.pdf/);

    const report = await readFile(path.join(outDir, 'report.md'), 'utf8');
    assert.match(report, /Private PDF Performance Evaluation/);
    assert.match(report, /Stage Diagnostics/);
    assert.match(report, /Single-Page Stage Summary/);
    assert.match(report, /When concurrency is already effective/);
    assert.match(report, /HaS Text ms/);
    assert.match(report, /HaS Image 34ms/);
    assert.match(report, /OCR\/HaS Text\/HaS Image\/structure\/VL\/cache bottlenecks/);
    assert.match(report, /page_elapsed/);
    assert.match(report, /stages=ocr=11\\\|has_ner=6\\\|match=4\\\|total=21/);
    assert.match(report, /pdf_text_layer/);
    assert.match(report, /sparse fallback/);
    assert.match(report, /skipped sparse file/);
    assert.match(report, /force_refresh force=true/);
    assert.match(report, /vision concurrency 3 vs 1 speedup/);
  assert.match(report, /cache hit vs forced concurrency 1 speedup/);
  assert.match(report, /cache-hit run is expected reuse: true/);
  assert.match(report, /cache-hit supports cold-start claim: false/);
  assert.match(report, /expected-reuse-only/);
  assert.match(report, /Live UI Batch Timing Read/);
    assert.match(report, /recognition_wait_ms` as first-reviewable latency/);
    assert.match(report, /all_recognition_complete_api_ms/);
    assert.match(report, /review_waiting_for_background_ms/);
    assert.doesNotMatch(report, /private-contract\.pdf/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log('eval ceshi perf tests passed');
