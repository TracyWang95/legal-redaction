"""File management API endpoint tests."""
from __future__ import annotations

import io
import json
import os
import sqlite3
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient


def _upload_txt(client: TestClient, filename: str = "sample.txt", content: bytes = b"Hello world") -> tuple[dict, int]:
    """Helper: upload a .txt file and return (json_body, status_code)."""
    resp = client.post(
        "/api/v1/files/upload",
        files={"file": (filename, io.BytesIO(content), "text/plain")},
    )
    return resp.json(), resp.status_code


# ── List files ───────────────────────────────────────────────

def test_list_files_empty(test_client: TestClient):
    resp = test_client.get("/api/v1/files")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["files"] == []


def test_list_files_after_upload(test_client: TestClient):
    _upload_txt(test_client)
    resp = test_client.get("/api/v1/files")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1
    assert len(body["files"]) >= 1
    assert body["files"][0]["original_filename"] == "sample.txt"


# ── Upload file ──────────────────────────────────────────────

def test_upload_valid_file(test_client: TestClient):
    body, status = _upload_txt(test_client)
    assert status == 200
    assert "file_id" in body
    assert body["filename"] == "sample.txt"
    assert body["file_size"] > 0


def test_upload_invalid_type_returns_400(test_client: TestClient):
    content = b"not a real exe"
    resp = test_client.post(
        "/api/v1/files/upload",
        files={"file": ("malware.exe", io.BytesIO(content), "application/octet-stream")},
    )
    assert resp.status_code == 400
    body = resp.json()
    # Custom error handler puts HTTPException detail into "message"
    assert "不支持" in body.get("message", "") or "类型" in body.get("message", "")


def test_upload_oversized_file_returns_error(test_client: TestClient, tmp_data_dir: str):
    """A file exceeding MAX_FILE_SIZE should be rejected (400 or 413)."""
    from app.core.config import settings
    original = settings.MAX_FILE_SIZE
    settings.MAX_FILE_SIZE = 1024  # 1 KB
    try:
        content = os.urandom(2048)  # 2 KB > 1 KB limit
        resp = test_client.post(
            "/api/v1/files/upload",
            files={"file": ("big.txt", io.BytesIO(content), "text/plain")},
        )
        assert resp.status_code in (400, 413)
    finally:
        settings.MAX_FILE_SIZE = original


def test_upload_with_job_id_registers_job_item(test_client: TestClient):
    """Batch uploads to draft jobs should atomically create the file and job item."""
    from app.services.file_management_service import get_file_store

    job_resp = test_client.post("/api/v1/jobs", json={"job_type": "text_batch", "title": "draft"})
    assert job_resp.status_code == 200
    job_id = job_resp.json()["id"]

    resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("registered.txt", io.BytesIO(b"registered"), "text/plain")},
    )

    assert resp.status_code == 200
    file_id = resp.json()["file_id"]
    assert file_id in get_file_store()

    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200
    items = detail.json()["items"]
    assert len(items) == 1
    assert items[0]["file_id"] == file_id


def test_upload_rolls_back_when_job_registration_fails_for_missing_job(
    test_client: TestClient,
    tmp_data_dir: str,
):
    """A failed batch registration must not leave file_store or disk orphans."""
    from app.services.file_management_service import get_file_store

    missing_job_id = "11111111-1111-4111-8111-111111111111"
    resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": missing_job_id, "upload_source": "batch"},
        files={"file": ("orphan.txt", io.BytesIO(b"orphan"), "text/plain")},
    )

    assert resp.status_code == 400
    assert len(get_file_store()) == 0
    assert list((Path(tmp_data_dir) / "uploads").iterdir()) == []


