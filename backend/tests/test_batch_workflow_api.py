from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff"
    b"\xff?\x00\x05\xfe\x02\xfeA\xe2&\xd9\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _disable_queue(monkeypatch) -> None:
    import app.services.job_management_service as jms

    monkeypatch.setattr(jms, "enqueue_task", lambda *args, **kwargs: None)


def _create_job(client: TestClient, job_type: str, title: str) -> dict:
    response = client.post(
        "/api/v1/jobs",
        json={
            "job_type": job_type,
            "title": title,
            "config": {
                "batch_wizard_mode": job_type.replace("_batch", ""),
                "entity_type_ids": ["PERSON"],
                "ocr_has_types": ["STAMP"],
                "has_image_types": ["FACE"],
                "replacement_mode": "structured",
                "wizard_furthest_step": 1,
            },
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job_type"] == job_type
    assert body["status"] == "draft"
    return body


def _upload_to_job(
    client: TestClient,
    job_id: str,
    *,
    filename: str,
    content: bytes,
    content_type: str,
) -> dict:
    response = client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": (filename, io.BytesIO(content), content_type)},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filename"] == filename
    assert body["file_id"]
    return body


def _item_for_file(client: TestClient, job_id: str, file_id: str) -> dict:
    response = client.get(f"/api/v1/jobs/{job_id}")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    match = next((item for item in items if item["file_id"] == file_id), None)
    assert match is not None
    return match


def _mark_awaiting_review(store, job_id: str, item_id: str) -> None:
    from app.services.job_store import JobItemStatus, JobStatus

    store.update_job_status(job_id, JobStatus.PROCESSING)
    store.update_item_status(item_id, JobItemStatus.PROCESSING)
    store.update_item_status(item_id, JobItemStatus.AWAITING_REVIEW)
    store.update_job_status(job_id, JobStatus.AWAITING_REVIEW)


def _mark_completed_with_output(
    *,
    store,
    tmp_data_dir: str,
    job_id: str,
    item_id: str,
    file_id: str,
    filename: str,
    content: bytes,
    entities: list[dict] | None = None,
    bounding_boxes: dict | None = None,
) -> Path:
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus

    current = store.get_item(item_id)
    assert current is not None
    if current["status"] == "pending":
        store.update_item_status(item_id, JobItemStatus.PROCESSING)
    if store.get_item(item_id)["status"] == "awaiting_review":
        store.update_item_status(item_id, JobItemStatus.PROCESSING)
    store.update_item_status(item_id, JobItemStatus.COMPLETED)

    output_path = Path(tmp_data_dir) / "outputs" / filename
    output_path.write_bytes(content)
    get_file_store().update_fields(
        file_id,
        {
            "output_path": str(output_path),
            "redacted_count": len(entities or []),
            "entities": entities or [],
            "bounding_boxes": bounding_boxes or {},
        },
    )
    return output_path


def _read_manifest(response) -> dict:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        return json.loads(zf.read("manifest.json"))


def test_text_batch_job_review_export_report_and_download_contract(
    test_client: TestClient,
    tmp_data_dir: str,
    monkeypatch,
):
    from app.services.job_store import JobStatus, get_job_store

    _disable_queue(monkeypatch)
    store = get_job_store()

    job = _create_job(test_client, "text_batch", "Text contract review")
    job_id = job["id"]
    uploaded = _upload_to_job(
        test_client,
        job_id,
        filename="contract.txt",
        content=b"Alice signs the contract.",
        content_type="text/plain",
    )
    file_id = uploaded["file_id"]
    item = _item_for_file(test_client, job_id, file_id)

    submit = test_client.post(f"/api/v1/jobs/{job_id}/submit")
    assert submit.status_code == 200, submit.text
    assert submit.json()["status"] == "queued"

    _mark_awaiting_review(store, job_id, item["id"])

    draft_payload = {
        "entities": [
            {
                "id": "e1",
                "text": "Alice",
                "type": "PERSON",
                "start": 0,
                "end": 5,
                "page": 1,
                "confidence": 0.99,
                "source": "manual",
                "selected": True,
            }
        ],
        "bounding_boxes": [],
    }
    draft = test_client.put(
        f"/api/v1/jobs/{job_id}/items/{item['id']}/review-draft",
        json=draft_payload,
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["exists"] is True
    assert draft.json()["entities"][0]["text"] == "Alice"

    loaded_draft = test_client.get(f"/api/v1/jobs/{job_id}/items/{item['id']}/review-draft")
    assert loaded_draft.status_code == 200
    assert loaded_draft.json()["entities"][0]["type"] == "PERSON"

    approved = test_client.post(f"/api/v1/jobs/{job_id}/items/{item['id']}/review/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "review_approved"

    _mark_completed_with_output(
        store=store,
        tmp_data_dir=tmp_data_dir,
        job_id=job_id,
        item_id=item["id"],
        file_id=file_id,
        filename="redacted-contract.txt",
        content=b"[PERSON] signs the contract.",
        entities=draft_payload["entities"],
    )
    store.update_job_status(job_id, JobStatus.COMPLETED)

    report = test_client.get(f"/api/v1/jobs/{job_id}/export-report", params={"file_ids": file_id})
    assert report.status_code == 200, report.text
    report_body = report.json()
    assert report_body["job"]["id"] == job_id
    assert report_body["summary"]["selected_files"] == 1
    assert report_body["summary"]["ready_for_delivery"] is True
    assert report_body["summary"]["redacted_selected_files"] == 1
    assert report_body["files"][0]["ready_for_delivery"] is True

    original_zip = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": [file_id], "redacted": False, "job_id": job_id},
    )
    original_manifest = _read_manifest(original_zip)
    assert original_manifest["redacted"] is False
    assert original_manifest["included_count"] == 1

    redacted_zip = test_client.post(
        "/api/v1/files/batch/download",
        json={"file_ids": [file_id], "redacted": True, "job_id": job_id},
    )
    redacted_manifest = _read_manifest(redacted_zip)
    assert redacted_zip.headers["x-batch-zip-redacted"] == "true"
    assert redacted_manifest["redacted"] is True
    assert redacted_manifest["included_count"] == 1
    assert redacted_manifest["skipped"] == []


def test_review_draft_read_survives_completed_item_with_output(
    test_client: TestClient,
    tmp_data_dir: str,
    monkeypatch,
):
    from app.services.job_store import JobStatus, get_job_store

    _disable_queue(monkeypatch)
    store = get_job_store()

    job = _create_job(test_client, "text_batch", "Completed draft read")
    job_id = job["id"]
    uploaded = _upload_to_job(
        test_client,
        job_id,
        filename="complete.txt",
        content=b"Alice approved.",
        content_type="text/plain",
    )
    item = _item_for_file(test_client, job_id, uploaded["file_id"])

    _mark_awaiting_review(store, job_id, item["id"])
    draft_payload = {
        "entities": [
            {
                "id": "e1",
                "text": "Alice",
                "type": "PERSON",
                "start": 0,
                "end": 5,
                "page": 1,
                "confidence": 0.99,
                "source": "manual",
                "selected": True,
            }
        ],
        "bounding_boxes": [],
    }
    saved = test_client.put(
        f"/api/v1/jobs/{job_id}/items/{item['id']}/review-draft",
        json=draft_payload,
    )
    assert saved.status_code == 200, saved.text

    _mark_completed_with_output(
        store=store,
        tmp_data_dir=tmp_data_dir,
        job_id=job_id,
        item_id=item["id"],
        file_id=uploaded["file_id"],
        filename="complete-redacted.txt",
        content=b"[PERSON] approved.",
        entities=draft_payload["entities"],
    )
    store.update_job_status(job_id, JobStatus.COMPLETED)

    loaded = test_client.get(f"/api/v1/jobs/{job_id}/items/{item['id']}/review-draft")

    assert loaded.status_code == 200, loaded.text
    assert loaded.json()["exists"] is True
    assert loaded.json()["entities"][0]["text"] == "Alice"


def test_review_draft_read_degrades_when_jobs_db_is_briefly_busy(
    test_client: TestClient,
    monkeypatch,
):
    import app.services.job_management_service as jms

    job = _create_job(test_client, "text_batch", "Busy draft read")
    uploaded = _upload_to_job(
        test_client,
        job["id"],
        filename="busy.txt",
        content=b"Alice pending.",
        content_type="text/plain",
    )
    item = _item_for_file(test_client, job["id"], uploaded["file_id"])

    def busy_connect(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(jms, "connect_sqlite", busy_connect)

    response = test_client.get(f"/api/v1/jobs/{job['id']}/items/{item['id']}/review-draft")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["exists"] is False
    assert body["entities"] == []
    assert body["bounding_boxes"] == []
    assert body["degraded"] is True
    assert body["retry_after_ms"] == 500


def test_smart_batch_accepts_text_and_png_and_exports_completed_outputs(
    test_client: TestClient,
    tmp_data_dir: str,
    monkeypatch,
):
    from app.services.job_store import JobStatus, get_job_store

    _disable_queue(monkeypatch)
    store = get_job_store()

    job = _create_job(test_client, "smart_batch", "Smart mixed files")
    job_id = job["id"]
    txt = _upload_to_job(
        test_client,
        job_id,
        filename="note.txt",
        content=b"Bob has a receipt image.",
        content_type="text/plain",
    )
    png = _upload_to_job(
        test_client,
        job_id,
        filename="receipt.png",
        content=PNG_1X1,
        content_type="image/png",
    )

    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200, detail.text
    items_by_file = {item["file_id"]: item for item in detail.json()["items"]}
    assert set(items_by_file) == {txt["file_id"], png["file_id"]}

    submit = test_client.post(f"/api/v1/jobs/{job_id}/submit")
    assert submit.status_code == 200, submit.text
    assert submit.json()["status"] == "queued"

    txt_item = items_by_file[txt["file_id"]]
    png_item = items_by_file[png["file_id"]]
    store.update_job_status(job_id, JobStatus.PROCESSING)
    _mark_completed_with_output(
        store=store,
        tmp_data_dir=tmp_data_dir,
        job_id=job_id,
        item_id=txt_item["id"],
        file_id=txt["file_id"],
        filename="redacted-note.txt",
        content=b"[PERSON] has a receipt image.",
        entities=[
            {
                "id": "e1",
                "text": "Bob",
                "type": "PERSON",
                "start": 0,
                "end": 3,
                "page": 1,
                "confidence": 0.98,
                "source": "manual",
                "selected": True,
            }
        ],
    )
    _mark_completed_with_output(
        store=store,
        tmp_data_dir=tmp_data_dir,
        job_id=job_id,
        item_id=png_item["id"],
        file_id=png["file_id"],
        filename="redacted-receipt.png",
        content=PNG_1X1,
        bounding_boxes={
            1: [
                {
                    "id": "b1",
                    "x": 0.1,
                    "y": 0.1,
                    "width": 0.2,
                    "height": 0.2,
                    "type": "FACE",
                    "source": "has_image",
                    "selected": True,
                    "confidence": 0.9,
                }
            ]
        },
    )
    store.update_job_status(job_id, JobStatus.COMPLETED)

    batch_details = test_client.post("/api/v1/jobs/batch-details", json={"ids": [job_id]})
    assert batch_details.status_code == 200, batch_details.text
    returned_job = batch_details.json()["jobs"][0]
    assert returned_job["id"] == job_id
    assert returned_job["job_type"] == "smart_batch"
    assert returned_job["progress"]["completed"] == 2
    assert returned_job["nav_hints"]["redacted_count"] == 2
    assert returned_job["nav_hints"]["export_ready_count"] == 2
    assert returned_job["nav_hints"]["reviewable_count"] == 0
    assert returned_job["nav_hints"]["can_review_now"] is False
    assert returned_job["nav_hints"]["can_export_now"] is True
    assert {item["file_id"] for item in returned_job["items"]} == {txt["file_id"], png["file_id"]}

    report = test_client.get(
        f"/api/v1/jobs/{job_id}/export-report",
        params=[("file_ids", txt["file_id"]), ("file_ids", png["file_id"])],
    )
    assert report.status_code == 200, report.text
    report_body = report.json()
    assert report_body["summary"]["selected_files"] == 2
    assert report_body["summary"]["ready_for_delivery"] is True
    assert report_body["summary"]["redacted_selected_files"] == 2
    assert report_body["redacted_zip"]["included_count"] == 2
    assert {file["file_type"] for file in report_body["files"]} == {"txt", "image"}

    redacted_zip = test_client.post(
        "/api/v1/files/batch/download",
        json={
            "file_ids": [txt["file_id"], png["file_id"]],
            "redacted": True,
            "job_id": job_id,
        },
    )
    manifest = _read_manifest(redacted_zip)
    assert manifest["requested_count"] == 2
    assert manifest["included_count"] == 2
    assert manifest["skipped_count"] == 0
    assert {entry["file_id"] for entry in manifest["included"]} == {
        txt["file_id"],
        png["file_id"],
    }


def test_progressive_review_nav_hints_allow_review_before_export(
    test_client: TestClient,
    monkeypatch,
):
    from app.services.job_store import JobItemStatus, JobStatus, get_job_store

    _disable_queue(monkeypatch)
    store = get_job_store()

    job = _create_job(test_client, "text_batch", "Progressive review")
    job_id = job["id"]
    first = _upload_to_job(
        test_client,
        job_id,
        filename="first.txt",
        content=b"first",
        content_type="text/plain",
    )
    second = _upload_to_job(
        test_client,
        job_id,
        filename="second.txt",
        content=b"second",
        content_type="text/plain",
    )
    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200, detail.text
    items_by_file = {item["file_id"]: item for item in detail.json()["items"]}
    first_item = items_by_file[first["file_id"]]
    second_item = items_by_file[second["file_id"]]

    submit = test_client.post(f"/api/v1/jobs/{job_id}/submit")
    assert submit.status_code == 200, submit.text
    store.update_job_status(job_id, JobStatus.PROCESSING)
    store.update_item_status(first_item["id"], JobItemStatus.PROCESSING)
    store.update_item_status(first_item["id"], JobItemStatus.AWAITING_REVIEW)
    store.update_item_status(second_item["id"], JobItemStatus.PROCESSING)

    response = test_client.get(f"/api/v1/jobs/{job_id}")
    assert response.status_code == 200, response.text
    body = response.json()
    nav = body["nav_hints"]
    assert body["progress"]["awaiting_review"] == 1
    assert body["progress"]["processing"] == 1
    assert nav["first_awaiting_review_item_id"] == first_item["id"]
    assert nav["reviewable_count"] == 1
    assert nav["awaiting_review_count"] == 1
    assert nav["processing_count"] == 1
    assert nav["redacted_count"] == 0
    assert nav["export_ready_count"] == 0
    assert nav["export_blocked_count"] == 2
    assert nav["can_review_now"] is True
    assert nav["can_export_now"] is False

    listed = test_client.get("/api/v1/jobs")
    assert listed.status_code == 200, listed.text
    listed_job = next(row for row in listed.json()["jobs"] if row["id"] == job_id)
    assert listed_job["nav_hints"]["can_review_now"] is True
    assert listed_job["nav_hints"]["can_export_now"] is False


def test_job_detail_degrades_when_file_store_unavailable(
    test_client: TestClient,
    monkeypatch,
):
    import app.services.file_management_service as fms

    job = _create_job(test_client, "smart_batch", "Metadata degraded")
    job_id = job["id"]
    uploaded = _upload_to_job(
        test_client,
        job_id,
        filename="contract.txt",
        content=b"Alice signs.",
        content_type="text/plain",
    )

    def raise_unavailable(file_id: str):
        raise sqlite3.OperationalError("unable to open database file")

    monkeypatch.setattr(fms.file_store, "get", raise_unavailable)

    response = test_client.get(f"/api/v1/jobs/{job_id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["nav_hints"]["metadata_degraded"] is True
    assert body["nav_hints"]["metadata_degraded_count"] == 1
    item = next(row for row in body["items"] if row["file_id"] == uploaded["file_id"])
    assert item["filename"] is None
    assert item["file_type"] is None
    assert item["has_output"] is False
    assert item["entity_count"] == 0


def test_export_report_degrades_when_file_store_unavailable(
    test_client: TestClient,
    monkeypatch,
):
    import app.services.file_management_service as fms

    job = _create_job(test_client, "smart_batch", "Report metadata degraded")
    job_id = job["id"]
    uploaded = _upload_to_job(
        test_client,
        job_id,
        filename="contract.txt",
        content=b"Alice signs.",
        content_type="text/plain",
    )

    def raise_unavailable(file_id: str):
        raise sqlite3.OperationalError("unable to open database file")

    monkeypatch.setattr(fms.file_store, "get", raise_unavailable)

    response = test_client.get(f"/api/v1/jobs/{job_id}/export-report")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["summary"]["ready_for_delivery"] is False
    assert body["summary"]["action_required"] is True
    assert body["summary"]["redacted_selected_files"] == 0
    report_file = next(row for row in body["files"] if row["file_id"] == uploaded["file_id"])
    assert report_file["has_output"] is False
    assert report_file["entity_count"] == 0
    assert report_file["error"] == "file_metadata_unavailable"
    assert report_file["ready_for_delivery"] is False


def test_completed_item_missing_output_is_reported_without_500(
    test_client: TestClient,
    tmp_data_dir: str,
):
    from app.services.file_management_service import get_file_store
    from app.services.job_store import JobItemStatus, JobStatus, get_job_store

    store = get_job_store()
    job = _create_job(test_client, "text_batch", "Missing output")
    job_id = job["id"]
    uploaded = _upload_to_job(
        test_client,
        job_id,
        filename="contract.txt",
        content=b"Alice signs.",
        content_type="text/plain",
    )
    item = _item_for_file(test_client, job_id, uploaded["file_id"])
    store.update_job_status(job_id, JobStatus.PROCESSING)
    store.update_item_status(item["id"], JobItemStatus.PROCESSING)
    store.update_item_status(item["id"], JobItemStatus.COMPLETED)
    store.update_job_status(job_id, JobStatus.COMPLETED)
    missing_output = Path(tmp_data_dir) / "outputs" / "missing-redacted.txt"
    get_file_store().update_fields(
        uploaded["file_id"],
        {
            "output_path": str(missing_output),
            "redacted_count": 1,
        },
    )

    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200, detail.text
    detail_item = next(row for row in detail.json()["items"] if row["file_id"] == uploaded["file_id"])
    assert detail_item["has_output"] is False

    report = test_client.get(f"/api/v1/jobs/{job_id}/export-report")
    assert report.status_code == 200, report.text
    body = report.json()
    assert body["summary"]["redacted_selected_files"] == 0
    assert body["summary"]["ready_for_delivery"] is False
    report_file = next(row for row in body["files"] if row["file_id"] == uploaded["file_id"])
    assert report_file["redacted_export_skip_reason"] == "missing_redacted_output"
    assert report_file["ready_for_delivery"] is False
