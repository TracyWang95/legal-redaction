from __future__ import annotations

from app.services import job_management_service as jms
from app.services.job_store import JobItemStatus, JobStatus


def test_submit_job_enqueues_short_recognition_items_first(monkeypatch):
    class Store:
        def __init__(self) -> None:
            self.submitted = False
            self.row = {
                "id": "job",
                "job_type": "smart_batch",
                "title": "queue",
                "status": JobStatus.DRAFT.value,
                "skip_item_review": 0,
                "priority": 0,
                "config_json": "{}",
                "error_message": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
            self.items = [
                {"id": "large", "job_id": "job", "file_id": "large-pdf", "sort_order": 0, "status": JobItemStatus.PENDING.value},
                {"id": "image", "job_id": "job", "file_id": "short-image", "sort_order": 1, "status": JobItemStatus.PENDING.value},
                {"id": "text", "job_id": "job", "file_id": "short-text", "sort_order": 2, "status": JobItemStatus.PENDING.value},
            ]

        def get_job(self, job_id: str):
            assert job_id == "job"
            return self.row

        def list_items(self, job_id: str):
            assert job_id == "job"
            return list(self.items)

        def submit_job(self, job_id: str) -> None:
            assert job_id == "job"
            self.submitted = True
            self.row["status"] = JobStatus.QUEUED.value

    metadata = {
        "large-pdf": {"file_type": "pdf_scanned", "page_count": 6},
        "short-image": {"file_type": "image", "page_count": 1},
        "short-text": {"file_type": "txt", "file_size": 512},
    }
    captured: list[tuple[str, dict]] = []

    monkeypatch.setattr(jms, "validate_file_allowed_for_job_type", lambda **_kwargs: None)
    monkeypatch.setattr(jms, "lock_job_config", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(jms, "job_to_summary", lambda row, _store: {"id": row["id"], "status": row["status"]})
    monkeypatch.setattr(jms, "_safe_file_info", lambda file_id: (metadata[file_id], None))
    monkeypatch.setattr(
        jms,
        "enqueue_task",
        lambda _task_type, _job_id, item_id, _file_id, meta=None: captured.append((item_id, dict(meta or {}))),
    )

    result = jms.submit_job(Store(), "job")

    assert result == {"id": "job", "status": JobStatus.QUEUED.value}
    assert [item_id for item_id, _meta in captured] == ["text", "image", "large"]
    assert captured[0][1]["priority_class"] == 0
    assert captured[-1][1]["estimated_work_units"] == 6
