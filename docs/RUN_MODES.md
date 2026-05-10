# Run Modes

This document is for first-run and maintenance choices. The interface for users is only one:
`http://localhost:3000`.

Backend or model ports are not browser entrypoints.

## Node Version

Use Node.js 24. The supported package engine is `>=20 <25`, and the
repository keeps `.nvmrc` and `.node-version` aligned for local version managers.

## Start Modes

| Mode | Command | What it starts | When to use | Limitation |
| --- | --- | --- | --- | --- |
| Default docker | `cp .env.docker.example .env` then `docker compose up -d` | Frontend, backend, storage | First open, login, upload validation, API smoke | OCR, HaS Text, HaS Image not started |
| GPU/full model | `docker compose --profile gpu up -d` | Frontend, backend, OCR, HaS Text, HaS Image | Full recognition + export validation | Requires NVIDIA runtime and configured model files |
| Local dev | `npm run dev` | Full local stack | Local code checks | Longer startup and higher machine usage |
| Reuse existing services | `npm run dev:attach` | Only missing local services | Partial stack already running | Depends on health checks |
| App API only | `npm run dev:app` | Frontend + backend | Work on UI/API when model services are ready | No model processing in this mode |
| Models only | `npm run dev:models` | OCR, HaS Text, HaS Image | Model warm-up and isolated model checks | No UI/backend |

## Non-Technical Startup

On Windows, the simplest entry is `start-dev.bat` from the repository root. It
delegates to WSL when available and tries to reuse healthy services.

In a WSL/macOS/Linux terminal, use:

```bash
npm run dev:attach
```

For a first Docker smoke test without models, use:

```bash
cp .env.docker.example .env
docker compose up -d
```

The user-facing page is still only `http://localhost:3000`.

## Recommended path

1. Run default docker.
2. Open `http://localhost:3000`.
3. Run:

```bash
npm run doctor
curl http://127.0.0.1:8000/health/services
```

If OCR/HaS Text/HaS Image are `offline`, switch to GPU/full model mode.
`degraded` means the service is present but not yet ready.

## Confirming 3000 and 8000

Use these checks before troubleshooting model services:

| Port | URL | Means |
| --- | --- | --- |
| `3000` | `http://localhost:3000` | Frontend/user interface is reachable. |
| `8000` | `http://127.0.0.1:8000/health` | Backend API is reachable and can report health. |

Bash / WSL:

```bash
curl -I http://localhost:3000
curl http://127.0.0.1:8000/health
```

PowerShell:

```powershell
Invoke-WebRequest http://localhost:3000 -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:8000/health
```

Do not use `8000` as the UI. It is expected to return API/JSON responses.

## Presets and task flow

- Single-file is the first target for every tester.
- Task center is used for batch creation and progress review.
- Batch can mix DOCX, PDF, scans, and images.
- Export handoff uses `ready_for_delivery` and `action_required`.

## GPU and recognition concurrency

The default page-level concurrency is `2` (`BATCH_RECOGNITION_PAGE_CONCURRENCY=2`).
It only controls parallel recognition pages inside one file and is capped by file page count.

`JOB_CONCURRENCY` controls how many batch items the backend processes at once.

When GPU is busy, lower these first:

```bash
BATCH_RECOGNITION_PAGE_CONCURRENCY=1
VISION_DUAL_PIPELINE_PARALLEL=false
HAS_TEXT_N_GPU_LAYERS=-1
```

## HaS Text doctor and preflight

```bash
HAS_TEXT_SERVER_BIN=/path/to/llama-server npm run doctor:has-text-server
```

This command validates external server configuration, prints the generated command,
and does not start `llama-server` or run model inference.

```bash
npm run has-text:gpu-preflight
```

This checks current HaS Text status and GPU busy state before replacing a running
service on port 8080.

By default, the preflight expects HaS Text to run on CUDA/GPU offload (`HAS_TEXT_N_GPU_LAYERS` not `0`, `HAS_TEXT_DEVICE` not `cpu`) and will print a runtime warning when it detects fallback risk.
It does not stop/start/restart any model service.
It is a read-only check; keep existing services/processes untouched and do not use it to control 8080/7860 handoff actions.

## Model warm-up script

`backend/scripts/warmup_models.py` is optional and conservative: it only calls
already-running model endpoints and does not start or stop model processes. It
uses hard-coded localhost model ports from the environment where it runs:

- `127.0.0.1:8080` for HaS Text
- `127.0.0.1:8081` for HaS Image
- `127.0.0.1:8082` for OCR

Before running it, confirm those ports from the same shell:

```bash
curl http://127.0.0.1:8080/v1/models
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8082/health
```

Then run it from WSL/Linux:

```bash
WARMUP_MAX_WAIT_SECONDS=180 node scripts/run-python.mjs backend/scripts/warmup_models.py
```

If the model services are Docker containers with `8080/8081/8082` published to
the host, prefer the WSL host shell. A plain `docker compose exec backend ...`
is usually wrong for this script because, on the default bridge network,
`127.0.0.1` points at the backend container itself rather than the model
containers.

For a temporary container on a Linux/WSL Docker engine with host networking:

```bash
docker run --rm --network host -v "$PWD/backend:/app" -w /app python:3.11-slim \
  sh -lc "pip install -q httpx Pillow && WARMUP_MAX_WAIT_SECONDS=180 python scripts/warmup_models.py"
```

## Real-file gates

Public users should start from public fixtures:

```bash
npm run eval:public -- output/playwright/eval-public-current
```

Maintainers can validate private regression with either:

```bash
npm run eval:ceshi:preflight -- output/playwright/eval-ceshi-preflight
npm run eval:ceshi -- output/playwright/eval-ceshi-current
```

Run private gates only when model services are healthy and GPU is idle.

## First-run troubleshooting shortcuts

| Symptom | Next step |
| --- | --- |
| `npm run setup` fails on Node version | use Node 24 |
| Browser cannot open app | open `http://localhost:3000` only |
| One service `offline` | switch to GPU/full model mode |
| Auth eval blocked | follow the auth-enabled token path in docs |
| Live E2E cannot start | `npm run test:e2e:live:preflight` |
