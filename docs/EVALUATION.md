# Evaluation

Evaluation is split into public gates for open-source confidence and private
real-file gates for maintainers. New users should start with the README and the
single-file product flow, not a private corpus. If you only want to verify that
the open-source package is usable, stop at the public gates.

## Recommended Order

1. `npm run doctor`
2. `npm run eval:public -- output/playwright/eval-public-current`
3. `npm run quality:fast` while iterating, then `npm run quality:full` before handoff
4. `eval:batch-e2e` for the mixed-file workflow
5. Maintainer real-file gates only after the local stack is healthy

## Gate Boundary

Use npm scripts as the stable entry points. Prefer them over ad-hoc `node
scripts/...` commands unless you are debugging one script directly.

| Gate | Command | Scope | Private files? | Intended users |
| --- | --- | --- | --- | --- |
| Local readiness | `npm run doctor` or `npm run doctor:strict` | Dev stack and environment checks; strict mode emits JSON and fails on stricter readiness issues. | No | Users and contributors |
| Public eval | `npm run eval:public -- output/playwright/eval-public-current` | Public fixtures, generated reports, and no-private-file regression evidence. | No | Users, contributors, CI-like local checks |
| Fast quality | `npm run quality:fast` | Short local quality loop for contributors after small changes. | No | Contributors |
| Full quality | `npm run quality:full` | Broader contributor quality gate before handoff, with frontend build and backend key pytest. | No | Contributors and maintainers |
| Maintainer real-file | `npm run eval:ceshi -- output/playwright/eval-ceshi-current` | Private four-file batch evidence from `EVAL_CESHI_DIR` or an ignored manifest. | Yes | Maintainers only |
| Maintainer performance | `npm run eval:ceshi:perf -- <pdf> output/playwright/eval-ceshi-perf-current` | Private six-page PDF timing baseline for OCR, vision, cache-hit, and preview paths. | Yes | Maintainers only |

Private corpus gates are maintainer-only gates. They should never be described as
ordinary quickstart, CI, or open-source user requirements.

## Release Readiness Evidence

`npm run readiness` reads existing local evidence and writes a sanitized
release-readiness report. For a release candidate, prefer explicit inputs so the
report cannot drift to a different retained local run:

```bash
RELEASE_LIVE_UI_SUMMARY=<summary-json> \
RELEASE_UI_BROWSER_SUMMARY=<ui-browser-summary-json> \
RELEASE_MODEL_MANIFEST=<model-provenance-manifest-json> \
RELEASE_NODE24_PROOF=<node24-proof-json> \
RELEASE_EVIDENCE_MANIFEST=<evidence-manifest-json> \
npm run readiness -- --out output/playwright/release-readiness-current/release-readiness-report.json
```

If `RELEASE_LIVE_UI_SUMMARY` is omitted, the script first uses
`live-ui-private-current/summary.json` under `RELEASE_PLAYWRIGHT_ROOT` when it
exists and passes. Otherwise it selects the newest passing `live-ui-*` summary by
the summary `generated_at` timestamp. `RELEASE_UI_BROWSER_SUMMARY` works the
same way for `ui-browser-contract-current/summary.json` or the newest passing
`ui-browser-contract-*` summary, and records the 3000 entry route coverage,
viewport, failed requests, and blocked sensitive API count.

The readiness report also records the `quality:fast` source contract and the
live UI timing diagnostics that matter for release notes:
`batch_timing_diagnostics.first_reviewable_*`,
`batch_timing_diagnostics.all_recognition_complete_*`,
`batch_timing_diagnostics.review_waiting_for_background_ms`, and the sanitized
`api_timing` summary. The evidence manifest check requires UI, model
provenance, Node 24, and release-readiness artifacts, not just any three
directories.

## Public Gates

Public gates use generated or committed fixtures and do not require private
files.

```bash
npm run doctor
npm run eval:public -- output/playwright/eval-public-current
```

`eval:public` verifies:

- public DOCX/PDF fixture generation
- direct text recognition on public fixtures
- redacted DOCX/PDF safety checks
- an offline visual fallback smoke test

The public gate proves the open-source package can run. It does not prove your
private corpus accuracy. The practical pass condition is a zero exit code plus
a passing quality gate in the generated summary.

