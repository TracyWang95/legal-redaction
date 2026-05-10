# DataInfra RedactionEverything

DataInfra RedactionEverything is a local-first redaction workflow: one file first,
then batch.

[Chinese](./README.md) | [Docs](./docs/README.md) | [API](./docs/API.md) | [Models](./docs/MODELS.md)

## One Browser Entry

Use only `http://localhost:3000` for opening the interface.

Other ports are service endpoints, not browser pages:

- `8000` backend API and `/health`
- `8080` HaS Text
- `8081` HaS Image
- `8082` OCR

## Start and Check Model/GPU Readiness

### First run (UI/API)

```bash
git clone https://github.com/TracyWang95/DataInfra-RedactionEverything.git
cd DataInfra-RedactionEverything
npm run setup
cp .env.docker.example .env
docker compose up -d
```

Use Node.js 24. The package engine is `>=20 <25`, and the repository
keeps `.nvmrc` and `.node-version` aligned for local version managers.

If backend, frontend, or model services are already running and you only want
to attach to the existing local stack:

```bash
npm run dev:attach
```

This is the default lightweight mode for interface and API smoke checks.
It is not the full recognition path.

```bash
npm run doctor
curl http://127.0.0.1:8000/health/services
```

When OCR/HaS Text/HaS Image are not `online`, start model mode:

```bash
docker compose --profile gpu up -d
```

Models and GPU are optional for first-run UI/API checks, but required for full
recognition and confident export.

## One-Click Start and Port Checks

For a non-technical first open on Windows, double-click `start-dev.bat` from the
repository root. In WSL, macOS, or Linux, run:

```bash
npm run dev:attach
```

For the lightweight Docker path, run:

```bash
cp .env.docker.example .env
docker compose up -d
```

After startup, check only these two addresses:

| Check | Address | Success signal |
| --- | --- | --- |
| User interface | `http://localhost:3000` | The DataInfra page opens in the browser. |
| Backend health | `http://127.0.0.1:8000/health` | JSON is returned, usually with `status`. |

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

If `3000` is down, check the frontend. If `8000` is down, check the backend.
Port `8000` is for API and health checks; it is not the product UI.

## Model Warm-Up Script Network Rule

`backend/scripts/warmup_models.py` only calls already-running model services. It
does not start or stop model processes. The script calls `127.0.0.1:8080`,
`127.0.0.1:8081`, and `127.0.0.1:8082` from the environment where it runs, so
run it only from a WSL/container network where those ports are reachable on the
same `127.0.0.1`.

First confirm model ports from that shell:

```bash
curl http://127.0.0.1:8080/v1/models
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8082/health
```

Then run from WSL/Linux:

```bash
WARMUP_MAX_WAIT_SECONDS=180 node scripts/run-python.mjs backend/scripts/warmup_models.py
```

If Docker publishes `8080/8081/8082` to the host, prefer running the command
from the WSL host shell. Do not run it with plain `docker compose exec backend
...`: on a bridge network, `127.0.0.1` means the backend container itself, not
the `ner`, `vision`, or `ocr` containers.

If you must run it from a temporary container and your Linux/WSL Docker supports
host networking, use:

```bash
docker run --rm --network host -v "$PWD/backend:/app" -w /app python:3.11-slim \
  sh -lc "pip install -q httpx Pillow && WARMUP_MAX_WAIT_SECONDS=180 python scripts/warmup_models.py"
```

## User Flow

### Single-file flow

1. Open `http://localhost:3000`
2. Upload one file (DOCX, PDF, scanned PDF, PNG, JPG)
3. Run recognition
4. Review text entities and visual boxes
5. Export and verify the output file

### Task center and batch flow

- Open a batch from task center when the single-file flow is stable.
- One batch supports mixed file types by default.
- In task center, check per-file progress, errors, and status before exporting.
- Export after review passes.

### Result handoff status

- `ready_for_delivery`: result page/file can be handed off.
- `action_required`: review is still needed.

## Model Boundary

Model files are not committed in this repository. Configure local paths such as
`HAS_MODEL_PATH` and `HAS_IMAGE_WEIGHTS` to enable full recognition.
See [docs/MODELS.md](./docs/MODELS.md) and
[docs/MODEL_PROVENANCE.md](./docs/MODEL_PROVENANCE.md).

HaS Image currently has a fixed 21-class contract: `face`, `fingerprint`,
`palmprint`, `id_card`, `hk_macau_permit`, `passport`, `employee_badge`,
`license_plate`, `bank_card`, `physical_key`, `receipt`, `shipping_label`,
`official_seal`, `whiteboard`, `sticky_note`, `mobile_screen`, `monitor_screen`,
`medical_wristband`, `qr_code`, `barcode`, `paper`.

The default configuration leaves `paper` off. Signature, handwriting, and
VLM-based signature detection are not HaS Image classes. If signature-like
evidence appears, it comes from conservative local fallback or OCR visual labels,
not from an added HaS Image class.

## Notes for evaluation

- `npm run eval:public -- output/playwright/eval-public-current` checks public fixtures.
- `npm run quality:fast` runs the contributor-facing quick gate.
- `npm run eval:ceshi -- output/playwright/eval-ceshi-current` is maintainer private
  corpus flow and should run only after services are healthy and GPU is idle.

If auth is disabled, evaluation scripts can run without `DATAINFRA_TOKEN_FILE`.
If auth is enabled, use the local token command documented in project docs.
