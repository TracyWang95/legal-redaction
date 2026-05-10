#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_OUT_DIR = path.join("output", "playwright", "eval-ceshi-current");
const PRIVATE_CORPUS_ENV = "EVAL_CESHI_DIR";
const DEFAULT_CESHI_GATE_ENV = {
  EVAL_BATCH_MIN_TOTAL_ENTITIES: "1",
  EVAL_BATCH_MIN_TOTAL_BOXES: "1",
  EVAL_BATCH_MAX_PDF_SIZE_RATIO: "8",
  EVAL_BATCH_MAX_PDF_SIZE_BYTES: "20971520",
  EVAL_BATCH_WARN_PDF_SIZE_RATIO: "4",
  EVAL_BATCH_WARN_PDF_SIZE_BYTES: "10485760",
};
const REQUIRED_FILE_COUNT = 4;

function usage() {
  console.log(`Usage:
  npm run eval:ceshi
  npm run eval:ceshi -- output/playwright/eval-ceshi-current
  npm run eval:ceshi:diagnostics-only -- output/playwright/eval-ceshi-diagnostics-current
  npm run eval:ceshi:diagnostics-plan -- output/playwright/eval-ceshi-current
  node scripts/eval-ceshi.mjs --check-only
  node scripts/eval-ceshi.mjs --preflight
  node scripts/eval-ceshi.mjs --dry-run
  node scripts/eval-ceshi.mjs --diagnostics-only output/playwright/eval-ceshi-current
  node scripts/eval-ceshi.mjs --manifest fixtures/local-real-files.json --check-only

Options via env:
  EVAL_CESHI_DIR   Directory containing a private corpus with at least 2 docx, 1 pdf, and 1 image
  EVAL_CESHI_MANIFEST  JSON manifest listing replacement real files; copy fixtures/local-real-files.example.json first
  EVAL_CESHI_FILES     Four replacement file paths separated by ${JSON.stringify(path.delimiter)}
  EVAL_BATCH_MIN_TOTAL_ENTITIES  Private gate minimum text entities, default ${DEFAULT_CESHI_GATE_ENV.EVAL_BATCH_MIN_TOTAL_ENTITIES}
  EVAL_BATCH_MIN_TOTAL_BOXES     Private gate minimum visual boxes, default ${DEFAULT_CESHI_GATE_ENV.EVAL_BATCH_MIN_TOTAL_BOXES}
  EVAL_BATCH_MAX_PDF_SIZE_RATIO  Private gate redacted/original PDF fail ratio, default ${DEFAULT_CESHI_GATE_ENV.EVAL_BATCH_MAX_PDF_SIZE_RATIO}
  EVAL_BATCH_MAX_PDF_SIZE_BYTES  Private gate redacted PDF fail bytes, default ${DEFAULT_CESHI_GATE_ENV.EVAL_BATCH_MAX_PDF_SIZE_BYTES}
  EVAL_BATCH_WARN_PDF_SIZE_RATIO Private gate redacted/original PDF risk ratio, default ${DEFAULT_CESHI_GATE_ENV.EVAL_BATCH_WARN_PDF_SIZE_RATIO}
  EVAL_BATCH_WARN_PDF_SIZE_BYTES Private gate redacted PDF risk bytes, default ${DEFAULT_CESHI_GATE_ENV.EVAL_BATCH_WARN_PDF_SIZE_BYTES}
  EVAL_CESHI_FULL_CONTRACT_PAGES Optional contract PDF pages for full vision diagnostics; default 1-6 only for the built-in private corpus

Auth/API env is forwarded to eval:batch-e2e:
  DATAINFRA_API
  DATAINFRA_PASSWORD
  DATAINFRA_TOKEN
  DATAINFRA_TOKEN_FILE
`);
}

function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(0);
  }
  const checkOnly =
    argv.includes("--check-only") ||
    process.env.npm_config_check_only === "true";
  const preflight =
    argv.includes("--preflight") ||
    process.env.npm_config_preflight === "true";
  const dryRun =
    argv.includes("--dry-run") || process.env.npm_config_dry_run === "true";
  const diagnostics =
    argv.includes("--diagnostics") ||
    argv.includes("--diagnostics-only") ||
    process.env.npm_config_diagnostics === "true" ||
    process.env.npm_config_diagnostics_only === "true";
  const diagnosticsOnly =
    argv.includes("--diagnostics-only") ||
    process.env.npm_config_diagnostics_only === "true";
  let manifest = process.env.EVAL_CESHI_MANIFEST || "";
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      manifest = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      manifest = arg.slice("--manifest=".length);
      continue;
    }
    if (arg.startsWith("-")) continue;
    positional.push(arg);
  }
  const outDir = positional[0] || DEFAULT_OUT_DIR;
  return { checkOnly, diagnostics, diagnosticsOnly, dryRun, manifest, outDir, preflight };
}

