# Documentation

This directory contains the detailed documentation map. The top-level README is
the ordinary starting point; these files cover run modes, API examples, model
notes, evaluation contracts, and release-readiness evidence.

## Start Here

| Need | Read |
| --- | --- |
| 中文首次使用 | [QUICKSTART_ZH.md](./QUICKSTART_ZH.md) |
| Start the app | [RUN_MODES.md](./RUN_MODES.md) |
| Try the HTTP API | [API.md](./API.md) |
| Configure model files | [MODELS.md](./MODELS.md) |
| Check model provenance | [MODEL_PROVENANCE.md](./MODEL_PROVENANCE.md) |
| Run public or maintainer evals | [EVALUATION.md](./EVALUATION.md) |
| Review handoff evidence | [QUALITY_AUDIT.md](./QUALITY_AUDIT.md) |
| Troubleshoot local setup | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |

## User Path

For ordinary users, keep the flow simple:

1. Start with the top-level README or the Chinese quickstart.
2. Open `http://localhost:3000` and process one file.
3. Review detected text entities and visual boxes.
4. Export the redacted file.
5. Move to a batch job only after the single-file workflow is understood.

Batch jobs are mixed-file by default: DOCX, PDF, scanned PDFs, and image files
can live in the same job.

Use Node 24. The package engine is `>=20 <25`, and `.nvmrc` /
`.node-version` record the recommended local version.

Canonical local ports:

| Service | Port | Notes |
| --- | --- | --- |
| UI | `3000` | Default frontend entry point. |
| API | `8000` | FastAPI backend and `/health`. |
| HaS Text | `8080` | OpenAI-compatible `/v1` text recognition service. |
| HaS Image | `8081` | Fixed 21-class visual detection service. |
| OCR | `8082` | OCR service. |

For one-command local development, `npm run dev` uses these ports. If healthy
services are already listening, use `npm run dev:attach` to reuse them.

## Maintainer Path

Maintainers can use the evaluation docs after the product path is already
running. Public gates use generated fixtures and are safe for open-source
triage. Real-file gates use local private files or a local manifest and should
not be presented as the first-run path for new users.

When auth is disabled (`AUTH_ENABLED=false` or `/auth/status` reports
`auth_enabled=false`), eval scripts do not require a token. Create or pass
`DATAINFRA_TOKEN_FILE` only when auth is enabled.

Common gates:

| Gate | Script | Boundary |
| --- | --- | --- |
| Environment check | `npm run doctor:strict` | Local dependency, model, service, and auth readiness. |
| Model manifest | `npm run models:manifest` | Local model filename, size, hash, role, and source metadata without absolute paths. |
| Release readiness | `npm run readiness` | Local evidence rollup for UI, model provenance, Node, HaS Image, and vision-pipeline contracts. |
| Public eval | `npm run eval:public` | Public or generated fixtures only. |
| Fast quality | `npm run quality:fast` | Contributor iteration gate. |
| Full quality | `npm run quality:full` | Contributor handoff gate with frontend build and backend key pytest. |
| Maintainer real-file | `npm run eval:ceshi` | Private local corpus or ignored manifest; requires healthy services and an idle GPU. |

See [EVALUATION.md](./EVALUATION.md) for command arguments, auth behavior, and
artifact expectations.

## Model Boundary

HaS Image is fixed to 21 documented classes. Signature, handwriting, and
VLM-based visual checklist detection are separate paths. OCR labels and local
fallback can create review evidence, but they are not HaS Image model hits.

Model weights are local operator assets. Do not commit weights, private
manifests, token files, generated real-file reports, or private absolute paths.
