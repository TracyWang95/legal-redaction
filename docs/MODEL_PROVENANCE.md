# Model Provenance

This repository is Apache-2.0 source code. Model weights are third-party
artifacts and are not committed here.

Last checked: 2026-05-06.

This document records source, license, integrity, and capability boundaries for
the model artifacts expected by local deployments. It intentionally does not
record private mirror URLs, local absolute paths, Hugging Face tokens, or
unverified upstream commits.

The Hugging Face revisions below were read from the public Hugging Face API on
2026-05-06. Treat them as upstream reference revisions for this handoff. A
formal release should still confirm that the private mirror or deployment
snapshot uses the same revisions before publishing release artifacts.

## Required Artifacts

| Runtime role | Upstream artifact | License shown upstream | Default local filename | Redistribution note |
| --- | --- | --- | --- | --- |
| OCR / document parsing | `PaddlePaddle/PaddleOCR-VL` | Apache-2.0 | Hugging Face snapshot/cache used by vLLM; served as `PaddleOCR-VL-1.5-0.9B` in local scripts | Keep upstream license, model card, and custom-code/trust-remote-code notes with mirrored weights. |
| PaddleOCR-VL base model reference | `baidu/ERNIE-4.5-0.3B-Paddle` | Apache-2.0 | Not downloaded directly by this project | Relevant because the PaddleOCR-VL model tree identifies it as the base model. Preserve this reference when auditing PaddleOCR-VL. |
| Text semantic anonymization | `xuanwulab/HaS_4.0_0.6B_GGUF` | MIT | `HaS_Text_0209_0.6B_Q4_K_M.gguf` | The model tree identifies `Qwen/Qwen3-0.6B-Base` as the base model; preserve both HaS and Qwen references. |
| HaS Text base model reference | `Qwen/Qwen3-0.6B-Base` | Apache-2.0 | Not downloaded directly by this project | Relevant because HaS Text is a finetuned/quantized descendant. |
| Visual sensitive-region detection | `xuanwulab/HaS_Image_0209_FP32` | MIT | `sensitive_seg_best.pt` | Keep upstream license and attribution with the weights. |

## Optional Artifacts

These artifacts may appear in a maintainer environment or private mirror. They
are discovered by `npm run models:manifest` so a local deployment can keep one
sanitized inventory, but they are not required for the default open-source
workflow.

| Runtime role | Upstream artifact | License shown upstream | Observed local filename | Boundary |
| --- | --- | --- | --- | --- |
| Optional VLM | `unsloth/GLM-4.6V-Flash-GGUF` | MIT | `GLM-4.6V-Flash-Q4_K_M.gguf` | Optional local checklist-driven visual stage; keep signature/handwriting claims behind a separate quality gate. |
| Optional VLM projector | `unsloth/GLM-4.6V-Flash-GGUF` | MIT | `mmproj-F16.gguf` | Companion projector for the optional VLM artifact. |

## Verified Upstream Revisions

| Upstream artifact | Revision | Last modified from Hub API |
| --- | --- | --- |
| `xuanwulab/HaS_4.0_0.6B_GGUF` | `39a643aa8f19ad6c324fe96dacb1fc292fbe6095` | `2025-10-28T05:18:45.000Z` |
| `xuanwulab/HaS_Image_0209_FP32` | `3ed1114d783274208695e422bf22c017d6424669` | `2026-03-03T08:11:20.000Z` |
| `unsloth/GLM-4.6V-Flash-GGUF` | `c78a0727cb5ee489db2f218a212f613943023ee8` | `2025-12-27T11:17:13.000Z` |

## Source Links

- PaddleOCR-VL model card: <https://huggingface.co/PaddlePaddle/PaddleOCR-VL>
- PaddleOCR-VL license file: <https://huggingface.co/PaddlePaddle/PaddleOCR-VL/blob/main/LICENSE>
- ERNIE-4.5-0.3B-Paddle model card: <https://huggingface.co/baidu/ERNIE-4.5-0.3B-Paddle>
- HaS Text GGUF model card: <https://huggingface.co/xuanwulab/HaS_4.0_0.6B_GGUF>
- Qwen3-0.6B-Base model card: <https://huggingface.co/Qwen/Qwen3-0.6B-Base>
- HaS Image model card: <https://huggingface.co/xuanwulab/HaS_Image_0209_FP32>
- GLM-4.6V-Flash GGUF model card: <https://huggingface.co/unsloth/GLM-4.6V-Flash-GGUF>

## Operational Rules

- Do not commit model files, converted weights, or cached Hugging Face snapshots.
- Do not commit local absolute model paths. Keep operator paths in `.env`,
  local shell profiles, or ignored deployment configuration.
- If you mirror weights into a private registry, mirror the upstream license,
  model card, and this provenance document together.
- If you change a model repo, filename, quantization, or served model name,
  update [MODELS.md](./MODELS.md), this document, startup scripts, and relevant
  evaluation baselines in the same change.
