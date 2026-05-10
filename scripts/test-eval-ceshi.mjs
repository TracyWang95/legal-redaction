#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tmpDir = await mkdtemp(path.join(os.tmpdir(), "datainfra-eval-ceshi-"));

async function createMockDiagnosticPython() {
  const writerPath = path.join(tmpDir, "mock-diagnostics-writer.mjs");
  await writeFile(
    writerPath,
    `
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = process.argv.find((arg, index) =>
  index >= 3 && /(?:^|[\\\\/])diagnostics[\\\\/][^\\\\/]+$/.test(String(arg))
) || process.argv[4];
const normalizedOutDir = String(outDir).replace(/\\\\/g, "/");
const id = normalizedOutDir.includes("/vision-contract-pdf-all")
  ? "vision-contract-pdf-all"
  : normalizedOutDir.includes("/vision-contract-pdf")
    ? "vision-contract-pdf"
    : normalizedOutDir.includes("/seal-contract-pdf")
      ? "seal-contract-pdf"
      : path.basename(outDir);
mkdirSync(outDir, { recursive: true });

function writeJson(name, value) {
  writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2), "utf8");
}

function pageSummary(page) {
  const number = String(page).padStart(2, "0");
  const overlay = \`page-\${number}-vision.png\`;
  if (process.env.MOCK_SKIP_CESHI_OVERLAY_PAGE !== number) {
    writeFileSync(path.join(outDir, overlay), "overlay", "utf8");
  }
  return { page, visual_count: 1, overlay_image: overlay };
}

let summary = { quality_gate: { passed: true } };
if (id === "vision-contract-pdf-all") {
  summary = { quality_gate: { passed: true }, pages: [1, 2, 3, 4, 5, 6].map(pageSummary) };
} else if (id === "vision-contract-pdf") {
  summary = {
    quality_gate: { passed: true },
    ocr_artifact_filter: { removed_regions: 1 },
    ocr_text_filter: { diagnostic_regions: 16 },
  };
  writeJson("page-05.json", [
    { source: "has_image", type: "official_seal", x: 0.1, width: 0.1, height: 0.1 },
    { source: "has_image", type: "official_seal", x: 0.2, width: 0.1, height: 0.1 },
    { source: "red_seal_fallback", type: "official_seal", x: 0.92, width: 0.05, height: 0.12 },
    { source: "red_seal_fallback", type: "official_seal", x: 0.94, width: 0.04, height: 0.13 }
  ]);
  writeJson("page-05-ocr-diagnostics.json", Array.from({ length: 16 }, (_, index) => ({ id: index + 1 })));
} else if (id === "seal-contract-pdf") {
  summary = { quality_gate: { passed: true } };
}
writeJson("summary.json", summary);
writeFileSync(path.join(outDir, "report.html"), "<!doctype html><title>mock report</title>", "utf8");
`,
    "utf8",
  );
  return writerPath;
}

async function assertCeshiDiagnosticsArtifacts(outDir) {
  const diagnosticsDir = path.join(outDir, "diagnostics");
  const summary = JSON.parse(
    await readFile(path.join(diagnosticsDir, "diagnostics-summary.json"), "utf8"),
  );
  const report = await readFile(path.join(diagnosticsDir, "report.html"), "utf8");
  assert.match(report, /private corpus Diagnostics/);
  assert.equal(summary.privacy.private_details, false);
  assert.equal(summary.commands.length, 7);
  for (const command of summary.commands) {
    assert.equal(command.ok, true, `${command.id} should pass`);
    const layerDir = path.join(diagnosticsDir, command.id);
    await readFile(path.join(layerDir, "summary.json"), "utf8");
    await readFile(path.join(layerDir, "report.html"), "utf8");
  }
  const visionAll = JSON.parse(
    await readFile(path.join(diagnosticsDir, "vision-contract-pdf-all", "summary.json"), "utf8"),
  );
  assert.equal(visionAll.pages.length, 6);
  for (const page of visionAll.pages) {
    assert.equal(typeof page.overlay_image, "string");
    await readFile(
      path.join(diagnosticsDir, "vision-contract-pdf-all", page.overlay_image),
      "utf8",
    );
  }
  const artifactText = JSON.stringify(summary) + report;
  assert.doesNotMatch(artifactText, /manifest-a\.docx|manifest-b\.docx|manifest-contract\.pdf/);
}

