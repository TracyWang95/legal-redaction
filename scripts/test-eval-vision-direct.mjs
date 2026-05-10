#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tmpDir = await mkdtemp(
  path.join(os.tmpdir(), "datainfra-eval-vision-direct-"),
);

async function withServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function spawnText(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

try {
  const imagePath = path.join(tmpDir, "vision-direct-smoke.png");
  const makeImage = spawnSync(
    process.platform === "win32" ? "python.exe" : "python",
    [
      "-c",
      [
        "from PIL import Image, ImageDraw",
        'img=Image.new("RGB",(640,480),"white")',
        "d=ImageDraw.Draw(img)",
        'd.text((40,80),"Contract No: HT-2026-001",fill=(0,0,0))',
        "d.ellipse([420,80,540,200], outline=(220,0,0), width=8)",
        "d.line([90,360,240,390], fill=(20,20,20), width=4)",
        'd.text((90,394),"signature",fill=(0,0,0))',
        `img.save(${JSON.stringify(imagePath)})`,
      ].join(";"),
    ],
    { cwd: rootDir, encoding: "utf8" },
  );
  assert.equal(makeImage.status, 0, `${makeImage.stdout}\n${makeImage.stderr}`);

  let sawOcrPayload = false;
  const ocrServer = await withServer((req, res) => {
    if (
      req.method !== "POST" ||
      !["/structure", "/ocr"].includes(req.url || "")
    ) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "not found" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      sawOcrPayload =
        typeof payload.image === "string" && payload.image.length > 100;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          boxes: [
            {
              text: req.url === "/ocr" ? "[seal]" : "Contract No: HT-2026-001",
              x: req.url === "/ocr" ? 0.66 : 0.05,
              y: req.url === "/ocr" ? 0.16 : 0.14,
              width: req.url === "/ocr" ? 0.18 : 0.44,
              height: req.url === "/ocr" ? 0.2 : 0.1,
              confidence: 0.9,
              label: req.url === "/ocr" ? "seal" : "text",
            },
            ...(req.url === "/ocr"
              ? [
                  {
                    text: "Signed by Alice",
                    x: 0.13,
                    y: 0.74,
                    width: 0.28,
                    height: 0.12,
                    confidence: 0.82,
                    label: "SIGNATURE",
                  },
                ]
              : []),
            ...(req.url === "/structure"
              ? [
                  {
                    text: "scanner edge artifact",
                    x: 0.0,
                    y: 0.42,
                    width: 0.18,
                    height: 0.08,
                    confidence: 0.9,
                    label: "text",
                  },
                  {
                    text: "blank low ink artifact",
                    x: 0.28,
                    y: 0.52,
                    width: 0.12,
                    height: 0.08,
                    confidence: 0.9,
                    label: "text",
                  },
                ]
              : []),
          ],
        }),
      );
    });
  });

  let sawHasImagePayload = false;
  const hasImageServer = await withServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/detect") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "not found" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      sawHasImagePayload =
        typeof payload.image_base64 === "string" &&
        payload.image_base64.length > 100;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          boxes: [
            {
              x: 0.62,
              y: 0.14,
              width: 0.22,
              height: 0.24,
              category: "official_seal",
              confidence: 0.88,
            },
            {
              x: 0.12,
              y: 0.72,
              width: 0.32,
              height: 0.14,
              category: "signature",
              confidence: 0.97,
            },
          ],
        }),
      );
    });
  });

  try {
    const result = await spawnText(
      process.platform === "win32" ? "python.exe" : "python",
      [
        "scripts/eval-vision-direct.py",
        imagePath,
        tmpDir,
        "--ocr-base-url",
        ocrServer.baseUrl,
        "--has-image-base-url",
        hasImageServer.baseUrl,
        "--pages",
        "1 1",
        "--write-pages",
      ],
      { cwd: rootDir, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /regions=/);
    assert.match(result.stdout, /visual=/);
    assert.match(result.stdout, /has_image=/);
    assert.match(result.stdout, /quality=pass/);

    const failDir = path.join(tmpDir, "threshold-fail");
    const failResult = await spawnText(
      process.platform === "win32" ? "python.exe" : "python",
      [
        "scripts/eval-vision-direct.py",
        imagePath,
        failDir,
        "--ocr-base-url",
        ocrServer.baseUrl,
        "--has-image-base-url",
        hasImageServer.baseUrl,
        "--min-total-visual-regions",
        "99",
        "--min-total-has-image-regions",
        "99",
      ],
      { cwd: rootDir, encoding: "utf8" },
    );
    assert.equal(
      failResult.status,
      1,
      `${failResult.stdout}\n${failResult.stderr}`,
    );
    assert.match(failResult.stdout, /quality=fail/);
    assert.match(failResult.stderr, /quality gate failed/);
    const failedSummary = JSON.parse(
      await readFile(path.join(failDir, "summary.json"), "utf8"),
    );
    assert.equal(failedSummary.quality_gate.passed, false);
    assert.equal(
      failedSummary.quality_gate.thresholds.min_total_visual_regions,
      99,
    );
    assert.equal(
      failedSummary.quality_gate.thresholds.min_total_has_image_regions,
      99,
    );
    assert(
      failedSummary.quality_gate.failed_checks.some((check) =>
        check.includes("total HaS Image regions"),
      ),
      JSON.stringify(failedSummary.quality_gate.failed_checks),
    );
  } finally {
    await ocrServer.close();
    await hasImageServer.close();
  }

  assert.equal(sawOcrPayload, true);
  assert.equal(sawHasImagePayload, true);
  const summary = JSON.parse(
    await readFile(path.join(tmpDir, "summary.json"), "utf8"),
  );
  const report = await readFile(path.join(tmpDir, "report.html"), "utf8");
  const pageRegions = JSON.parse(
    await readFile(path.join(tmpDir, "page-01.json"), "utf8"),
  );
  const ocrDiagnostics = JSON.parse(
    await readFile(path.join(tmpDir, "page-01-ocr-diagnostics.json"), "utf8"),
  );
  assert.equal(summary.page_count, 1);
  assert.equal(summary.input, "input-01.png");
  assert.equal(summary.privacy.private_details, false);
  assert.equal(summary.input_ref.path, undefined);
  assert.equal(typeof summary.input_ref.path_sha256, "string");
  assert.deepEqual(summary.selected_pages, [1]);
  assert.equal(summary.total_visual_regions >= 1, true);
  assert.equal(summary.total_has_image_regions, 1);
  assert.equal(summary.total_has_image_model_regions, 1);
  assert.equal(summary.total_signature_fallback_regions, 1);
  assert.equal(summary.quality_gate.passed, true);
  assert.equal(summary.quality_gate.error_count, 0);
  assert.equal(summary.ocr_artifact_filter.removed_regions, 2);
  assert.deepEqual(summary.ocr_artifact_filter.removed_by_reason, {
    page_edge: 1,
    low_ink: 1,
  });
  assert.equal(summary.ocr_text_filter.diagnostic_regions, 1);
  assert.equal(summary.deduplication.removed_regions >= 1, true);
  assert.equal(typeof summary.visual_review_by_issue, "object");
  assert.equal(summary.pages[0].deduplication.removed_regions >= 1, true);
  assert.equal(summary.pages[0].ocr_artifact_filter.removed_regions, 2);
  assert.equal(summary.pages[0].ocr_text_filter.diagnostic_regions, 1);
  assert.equal(typeof summary.pages[0].visual_review_by_issue, "object");
  assert.equal(summary.pages[0].by_source.ocr_structure, undefined);
  assert.equal(summary.pages[0].by_source.has_image, 1);
  assert.equal(summary.pages[0].has_image_count, 1);
  assert.equal(summary.pages[0].has_image_model_count, 1);
  assert.equal(summary.pages[0].signature_fallback_count, 1);
  assert.equal(summary.pages[0].by_type.signature, 1);
  assert.equal(
    summary.warnings.some((warning) =>
      warning.includes("signature/handwriting fallback region(s)") &&
      warning.includes("not HaS Image model classes"),
    ),
    true,
  );
  assert.equal(
    summary.warnings.some((warning) =>
      warning.includes("unsupported model response category 'signature'") &&
      warning.includes("fixed 21-class HaS Image contract"),
    ),
    true,
  );
  assert.equal(
    pageRegions.every(
      (region) =>
        typeof region.source_detail === "string" && Array.isArray(region.warnings),
    ),
    true,
  );
  assert.equal(
    pageRegions.some((region) => region.text === "scanner edge artifact"),
    false,
  );
  assert.equal(
    pageRegions.some((region) => region.text === "blank low ink artifact"),
    false,
  );
  assert.equal(
    pageRegions.some((region) => region.text === "Contract No: HT-2026-001"),
    false,
  );
  assert.equal(
    ocrDiagnostics.some(
      (region) => region.text === "[redacted]" && region.text_redacted === true,
    ),
    true,
  );
  assert.equal(
    ocrDiagnostics.some((region) => region.text === "Contract No: HT-2026-001"),
    false,
  );
  assert.equal(ocrDiagnostics[0].source_detail, "ocr_structure");
  assert.equal(Array.isArray(ocrDiagnostics[0].warnings), true);
  assert.equal(
    pageRegions.some((region) => region.source === "has_image"),
    true,
  );
  const signatureFallback = pageRegions.find(
    (region) => region.type === "signature",
  );
  assert.equal(signatureFallback?.source, "ocr_ocr");
  assert.equal(
    signatureFallback?.source_detail,
    "signature_ocr_fallback_not_has_image",
  );
  assert.deepEqual(signatureFallback?.warnings, [
    "signature_handwriting_fallback",
    "not_has_image_model_class",
    "not_counted_as_has_image",
  ]);
  assert.equal(
    pageRegions.some(
      (region) => region.source === "has_image" && region.type === "signature",
    ),
    false,
  );
  await access(path.join(tmpDir, "page-01-vision.png"));
  assert.match(report, /Direct Vision Evaluation/);
  assert.match(report, /Quality Gate/);
  assert.match(report, /Review Queue/);
  assert.match(report, /Deduped/);
  assert.match(report, /OCR artifact filter/);
  assert.match(report, /OCR text diagnostics/);
  assert.match(report, /Visual review issues/);
  assert.match(report, /Signature Fallback/);
  assert.match(report, /signature fallback/);
  assert.match(report, /PASS/);
  assert.match(report, /page-01-vision\.png/);
  assert.match(report, /official_seal/);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("eval vision direct tests passed");