def test_upload_rolls_back_when_job_is_not_draft(
    test_client: TestClient,
    tmp_data_dir: str,
):
    """Rejected uploads to submitted jobs must not persist unattached files."""
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobStatus, get_job_store

    job_resp = test_client.post("/api/v1/jobs", json={"job_type": "text_batch", "title": "locked"})
    assert job_resp.status_code == 200
    job_id = job_resp.json()["id"]
    get_job_store().update_job_status(job_id, JobStatus.QUEUED)

    resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("late.txt", io.BytesIO(b"late"), "text/plain")},
    )

    assert resp.status_code == 400
    assert len(get_file_store()) == 0
    assert list((Path(tmp_data_dir) / "uploads").iterdir()) == []


def test_upload_source_batch_without_batch_context_rolls_back_saved_file(
    test_client: TestClient,
    tmp_data_dir: str,
):
    """Invalid batch upload metadata is validated after disk write; rollback must clean it."""
    from app.services.file_management_service import get_file_store

    resp = test_client.post(
        "/api/v1/files/upload",
        data={"upload_source": "batch"},
        files={"file": ("metadata.txt", io.BytesIO(b"metadata"), "text/plain")},
    )

    assert resp.status_code == 400
    assert len(get_file_store()) == 0
    assert list((Path(tmp_data_dir) / "uploads").iterdir()) == []


def test_upload_rolls_back_when_file_store_write_fails(
    test_client: TestClient,
    tmp_data_dir: str,
    monkeypatch,
):
    """Unexpected metadata persistence failures must not leave disk orphans."""
    import app.services.file_management_service as fms

    def fail_set(*_args, **_kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(fms.file_store, "set", fail_set)

    resp = test_client.post(
        "/api/v1/files/upload",
        files={"file": ("db-fail.txt", io.BytesIO(b"db-fail"), "text/plain")},
    )

    assert resp.status_code == 500
    assert len(fms.get_file_store()) == 0
    assert list((Path(tmp_data_dir) / "uploads").iterdir()) == []


# ── Download file ────────────────────────────────────────────

def test_download_file_exists(test_client: TestClient):
    body, status = _upload_txt(test_client, content=b"download me")
    assert status == 200
    file_id = body["file_id"]
    resp = test_client.get(f"/api/v1/files/{file_id}/download")
    assert resp.status_code == 200
    assert len(resp.content) > 0


def test_download_file_not_found_returns_404(test_client: TestClient):
    resp = test_client.get("/api/v1/files/nonexistent-id/download")
    assert resp.status_code == 404


def test_download_legacy_record_missing_file_path_returns_400(test_client: TestClient):
    from app.services.file_management_service import get_file_store

    get_file_store().set(
        "legacy-missing-path",
        {
            "id": "legacy-missing-path",
            "original_filename": "legacy.txt",
            "file_type": "txt",
            "file_size": 12,
            "created_at": "2026-01-01T00:00:00+00:00",
            "upload_source": "playground",
        },
    )

    resp = test_client.get("/api/v1/files/legacy-missing-path/download")

    assert resp.status_code == 400
    assert "missing original file path" in resp.text


def test_download_redacted_with_null_output_path_returns_400(test_client: TestClient):
    from app.services.file_management_service import get_file_store

    get_file_store().set(
        "redacted-null-output",
        {
            "id": "redacted-null-output",
            "original_filename": "legacy.txt",
            "file_type": "txt",
            "file_size": 12,
            "created_at": "2026-01-01T00:00:00+00:00",
            "upload_source": "playground",
            "output_path": None,
        },
    )

    resp = test_client.get("/api/v1/files/redacted-null-output/download?redacted=true")

    assert resp.status_code == 400
    assert "文件尚未匿名化" in resp.text


def test_page_image_legacy_record_missing_file_path_returns_400(test_client: TestClient):
    from app.services.file_management_service import get_file_store

    get_file_store().set(
        "legacy-image-missing-path",
        {
            "id": "legacy-image-missing-path",
            "original_filename": "legacy.png",
            "file_type": "png",
            "file_size": 12,
            "created_at": "2026-01-01T00:00:00+00:00",
            "upload_source": "playground",
        },
    )

    resp = test_client.get("/api/v1/files/legacy-image-missing-path/page-image")

    assert resp.status_code == 400
    assert "missing original file path" in resp.text


# ── Delete file ──────────────────────────────────────────────

def test_batch_download_original_zip_skips_missing_files(test_client: TestClient):
    body, status = _upload_txt(test_client, filename="alpha.txt", content=b"alpha")
    assert status == 200

    resp = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": [body["file_id"], "missing-id"], "redacted": False},
    )

    assert resp.status_code == 200
    assert resp.headers["x-batch-zip-included-count"] == "1"
    assert resp.headers["x-batch-zip-skipped-count"] == "1"
    assert resp.headers["x-batch-zip-requested-count"] == "2"
    assert json.loads(resp.headers["x-batch-zip-skipped"]) == [
        {"file_id": "missing-id", "reason": "file_not_found"}
    ]
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert sorted(zf.namelist()) == ["alpha.txt", "manifest.json"]
        assert zf.read("alpha.txt") == b"alpha"
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    assert manifest["redacted"] is False
    assert manifest["requested_count"] == 2
    assert manifest["included_count"] == 1
    assert manifest["skipped_count"] == 1
    assert manifest["included"][0]["file_id"] == body["file_id"]
    assert manifest["included"][0]["archive_name"] == "alpha.txt"
    assert manifest["skipped"] == [{"file_id": "missing-id", "reason": "file_not_found"}]