try {
  const files = [
    "corpus-a.docx",
    "corpus-b.docx",
    "corpus-contract.pdf",
    "corpus-image.png",
  ];
  for (const filename of files) {
    await writeFile(path.join(tmpDir, filename), "fixture", "utf8");
  }
  const manifestFiles = [
    "manifest-a.docx",
    "manifest-b.docx",
    "manifest-contract.pdf",
    "manifest-image.png",
  ];
  for (const filename of manifestFiles) {
    await writeFile(path.join(tmpDir, filename), "fixture", "utf8");
  }
  const manifestPath = path.join(tmpDir, "real-files.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        files: manifestFiles.map((filename) => ({ path: filename })),
      },
      null,
      2,
    ),
    "utf8",
  );

  const checkOnly = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["scripts/eval-ceshi.mjs", "--check-only"],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
      },
    },
  );
  assert.equal(checkOnly.status, 0, `${checkOnly.stdout}\n${checkOnly.stderr}`);
  assert.match(checkOnly.stdout, /regression files found/);
  assert.match(checkOnly.stdout, /input-01\.docx path_sha256=/);
  assert.doesNotMatch(checkOnly.stdout, /manifest-a\.docx/);
  assert.match(checkOnly.stdout, /EVAL_BATCH_MIN_TOTAL_ENTITIES=1/);
  assert.match(checkOnly.stdout, /EVAL_BATCH_MIN_TOTAL_BOXES=1/);
  assert.match(checkOnly.stdout, /EVAL_BATCH_MAX_PDF_SIZE_RATIO=8/);
  assert.match(checkOnly.stdout, /EVAL_BATCH_MAX_PDF_SIZE_BYTES=20971520/);
  assert.match(checkOnly.stdout, /EVAL_BATCH_WARN_PDF_SIZE_RATIO=4/);
  assert.match(checkOnly.stdout, /EVAL_BATCH_WARN_PDF_SIZE_BYTES=10485760/);
  assert.match(checkOnly.stdout, /metadata_degraded/);
  assert.match(checkOnly.stdout, /AUTH_ENABLED=false/);
  assert.match(checkOnly.stdout, /DATAINFRA_TOKEN_FILE=tmp\/eval-token\.txt/);
  assert.match(checkOnly.stdout, /default page concurrency is 2/);
  assert.match(checkOnly.stdout, /GPU is idle/);
  assert.match(checkOnly.stdout, /backend logs/);
  assert.match(checkOnly.stdout, /SQLite drvfs\/WAL/);
  assert.match(checkOnly.stdout, /doctor:strict/);
  assert.match(checkOnly.stdout, /real E2E skipped: check-only mode/);

  const preflightOutDir = path.join(tmpDir, "preflight-out");
  const preflight = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["scripts/eval-ceshi.mjs", "--preflight", preflightOutDir],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
      },
    },
  );
  assert.equal(preflight.status, 0, `${preflight.stdout}\n${preflight.stderr}`);
  assert.match(preflight.stdout, /real E2E skipped: preflight mode checks local corpus paths/);
  assert.match(preflight.stdout, /preflight-summary\.json/);
  assert.doesNotMatch(preflight.stdout, /manifest-a\.docx/);
  const preflightSummary = JSON.parse(
    await readFile(path.join(preflightOutDir, "preflight-summary.json"), "utf8"),
  );
  assert.equal(preflightSummary.mode, "preflight");
  assert.equal(preflightSummary.auth.credential_required_for_preflight, false);
  assert.equal(preflightSummary.batch_e2e.skipped, true);
  assert.match(preflightSummary.batch_e2e.skip_reason, /does not require credentials/);
  assert.ok(!JSON.stringify(preflightSummary).includes("manifest-a.docx"));

  const npmConfigCheckOnly = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["scripts/eval-ceshi.mjs"],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
        npm_config_check_only: "true",
      },
    },
  );
  assert.equal(
    npmConfigCheckOnly.status,
    0,
    `${npmConfigCheckOnly.stdout}\n${npmConfigCheckOnly.stderr}`,
  );
  assert.match(npmConfigCheckOnly.stdout, /regression files found/);

  const dryRun = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["scripts/eval-ceshi.mjs", "--dry-run", "output/private-gate"],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
        EVAL_BATCH_MIN_TOTAL_ENTITIES: "7",
        EVAL_BATCH_MIN_TOTAL_BOXES: "9",
        EVAL_BATCH_MAX_PDF_SIZE_RATIO: "10",
        EVAL_BATCH_MAX_PDF_SIZE_BYTES: "31457280",
      },
    },
  );
  assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
  assert.match(dryRun.stdout, /real E2E skipped: dry-run mode/);
  assert.match(dryRun.stdout, /EVAL_BATCH_MIN_TOTAL_ENTITIES=7/);
  assert.match(dryRun.stdout, /EVAL_BATCH_MIN_TOTAL_BOXES=9/);
  assert.match(dryRun.stdout, /EVAL_BATCH_MAX_PDF_SIZE_RATIO=10/);
  assert.match(dryRun.stdout, /EVAL_BATCH_MAX_PDF_SIZE_BYTES=31457280/);
  assert.match(
    dryRun.stdout,
    /scripts\/eval-batch-e2e\.mjs output\/private-gate/,
  );

  const diagnosticsDryRun = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    [
      "scripts/eval-ceshi.mjs",
      "--diagnostics",
      "--dry-run",
      "output/private-gate",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
      },
    },
  );
  assert.equal(
    diagnosticsDryRun.status,
    0,
    `${diagnosticsDryRun.stdout}\n${diagnosticsDryRun.stderr}`,
  );
  assert.match(diagnosticsDryRun.stdout, /private corpus diagnostics commands/);
  assert.match(diagnosticsDryRun.stdout, /text-docx-a: .*eval-text-direct\.py/);
  assert.match(
    diagnosticsDryRun.stdout,
    /ocr-contract-pdf: .*eval-ocr-direct\.py/,
  );
  assert.match(
    diagnosticsDryRun.stdout,
    /vision-contract-pdf: .*eval-vision-direct\.py/,
  );
  assert.match(
    diagnosticsDryRun.stdout,
    /vision-contract-pdf-all: .*eval-vision-direct\.py/,
  );
  assert.match(diagnosticsDryRun.stdout, /--pages 1-6/);
  assert.match(
    diagnosticsDryRun.stdout,
    /seal-contract-pdf: .*eval-seal-offline\.py/,
  );
  assert.match(
    diagnosticsDryRun.stdout,
    /vision-image-png: .*eval-vision-direct\.py/,
  );
  assert.match(diagnosticsDryRun.stdout, /diagnostics-summary\.json/);
  assert.match(diagnosticsDryRun.stdout, /diagnostics[\\/]report\.html/);
  assert.match(diagnosticsDryRun.stdout, /private corpus diagnostics planned: 7/);

  const diagnosticsOnlyDryRun = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    [
      "scripts/eval-ceshi.mjs",
      "--diagnostics-only",
      "--dry-run",
      "output/private-diagnostics",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
      },
    },
  );
  assert.equal(
    diagnosticsOnlyDryRun.status,
    0,
    `${diagnosticsOnlyDryRun.stdout}\n${diagnosticsOnlyDryRun.stderr}`,
  );
  assert.doesNotMatch(diagnosticsOnlyDryRun.stdout, /eval-batch-e2e\.mjs/);
  assert.match(diagnosticsOnlyDryRun.stdout, /real E2E skipped: dry-run mode/);
  assert.match(
    diagnosticsOnlyDryRun.stdout,
    /private corpus diagnostics planned: 7/,
  );

  const npmStyleDiagnosticsPlan = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["scripts/eval-ceshi.mjs", "output/npm-style-diagnostics"],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
        npm_config_diagnostics_only: "true",
        npm_config_dry_run: "true",
      },
    },
  );
  assert.equal(
    npmStyleDiagnosticsPlan.status,
    0,
    `${npmStyleDiagnosticsPlan.stdout}\n${npmStyleDiagnosticsPlan.stderr}`,
  );
  assert.doesNotMatch(npmStyleDiagnosticsPlan.stdout, /eval-batch-e2e\.mjs/);
  assert.match(
    npmStyleDiagnosticsPlan.stdout,
    /private corpus diagnostics planned: 7/,
  );

  const manifestCheckOnly = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["scripts/eval-ceshi.mjs", "--manifest", manifestPath, "--check-only"],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: path.join(tmpDir, "missing-default-dir"),
      },
    },
  );
  assert.equal(
    manifestCheckOnly.status,
    0,
    `${manifestCheckOnly.stdout}\n${manifestCheckOnly.stderr}`,
  );
  assert.match(manifestCheckOnly.stdout, /private corpus manifest files found/);
  assert.match(manifestCheckOnly.stdout, /manifest_sha256=/);
  assert.match(manifestCheckOnly.stdout, /input-03\.pdf path_sha256=/);
  assert.doesNotMatch(manifestCheckOnly.stdout, /manifest-contract\.pdf/);

  const manifestDiagnosticsDryRun = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    [
      "scripts/eval-ceshi.mjs",
      "--manifest",
      manifestPath,
      "--diagnostics-only",
      "--dry-run",
      "output/manifest-diagnostics",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: path.join(tmpDir, "missing-default-dir"),
      },
    },
  );
  assert.equal(
    manifestDiagnosticsDryRun.status,
    0,
    `${manifestDiagnosticsDryRun.stdout}\n${manifestDiagnosticsDryRun.stderr}`,
  );
  assert.doesNotMatch(manifestDiagnosticsDryRun.stdout, /vision-contract-pdf-all/);
  assert.match(
    manifestDiagnosticsDryRun.stdout,
    /private corpus diagnostics planned: 6/,
  );
  assert.match(manifestDiagnosticsDryRun.stdout, /diagnostics[\\/]report\.html/);

  const mockWriter = await createMockDiagnosticPython();
  const diagnosticsOutDir = path.join(tmpDir, "out-diagnostics");
  const diagnosticsRun = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    [
      "scripts/eval-ceshi.mjs",
      "--diagnostics-only",
      diagnosticsOutDir,
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
        EVAL_CESHI_DIAGNOSTIC_RUNNER: process.execPath,
        EVAL_CESHI_DIAGNOSTIC_RUNNER_ARGV: JSON.stringify([mockWriter]),
      },
    },
  );
  assert.equal(
    diagnosticsRun.status,
    0,
    `${diagnosticsRun.stdout}\n${diagnosticsRun.stderr}`,
  );
  assert.match(diagnosticsRun.stdout, /private corpus diagnostics assertions: pass/);
  await assertCeshiDiagnosticsArtifacts(diagnosticsOutDir);
  const diagnosticsSummary = JSON.parse(
    await readFile(path.join(diagnosticsOutDir, "diagnostics", "diagnostics-summary.json"), "utf8"),
  );
  assert.equal(diagnosticsSummary.batch_e2e.skipped, true);
  assert.match(diagnosticsSummary.batch_e2e.skip_reason, /diagnostics-only mode intentionally skips/);
  const diagnosticsReport = await readFile(path.join(diagnosticsOutDir, "diagnostics", "report.html"), "utf8");
  assert.match(diagnosticsReport, /Real batch E2E: skipped/);

  const missingOverlayOutDir = path.join(tmpDir, "out-missing-overlay");
  const missingOverlayRun = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    [
      "scripts/eval-ceshi.mjs",
      "--diagnostics-only",
      missingOverlayOutDir,
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_DIR: tmpDir,
        EVAL_CESHI_DIAGNOSTIC_RUNNER: process.execPath,
        EVAL_CESHI_DIAGNOSTIC_RUNNER_ARGV: JSON.stringify([mockWriter]),
        MOCK_SKIP_CESHI_OVERLAY_PAGE: "06",
      },
    },
  );
  assert.notEqual(
    missingOverlayRun.status,
    0,
    `${missingOverlayRun.stdout}\n${missingOverlayRun.stderr}`,
  );
  assert.match(
    missingOverlayRun.stderr,
    /vision-contract-pdf-all page 6 overlay must exist/,
  );
  assert.doesNotMatch(missingOverlayRun.stderr, /manifest-a\.docx|manifest-b\.docx/);

  await rm(path.join(tmpDir, files[3]));
  const missingFileList = files.map((filename) => path.join(tmpDir, filename)).join(path.delimiter);
  const missing = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["scripts/eval-ceshi.mjs", "--check-only"],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        EVAL_CESHI_FILES: missingFileList,
      },
    },
  );
  assert.notEqual(missing.status, 0, `${missing.stdout}\n${missing.stderr}`);
  assert.match(missing.stderr, /Missing private corpus regression files/);
  assert.match(missing.stderr, /fixtures\/local-real-files\.example\.json/);
  assert.match(missing.stderr, /input-04\.png path_sha256=/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("eval ceshi tests passed");
