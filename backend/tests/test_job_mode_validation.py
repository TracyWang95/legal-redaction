from __future__ import annotations

import io

from fastapi.testclient import TestClient


PNG_BYTES = b"\x89PNG\r\n\x1a\nmode-test"


def _create_job(client: TestClient, job_type: str) -> str:
    resp = client.post("/api/v1/jobs", json={"job_type": job_type, "title": f"{job_type} test"})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_text_batch_rejects_image_upload_and_rolls_back(test_client: TestClient, tmp_data_dir: str):
    from pathlib import Path

    from app.services.file_management_service import get_file_store

    job_id = _create_job(test_client, "text_batch")

    resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("scan.png", io.BytesIO(PNG_BYTES), "image/png")},
    )

    assert resp.status_code == 400
    assert "not allowed for text_batch" in resp.text
    assert len(get_file_store()) == 0
    assert list((Path(tmp_data_dir) / "uploads").iterdir()) == []


def test_image_batch_rejects_text_upload_and_rolls_back(test_client: TestClient, tmp_data_dir: str):
    from pathlib import Path

    from app.services.file_management_service import get_file_store

    job_id = _create_job(test_client, "image_batch")

    resp = test_client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("notes.txt", io.BytesIO(b"plain text"), "text/plain")},
    )

    assert resp.status_code == 400
    assert "not allowed for image_batch" in resp.text
    assert len(get_file_store()) == 0
    assert list((Path(tmp_data_dir) / "uploads").iterdir()) == []


def test_submit_revalidates_existing_items_before_queueing(test_client: TestClient):
    from app.models.schemas import FileType
    from app.services.file_management_service import get_file_store
    from app.services.job_store import get_job_store

    job_id = _create_job(test_client, "image_batch")
    file_id = "legacy-text-file"
    get_file_store().set(
        file_id,
        {
            "id": file_id,
            "original_filename": "legacy.txt",
            "file_type": FileType.TXT,
            "file_size": 11,
        },
    )
    get_job_store().add_item(job_id, file_id)

    resp = test_client.post(f"/api/v1/jobs/{job_id}/submit")

    assert resp.status_code == 400
    assert "not allowed for image_batch" in resp.text