def test_batch_download_redacted_zip_skips_unredacted_files(test_client: TestClient, tmp_data_dir: str):
    from app.services.file_management_service import get_file_store

    ready, ready_status = _upload_txt(test_client, filename="ready.txt", content=b"original")
    pending, pending_status = _upload_txt(test_client, filename="pending.txt", content=b"pending")
    assert ready_status == 200
    assert pending_status == 200

    output_path = Path(tmp_data_dir) / "outputs" / "redacted-ready.txt"
    output_path.write_bytes(b"redacted")
    get_file_store().update_fields(ready["file_id"], {"output_path": str(output_path)})

    resp = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": [ready["file_id"], pending["file_id"]], "redacted": True},
    )

    assert resp.status_code == 200
    assert resp.headers["x-batch-zip-included-count"] == "1"
    assert resp.headers["x-batch-zip-skipped-count"] == "1"
    assert resp.headers["x-batch-zip-redacted"] == "true"
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert sorted(zf.namelist()) == ["manifest.json", "redacted_ready.txt"]
        assert zf.read("redacted_ready.txt") == b"redacted"
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    assert manifest["redacted"] is True
    assert manifest["requested_count"] == 2
    assert manifest["included_count"] == 1
    assert manifest["skipped_count"] == 1
    assert manifest["included"][0]["archive_name"] == "redacted_ready.txt"
    assert manifest["skipped"] == [
        {"file_id": pending["file_id"], "reason": "missing_redacted_output"}
    ]