- Do not invent an upstream commit. Record a Hugging Face commit only when it is
  taken from an actual snapshot revision, lockfile, or mirror metadata.
- `npm run doctor:strict` writes `output/doctor-report.json` with a provenance
  documentation check for CI and release review.

## Local Provenance Manifest

Generate a sanitized model manifest from the local operator environment or
private mirror metadata:

```bash
npm run models:manifest
```

The default output is `output/model-provenance-manifest.json`. For a custom
path, call the Node script directly: `node scripts/create-model-provenance-manifest.mjs --out <path>`.

By default the script checks `D:\has_models` and `/mnt/d/has_models` for the
required HaS Text and HaS Image files plus optional VLM/mmproj files. The output
is a deploy-time artifact, not a committed weight bundle. It records only
basenames, roles, required/optional status, file sizes, SHA-256 hashes, and
source metadata. It does not write absolute model paths.

Manifest fields per artifact:

```json
{
  "role": "has_text",
  "basename": "HaS_Text_0209_0.6B_Q4_K_M.gguf",
  "requirement": "required",
  "sha256": "<sha256 of local file or mirrored blob>",
  "sizeBytes": 0,
  "upstream": {
    "repo": "xuanwulab/HaS_4.0_0.6B_GGUF",
    "url": "https://huggingface.co/xuanwulab/HaS_4.0_0.6B_GGUF",
    "revision": "39a643aa8f19ad6c324fe96dacb1fc292fbe6095",
    "revisionSource": "huggingface-api",
    "revisionCheckedAt": "2026-05-06",
    "license": "MIT",
    "sourceDoc": "docs/MODEL_PROVENANCE.md"
  }
}
```

Rules for the manifest:

- `sha256` and `sizeBytes` are the primary local integrity checks.
- Absolute local paths, Windows drive paths, WSL mount paths, user home
  directories, Hugging Face cache paths, and private registry URLs must not
  appear in shared manifests.
- License values must come from the upstream model card or bundled license file
  at the recorded revision.
- For Hugging Face snapshots, verify that the private deployment or mirror uses
  the recorded upstream revision before publishing a release.

This mirrors the privacy rule used by
`scripts/create-eval-evidence-manifest.mjs`: manifests can preserve hashes,
sizes, relative artifact names, and selected metadata without leaking private
input paths.

## HaS Image Boundary

The HaS Image artifact is documented as the fixed 21-class visual detector used
by this project. Signature, handwritten-signing, and VLM-based signature
detection are not part of that model artifact. The optional GLM-4.6V-Flash VLM
stage is a separate local capability with its own provenance entry and should
have its own evaluation gate before broad capability claims are published.

Local fallback evidence is implementation logic, not a model provenance entry.
It should be tracked in code and evaluation reports as supplemental review
evidence, not as an upstream model hit.

Known HaS Image limits for this project:

- The model contract is the 21-class set documented in [MODELS.md](./MODELS.md).
- `paper` is part of the model contract but disabled by default to avoid whole
  page container boxes.
- `signature`, `handwritten`, `handwriting`, and `handwritten_signature` are
  not HaS Image classes.
- `official_seal` output is handled as explicit box/mask replacement. Current
  code does not claim background erasure, whitening, or inpainting.

Known OCR/Text limits:

- PaddleOCR-VL provides OCR/layout evidence; text entity classification still
  depends on OCR quality, OCR-to-page coordinate mapping, HaS Text behavior, and
  deterministic rules.
- HaS Text is a semantic anonymization model, not an exhaustive compliance
  classifier. Keep human review in the product workflow and evaluate recall on
  the target corpus before relying on it for a new domain.

## Local Integrity Commands

Use local hashes for your own mirror or deployment record. Hashes are not
hard-coded here because operators may use private mirrors or different
quantization variants. Replace `<models-dir>` with your local model directory;
do not copy the local directory itself into shared reports.

```bash
sha256sum <models-dir>/HaS_Text_0209_0.6B_Q4_K_M.gguf
sha256sum <models-dir>/sensitive_seg_best.pt
sha256sum <models-dir>/GLM-4.6V-Flash-Q4_K_M.gguf
sha256sum <models-dir>/mmproj-F16.gguf
```

For PaddleOCR-VL, record the Hugging Face commit or snapshot directory used by
the vLLM environment when freezing a deployment. Do not add a PaddleOCR-VL
commit value to this document unless it was verified from the actual snapshot.

For Windows PowerShell:

```powershell
Get-FileHash <models-dir>\HaS_Text_0209_0.6B_Q4_K_M.gguf -Algorithm SHA256
Get-FileHash <models-dir>\sensitive_seg_best.pt -Algorithm SHA256
Get-FileHash <models-dir>\GLM-4.6V-Flash-Q4_K_M.gguf -Algorithm SHA256
Get-FileHash <models-dir>\mmproj-F16.gguf -Algorithm SHA256
```

Only store the hash value, file size, filename, upstream repo, license, and
verified revision in a shared manifest. Keep the absolute path local.
