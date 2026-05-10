"""JobStore unit tests — pure SQLite, no HTTP."""
from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest

from app.services.job_store import (
    InvalidStatusTransition,
    JobItemStatus,
    JobStatus,
    JobStore,
    JobType,
)


@pytest.fixture()
def store(tmp_path) -> JobStore:
    db_path = os.path.join(str(tmp_path), "test_jobs.db")
    return JobStore(db_path)


# ── Create job ───────────────────────────────────────────────

def test_create_job_returns_uuid(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH, title="batch-1")
    assert isinstance(jid, str) and len(jid) == 36  # UUID format


def test_created_job_has_draft_status(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH)
    job = store.get_job(jid)
    assert job is not None
    assert job["status"] == JobStatus.DRAFT.value
    assert job["job_type"] == JobType.TEXT_BATCH.value


def test_create_job_with_config(store: JobStore):
    cfg = {"mode": "fast"}
    jid = store.create_job(job_type=JobType.IMAGE_BATCH, config=cfg)
    job = store.get_job(jid)
    import json
    assert json.loads(job["config_json"]) == cfg


def test_update_job_draft_rejects_non_draft_job(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH, config={"mode": "fast"})
    assert store.update_job_draft(jid, {"config": {"mode": "accurate"}}) is True
    store.update_job_status(jid, JobStatus.QUEUED)

    assert store.update_job_draft(jid, {"config": {"mode": "late"}}) is False
    import json
    assert json.loads(store.get_job(jid)["config_json"]) == {"mode": "accurate"}


# ── Get job by ID ────────────────────────────────────────────

def test_get_job_exists(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH, title="find-me")
    job = store.get_job(jid)
    assert job is not None
    assert job["title"] == "find-me"


def test_get_job_not_found_returns_none(store: JobStore):
    assert store.get_job("nonexistent-uuid") is None


# ── Update job status ────────────────────────────────────────

def test_update_job_status_valid_transition(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH)
    store.update_job_status(jid, JobStatus.QUEUED)
    assert store.get_job(jid)["status"] == JobStatus.QUEUED.value


def test_update_job_status_idempotent(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH)
    store.update_job_status(jid, JobStatus.QUEUED)
    # Same status again should silently succeed
    store.update_job_status(jid, JobStatus.QUEUED)
    assert store.get_job(jid)["status"] == JobStatus.QUEUED.value


def test_update_job_status_invalid_transition_raises(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH)
    # DRAFT -> COMPLETED is not allowed
    with pytest.raises(InvalidStatusTransition) as exc_info:
        store.update_job_status(jid, JobStatus.COMPLETED)
    assert exc_info.value.current == "draft"
    assert exc_info.value.target == "completed"


def test_update_job_status_not_found_raises(store: JobStore):
    with pytest.raises(KeyError):
        store.update_job_status("ghost-id", JobStatus.QUEUED)


# ── List jobs with pagination ────────────────────────────────

def test_list_jobs_empty(store: JobStore):
    rows, total = store.list_jobs()
    assert rows == []
    assert total == 0


def test_list_jobs_pagination(store: JobStore):
    for i in range(5):
        store.create_job(job_type=JobType.TEXT_BATCH, title=f"j{i}")
    rows, total = store.list_jobs(page=1, page_size=2)
    assert total == 5
    assert len(rows) == 2

    rows2, _ = store.list_jobs(page=3, page_size=2)
    assert len(rows2) == 1  # 5th item on page 3


def test_list_jobs_filter_by_type(store: JobStore):
    store.create_job(job_type=JobType.TEXT_BATCH)
    store.create_job(job_type=JobType.IMAGE_BATCH)
    rows, total = store.list_jobs(job_type=JobType.IMAGE_BATCH)
    assert total == 1
    assert rows[0]["job_type"] == "image_batch"


# ── Job items: create and update ─────────────────────────────

def test_add_item_and_list(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH)
    iid = store.add_item(jid, file_id="file-abc")
    items = store.list_items(jid)
    assert len(items) == 1
    assert items[0]["file_id"] == "file-abc"
    assert items[0]["status"] == JobItemStatus.PENDING.value
    assert items[0]["id"] == iid


def test_update_item_status_valid(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH)
    iid = store.add_item(jid, file_id="f1")
    store.update_item_status(iid, JobItemStatus.PROCESSING)
    item = store.get_item(iid)
    assert item["status"] == JobItemStatus.PROCESSING.value


def test_update_item_status_invalid_raises(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH)
    iid = store.add_item(jid, file_id="f1")
    # PENDING -> COMPLETED not allowed (must go through PROCESSING first)
    with pytest.raises(InvalidStatusTransition):
        store.update_item_status(iid, JobItemStatus.COMPLETED)