def test_batch_download_redacted_zip_with_job_id_requires_delivery_ready(
    test_client: TestClient,
    tmp_data_dir: str,
):
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus, get_job_store

    job_resp = test_client.post("/api/v1/jobs", json={"job_type": "text_batch", "title": "zip"})
    assert job_resp.status_code == 200
    job_id = job_resp.json()["id"]

    ready_resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("ready.txt", io.BytesIO(b"ready"), "text/plain")},
    )
    pending_resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("pending.txt", io.BytesIO(b"pending"), "text/plain")},
    )
    assert ready_resp.status_code == 200
    assert pending_resp.status_code == 200
    ready_file_id = ready_resp.json()["file_id"]
    pending_file_id = pending_resp.json()["file_id"]

    detail = test_client.get(f"/api/v1/jobs/{job_id}").json()
    ready_item_id = next(
        item["id"] for item in detail["items"] if item["file_id"] == ready_file_id
    )
    store = get_job_store()
    store.update_item_status(ready_item_id, JobItemStatus.PROCESSING)
    store.update_item_status(ready_item_id, JobItemStatus.AWAITING_REVIEW)
    store.update_item_status(ready_item_id, JobItemStatus.COMPLETED)

    output_path = Path(tmp_data_dir) / "outputs" / "redacted-ready.txt"
    output_path.write_bytes(b"redacted")
    get_file_store().update_fields(ready_file_id, {"output_path": str(output_path)})

    resp = test_client.post(
        "/api/v1/files/batch/download",
        json={
            "file_ids": [ready_file_id, pending_file_id],
            "redacted": True,
            "job_id": job_id,
        },
    )

    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["message"] == "redacted export is not ready for delivery"
    assert detail["summary"]["ready_for_delivery"] is False
    assert detail["summary"]["action_required_files"] == 1
    assert detail["redacted_zip"]["skipped"] == [
        {"file_id": pending_file_id, "reason": "missing_redacted_output"}
    ]


def test_batch_download_redacted_zip_with_job_id_allows_ready_subset(
    test_client: TestClient,
    tmp_data_dir: str,
):
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus, get_job_store

    job_resp = test_client.post("/api/v1/jobs", json={"job_type": "text_batch", "title": "zip"})
    assert job_resp.status_code == 200
    job_id = job_resp.json()["id"]

    ready_resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("ready.txt", io.BytesIO(b"ready"), "text/plain")},
    )
    assert ready_resp.status_code == 200
    ready_file_id = ready_resp.json()["file_id"]

    detail = test_client.get(f"/api/v1/jobs/{job_id}").json()
    ready_item_id = next(
        item["id"] for item in detail["items"] if item["file_id"] == ready_file_id
    )
    store = get_job_store()
    store.update_item_status(ready_item_id, JobItemStatus.PROCESSING)
    store.update_item_status(ready_item_id, JobItemStatus.AWAITING_REVIEW)
    store.update_item_status(ready_item_id, JobItemStatus.COMPLETED)

    output_path = Path(tmp_data_dir) / "outputs" / "redacted-ready.txt"
    output_path.write_bytes(b"redacted")
    get_file_store().update_fields(ready_file_id, {"output_path": str(output_path)})

    resp = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": [ready_file_id], "redacted": True, "job_id": job_id},
    )

    assert resp.status_code == 200
    assert resp.headers["x-batch-zip-included-count"] == "1"
    assert resp.headers["x-batch-zip-skipped-count"] == "0"
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert sorted(zf.namelist()) == ["manifest.json", "redacted_ready.txt"]


