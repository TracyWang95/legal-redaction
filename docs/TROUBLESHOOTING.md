# Troubleshooting

Start from the narrowest check:

```bash
npm run doctor
```

For a non-technical startup on Windows, use `start-dev.bat` from the repository
root. In WSL/macOS/Linux, use `npm run dev:attach`. For the lightweight Docker
smoke path, use `cp .env.docker.example .env` and `docker compose up -d`.

If service and environment checks are clean but a page still fails, use this
order:

```bash
npm run doctor
curl http://127.0.0.1:8000/health/services
```

## Confirm frontend and backend first

Check only these two ports before debugging model services:

| Port | URL | Expected result |
| --- | --- | --- |
| `3000` | `http://localhost:3000` | Browser opens the product UI. |
| `8000` | `http://127.0.0.1:8000/health` | API returns JSON health. |

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

Do not treat `8000` as the application page. It is the backend API.

## Frequent Issues

| Symptom | Likely cause | Next step |
| --- | --- | --- |
| Browser page missing | Wrong URL | Open `http://localhost:3000`; only this is the user entry. |
| UI opens but no recognition result | Running lightweight mode only or model services offline | Start `docker compose --profile gpu up -d` after checking `docker compose` health and `/health/services`. |
| `npm run setup` failed | Node mismatch or missing deps | Use Node 24 and rerun setup. |
| `eval`/auth check failed | Token config mismatch | If auth is enabled, run `DATAINFRA_PASSWORD=<password> npm run eval:login -- tmp/eval-token.txt`. If `AUTH_ENABLED=false` or `/auth/status` shows disabled, omit token env vars. |
| Live browser E2E pre-check failed | Service not ready | Run `npm run test:e2e:live:preflight` and follow it. |
| Model service status is `offline` or `degraded` | Models/weights or GPU not ready | Confirm model path, GPU free state, and NVIDIA runtime; run `docker compose --profile gpu up -d` if needed. |
| Model service status is briefly `offline` while port is still open | Inference/long request in progress or service cold path delay | Treat as online when port is reachable; use `/health/services` with `--strict` checks and `HAS_TEXT_DEVICE=...`/`HAS_TEXT_N_GPU_LAYERS` to validate runtime policy. |
| Batch export missing some files | Review step not completed or report failed | Open task center, check file status and export report before assuming success. |
| GPU memory high | Shared GPU pressure | Keep `BATCH_RECOGNITION_PAGE_CONCURRENCY=1`, `VISION_DUAL_PIPELINE_PARALLEL=false`, keep HaS Text GPU offload enabled with `HAS_TEXT_N_GPU_LAYERS=-1`, and wait for queue drain before restart. |
| `warmup_models.py` says services are not reachable | It is running from the wrong network namespace | From the same shell, first curl `127.0.0.1:8080/8081/8082`. If those fail, run the script from WSL host or a host-network container where those ports are published. |

## Model Boundaries

HaS Image has exactly 21 model classes. Signature and VLM-based signature detection are future items, not current HaS Image classes.

Local fallback boxes are review-only evidence and are not model hit evidence.
Official seal redaction currently uses detected boxes plus explicit mask/replacement.

## WSL notes

When commands run under WSL, keep model files and data paths stable.
Avoid deleting project caches during recovery; keep service data and runbook
states when possible and restart services after config changes.

`backend/scripts/warmup_models.py` is sensitive to where it runs because it uses
`127.0.0.1` for all model services. If Docker publishes `8080/8081/8082` to the
host, run the warm-up command from the WSL host shell:

```bash
curl http://127.0.0.1:8080/v1/models
curl http://127.0.0.1:8081/health
curl http://127.0.0.1:8082/health
WARMUP_MAX_WAIT_SECONDS=180 node scripts/run-python.mjs backend/scripts/warmup_models.py
```

Avoid plain `docker compose exec backend ...` for this script on the default
bridge network. In that container, `127.0.0.1` is the backend container, not the
model services.

For a temporary container on a Linux/WSL Docker engine with host networking:

```bash
docker run --rm --network host -v "$PWD/backend:/app" -w /app python:3.11-slim \
  sh -lc "pip install -q httpx Pillow && WARMUP_MAX_WAIT_SECONDS=180 python scripts/warmup_models.py"
```