## Authenticated Batch E2E

`eval:batch-e2e` is the realistic product-flow gate using public or explicitly
provided files. It exercises create job, upload files, submit recognition,
commit review, export report, and download ZIP.

Generate a token when auth is enabled:

```bash
DATAINFRA_PASSWORD='your-local-password' npm run eval:login -- tmp/eval-token.txt
```

`tmp/eval-token.txt` is the default local token file. When auth is enabled,
eval scripts and `npm run test:e2e:live` use it automatically if
`DATAINFRA_PASSWORD`, `DATAINFRA_TOKEN`, and `DATAINFRA_TOKEN_FILE` are all
unset and the file exists. If auth is disabled by the live backend, or the local
env says `AUTH_ENABLED=false` and `/auth/status` is not reachable yet, eval
scripts skip credential requirements. In that mode `eval:login` writes an empty
token file by design.

Run the public mixed-file batch gate. If auth is disabled, omit token env vars:

```bash
npm run eval:batch-e2e -- \
  output/playwright/eval-batch-current
```

With no explicit files, the script uses public mixed fixtures under
`fixtures/eval`. This is the recommended workflow regression for open-source
triage.

For a real localhost browser gate, run the preflight before opening Playwright:

```bash
npm run test:e2e:live:dry
npm run test:e2e:live:preflight
npm run test:e2e:live
```

The dry run prints the resolved command and credential source without launching
a browser. The preflight checks the frontend URL, backend `/auth/status`,
password setup, and token validity. Use
`DATAINFRA_DEFAULT_TOKEN_FILE=/path/to/token.txt` only when you need a different
default local token file.

You can also pass your own mixed files. Add
`DATAINFRA_TOKEN_FILE=tmp/eval-token.txt` only when auth is enabled and you are
not using the default token-file path:

```bash
npm run eval:batch-e2e -- \
  output/playwright/eval-batch-current \
  /path/to/sample-a.docx \
  /path/to/sample-b.docx \
  /path/to/sample-contract.pdf \
  /path/to/sample-image.png
```

Expected artifacts:

- `summary.json`
- `report.html`
- `export-report.json`
- `original.zip`
- `redacted.zip`

Use `export-report.json.summary.delivery_status` as the product handoff gate.
`visual_review_hint` is a review hint and quality-risk signal, not a delivery
blocker by itself; it does not mean the file failed delivery.
It must not be described as a new model category or HaS Image class.

## Maintainer Real-File Gate

`EVAL_CESHI_DIR` points to a maintainer-owned local corpus. It is not required for
ordinary users, and it should not appear in the top-level quickstart.

The script does not assume a public default corpus path. Set `EVAL_CESHI_DIR`,
`EVAL_CESHI_MANIFEST`, or `EVAL_CESHI_FILES`. It expects exactly four private
files: two DOCX samples, one contract or scanned PDF, and one image sample. To
verify the local paths without uploading files:

```bash
node scripts/eval-ceshi.mjs --check-only
node scripts/eval-ceshi.mjs --preflight output/playwright/eval-ceshi-preflight
```

`--check-only` prints the resolved private-corpus labels and gate defaults.
`--preflight` also writes `preflight-summary.json` and records why the real
batch E2E was skipped. Neither mode requires login state, reads a token file,
uploads files, or launches the browser flow.

Then run. If auth is disabled, omit token env vars; if auth is enabled, the
default `tmp/eval-token.txt` is used automatically when it exists:

```bash
npm run eval:ceshi -- \
  output/playwright/eval-ceshi-current
```

If your local stack runs with `AUTH_ENABLED=false`, omit
`DATAINFRA_TOKEN_FILE=tmp/eval-token.txt`. If auth is enabled and the token file
already exists, the eval scripts use it directly and do not require
`DATAINFRA_PASSWORD` on every run.

Set `EVAL_CESHI_DIR` when using a directory-based private corpus:

```bash
EVAL_CESHI_DIR=<private-corpus-dir> \
npm run eval:ceshi -- output/playwright/eval-ceshi-current
```

For any other local real files, prefer an ignored manifest:

```bash
cp fixtures/local-real-files.example.json fixtures/local-real-files.json
EVAL_CESHI_MANIFEST=fixtures/local-real-files.json \
npm run eval:ceshi -- output/playwright/eval-local-real-current
```

