from __future__ import annotations

from app.main import cleanup_orphan_files, settings
from app.services.file_store_db import FileStoreDB
from app.services.job_store import JobStore, JobType


def _isolated_cleanup_state(monkeypatch, tmp_path):
    upload_dir = tmp_path / "uploads"
    output_dir = tmp_path / "outputs"
    data_dir = tmp_path / "data"
    upload_dir.mkdir()
    output_dir.mkdir()
    data_dir.mkdir()

    monkeypatch.setattr(settings, "UPLOAD_DIR", str(upload_dir))
    monkeypatch.setattr(settings, "OUTPUT_DIR", str(output_dir))
    monkeypatch.setattr(settings, "DATA_DIR", str(data_dir))
    monkeypatch.setattr(settings, "ORPHAN_CLEANUP_AGE_SEC", 0)

    import app.services.file_management_service as fms
    import app.services.job_store as job_store_module

    file_store = FileStoreDB(str(data_dir / "file_store.sqlite3"))
    job_store = JobStore(str(data_dir / "jobs.sqlite3"))
    monkeypatch.setattr(fms, "file_store", file_store)
    monkeypatch.setattr(job_store_module, "get_job_store", lambda: job_store)
    return upload_dir, output_dir, file_store, job_store


def test_orphan_cleanup_keeps_files_referenced_by_job_items(monkeypatch, tmp_path):
    upload_dir, _output_dir, _file_store, job_store = _isolated_cleanup_state(monkeypatch, tmp_path)

    referenced_file_id = "11111111-1111-1111-1111-111111111111"
    referenced_path = upload_dir / f"{referenced_file_id}.txt"
    orphan_path = upload_dir / "22222222-2222-2222-2222-222222222222.txt"
    referenced_path.write_text("needed by continue-review flow", encoding="utf-8")
    orphan_path.write_text("old orphan", encoding="utf-8")

    job_id = job_store.create_job(job_type=JobType.TEXT_BATCH, title="resume review")
    job_store.add_item(job_id, referenced_file_id)

    removed = cleanup_orphan_files()

    assert removed == 1
    assert referenced_path.exists()
    assert not orphan_path.exists()


def test_orphan_cleanup_skips_when_storage_has_no_persisted_references(monkeypatch, tmp_path):
    upload_dir, _output_dir, _file_store, _job_store = _isolated_cleanup_state(monkeypatch, tmp_path)

    paths = []
    for idx in range(6):
        path = upload_dir / f"orphan-{idx}.txt"
        path.write_text("orphan", encoding="utf-8")
        paths.append(path)

    removed = cleanup_orphan_files()

    assert removed == 0
    assert all(path.exists() for path in paths)


def test_startup_output_repair_drops_missing_and_unsafe_output_paths(monkeypatch, tmp_path):
    _upload_dir, output_dir, file_store, _job_store = _isolated_cleanup_state(monkeypatch, tmp_path)

    missing_file_id = "missing-output"
    unsafe_file_id = "unsafe-output"
    unsafe_path = tmp_path / "outside-redacted.txt"
    unsafe_path.write_text("outside", encoding="utf-8")
    file_store.set(
        missing_file_id,
        {
            "id": missing_file_id,
            "original_filename": "missing.txt",
            "output_path": str(output_dir / "does-not-exist.txt"),
            "redacted_count": 1,
        },
    )
    file_store.set(
        unsafe_file_id,
        {
            "id": unsafe_file_id,
            "original_filename": "unsafe.txt",
            "output_path": str(unsafe_path),
            "entity_map": {"a": "b"},
        },
    )

    from app.services.file_management_service import repair_file_store_output_records

    repaired = repair_file_store_output_records()

    assert repaired == 2
    assert "output_path" not in file_store.get(missing_file_id)
    assert "redacted_count" not in file_store.get(missing_file_id)
    assert "output_path" not in file_store.get(unsafe_file_id)
    assert "entity_map" not in file_store.get(unsafe_file_id)
    assert unsafe_path.exists()
