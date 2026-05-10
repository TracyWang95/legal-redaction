<!--
Copyright 2026 DataInfra-RedactionEverything Contributors
SPDX-License-Identifier: Apache-2.0
-->

# Eval Fixtures

These files are synthetic, public fixtures for smoke-testing the batch
evaluation flow without depending on private local data under a private corpus directory configured with `EVAL_CESHI_DIR`.

They intentionally include fake names, phone numbers, addresses, account
numbers, project IDs, contract terms, and HTML/Markdown structure so text
recognition, review, export, and report generation can be exercised from a
fresh clone.

For a public visual smoke image, generate the synthetic PNG:

```bash
npm run fixtures:visual
```

This writes `fixtures/eval/sample-visual.png` with fake contract text, a red
stamp-like mark, an approval line, and a QR-style placeholder. It is generated
rather than committed as a binary file so changes remain easy to review.

Smoke it without auth or model services:

```bash
npm run eval:vision-direct -- fixtures/eval/sample-visual.png output/playwright/eval-vision-direct-public -- --ocr-mode off --skip-has-image --write-pages --max-warnings -1
```

When OCR and HaS Image services are running, use the service-backed smoke:

```bash
npm run eval:vision-direct -- fixtures/eval/sample-visual.png output/playwright/eval-vision-direct-public-services -- --ocr-mode structure --write-pages --max-warnings -1 --min-total-has-image-regions 1
```

Use private real-world regression files for accuracy tuning, but keep these
fixtures small and safe enough to ship with the repository.

For a broader public no-auth quality gate, run:

```bash
npm run eval:public -- output/playwright/eval-public-current
```

That command also generates public DOCX/PDF fixtures under
`fixtures/benchmark` and checks searchable PDF/DOCX redaction safety. Its
top-level `summary.json` has a `coverage` block that must show at least one
text entity, at least one visual target, and non-empty redacted DOCX/PDF export
artifacts. The useful demo outputs are:

- `text-direct-txt/report.html`
- `text-direct-docx/report.html`
- `vision-offline/report.html`
- `vision-offline/page-01-vision.png`
- `redaction-safety/sample-redaction.redacted.docx`
- `redaction-safety/sample-redaction.redacted.pdf`