The manifest should point to four files in the same order:

1. DOCX sample A
2. DOCX sample B
3. Contract/scanned PDF
4. Image sample

Do not commit private files, private manifests, generated real-file reports, or
token files.

The live UI summary separates partial review readiness from full batch
recognition completion. In `summary.json`, check
`performance_context.batch.phase_diagnostics`:

- `recognition_wait_ms` / `first_reviewable_ui_ms`: browser time until the
  batch can enter review for files that are already available.
- `first_reviewable_source`: `api-job-item-status` when `/jobs/<id>` status reaches a
  reviewable state; otherwise `step3-next-enabled`.
- `first_reviewable_ui_minus_api_ms`, `first_reviewable_gap_severity`, and
  `first_reviewable_readable_summary`: expose when browser first-reviewable
  latency is slower than API first-reviewable latency. The default diagnostic
  hints are notice at 1000ms and warning at 5000ms; these are report hints, not
  pass/fail quality gates.
- `all_recognition_complete_api_ms`: API-observed time until every batch item
  has finished recognition or reached a terminal recognition status.
- `all_recognition_complete_source`: `api-job-item-status` when all items are terminal-recognized,
  `api-job-item-status-partial` when status is present but not complete, or
  `not_observed` when no status is available.
- `api_status.config_locked_at` / `api_status.freshness_counts`: freshness
  evidence used to avoid counting item states that were already completed before
  the current batch config was locked.
- `review_waiting_for_background_ms`: time attributed to the review phase while
  later files or background model work were still finishing.
- `review_blocked_wait_ms`: review-loop time with no enabled confirm, next, or
  export action.
- `review_blocked_wait_source` and `review_wait_readable_summary`: distinguish
  UI-disabled review time from the common case where review opened while
  background recognition for later files was still incomplete.

Do not compare `recognition_wait_ms` directly with a scanned PDF
`recognition_duration_ms` as if both were full-batch wall-clock timings.
When `job.config.config_locked_at` is present, the API timing probe treats item
`completed` / `awaiting_review` states with recognition or performance
timestamps before that lock as stale evidence and excludes them from
`first_reviewable_api_ms` and `all_recognition_complete_api_ms`. Items without
timestamps still use the legacy compatible status path and are marked in
`freshness_counts` as `no-item-timestamp-compatible`.

If item-level `started_at` / `finished_at` evidence is available, the
all-complete timing is derived from the latest finish timestamp relative to the
batch submit time. If only `recognition_duration_ms` is available, it is used as
a lower bound so a late API poll cannot write an obviously impossible full-batch
completion such as a 1s all-complete for a multi-second recognition result.

For batch PDFs, treat cache states in
`performance_context.batch.pdf_recognition[].cache.state` as the gate:
`warm_cache_hit_observed` (do not claim cold-start), `cache_miss_or_disabled_observed`
(can support cold-cache assumptions), `cache_mixed_observed` (cannot claim cold-start
because some signals are warm and some are not), or `cache_signal_absent` (insufficient
cache signal evidence).

For round-by-round real UI triage, start with `summary.json.evidence_summary`.
It is a readable index over the sanitized evidence, not a new product signal:

- `evidence_summary.pdf_recognition.lines`: one line per PDF with
  `recognition=<wall-clock>`, `page_sum=<sum of per-page durations>`,
  `ratio=<page_sum/wall-clock>`, page concurrency, cache state, and text-layer
  state.
- `performance_context.batch.pdf_recognition[].page_parallelism`: the structured
  version of the same PDF timing evidence. Use
  `observed_parallelism=parallel_overlap_observed` only when the per-page sum is
  materially above the recognition wall clock.
- `performance_context.batch.pdf_recognition[].text_layer`: records sparse
  text-layer fallback pages and aggregate block/char counts when the backend
  returns sanitized `duration_breakdown_ms.pdf_text_layer` diagnostics.
- `performance_context.batch.pdf_recognition[].page_duration_rank`: sorted
  per-page PDF recognition durations, slowest first. Its line is also copied to
  `evidence_summary.pdf_recognition.page_duration_rank_lines` so slow pages such
  as page 2 or page 1 are visible without reopening raw API evidence.
