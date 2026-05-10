# Prompt-to-Artifact Quality Audit

Audit snapshot for the open-source handoff surface. This file records traceable
evidence found in the workspace; it is not a completion certificate.

Date: 2026-05-06 local workspace time.

## Scope

- Read-only evidence review across README, docs, package scripts, startup
  scripts, eval scripts, contract tests, and existing local output artifacts.
- No frontend or backend business code was changed by this audit.
- This workspace includes maintainer-local browser evidence for the private
  corpus. These artifacts are local evidence, not public CI fixtures, and the
  release report should point at the exact archived evidence set used for a
  candidate.
- Current evidence pointers checked here:
  `output/playwright/live-ui-private-current-final-pass-v3/summary.json`,
  `output/playwright/current-evidence-manifest.json`,
  `output/playwright/release-readiness-current/release-readiness-report.json`,
  and `output/playwright/node24-current/node24-proof.json`.
  `output/playwright/clean-copy-current/clean-copy-proof.json` records a local
  clean-copy smoke run with generated dependencies excluded from the source
  copy.

## Prompt-to-Artifact Checklist

| Prompt requirement | Current artifact evidence | Status | Release gap |
| --- | --- | --- | --- |
| Provide a one-command/local startup surface with Node 24 compatibility. | `output/playwright/node24-current/node24-proof.json` records Node 24, project engine `>=20 <25`, recommended `24`, and passing source-level gates including `node scripts/test-dev-attach.mjs`, `node scripts/test-docs-contract.mjs`, manifest tests, live UI wrapper tests, and `node scripts/dev.mjs --doctor --json`. | Evidence present. | This is workstation runtime evidence. A clean public checkout or CI image still needs to run the same gates before release tagging. |
| Keep public docs/scripts aligned on ports and auth behavior. | `scripts/test-docs-contract.mjs` is included in the Node 24 proof and checks frontend 3000, no stale Vite dev port in public docs/scripts, auth-disabled eval behavior, and token guidance scoped to auth-enabled runs. | Evidence present. | No separate clean CI status is recorded in this workspace snapshot. |
| Keep the public CI workflow aligned with the open-source gate. | `.github/workflows/ci.yml` is configured for Node 24, frontend `npm ci`, backend `requirements-ci.txt`, `npm run quality:fast`, and `npm run quality:frontend`; `scripts/test-docs-contract.mjs` now guards against `node-version: 20` and `requirements.lock` in CI. | Config evidence present. | The workflow configuration is checked locally, but a real GitHub Actions run is still required before release tagging. |
| Prove the public gate can bootstrap from a dependency-free source copy. | `output/playwright/clean-copy-current/clean-copy-proof.json` records a local clean-copy smoke: source copied without `.git`, dependency folders, output, temp files, or `.env`; `npm --prefix frontend ci`, backend `requirements-ci.txt` install, frontend build, and `npm run quality:fast` all passed. | Local clean-copy evidence present. | The smoke used the workstation Node 24/Python 3.13; hosted GitHub Actions remains the release-grade proof. |
| Prove real browser single-file and batch flows against maintainer private files without exposing private paths. | `output/playwright/live-ui-private-current-final-pass-v3/summary.json` passed with no findings, console issues, page errors, or failed requests. It records single-file image recognition/redaction evidence with 10 boxes and 1 entity, plus a 4-file batch flow covering docx/docx/pdf/png and review actions through export. | Local evidence present. | Maintainer-local private corpus evidence is not a public fixture. A release candidate should archive the exact evidence set and command transcript. |
| Hash the current release evidence bundle. | `output/playwright/current-evidence-manifest.json` hashes the selected live UI run, model provenance artifact, Node 24 proof, and release-readiness report. It marks `private_inputs_read=false` and `private_paths_redacted=true`. | Evidence present. | Archive this exact manifest with the release candidate; do not substitute a newer local run without regenerating readiness. |
| Summarize release readiness from explicit evidence. | `output/playwright/release-readiness-current/release-readiness-report.json` is the local handoff summary. The current report contract covers Node, CI, `quality:fast`, Docker Compose startup, UI browser contract evidence, live UI private corpus timing diagnostics, model provenance, evidence manifest, HaS Image 21-class contract, vision no-regex contract, and docs surface. | Evidence present for local handoff. | The report itself lists remaining release gaps: hosted clean CI run, private mirror/deployment revision confirmation, and separate VLM signature provenance/gates. |
| Preserve the HaS Image fixed 21-class contract and paper default. | Release readiness includes `has-image-21-contract` with `class_count=21` and `paper_default_excluded=true`. Source/docs/tests also define the 21-class contract and keep `paper` disabled by default. | Evidence present. | Release-grade reproducibility still depends on the model provenance manifest and private mirror/operator checksums used for the release. |
| Avoid claiming signature detection as a supported model class. | Release readiness includes `vision-no-regex`; docs and backend contract tests keep signature/handwritten signing/VLM signature outside the HaS Image classes. | Evidence present for current non-claim. | A future VLM signature detector needs its own source attribution, manifest entry, tests, quality gate, and public wording before being advertised. |
| Publish model provenance responsibly. | Readiness points to `output/playwright/model-provenance-round4/model-provenance-manifest.json` with 5 models found, 0 required missing, 0 duplicate basenames, and upstream revisions for all model entries. `docs/MODEL_PROVENANCE.md` records the Hugging Face API revisions checked on 2026-05-06. | Local checksum and upstream revision evidence present. | A formal release should still confirm those revisions against the exact private mirror or deployment snapshot. |

