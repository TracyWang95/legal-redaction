# UI Browser Acceptance Contract

This task freezes the 1920x1080 manual UI checks into a repeatable browser script.

Run against the local frontend:

```bash
npm run test:ui-contract
```

Useful variants:

```bash
npm run test:ui-contract:dry
npm run test:ui-contract:preflight
node scripts/ui-browser-contract.mjs --headed
node scripts/ui-browser-contract.mjs --base-url http://127.0.0.1:3000 --out-dir output/playwright/ui-contract-local
```

The default script opens:

- `/`
- `/single`
- `/batch`
- `/jobs`
- `/history`
- `/settings`

It verifies:

- no document, body, or main page-level horizontal or vertical overflow at `1920x1080`
- no visible `繁忙`, `忙碌`, or `Busy` copy
- basic sidebar click coverage for these core workflow routes:
  - `/`
  - `/single`
  - `/batch`
  - `/jobs`
  - `/history`
  - `/settings`
- jobs and history tables are not blank before and after next-page pagination
- jobs and history pagination rails remain visible and within viewport after paging

By default the script mocks `/api/v1/**` and `/health/services` inside Playwright so it does not
need GPU services, does not upload files, does not use a private corpus directory, and does not trigger recognition,
redaction, job submit, or inference endpoints. Pass `--live-api` only when intentionally validating
against a live backend.

Artifacts are written under `output/playwright/...`:

- `plan.json`
- `summary.json`
- one `*-1920x1080.png` screenshot per checked route, unless `--no-screenshot` is passed

The private live UI gate (`npm run eval:ceshi:live-ui`) writes a different
`summary.json` for real-file evidence. Use its `evidence_summary` and
`performance_context.batch.pdf_recognition_summary` fields when reviewing PDF
recognition duration, per-page duration sums, observed PDF page parallelism,
sparse text-layer fallback, PDF page duration ranking, alias leaks, and
non-fixed HaS Image model types. The same report also includes
`performance_context.batch.timing_summary.lines`, which calls out UI/API
first-reviewable gaps and whether review wait was caused by unfinished
background recognition.