- `evidence_summary.type_integrity`: aggregates semantic alias leaks and
  non-fixed HaS Image model types from box geometry evidence. `alias_leak_types`
  means an entity alias such as `COMPANY` or non-ASCII OCR label escaped
  normalization; `unknown_has_image_types` means `has_image_model` emitted a
  type outside the fixed HaS Image class set.

## Diagnostics-Only Real-File Runs

When auth is unavailable or you need faster root-cause isolation:

```bash
EVAL_CESHI_MANIFEST=fixtures/local-real-files.json npm run eval:ceshi:diagnostics-only -- \
  output/playwright/eval-local-real-current
```

Diagnostics can include direct text, OCR, vision, and seal layers. Treat them as
maintainer evidence, not as the ordinary first-run path.
Diagnostics-only artifacts include `batch_e2e.skipped` and
`batch_e2e.skip_reason` so reports make clear when the authenticated real E2E
was intentionally skipped.

## Maintainer PDF Performance Baseline

Use `scripts/eval-ceshi-perf.mjs` when the private six-page PDF path feels slow and you
need stable numbers before changing backend behavior. The script uploads one
PDF, parses it, then measures forced per-page vision, expected vision cache
hits, page concurrency `1/2/3`, and preview-image requests.
It is a script-only benchmark against existing services (it does not start or stop
GPU services), so it avoids adding startup noise to the timing signal.

The vision requests intentionally match the frontend recognition path:
`include_result_image=false` is always sent, so the endpoint returns boxes and
pipeline status without rendering an annotated result image. Preview image
timing is measured separately through `/preview-image`.

Preview the plan without network calls:

```bash
node scripts/eval-ceshi-perf.mjs --dry-run
```

Check local file/API readiness without depending on login state:

```bash
node scripts/eval-ceshi-perf.mjs --preflight output/playwright/eval-ceshi-perf-preflight
```

The performance preflight writes `preflight-summary.json`. It probes
`/auth/status`, service health, and vision pipeline availability without
reading `DATAINFRA_TOKEN_FILE`, logging in, uploading the PDF, or running OCR or
vision. If auth is enabled, preflight reports that credentials are needed for
the real run instead of failing because no token is present.

Run the baseline. If auth is disabled, no token env vars are needed. If auth is
enabled, create `tmp/eval-token.txt` first; set `DATAINFRA_TOKEN_FILE` only for
a non-default token path:

```bash
node scripts/eval-ceshi-perf.mjs \
  <private-pdf-path> \
  output/playwright/eval-ceshi-perf-current
```

If the path is omitted, the first `*.pdf` under `EVAL_CESHI_DIR` is used. Useful
knobs:

```bash
EVAL_CESHI_PERF_PAGES=1-6
EVAL_CESHI_PERF_CONCURRENCY=1,2,3
EVAL_CESHI_PERF_PREVIEW_CONCURRENCY=1,2,3
EVAL_CESHI_PERF_CACHE_CONCURRENCY=3
```

`EVAL_CESHI_PERF_CONCURRENCY` controls the forced vision matrix. Each forced
run sends `force=true`, which bypasses existing page results and is useful for
comparing cold per-page work at concurrency `1`, `2`, and `3`.
`EVAL_CESHI_PERF_CACHE_CONCURRENCY` controls the follow-up cache-hit pass. That
pass omits `force=true` after the forced runs have stored the same page/type
signature, so it approximates the frontend repeat request path. The public API
does not expose a cache-hit flag, so the report labels this as an expected cache
hit rather than a proven cache hit. `summary.json.request_profile` records this
explicitly as `cache_hit_is_expected_reuse_probe: true` and
`cache_hit_supports_cold_start: false`.

Artifacts:

- `summary.json` for machine-readable upload, parse, vision, cache-hit, and
  preview timings
- `timings.csv` for per-request rows suitable for spreadsheet comparison
- `report.md` for quick before/after notes