def test_failed_job_item_clears_stale_output_and_zip_skips_it(
    test_client: TestClient,
    tmp_data_dir: str,
):
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus, get_job_store

    job_resp = test_client.post("/api/v1/jobs", json={"job_type": "text_batch", "title": "retry"})
    assert job_resp.status_code == 200
    job_id = job_resp.json()["id"]

    ready_resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("ready.txt", io.BytesIO(b"ready"), "text/plain")},
    )
    failed_resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("failed.txt", io.BytesIO(b"failed"), "text/plain")},
    )
    assert ready_resp.status_code == 200
    assert failed_resp.status_code == 200
    ready_file_id = ready_resp.json()["file_id"]
    failed_file_id = failed_resp.json()["file_id"]

    detail = test_client.get(f"/api/v1/jobs/{job_id}").json()
    item_by_file = {item["file_id"]: item for item in detail["items"]}
    store = get_job_store()

    ready_item_id = item_by_file[ready_file_id]["id"]
    store.update_item_status(ready_item_id, JobItemStatus.PROCESSING)
    store.update_item_status(ready_item_id, JobItemStatus.AWAITING_REVIEW)
    store.update_item_status(ready_item_id, JobItemStatus.COMPLETED)
    ready_output = Path(tmp_data_dir) / "outputs" / "redacted-ready.txt"
    ready_output.write_bytes(b"ready-redacted")
    get_file_store().update_fields(ready_file_id, {"output_path": str(ready_output)})

    failed_output = Path(tmp_data_dir) / "outputs" / "redacted-failed.txt"
    failed_output.write_bytes(b"stale-redacted")
    get_file_store().update_fields(
        failed_file_id,
        {"output_path": str(failed_output), "redacted_count": 99, "entity_map": {"x": "y"}},
    )
    failed_item_id = item_by_file[failed_file_id]["id"]
    store.update_item_status(failed_item_id, JobItemStatus.PROCESSING)
    store.update_item_status(failed_item_id, JobItemStatus.FAILED, error_message="redaction failed")

    failed_info = get_file_store().get(failed_file_id)
    assert failed_info is not None
    assert "output_path" not in failed_info
    assert "redacted_count" not in failed_info
    assert "entity_map" not in failed_info
    assert not failed_output.exists()

    resp = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": [ready_file_id, failed_file_id], "redacted": True},
    )

    assert resp.status_code == 200
    assert resp.headers["x-batch-zip-included-count"] == "1"
    assert json.loads(resp.headers["x-batch-zip-skipped"]) == [
        {"file_id": failed_file_id, "reason": "job_item_not_delivery_ready"}
    ]
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert sorted(zf.namelist()) == ["manifest.json", "redacted_ready.txt"]


def test_batch_download_original_zip_skips_unsafe_store_paths(test_client: TestClient, tmp_data_dir: str):
    from app.services.file_management_service import get_file_store

    ready, ready_status = _upload_txt(test_client, filename="ready.txt", content=b"ready")
    unsafe, unsafe_status = _upload_txt(test_client, filename="unsafe.txt", content=b"unsafe")
    assert ready_status == 200
    assert unsafe_status == 200

    outside_path = Path(tmp_data_dir) / "outside.txt"
    outside_path.write_bytes(b"outside")
    get_file_store().update_fields(unsafe["file_id"], {"file_path": str(outside_path)})

    resp = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": [ready["file_id"], unsafe["file_id"]], "redacted": False},
    )

    assert resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert sorted(zf.namelist()) == ["manifest.json", "ready.txt"]
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    assert manifest["included_count"] == 1
    assert manifest["skipped"] == [{"file_id": unsafe["file_id"], "reason": "unsafe_path"}]


def test_batch_download_zip_returns_400_when_nothing_downloadable(test_client: TestClient):
    resp = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": ["missing-id"], "redacted": False},
    )

    assert resp.status_code == 400


def test_delete_file_success(test_client: TestClient):
    body, status = _upload_txt(test_client)
    assert status == 200
    file_id = body["file_id"]
    resp = test_client.delete(f"/api/v1/files/{file_id}")
    assert resp.status_code == 200
    # Verify it's gone
    resp2 = test_client.get(f"/api/v1/files/{file_id}")
    assert resp2.status_code == 404


def test_delete_file_removes_job_item_reference(test_client: TestClient):
    from app.services.job_store import get_job_store

    job_resp = test_client.post("/api/v1/jobs", json={"job_type": "text_batch", "title": "delete"})
    assert job_resp.status_code == 200
    job_id = job_resp.json()["id"]
    upload_resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("delete-me.txt", io.BytesIO(b"delete"), "text/plain")},
    )
    assert upload_resp.status_code == 200
    file_id = upload_resp.json()["file_id"]
    assert file_id in get_job_store().list_referenced_file_ids()

    resp = test_client.delete(f"/api/v1/files/{file_id}")

    assert resp.status_code == 200
    assert file_id not in get_job_store().list_referenced_file_ids()
    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200
    assert detail.json()["items"] == []


def test_delete_file_not_found_returns_404(test_client: TestClient):
    resp = test_client.delete("/api/v1/files/nonexistent-id")
    assert resp.status_code == 404