function normalizeManifestPath(filePath, baseDir) {
  if (!filePath || typeof filePath !== "string") return "";
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function readManifestFiles(manifestPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const baseDir = path.dirname(absoluteManifest);
  const raw = JSON.parse(readFileSync(absoluteManifest, "utf8"));
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeManifestPath(item, baseDir));
  }
  if (Array.isArray(raw?.files)) {
    return raw.files.map((item) => {
      if (typeof item === "string") return normalizeManifestPath(item, baseDir);
      return normalizeManifestPath(item?.path, baseDir);
    });
  }
  const keyed = [
    raw?.docx_a ?? raw?.docxA ?? raw?.text_docx_a,
    raw?.docx_b ?? raw?.docxB ?? raw?.text_docx_b,
    raw?.pdf ?? raw?.contract_pdf,
    raw?.image ?? raw?.png ?? raw?.sample_image,
  ];
  return keyed.map((item) => normalizeManifestPath(item, baseDir));
}

function readEnvFileList() {
  const raw = process.env.EVAL_CESHI_FILES;
  if (!raw) return null;
  const newlineItems = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (newlineItems.length > 1) return newlineItems;
  return raw
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertCeshiFileList(files, source) {
  if (
    !Array.isArray(files) ||
    files.length !== REQUIRED_FILE_COUNT ||
    files.some((file) => !file)
  ) {
    throw new Error(
      `${source} must list exactly ${REQUIRED_FILE_COUNT} files: docx_a, docx_b, pdf, image`,
    );
  }
  return files;
}

function discoverPrivateCorpusFiles(root) {
  if (!root) {
    throw new Error(
      `Set ${PRIVATE_CORPUS_ENV}, EVAL_CESHI_MANIFEST, or EVAL_CESHI_FILES before running the private corpus gate.`,
    );
  }
  if (!existsSync(root)) {
    throw new Error(`Private corpus directory not found. Set ${PRIVATE_CORPUS_ENV} to a local directory.`);
  }
  const entries = readdirSync(root, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  const byExt = (ext) => files.filter((file) => path.extname(file).toLowerCase() === ext);
  const image = byExt(".png")[0] || byExt(".jpg")[0] || byExt(".jpeg")[0];
  const pdf = byExt(".pdf")[0];
  const docx = byExt(".docx");
  const selected = [...docx.slice(0, 2), pdf, image].filter(Boolean);
  if (!image || !pdf || docx.length < 2 || selected.length !== REQUIRED_FILE_COUNT) {
    throw new Error(
      `Private corpus directory must contain at least 2 docx files, 1 pdf, and 1 image. Set ${PRIVATE_CORPUS_ENV} or use EVAL_CESHI_MANIFEST.`,
    );
  }
  return selected;
}

function resolveCeshiFiles(manifest = "") {
  if (manifest) {
    return assertCeshiFileList(
      readManifestFiles(manifest),
      `manifest ${manifest}`,
    );
  }
  const envFiles = readEnvFileList();
  if (envFiles) {
    return assertCeshiFileList(envFiles, "EVAL_CESHI_FILES");
  }
  return assertCeshiFileList(
    discoverPrivateCorpusFiles(process.env[PRIVATE_CORPUS_ENV] || ""),
    PRIVATE_CORPUS_ENV,
  );
}

function resolveCeshiGateEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(DEFAULT_CESHI_GATE_ENV).map(([key, defaultValue]) => [
      key,
      env[key] ?? defaultValue,
    ]),
  );
}

function printCeshiGateEnv(gateEnv) {
  console.log("private corpus quality gate defaults:");
  for (const [key, value] of Object.entries(gateEnv)) {
    console.log(`- ${key}=${value}`);
  }
}

function printCeshiRuntimeNotes() {
  console.log("private corpus runtime notes:");
  console.log(
    "- Auth: when AUTH_ENABLED=false or the live backend reports auth disabled, eval scripts do not need DATAINFRA_* credentials. When auth is enabled, use DATAINFRA_TOKEN, DATAINFRA_TOKEN_FILE, or DATAINFRA_PASSWORD; prefer DATAINFRA_TOKEN_FILE=tmp/eval-token.txt for repeatable local gates.",
  );
  console.log(
    "- GPU: default page concurrency is 2 per image/scanned-PDF file, not per batch. Run the real private corpus batch E2E only when model services are healthy and the GPU is idle. Lower BATCH_RECOGNITION_PAGE_CONCURRENCY=1 and keep VISION_DUAL_PIPELINE_PARALLEL=false when memory is tight; keep HaS Text GPU offload enabled with HAS_TEXT_N_GPU_LAYERS=-1. This script does not stop or restart model services.",
  );
  console.log(
    "- Backend storage: if eval:batch-e2e writes summary.partial.json after HTTP 500 or metadata_degraded, follow its next_steps to check backend logs, SQLite drvfs/WAL behavior, and npm run doctor:strict; the default steps use redacted file labels.",
  );
}

