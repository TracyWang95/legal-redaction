from __future__ import annotations

import io

from fastapi.testclient import TestClient


def _create_text_job(client: TestClient) -> str:
    response = client.post("/api/v1/jobs", json={"job_type": "text_batch", "title": "items"})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _upload_text_to_job(client: TestClient, job_id: str) -> tuple[str, str]:
    response = client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("item.txt", io.BytesIO(b"item"), "text/plain")},
    )
    assert response.status_code == 200, response.text
    file_id = response.json()["file_id"]

    detail = client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200, detail.text
    item = next(row for row in detail.json()["items"] if row["file_id"] == file_id)
    return file_id, item["id"]


def test_delete_job_item_allows_draft_and_removes_file(test_client: TestClient):
    from app.services.file_management_service import get_file_store

    job_id = _create_text_job(test_client)
    file_id, item_id = _upload_text_to_job(test_client, job_id)

    response = test_client.delete(f"/api/v1/jobs/{job_id}/items/{item_id}")

    assert response.status_code == 200, response.text
    assert response.json() == {"deleted": True, "item_id": item_id, "file_id": file_id}
    assert file_id not in get_file_store()
    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200
    assert detail.json()["items"] == []


def test_delete_job_item_rejects_non_draft_without_removing_file(test_client: TestClient):
    from app.services.file_management_service import get_file_store

    job_id = _create_text_job(test_client)
    file_id, item_id = _upload_text_to_job(test_client, job_id)

    submit = test_client.post(f"/api/v1/jobs/{job_id}/submit")
    assert submit.status_code == 200, submit.text

    response = test_client.delete(f"/api/v1/jobs/{job_id}/items/{item_id}")

    assert response.status_code == 409
    body = response.json()
    assert "only draft jobs allow item deletion" in (body.get("message") or response.text)
    assert file_id in get_file_store()
    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200
    assert [item["id"] for item in detail.json()["items"]] == [item_id]


def test_delete_job_item_wrong_job_id_does_not_delete_foreign_item(test_client: TestClient):
    from app.services.file_management_service import get_file_store

    owner_job_id = _create_text_job(test_client)
    other_job_id = _create_text_job(test_client)
    file_id, item_id = _upload_text_to_job(test_client, owner_job_id)

    response = test_client.delete(f"/api/v1/jobs/{other_job_id}/items/{item_id}")

    assert response.status_code == 404
    assert file_id in get_file_store()
    owner_detail = test_client.get(f"/api/v1/jobs/{owner_job_id}")
    assert owner_detail.status_code == 200
    assert [item["id"] for item in owner_detail.json()["items"]] == [item_id]


def test_job_detail_exposes_item_performance_breakdown(test_client: TestClient):
    from app.services.job_store import get_job_store

    job_id = _create_text_job(test_client)
    _file_id, item_id = _upload_text_to_job(test_client, job_id)
    store = get_job_store()
    store.update_item_performance(
        item_id,
        {
            "recognition": {
                "queue_wait_ms": 17,
                "duration_ms": 88000,
                "vision_ms": 44000,
                "page_concurrency": 2,
                "page_concurrency_configured": 2,
                "pages": {
                    "1": {
                        "page": 1,
                        "duration_ms": 41000,
                        "cache_status": {"vision_result": "miss"},
                    },
                    "2": {
                        "page": 2,
                        "duration_ms": 47000,
                        "cache_status": {"vision_result": "miss"},
                    }
                },
            },
            "redaction": {"duration_ms": 1200},
            "repair": {"stale_processing": {"status": "none"}},
        },
    )

    response = test_client.get(f"/api/v1/jobs/{job_id}")
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["queue_wait_ms"] == 17
    assert item["recognition_duration_ms"] == 88000
    assert item["redaction_duration_ms"] == 1200
    assert item["recognition_pages"][0]["cache_status"]["vision_result"] == "miss"
    assert item["recognition_page_concurrency"] == 2
    assert item["recognition_page_concurrency_configured"] == 2
    assert item["recognition_page_duration_sum_ms"] == 88000
    assert item["recognition_parallelism_ratio"] == 2.0
    assert item["performance"]["repair"]["stale_processing"]["status"] == "none"

    batch = test_client.post("/api/v1/jobs/batch-details", json={"ids": [job_id]})
    assert batch.status_code == 200, batch.text
    assert batch.json()["jobs"][0]["items"][0]["recognition_duration_ms"] == 88000