The performance artifacts include explicit per-page stage diagnostics. For
each forced or expected-cache vision request, `summary.json`,
`timings.csv`, and `report.md` show `ocr_has`, `has_image`, `pdf_render`,
`pdf_text_layer`, `page_elapsed`, `request_total`, and `cache_status` fields.
OCR/HaS and HaS Image cells include backend sub-stage duration maps when the
API returns them, such as OCR, HaS NER/match, prepare, model, and fallback
timings. If the native
PDF text layer is present but too sparse and the request falls back to image
OCR, the report marks `pdf_text_layer` as `sparse fallback`; treat that as a
routing explanation, not a backend quality pass or failure by itself. When the
backend has already observed repeated sparse native text layers for the same
scanned PDF, later pages can show `pdf_text_layer_skipped_sparse_file=true`
or `skipped sparse file`; that means the backend skipped the cheap text-layer
probe and went straight to the image OCR path.

The report also includes a `Single-Page Stage Summary` table derived from the
backend `duration_breakdown_ms` payload when present. It normalizes the page
work into OCR, HaS Text, HaS Image, structure, VL, and cache signals, then
marks the slowest single-page stage as the page bottleneck. Use this table
after the concurrency matrix shows that page concurrency is already reducing
wall-clock time; at that point the next regression question is which single-page
stage is slow, not whether the page scheduler is active. The script keeps these
diagnostics sanitized by default and drops private paths, filenames, and text
from timing artifacts.

Keep preview concurrency separate from vision concurrency. Preview requests use
the boxes collected from the forced vision runs and measure image generation
latency, not recognition latency.

## Direct Baselines

Use direct baselines when backend auth is blocked or you need to isolate one
layer.

Text:

```bash
npm run eval:text-direct -- \
  /path/to/sample-a.docx \
  output/playwright/eval-text-direct-current
```

Vision with services:

```bash
npm run eval:vision-direct -- \
  /path/to/sample-contract.pdf \
  output/playwright/eval-vision-direct-current \
  -- --pages 1,5 --write-pages
```

Offline visual fallback smoke:

```bash
npm run fixtures:visual
npm run eval:vision-direct -- \
  fixtures/eval/sample-visual.png \
  output/playwright/eval-vision-direct-public \
  -- --ocr-mode off --skip-has-image --write-pages --max-warnings -1
```

The offline fallback smoke proves image loading, report generation, overlays,
and conservative local fallback logic. It does not prove OCR or HaS Image model
quality, and fallback boxes are not substitutes for HaS Image quality evidence.

## Visual Source Attribution

Reports separate model hits from supplemental evidence:

| Source | Count it as HaS Image model quality? |
| --- | --- |
| `has_image_model` / `has_image` | Yes. Fixed 21-class HaS Image model hit. |
| `local_fallback` / `fallback_detector` | No. Conservative recovery evidence only; never count toward HaS Image class-quality thresholds. |
| `ocr_has` / OCR visual labels | No. Useful review evidence, not HaS Image. |
| `table_structure` / OCR text boxes | No. Diagnostic structure/text evidence. |

HaS Image is fixed to the 21 classes in [MODELS.md](./MODELS.md). Signature,
handwritten-signing, and VLM-based signature detection are deferred; they are
not HaS Image classes and should not be reported as new HaS Image classes. Do
not use OCR labels or local fallback boxes to satisfy HaS Image model
thresholds.

For `official_seal`, quality checks should verify explicit box replacement output
rather than background whitening or full-image erase behavior.

For non-GPU contract checks, run the backend contract subset:

```bash
cd backend
python -m pytest tests/test_has_image_categories_contract.py tests/test_type_mapping.py tests/test_has_client.py tests/test_vision_contracts.py
```

This subset does not start OCR, HaS Text, HaS Image, or VLM services. It guards
the fixed 21-class HaS Image category set, preset alignment, type alias
canonicalization, and the no-regex image-pipeline boundary.

## Quality Gate Signals

For `eval:batch-e2e`, check:

- `summary.json.quality_gate.passed`
- final job status
- recognition totals
- `export-report.json.summary.delivery_status`
- ZIP manifest included/skipped counts
- redacted output leak checks and PDF size-regression checks

For direct visual gates, check:

- `summary.json.quality_gate.passed`
- total visual regions
- HaS Image model counts when proving model contribution
- page overlays for missed seals, QR codes, IDs, or over-redaction

## Privacy Rules

Default reports should avoid absolute input paths, original private filenames,
and raw OCR/entity text. Use `EVAL_REPORT_INCLUDE_PRIVATE_DETAILS=1` only for
local-only debugging artifacts that will not be shared.
