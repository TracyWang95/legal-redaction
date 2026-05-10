# API Quickstart

This page shows the smallest useful HTTP flow. The backend listens on
`http://127.0.0.1:8000`; versioned routes are under `/api/v1`.

Start with one file. Move to batch after the single-file review/export loop is
clear.

## Auth

Check auth state:

```bash
curl http://127.0.0.1:8000/api/v1/auth/status
```

If auth is enabled, create a local token file:

```bash
DATAINFRA_PASSWORD='your-local-password' npm run eval:login -- tmp/eval-token.txt
TOKEN="$(cat tmp/eval-token.txt)"
AUTH=(-H "Authorization: Bearer $TOKEN")
```

PowerShell:

```powershell
$env:DATAINFRA_PASSWORD = "your-local-password"
npm run eval:login -- tmp\eval-token.txt
$TOKEN = Get-Content tmp\eval-token.txt -Raw
```

Keep tokens out of commits, issues, screenshots, and logs.

## Health

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/health/services
```

`/health/services` tells you whether OCR, HaS Text, and HaS Image are `online`,
`degraded`, or `offline`. A model service that is reachable but currently
loading or running inference is reported as `online`; per-job queue/progress is
shown by job APIs, not by service health. Each service entry can include
`detail` fields such as `gpu_available`, `device`, `runtime_mode`, and
`model_state` so operators can distinguish CPU mode from GPU mode. CPU-only
Docker can have a healthy backend while recognition services are offline.

## Concurrency Settings

`BATCH_RECOGNITION_PAGE_CONCURRENCY` applies only after a single image or
scanned-PDF item reaches the vision stage. It limits how many pages from that
one file can call OCR/HaS Image at the same time; it is not the batch-file
worker count. The backend caps the effective value to the file page count and
the configured `1..4` range. Use `JOB_CONCURRENCY` for batch item worker
parallelism, and keep both low on a shared GPU.

## Presets

```bash
curl -sS http://127.0.0.1:8000/api/v1/presets "${AUTH[@]}"
```

Built-in presets are read-only templates. They reference configured entity
types, OCR/HaS text types, and the fixed 21 HaS Image classes only.
`signature`, `handwritten`, `handwriting`, and `handwritten_signature` are not
HaS Image classes.

Create your own preset for deployment-specific rules:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/presets \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Partner data-room review",
    "kind":"full",
    "selectedEntityTypeIds":["PERSON","EMAIL","ORG","CONTRACT_NO"],
    "ocrHasTypes":["PERSON","EMAIL","ORG","CONTRACT_NO"],
    "hasImageTypes":["face","official_seal","qr_code"],
    "replacementMode":"structured"
  }'
```

## Single File Flow

Upload:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/files/upload \
  "${AUTH[@]}" \
  -F "file=@/path/to/sample.docx" \
  -F "upload_source=playground"
```

`upload_source=playground` is a legacy API value for the single-file workflow;
the user-facing product name is single-file processing/workbench.

Parse and run text recognition:

```bash
FILE_ID='paste-file-id-here'

curl -sS http://127.0.0.1:8000/api/v1/files/$FILE_ID/parse "${AUTH[@]}"

curl -sS -X POST http://127.0.0.1:8000/api/v1/files/$FILE_ID/ner/hybrid \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"entity_type_ids":["PERSON","PHONE","ID_CARD","ORG","ADDRESS","DATE","AMOUNT"]}'
```

Run visual recognition for an image/PDF page:

```bash
curl -sS -X POST "http://127.0.0.1:8000/api/v1/redaction/$FILE_ID/vision?page=1" \
  "${AUTH[@]}"
```

Fetch the file and review the returned `entities` and `bounding_boxes`:

```bash
curl -sS http://127.0.0.1:8000/api/v1/files/$FILE_ID "${AUTH[@]}"
```

Bounding boxes may include:

| Evidence source | Meaning |
| --- | --- |
| `has_image_model` | HaS Image model hit from the fixed 21-class detector. |
| `ocr_has` | OCR/HaS text or OCR visual evidence mapped to a page region. |
| `local_fallback` | Conservative local recovery evidence, such as seal fallback. |
| `manual` | User-created or user-edited review box. |

Use `has_image_model` when measuring model contribution. Local fallback and OCR
evidence can help review, but they are not HaS Image model hits.

## Batch Flow

Create a batch job:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/jobs \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{
    "job_type":"smart_batch",
    "title":"Mixed file batch",
    "skip_item_review":false,
    "config":{
      "batch_step1_configured":true,
      "entity_type_ids":["PERSON","PHONE","ID_CARD","ORG","ADDRESS","DATE","AMOUNT"],
      "selected_modes":["text","image"]
    }
  }'
```

Upload DOCX, PDF, scan, and image files into the same job. Mixed files are the
normal batch shape:

```bash
JOB_ID='paste-job-id-here'

curl -sS -X POST http://127.0.0.1:8000/api/v1/files/upload \
  "${AUTH[@]}" \
  -F "file=@/path/to/sample-contract.pdf" \
  -F "job_id=$JOB_ID" \
  -F "upload_source=batch"
```

Submit and poll:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/jobs/$JOB_ID/submit "${AUTH[@]}"
curl -sS http://127.0.0.1:8000/api/v1/jobs/$JOB_ID "${AUTH[@]}"
```

Items move through `pending`, `queued`, `parsing`, `ner` or `vision`,
`awaiting_review`, `redacting`, and `completed`.

## Review And Export

When an item is ready for review, fetch the file, send the reviewed entities and
boxes, then read the export report:

```bash
ITEM_ID='paste-item-id-here'

curl -sS http://127.0.0.1:8000/api/v1/files/$FILE_ID "${AUTH[@]}"

curl -sS -X POST "http://127.0.0.1:8000/api/v1/jobs/$JOB_ID/items/$ITEM_ID/review/commit?reviewer=api" \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"entities":[],"bounding_boxes":[]}'

curl -sS http://127.0.0.1:8000/api/v1/jobs/$JOB_ID/export-report \
  "${AUTH[@]}" \
  -o export-report.json
```

Use `summary.delivery_status` as the download gate:

| Status | Meaning |
| --- | --- |
| `ready_for_delivery` | Selected files have confirmed review state and usable redacted output. |
| `action_required` | At least one selected file needs review, output generation, or retry. |
| `no_selection` | No files are selected for the report. |

Visual review fields are advisory in the current contract. They identify pages
to inspect; they do not by themselves change delivery status.

Download redacted outputs:

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/files/batch/download \
  "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"job_id":"paste-job-id-here","redacted":true}' \
  -o redacted-batch.zip
```

If the selected set is not ready, the API returns a machine-readable report.
Common ZIP skip reasons are `job_item_not_delivery_ready`,
`missing_redacted_output`, `file_not_found`, and `unsafe_path`.

## Regression Command

For a scripted mixed-file workflow gate:

```bash
npm run eval:batch-e2e -- \
  output/playwright/eval-batch-current \
  /path/to/sample-a.docx \
  /path/to/sample-b.docx \
  /path/to/sample-contract.pdf \
  /path/to/sample-image.png
```

Without explicit files, `eval:batch-e2e` uses public mixed fixtures. If auth is
disabled, no token env vars are needed. If auth is enabled, create
`tmp/eval-token.txt` first with `npm run eval:login`; set
`DATAINFRA_TOKEN_FILE` only when using a non-default token path.