function realE2ESkipReason({ checkOnly = false, diagnosticsOnly = false, dryRun = false, preflight = false } = {}) {
  if (preflight) {
    return "preflight mode checks local corpus paths and writes readiness metadata only; it does not require credentials, upload files, or launch the batch E2E";
  }
  if (checkOnly) {
    return "check-only mode validates the local corpus paths and gate defaults only";
  }
  if (dryRun) {
    return "dry-run mode prints the resolved commands only; no upload, browser, or backend mutation is performed";
  }
  if (diagnosticsOnly) {
    return "diagnostics-only mode intentionally skips the authenticated product batch E2E and runs direct text/OCR/vision layers instead";
  }
  return "";
}

function writeCeshiPreflightSummary(outDir, files, refs, gateEnv, skipReason) {
  mkdirSync(outDir, { recursive: true });
  const summary = {
    generated_at: new Date().toISOString(),
    mode: "preflight",
    output_dir: reportOutputPath(process.cwd(), outDir),
    inputs: refs,
    input_count: files.length,
    gate_env: gateEnv,
    privacy: {
      private_details: includePrivateReportDetails(),
    },
    batch_e2e: {
      skipped: true,
      skip_reason: skipReason,
    },
    auth: {
      credential_required_for_preflight: false,
      real_e2e_note: "if auth is enabled for the live backend, the real batch E2E needs DATAINFRA_TOKEN, DATAINFRA_TOKEN_FILE, or DATAINFRA_PASSWORD",
    },
  };
  const target = path.join(outDir, "preflight-summary.json");
  writeFileSync(target, JSON.stringify(summary, null, 2), "utf8");
  console.log(`private corpus preflight summary: ${reportOutputPath(process.cwd(), target)}`);
}

function pythonCmd() {
  return (
    process.env.PYTHON ||
    (process.platform === "win32" ? "python.exe" : "python")
  );
}