def test_update_item_status_with_error_message(store: JobStore):
    jid = store.create_job(job_type=JobType.TEXT_BATCH)
    iid = store.add_item(jid, file_id="f1")
    store.update_item_status(iid, JobItemStatus.PROCESSING)
    store.update_item_status(iid, JobItemStatus.FAILED, error_message="timeout")
    item = store.get_item(iid)
    assert item["status"] == "failed"
    assert item["error_message"] == "timeout"


def test_update_item_progress_persists_long_running_state(store: JobStore):
    jid = store.create_job(job_type=JobType.IMAGE_BATCH)
    iid = store.add_item(jid, file_id="f1")

    store.update_item_progress(
        iid,
        stage="vision",
        current=3,
        total=6,
        message="Recognizing page 3/6",
    )

    item = store.get_item(iid)
    assert item["progress_stage"] == "vision"
    assert item["progress_current"] == 3
    assert item["progress_total"] == 6
    assert item["progress_message"] == "Recognizing page 3/6"
    assert item["progress_updated_at"]


def test_update_item_performance_merges_timing_breakdown(store: JobStore):
    jid = store.create_job(job_type=JobType.IMAGE_BATCH)
    iid = store.add_item(jid, file_id="f1")

    store.update_item_performance(
        iid,
        {
            "recognition": {
                "duration_ms": 1234,
                "pages": {"2": {"page": 2, "duration_ms": 600}},
            }
        },
    )
    store.update_item_performance(
        iid,
        {
            "recognition": {
                "queue_wait_ms": 45,
                "pages": {"1": {"page": 1, "duration_ms": 500}},
            },
            "redaction": {"duration_ms": 321},
        },
    )

    performance = store.get_item_performance(iid)
    assert performance["recognition"]["duration_ms"] == 1234
    assert performance["recognition"]["queue_wait_ms"] == 45
    assert performance["recognition"]["pages"]["1"]["duration_ms"] == 500
    assert performance["recognition"]["pages"]["2"]["duration_ms"] == 600
    assert performance["redaction"]["duration_ms"] == 321
    assert store.get_item_performance_map(jid)[iid] == performance


def test_repair_stale_processing_items_requeues_abandoned_item(store: JobStore, monkeypatch):
    cleared: list[set[str]] = []
    monkeypatch.setattr(store, "_clear_outputs_for_file_ids", lambda file_ids: cleared.append(set(file_ids)))

    jid = store.create_job(job_type=JobType.IMAGE_BATCH)
    iid = store.add_item(jid, file_id="file-stale")
    store.update_job_status(jid, JobStatus.PROCESSING)
    store.update_item_status(iid, JobItemStatus.PROCESSING)
    cleared.clear()

    stale_at = (datetime.now(UTC) - timedelta(minutes=20)).isoformat()
    with store._connect() as conn:
        conn.execute(
            """
            UPDATE job_items
            SET progress_stage = 'vision',
                progress_current = 1,
                progress_total = 6,
                progress_updated_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (stale_at, stale_at, iid),
        )
        conn.commit()

    redispatch = store.repair_stale_processing_items(max_age_seconds=60)

    assert redispatch == [
        {"item_id": iid, "job_id": jid, "file_id": "file-stale", "task": "recognition"}
    ]
    item = store.get_item(iid)
    assert item["status"] == JobItemStatus.PENDING.value
    assert item["error_message"] == "auto-reset: stale processing"
    performance = store.get_item_performance(iid)
    assert performance["repair"]["stale_processing"]["status"] == "requeued"
    assert performance["repair"]["stale_processing"]["previous_stage"] == "vision"
    assert store.get_job(jid)["status"] == JobStatus.QUEUED.value
    assert cleared == [{"file-stale"}]


def test_repair_stale_processing_items_skips_active_item(store: JobStore, monkeypatch):
    monkeypatch.setattr(store, "_clear_outputs_for_file_ids", lambda file_ids: None)

    jid = store.create_job(job_type=JobType.IMAGE_BATCH)
    iid = store.add_item(jid, file_id="file-active")
    store.update_job_status(jid, JobStatus.PROCESSING)
    store.update_item_status(iid, JobItemStatus.PROCESSING)

    stale_at = (datetime.now(UTC) - timedelta(minutes=20)).isoformat()
    with store._connect() as conn:
        conn.execute(
            "UPDATE job_items SET progress_updated_at = ?, updated_at = ? WHERE id = ?",
            (stale_at, stale_at, iid),
        )
        conn.commit()

    redispatch = store.repair_stale_processing_items(
        exclude_item_ids={iid},
        max_age_seconds=60,
    )

    assert redispatch == []
    assert store.get_item(iid)["status"] == JobItemStatus.PROCESSING.value
    assert store.get_job(jid)["status"] == JobStatus.PROCESSING.value