## Evidence Matrix

| Area | Traceable evidence | Audit status | Remaining gap |
| --- | --- | --- | --- |
| One-command startup | `README.md` quickstart documents `npm run setup`, `docker compose up -d`, `docker compose --profile gpu up -d`, `npm run dev`, and `start-dev.bat`. `docs/RUN_MODES.md` separates Docker CPU smoke, Docker GPU, local dev, app-only, models-only, and attach-existing modes. `output/playwright/node24-current/node24-proof.json` records Node 24 running source-level gates and `scripts/dev.mjs --doctor --json`. | Evidence present. | CPU smoke is explicitly not full recognition. The Node 24 proof is local workstation evidence, not clean public CI. |
| Ports | `scripts/dev.mjs` defaults: backend 8000, frontend 3000, HaS Text 8080, HaS Image 8081, OCR 8082. `docker-compose.yml`, env examples, Playwright config, and auth global setup align on frontend 3000/backend 8000. `scripts/test-docs-contract.mjs` checks public docs/scripts for stale port references. | Evidence present. | None found for the audited files. |
| No stale Vite dev port | Source docs and scripts were checked for the old frontend dev port by the docs contract test included in `node24-current`. | Evidence present for public docs/scripts/config audited here. | Historical output logs are outside source docs/config and were not treated as contract evidence. |
| CI workflow | `.github/workflows/ci.yml` uses Node 24 for public quality and E2E, installs backend `requirements-ci.txt` instead of the heavy runtime lock file, and runs `npm run quality:fast` plus `npm run quality:frontend` from the repository root. `scripts/test-docs-contract.mjs` asserts these source-level constraints. | Config evidence present. | This does not prove the hosted workflow has run successfully on a clean GitHub runner. |
| Local clean-copy smoke | `output/playwright/clean-copy-current/clean-copy-proof.json` records a dependency-free source copy, frontend lock install, backend CI dependency install, frontend build, and fast public quality run. This smoke exposed a missing `opencv-python-headless` CI dependency for seal fallback tests; `backend/requirements-ci.txt` now includes it. | Evidence present and issue fixed. | Runtime versions differ from hosted CI; treat this as a strong local smoke, not a replacement for GitHub Actions. |
| Auth behavior | `README.md`, `docs/README.md`, `docs/EVALUATION.md`, `docs/RUN_MODES.md`, `docs/TROUBLESHOOTING.md`, `scripts/eval-auth.mjs`, and `scripts/eval-login.mjs` document that `AUTH_ENABLED=false` needs no token, while auth-enabled evals use `eval:login` and `tmp/eval-token.txt` / `DATAINFRA_TOKEN_FILE`. `scripts/test-docs-contract.mjs` asserts this contract. | Evidence present. | Requires live `/auth/status` for real browser/eval confidence. |
| GPU boundary | `docs/RUN_MODES.md` and `docs/MODELS.md` document low-VRAM defaults, idle-GPU guidance, HaS Text GPU preflight, and non-mutating server doctor behavior. `scripts/quality-local.mjs` includes the HaS Text GPU preflight contract test. | Evidence present. | Current Node 24 doctor proof explicitly says it used this workstation's existing dependencies, model paths, and live services; it is not idle-GPU proof or clean CI. |
| Model provenance | `docs/MODEL_PROVENANCE.md` lists runtime model repos, observed upstream license labels, source links, base-model references, local integrity commands, Hugging Face API revisions checked on 2026-05-06, and `npm run models:manifest`. `scripts/create-model-provenance-manifest.mjs` generates a sanitized SHA-256/size/revision manifest without absolute model paths. Readiness summarizes the current local manifest as 5 found models, 0 required missing, 0 duplicate basenames, and revisions on all model entries. | Evidence present. | The recorded revisions still need to be confirmed against the exact private mirror or deployment snapshot used for a tagged release. |
| HaS Image 21-class contract | `README.md`, `docs/README.md`, `docs/MODELS.md`, `docs/EVALUATION.md`, `docs/MODEL_PROVENANCE.md`, `backend/app/core/has_image_categories.py`, and `backend/tests/test_has_image_categories_contract.py` define exactly 21 model classes and keep `paper` disabled by default. Release readiness reports `class_count=21`. | Evidence present. | Requires a local weight checksum or private mirror manifest for release-grade reproducibility. |
| Signature limitation | `README.md`, `docs/README.md`, `docs/MODELS.md`, `docs/MODEL_PROVENANCE.md`, and `docs/EVALUATION.md` state that signature/handwritten signing/VLM signature detection are not HaS Image classes. `backend/tests/test_has_image_categories_contract.py` forbids signature slugs in the model contract. | Evidence present. | A future VLM signature detector needs its own source attribution, manifest entry, tests, and quality gate before being claimed. |
| Private corpus eval | `output/playwright/live-ui-private-current-final-pass-v3/summary.json` is the selected current evidence. It passed with empty findings, console, page error, and failed request lists. The summary redacts private file paths with short hashes and covers one image single-file flow plus a 4-file batch flow through export. | Local evidence present. | The run is maintainer-local evidence, not public CI. A release handoff should archive the exact manifest and command transcript with the candidate. |
| Evidence manifest | `output/playwright/current-evidence-manifest.json` was generated with `private_inputs_read=false` and `private_paths_redacted=true`. It includes the live UI artifact, `model-provenance-round4`, `node24-current`, and `release-readiness-current`, with per-file SHA-256 hashes. | Evidence present. | Keep this manifest coupled to the candidate; changing any evidence directory requires regenerating manifest and readiness. |
| Release readiness | `output/playwright/release-readiness-current/release-readiness-report.json` is generated by `npm run readiness` and now includes `quality-fast-contract`, `ui-browser-contract`, and live UI `batch_timing_diagnostics` / `api_timing` evidence in addition to the CI workflow contract. | Local handoff evidence present. | The same report is not a completion certificate and still records release gaps: hosted clean CI run, private mirror/deployment revision confirmation, and VLM signature provenance/gates. |
| Quality commands | `package.json` exposes `quality`, `quality:fast`, `quality:dry`, `quality:frontend`, `quality:backend`, `quality:full`, `readiness`, `test:docs`, and script contract tests. `scripts/quality-local.mjs` prints scope and excludes private real-file work by default. | Evidence present. | `quality:fast` is still a local gate, not a published CI status in this workspace snapshot. |

## Open Release Gaps

- Clean CI: run the same gates from a clean public checkout or CI image before
  tagging a release. The current Node 24 proof is useful local evidence, but it
  explicitly used this workstation's dependencies, model paths, and live
  services.
- Model mirror confirmation: confirm the recorded Hugging Face revisions against
  the exact private mirror or deployment snapshot before publishing release
  artifacts. Do not infer or invent revisions from model names.
- VLM signature support: add separate VLM signature source attribution,
  manifest entries, tests, quality gates, and documentation before advertising
  signature detection as model-supported.
- Release archive discipline: archive the exact live UI summary, evidence
  manifest, release-readiness report, Node 24 proof, model manifest, command
  transcript, and service/GPU preflight snapshot used for the candidate.

## Tests To Run For This Audit

Minimum docs/quality checks:

```bash
npm run test:docs
node scripts/test-quality-local.mjs
npm run quality:dry
```

Heavier local confidence gate:

```bash
npm run quality:fast
```

`quality:fast` uses public/temp fixtures and contract/unit-style checks. It does
not run private real-file evaluation or start model/GPU services by default.