function diagnosticPlan(outDir, files, options = {}) {
  const diagnosticsDir = path.join(outDir, "diagnostics");
  const py = pythonCmd();
  const refs = options.fileRefs || fileRefs(files);
  const fullContractPages =
    process.env.EVAL_CESHI_FULL_CONTRACT_PAGES ||
    (options.privateCorpus ? "1-6" : "");
  const commands = [
    {
      id: "text-docx-a",
      kind: "text",
      input: files[0],
      input_label: refs[0]?.label || "input-01",
      output_dir: path.join(diagnosticsDir, "text-docx-a"),
      command: [
        py,
        "scripts/eval-text-direct.py",
        files[0],
        path.join(diagnosticsDir, "text-docx-a"),
      ],
    },
    {
      id: "text-docx-b",
      kind: "text",
      input: files[1],
      input_label: refs[1]?.label || "input-02",
      output_dir: path.join(diagnosticsDir, "text-docx-b"),
      command: [
        py,
        "scripts/eval-text-direct.py",
        files[1],
        path.join(diagnosticsDir, "text-docx-b"),
      ],
    },
    {
      id: "ocr-contract-pdf",
      kind: "ocr",
      input: files[2],
      input_label: refs[2]?.label || "input-03",
      output_dir: path.join(diagnosticsDir, "ocr-contract-pdf"),
      command: [
        py,
        "scripts/eval-ocr-direct.py",
        files[2],
        path.join(diagnosticsDir, "ocr-contract-pdf"),
        "--mode",
        "structure",
        "--pages",
        "1",
        "5",
        "--write-pages",
      ],
    },
    {
      id: "vision-contract-pdf",
      kind: "vision",
      input: files[2],
      input_label: refs[2]?.label || "input-03",
      output_dir: path.join(diagnosticsDir, "vision-contract-pdf"),
      command: [
        py,
        "scripts/eval-vision-direct.py",
        files[2],
        path.join(diagnosticsDir, "vision-contract-pdf"),
        "--ocr-mode",
        "structure",
        "--pages",
        "1",
        "5",
        "--write-pages",
        "--max-warnings",
        "-1",
      ],
    },
  ];

  if (fullContractPages) {
    commands.push({
      id: "vision-contract-pdf-all",
      kind: "vision",
      input: files[2],
      input_label: refs[2]?.label || "input-03",
      output_dir: path.join(diagnosticsDir, "vision-contract-pdf-all"),
      command: [
        py,
        "scripts/eval-vision-direct.py",
        files[2],
        path.join(diagnosticsDir, "vision-contract-pdf-all"),
        "--ocr-mode",
        "structure",
        "--pages",
        fullContractPages,
        "--write-pages",
        "--max-warnings",
        "-1",
        "--min-page-visual-regions",
        "1",
        "--min-total-has-image-regions",
        "1",
      ],
    });
  }

  commands.push(
    {
      id: "seal-contract-pdf",
      kind: "seal",
      input: files[2],
      input_label: refs[2]?.label || "input-03",
      output_dir: path.join(diagnosticsDir, "seal-contract-pdf"),
      command: [
        py,
        "scripts/eval-seal-offline.py",
        files[2],
        path.join(diagnosticsDir, "seal-contract-pdf"),
        "--write-pages",
      ],
    },
    {
      id: "vision-image-png",
      kind: "vision",
      input: files[3],
      input_label: refs[3]?.label || "input-04",
      output_dir: path.join(diagnosticsDir, "vision-image-png"),
      command: [
        py,
        "scripts/eval-vision-direct.py",
        files[3],
        path.join(diagnosticsDir, "vision-image-png"),
        "--ocr-mode",
        "structure",
        "--write-pages",
        "--max-warnings",
        "-1",
        "--min-total-has-image-regions",
        "1",
      ],
    },
  );

  return commands;
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function backendStorageFailureSteps(summary) {
  const steps = Array.isArray(summary?.next_steps) ? summary.next_steps : [];
  return steps.filter((step) => /backend logs|SQLite|drvfs|WAL|doctor:strict/i.test(String(step)));
}

function printBatchFailureGuidance(outDir) {
  const partial = readJsonIfExists(path.join(outDir, "summary.partial.json"));
  const steps = backendStorageFailureSteps(partial);
  if (steps.length === 0) return;
  console.error("private corpus batch backend/storage next steps:");
  for (const step of steps) {
    console.error(`- ${step}`);
  }
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function includePrivateReportDetails() {
  return envFlag("EVAL_REPORT_INCLUDE_PRIVATE_DETAILS", false);
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

function fileLabel(file, index) {
  const extension = path.extname(file).toLowerCase();
  return `input-${String(index + 1).padStart(2, "0")}${extension}`;
}

function fileRefs(files) {
  return files.map((file, index) => {
    const resolved = path.resolve(file);
    const basename = path.basename(file);
    const ref = {
      label: fileLabel(file, index),
      extension: path.extname(file).toLowerCase(),
      path_sha256: shortHash(resolved),
      basename_sha256: shortHash(basename),
    };
    if (includePrivateReportDetails()) {
      ref.path = resolved;
      ref.basename = basename;
    }
    return ref;
  });
}

function shouldRunPrivateDiagnosticAssertions(manifest) {
  if (process.env.EVAL_CESHI_PRIVATE_ASSERTIONS != null) {
    return envFlag("EVAL_CESHI_PRIVATE_ASSERTIONS", true);
  }
  return !manifest && !process.env.EVAL_CESHI_FILES;
}

function assertDiagnosticContract(condition, message) {
  if (!condition) throw new Error(`private corpus diagnostics contract failed: ${message}`);
}

function assertArtifactContract(condition, message) {
  if (!condition) throw new Error(`private corpus artifact contract failed: ${message}`);
}

function assertRequiredFile(filePath, label) {
  assertArtifactContract(existsSync(filePath), `${label} must exist`);
}

function readRequiredJson(filePath, label) {
  assertRequiredFile(filePath, label);
  const value = readJsonIfExists(filePath);
  assertArtifactContract(value != null, `${label} must be valid JSON`);
  return value;
}

function assertBatchArtifactContract(outDir) {
  const summary = readRequiredJson(path.join(outDir, "summary.json"), "summary.json");
  readRequiredJson(path.join(outDir, "export-report.json"), "export-report.json");
  assertRequiredFile(path.join(outDir, "report.html"), "report.html");
  const pdfGate = summary?.quality_gate?.pdf_size_regression;
  assertArtifactContract(
    pdfGate && typeof pdfGate === "object",
    "summary.json quality_gate.pdf_size_regression must exist",
  );
  for (const field of ["checked_count", "failed_count", "risk_count"]) {
    assertArtifactContract(
      Number.isFinite(Number(pdfGate[field])),
      `summary.json quality_gate.pdf_size_regression.${field} must exist`,
    );
  }
  assertArtifactContract(
    Array.isArray(pdfGate.checked),
    "summary.json quality_gate.pdf_size_regression.checked must exist",
  );
  const thresholds = pdfGate.thresholds || {};
  for (const field of [
    "max_pdf_size_ratio",
    "max_pdf_size_bytes",
    "warn_pdf_size_ratio",
    "warn_pdf_size_bytes",
  ]) {
    assertArtifactContract(
      Number.isFinite(Number(thresholds[field])),
      `summary.json quality_gate.pdf_size_regression.thresholds.${field} must exist`,
    );
  }
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item?.[key];
    if (typeof value === "string" && value) counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function validatePrivateDiagnosticOutputs(outDir) {
  const diagnosticsDir = path.join(outDir, "diagnostics");
  const visionDir = path.join(diagnosticsDir, "vision-contract-pdf");
  const visionAllDir = path.join(diagnosticsDir, "vision-contract-pdf-all");
  const visionSummary = readJsonIfExists(path.join(visionDir, "summary.json"));
  const visionAllSummary = readJsonIfExists(path.join(visionAllDir, "summary.json"));
  const pageFive = readJsonIfExists(path.join(visionDir, "page-05.json"));
  const pageFiveOcrDiagnostics = readJsonIfExists(
    path.join(visionDir, "page-05-ocr-diagnostics.json"),
  );

  assertDiagnosticContract(visionSummary?.quality_gate?.passed === true, "vision-contract-pdf quality gate must pass");
  assertDiagnosticContract(
    visionAllSummary?.quality_gate?.passed === true,
    "vision-contract-pdf-all quality gate must pass",
  );
  assertDiagnosticContract(
    Array.isArray(visionAllSummary?.pages) && visionAllSummary.pages.length === 6,
    "vision-contract-pdf-all must evaluate all 6 private contract pages",
  );
  for (const page of visionAllSummary.pages) {
    assertDiagnosticContract(
      Number(page?.visual_count || 0) >= 1,
      `vision-contract-pdf-all page ${page?.page} must have at least one visual region`,
    );
    assertDiagnosticContract(
      page?.overlay_image && existsSync(path.join(visionAllDir, page.overlay_image)),
      `vision-contract-pdf-all page ${page?.page} overlay image must exist`,
    );
  }
  assertDiagnosticContract(Array.isArray(pageFive), "vision-contract-pdf/page-05.json must exist");
  assertDiagnosticContract(
    Array.isArray(pageFiveOcrDiagnostics),
    "vision-contract-pdf/page-05-ocr-diagnostics.json must exist",
  );

  const pageFiveBySource = countBy(pageFive, "source");
  const pageFiveTypes = new Set(pageFive.map((region) => region?.type).filter(Boolean));
  assertDiagnosticContract(pageFive.length >= 4, "contract page 5 should keep visual seal boxes");
  assertDiagnosticContract(
    pageFiveBySource.has_image >= 2,
    "contract page 5 should keep main HaS Image seal boxes",
  );
  assertDiagnosticContract(
    pageFiveBySource.red_seal_fallback >= 2,
    "contract page 5 should keep right-edge seam seal fallback boxes",
  );
  assertDiagnosticContract(
    [...pageFiveTypes].every((type) => type === "official_seal" || type === "qr_code"),
    "contract page 5 final regions should be seal/QR visual regions only",
  );
  assertDiagnosticContract(
    pageFive.every((region) => !String(region?.source || "").startsWith("ocr_")),
    "contract page 5 final regions must not include OCR text sources",
  );

  const seamSeals = pageFive.filter((region) => region?.source === "red_seal_fallback");
  assertDiagnosticContract(
    seamSeals.every(
      (region) =>
        Number(region.x) >= 0.9 &&
        Number(region.width) >= 0.03 &&
        Number(region.width) <= 0.08 &&
        Number(region.height) >= 0.1 &&
        Number(region.height) <= 0.18,
    ),
    "right-edge seam seals should stay in the expected coordinate window",
  );
  assertDiagnosticContract(
    pageFiveOcrDiagnostics.length >= 16,
    "contract page 5 OCR text diagnostics should preserve filtered text evidence",
  );
  assertDiagnosticContract(
    (visionSummary.ocr_artifact_filter?.removed_regions || 0) >= 1,
    "contract diagnostics should report OCR artifact filtering",
  );
  assertDiagnosticContract(
    (visionSummary.ocr_text_filter?.diagnostic_regions || 0) >= 16,
    "contract diagnostics should report OCR text moved to diagnostics",
  );

  const sealSummary = readJsonIfExists(
    path.join(diagnosticsDir, "seal-contract-pdf", "summary.json"),
  );
  assertDiagnosticContract(sealSummary?.quality_gate?.passed === true, "seal-contract-pdf quality gate must pass");

  return {
    passed: true,
    vision_contract_page_5: {
      region_count: pageFive.length,
      by_source: pageFiveBySource,
      ocr_diagnostic_regions: pageFiveOcrDiagnostics.length,
    },
  };
}

function assertDiagnosticCommandArtifacts(def, outDir, options = {}) {
  const summary = readRequiredJson(
    path.join(def.output_dir, "summary.json"),
    `${def.id}/summary.json`,
  );
  assertRequiredFile(path.join(def.output_dir, "report.html"), `${def.id}/report.html`);
  if (def.id !== "vision-contract-pdf-all" || !options.privateCorpus) return summary;

  const pages = Array.isArray(summary.pages) ? summary.pages : [];
  assertArtifactContract(
    pages.length === 6,
    "vision-contract-pdf-all summary.json must contain 6 pages",
  );
  for (const page of pages) {
    const pageNumber = Number(page?.page);
    assertArtifactContract(
      Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 6,
      "vision-contract-pdf-all summary pages must be numbered 1-6",
    );
    assertArtifactContract(
      page?.overlay_image,
      `vision-contract-pdf-all page ${pageNumber} overlay_image must exist in summary`,
    );
    assertRequiredFile(
      path.join(def.output_dir, page.overlay_image),
      `vision-contract-pdf-all page ${pageNumber} overlay`,
    );
  }
  return summary;
}

function assertDiagnosticsArtifactContract(outDir, commands, options = {}) {
  const diagnosticsDir = path.join(outDir, "diagnostics");
  const summary = readRequiredJson(
    path.join(diagnosticsDir, "diagnostics-summary.json"),
    "diagnostics/diagnostics-summary.json",
  );
  assertRequiredFile(path.join(diagnosticsDir, "report.html"), "diagnostics/report.html");
  assertArtifactContract(
    Array.isArray(summary.commands) && summary.commands.length === commands.length,
    "diagnostics-summary.json commands must match the diagnostics plan",
  );
  for (const def of commands) {
    assertDiagnosticCommandArtifacts(def, outDir, options);
  }
  return summary;
}

function summarizeDiagnosticCommand(def, status, dryRun = false, outDir = process.cwd()) {
  const summaryPath = path.join(def.output_dir, "summary.json");
  const reportPath = path.join(def.output_dir, "report.html");
  const summary = dryRun ? null : readJsonIfExists(summaryPath);
  const gate =
    summary?.quality_gate && typeof summary.quality_gate === "object"
      ? summary.quality_gate
      : null;
  return {
    id: def.id,
    kind: def.kind,
    input: def.input_label || "input",
    output_dir: reportOutputPath(outDir, def.output_dir),
    command: formatDiagnosticCommand(def, outDir),
    ...(includePrivateReportDetails()
      ? { private_input: def.input, private_output_dir: def.output_dir }
      : {}),
    status,
    ok: dryRun ? null : status === 0 && (gate ? gate.passed !== false : true),
    summary_path: reportOutputPath(outDir, summaryPath),
    report_path: reportOutputPath(outDir, reportPath),
    summary_href: relativeArtifactLink(path.join(outDir, "diagnostics"), summaryPath),
    report_href: relativeArtifactLink(path.join(outDir, "diagnostics"), reportPath),
    quality_gate: gate,
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function relativeArtifactLink(fromDir, targetPath) {
  return path.relative(fromDir, targetPath).replace(/\\/g, "/");
}

function reportOutputPath(outDir, targetPath) {
  if (includePrivateReportDetails()) return path.resolve(targetPath);
  return path.relative(path.resolve(outDir), path.resolve(targetPath)).replace(/\\/g, "/");
}

function formatDiagnosticCommand(def, outDir) {
  if (includePrivateReportDetails()) return def.command;
  return def.command.map((arg) => {
    if (arg === def.input) return def.input_label || "input";
    if (arg === def.output_dir) return reportOutputPath(outDir, def.output_dir);
    return arg;
  });
}

function diagnosticSpawnCommand(def) {
  const runner = process.env.EVAL_CESHI_DIAGNOSTIC_RUNNER;
  if (!runner) return def.command;
  let runnerArgs = [];
  const rawRunnerArgs = process.env.EVAL_CESHI_DIAGNOSTIC_RUNNER_ARGV;
  if (rawRunnerArgs) {
    const parsed = JSON.parse(rawRunnerArgs);
    assertArtifactContract(
      Array.isArray(parsed) && parsed.every((item) => typeof item === "string"),
      "EVAL_CESHI_DIAGNOSTIC_RUNNER_ARGV must be a JSON string array",
    );
    runnerArgs = parsed;
  }
  return [runner, ...runnerArgs, ...def.command];
}

function renderDiagnosticsReport(summary) {
  const diagnosticsDir = summary.diagnostics_dir;
  const statusText = summary.passed === true ? "PASS" : summary.passed === false ? "FAIL" : "PLAN";
  const rows = (summary.commands || []).map((item) => {
    const gate = item.quality_gate || {};
    const gateText = gate.passed == null ? "-" : gate.passed ? "pass" : "fail";
    const statusClass = item.ok === true ? "pass" : item.ok === false ? "fail" : "muted";
    const reportLink = item.report_path
      ? `<a href="${escapeHtml(item.report_href || relativeArtifactLink(diagnosticsDir, item.report_path))}">report</a>`
      : "-";
    const summaryLink = item.summary_path
      ? `<a href="${escapeHtml(item.summary_href || relativeArtifactLink(diagnosticsDir, item.summary_path))}">summary</a>`
      : "-";
    const counts = [
      gate.total_boxes != null ? `boxes ${gate.total_boxes}` : "",
      gate.total_visual_boxes != null ? `visual ${gate.total_visual_boxes}` : "",
      gate.total_has_image_boxes != null ? `HaS ${gate.total_has_image_boxes}` : "",
      gate.total_regions != null ? `regions ${gate.total_regions}` : "",
      gate.warning_count != null ? `warnings ${gate.warning_count}` : "",
    ].filter(Boolean).join(" 路 ") || "-";
    return `<tr>
      <td><code>${escapeHtml(item.id)}</code></td>
      <td>${escapeHtml(item.kind)}</td>
      <td class="${statusClass}">${escapeHtml(item.ok == null ? "planned" : item.ok ? "ok" : "failed")}</td>
      <td>${escapeHtml(gateText)}</td>
      <td>${escapeHtml(counts)}</td>
      <td>${reportLink} 路 ${summaryLink}</td>
    </tr>`;
  }).join("\n");
  const privateAssertions = summary.private_assertions || {};
  const batchE2E = summary.batch_e2e || {};
  const batchE2EText = batchE2E.skipped
    ? `skipped: ${batchE2E.skip_reason || "requested"}`
    : "not skipped";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>private corpus Diagnostics</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 32px; color: #172033; background: #f8fafc; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .muted { color: #64748b; }
    .metrics { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0; }
    .metric { background: white; border: 1px solid #dbe3ef; border-radius: 8px; padding: 12px 14px; min-width: 120px; }
    .metric b { display: block; font-size: 22px; margin-top: 4px; }
    .pass { color: #047857; }
    .fail { color: #b91c1c; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #dbe3ef; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #e5edf6; text-align: left; vertical-align: top; }
    th { background: #eef4fb; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
    code { background: #eef4fb; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>private corpus Diagnostics</h1>
  <p class="muted">Generated ${escapeHtml(summary.generated_at)}. Open each layer report for page overlays and detailed gate output.</p>
  <p class="muted">Real batch E2E: ${escapeHtml(batchE2EText)}</p>
  <div class="metrics">
    <div class="metric">Status<b class="${summary.passed === false ? "fail" : "pass"}">${escapeHtml(statusText)}</b></div>
    <div class="metric">Commands<b>${escapeHtml((summary.commands || []).length)}</b></div>
    <div class="metric">Private assertions<b class="${privateAssertions.passed ? "pass" : "muted"}">${escapeHtml(privateAssertions.passed ? "pass" : privateAssertions.skipped ? "skipped" : "-")}</b></div>
  </div>
  <table>
    <thead><tr><th>layer</th><th>kind</th><th>status</th><th>gate</th><th>counts</th><th>artifacts</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function runDiagnostics(
  outDir,
  files,
  dryRun = false,
  privateAssertions = false,
  privateCorpus = false,
  batchE2ESkipReason = "",
) {
  const refs = fileRefs(files);
  const commands = diagnosticPlan(outDir, files, { privateCorpus, fileRefs: refs });
  const diagnosticsDir = path.join(outDir, "diagnostics");
  console.log("private corpus diagnostics commands:");
  for (const def of commands) {
    console.log(`- ${def.id}: ${formatDiagnosticCommand(def, outDir).join(" ")}`);
  }

  if (dryRun) {
    return {
      generated_at: new Date().toISOString(),
      dry_run: true,
      output_dir: reportOutputPath(process.cwd(), outDir),
      diagnostics_dir: reportOutputPath(outDir, diagnosticsDir),
      report_path: reportOutputPath(outDir, path.join(diagnosticsDir, "report.html")),
      inputs: refs,
      privacy: {
        private_details: includePrivateReportDetails(),
      },
      batch_e2e: {
        skipped: Boolean(batchE2ESkipReason),
        skip_reason: batchE2ESkipReason || null,
      },
      passed: null,
      commands: commands.map((def) =>
        summarizeDiagnosticCommand(def, null, true, outDir),
      ),
    };
  }

  mkdirSync(diagnosticsDir, { recursive: true });
  const results = [];
  for (const def of commands) {
    mkdirSync(def.output_dir, { recursive: true });
    console.log(`\nprivate corpus diagnostic ${def.id}`);
    const [cmd, ...args] = diagnosticSpawnCommand(def);
    const result = spawnSync(cmd, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    results.push(summarizeDiagnosticCommand(def, result.status ?? 1, false, outDir));
    if ((result.status ?? 1) === 0) {
      assertDiagnosticCommandArtifacts(def, outDir, { privateCorpus });
    }
  }
  const privateAssertionResult = privateAssertions
    ? validatePrivateDiagnosticOutputs(outDir)
    : { passed: null, skipped: true };
  if (privateAssertionResult.passed) {
    console.log("private corpus diagnostics assertions: pass");
  }
  const summary = {
    generated_at: new Date().toISOString(),
    dry_run: false,
    output_dir: reportOutputPath(process.cwd(), outDir),
    diagnostics_dir: reportOutputPath(outDir, diagnosticsDir),
    report_path: reportOutputPath(outDir, path.join(diagnosticsDir, "report.html")),
    inputs: refs,
    privacy: {
      private_details: includePrivateReportDetails(),
    },
    batch_e2e: {
      skipped: Boolean(batchE2ESkipReason),
      skip_reason: batchE2ESkipReason || null,
    },
    passed: results.every((item) => item.ok === true),
    private_assertions: privateAssertionResult,
    commands: results,
  };
  writeFileSync(
    path.join(diagnosticsDir, "diagnostics-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  writeFileSync(
    path.join(diagnosticsDir, "report.html"),
    renderDiagnosticsReport(summary),
    "utf8",
  );
  assertDiagnosticsArtifactContract(outDir, commands, { privateCorpus });
  console.log(
    `private corpus diagnostics summary: ${reportOutputPath(process.cwd(), path.join(diagnosticsDir, "diagnostics-summary.json"))}`,
  );
  console.log(`private corpus diagnostics report: ${reportOutputPath(process.cwd(), path.join(diagnosticsDir, "report.html"))}`);
  return summary;
}

const { checkOnly, diagnostics, diagnosticsOnly, dryRun, manifest, outDir, preflight } =
  parseArgs(process.argv.slice(2));
const privateDiagnosticAssertions = shouldRunPrivateDiagnosticAssertions(manifest);
const privateDiagnosticCorpus = !manifest && !process.env.EVAL_CESHI_FILES;
let files;
try {
  files = resolveCeshiFiles(manifest);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const missing = files.filter((file) => !existsSync(file));
const refs = fileRefs(files);

if (missing.length > 0) {
  console.error("Missing private corpus regression files:");
  for (const file of missing) {
    const index = files.indexOf(file);
    const ref = refs[index] || { label: fileLabel(file, index) };
    console.error(`- ${ref.label} path_sha256=${ref.path_sha256 || shortHash(path.resolve(file))}`);
  }
  console.error(
    "Set EVAL_CESHI_DIR for the private corpus, or copy fixtures/local-real-files.example.json to fixtures/local-real-files.json and use --manifest / EVAL_CESHI_MANIFEST for your own four-file real corpus.",
  );
  process.exit(1);
}

console.log(
  manifest
    ? `private corpus manifest files found: ${includePrivateReportDetails() ? path.resolve(manifest) : `manifest_sha256=${shortHash(path.resolve(manifest))}`}`
    : "private corpus regression files found:",
);
for (const ref of refs) console.log(`- ${ref.label} path_sha256=${ref.path_sha256}`);

const gateEnv = resolveCeshiGateEnv();
printCeshiGateEnv(gateEnv);
printCeshiRuntimeNotes();

if (preflight) {
  const skipReason = realE2ESkipReason({ preflight: true });
  console.log(`private corpus real E2E skipped: ${skipReason}`);
  writeCeshiPreflightSummary(outDir, files, refs, gateEnv, skipReason);
  process.exit(0);
}

if (checkOnly) {
  console.log(`private corpus real E2E skipped: ${realE2ESkipReason({ checkOnly: true })}`);
  process.exit(0);
}

if (dryRun) {
  const skipReason = realE2ESkipReason({ dryRun: true, diagnosticsOnly });
  console.log(`private corpus real E2E skipped: ${skipReason}`);
  if (!diagnosticsOnly) {
    console.log("private corpus batch command:");
    const displayFiles = includePrivateReportDetails() ? files : refs.map((ref) => ref.label);
    console.log([process.execPath, "scripts/eval-batch-e2e.mjs", reportOutputPath(process.cwd(), outDir), ...displayFiles].join(" "));
  }
  if (diagnostics) {
    const summary = runDiagnostics(
      outDir,
      files,
      true,
      privateDiagnosticAssertions,
      privateDiagnosticCorpus,
      diagnosticsOnly ? realE2ESkipReason({ diagnosticsOnly: true }) : skipReason,
    );
    console.log(
      `private corpus diagnostics summary: ${path.join(outDir, "diagnostics", "diagnostics-summary.json")}`,
    );
    console.log(
      `private corpus diagnostics report: ${path.join(outDir, "diagnostics", "report.html")}`,
    );
    console.log(`private corpus diagnostics planned: ${summary.commands.length}`);
  }
  process.exit(0);
}

let batchStatus = 0;
if (!diagnosticsOnly) {
  const result = spawnSync(
    process.execPath,
    ["scripts/eval-batch-e2e.mjs", outDir, ...files],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ...gateEnv,
        EVAL_BATCH_USE_LOCAL_CESHI: "1",
      },
    },
  );
  batchStatus = result.status ?? 1;
  if (batchStatus !== 0) {
    printBatchFailureGuidance(outDir);
  } else {
    assertBatchArtifactContract(outDir);
  }
}
if (diagnosticsOnly) {
  console.log(`private corpus real E2E skipped: ${realE2ESkipReason({ diagnosticsOnly: true })}`);
}

let diagnosticsStatus = 0;
if (diagnostics) {
  const summary = runDiagnostics(
    outDir,
    files,
    false,
    privateDiagnosticAssertions,
    privateDiagnosticCorpus,
    diagnosticsOnly ? realE2ESkipReason({ diagnosticsOnly: true }) : "",
  );
  diagnosticsStatus = summary.passed ? 0 : 1;
}

process.exit(batchStatus || diagnosticsStatus);
