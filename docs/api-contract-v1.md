# API Contract v1 — DataInfra-RedactionEverything

> **Frozen:** 2026-04-04  
> **Base URL:** `/api/v1`  
> **Auth:** Bearer JWT (`Authorization` header) + `X-CSRF-Token` on mutating requests  
> **Default timeout:** 60,000ms (overrides noted per endpoint)

---

## 1. Files

| Method | Path | Auth | Timeout | Description |
|--------|------|------|---------|-------------|
| POST | `/files/upload` | Yes | 60s | Upload file (multipart/form-data). Params: `file`, `batch_group_id?`, `job_id?`, `upload_source?` |
| GET | `/files/{file_id}/parse` | Yes | 60s | Parse file → `ParseResult` |
| GET | `/files/{file_id}` | Yes | 60s | Get file info → `FileInfo` |
| GET | `/files` | Yes | 60s | List files (paginated) → `FileListResponse`. Params: `page`, `page_size`, `source?`, `embed_job?`, `job_id?` |
| POST | `/files/batch/download` | Yes | 60s | Batch download as ZIP → Blob. Body: `{ file_ids, redacted }` |
| GET | `/files/{file_id}/download` | Yes | 60s | Download single file. Params: `redacted` |
| DELETE | `/files/{file_id}` | Yes | 60s | Delete file |

## 2. NER (Named Entity Recognition)

| Method | Path | Auth | Timeout | Description |
|--------|------|------|---------|-------------|
| GET | `/files/{file_id}/ner` | Yes | 130s | Extract entities → `NERResult` |

## 3. Redaction

| Method | Path | Auth | Timeout | Description |
|--------|------|------|---------|-------------|
| POST | `/redaction/execute` | Yes | 60s | Execute redaction → `RedactionResult`. Body: `RedactionRequest` |
| GET | `/redaction/{file_id}/compare` | Yes | 60s | Get before/after comparison → `CompareData` |
| POST | `/redaction/{file_id}/vision?page={n}` | Yes | **400s** | Vision detection (OCR+NER+YOLO) → `VisionResult` |
| GET | `/redaction/entity-types` | No | 60s | List entity types (legacy) |
| GET | `/redaction/{file_id}/report` | Yes | 60s | Quality report |
| GET | `/redaction/replacement-modes` | No | 60s | List replacement modes |

## 4. Entity Types (Custom Types)

| Method | Path | Auth | Timeout | Description |
|--------|------|------|---------|-------------|
| GET | `/custom-types?enabled_only={bool}` | Yes | 60s | List all → `{ custom_types, total }` |
| GET | `/custom-types/{id}` | Yes | 60s | Get by ID → `EntityTypeConfig` |
| POST | `/custom-types` | Yes | 60s | Create → `EntityTypeConfig` |
| PUT | `/custom-types/{id}` | Yes | 60s | Update → `EntityTypeConfig` |
| DELETE | `/custom-types/{id}` | Yes | 60s | Delete |
| POST | `/custom-types/{id}/toggle` | Yes | 60s | Toggle enabled → `{ enabled }` |
| POST | `/custom-types/reset` | Yes | 60s | Reset to defaults |

## 5. Presets

| Method | Path | Auth | Timeout | Description |
|--------|------|------|---------|-------------|
| GET | `/presets` | No* | 60s | List presets → `RecognitionPreset[]` or `{ presets }` |
| POST | `/presets` | No* | 60s | Create → `RecognitionPreset` |
| PUT | `/presets/{id}` | No* | 60s | Update → `RecognitionPreset` |
| DELETE | `/presets/{id}` | No* | 60s | Delete |

> *Presets API currently doesn't attach auth headers — potential 401 when AUTH_ENABLED=true

## 6. Jobs

| Method | Path | Auth | Timeout | Description |
|--------|------|------|---------|-------------|
| POST | `/jobs` | Yes | 60s | Create job. Body: `{ job_type, title, config }` |
| GET | `/jobs` | Yes | 60s | List jobs. Params: `job_type?`, `page`, `page_size` |
| GET | `/jobs/{id}` | Yes | 60s | Get job detail (includes items) |
| POST | `/jobs/{id}/submit` | Yes | 60s | Submit job for processing |
| POST | `/jobs/{id}/cancel` | Yes | 60s | Cancel job |
| DELETE | `/jobs/{id}` | Yes | 60s | Delete job |
| POST | `/jobs/{id}/requeue-failed` | Yes | 60s | Requeue failed items |
| POST | `/jobs/{id}/items/{item_id}/review/approve` | Yes | 60s | Approve review |
| POST | `/jobs/{id}/items/{item_id}/review/reject` | Yes | 60s | Reject review |
| GET | `/jobs/{id}/items/{item_id}/review-draft` | Yes | 60s | Get review draft |
| PUT | `/jobs/{id}/items/{item_id}/review-draft` | Yes | 60s | Save review draft |
| DELETE | `/jobs/{id}/items/{item_id}/review-draft` | Yes | 60s | Discard review draft |
| POST | `/jobs/{id}/commit` | Yes | 60s | Commit job (finalize) |

## 7. Health & Safety

| Method | Path | Auth | Timeout | Description |
|--------|------|------|---------|-------------|
| GET | `/health` | No | 15s | Backend health |
| GET | `/health/services` | No | 15s | All 5 services status |
| POST | `/safety/cleanup` | Yes | 60s | Orphan file cleanup |

---

## Error Response Format

```json
{
  "detail": "string or object"
}
```

HTTP status codes: 400 (bad request), 401 (unauthorized), 404 (not found), 422 (validation), 500 (server error)

---

## Known Mismatches (Frontend Types vs Backend)

1. **`Entity.source`** — backend returns `source` field but `Entity` interface in `types/index.ts` doesn't include it
2. **`VisionResult.result_image`** — backend may return base64 result image, not in frontend types
3. **Presets API missing auth** — `presetsApi.ts` uses raw `fetch()` without JWT/CSRF headers
4. **Jobs API duplicate auth** — `jobsApi.ts` has its own `authHeaders()` instead of using the shared axios instance
5. **Untyped report** — `redactionApi.getReport()` returns `Promise<any>`
6. **Presets response format** — backend may return `RecognitionPreset[]` or `{ presets: [...] }`, frontend handles both
