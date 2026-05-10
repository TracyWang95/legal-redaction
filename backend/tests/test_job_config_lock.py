from __future__ import annotations

import io

from fastapi.testclient import TestClient


def _create_job(client: TestClient) -> str:
    resp = client.post(
        "/api/v1/jobs",
        json={"job_type": "text_batch", "title": "lock", "config": {"mode": "fast"}},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _upload_to_job(client: TestClient, job_id: str) -> str:
    resp = client.post(
        "/api/v1/files/upload",
        data={"job_id": job_id, "upload_source": "batch"},
        files={"file": ("lock.txt", io.BytesIO(b"lock"), "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["file_id"]


def test_submit_locks_job_config_and_preserves_version(test_client: TestClient):
    job_id = _create_job(test_client)
    _upload_to_job(test_client, job_id)

    submit = test_client.post(f"/api/v1/jobs/{job_id}/submit")
    assert submit.status_code == 200, submit.text
    config = submit.json()["config"]

    assert config["mode"] == "fast"
    assert config["config_version"] == 1
    assert isinstance(config["config_locked_at"], str)

    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.status_code == 200
    assert detail.json()["config"]["config_locked_at"] == config["config_locked_at"]


def test_non_draft_job_config_update_returns_409(test_client: TestClient):
    job_id = _create_job(test_client)
    _upload_to_job(test_client, job_id)
    submit = test_client.post(f"/api/v1/jobs/{job_id}/submit")
    assert submit.status_code == 200
    locked_at = submit.json()["config"]["config_locked_at"]

    update = test_client.put(
        f"/api/v1/jobs/{job_id}",
        json={"config": {"mode": "late"}},
    )

    assert update.status_code == 409
    detail = test_client.get(f"/api/v1/jobs/{job_id}")
    assert detail.json()["config"]["mode"] == "fast"
    assert detail.json()["config"]["config_locked_at"] == locked_at
