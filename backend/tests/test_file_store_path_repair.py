from __future__ import annotations

import os


class DictStore(dict):
    def set(self, key, value):
        self[key] = value


def test_normalize_store_path_recovers_windows_upload_paths(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services import file_management_service as fms

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    stored = upload_dir / "file-1.png"
    stored.write_bytes(b"png")
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(upload_dir))

    assert fms._normalize_store_path(  # noqa: SLF001 - regression coverage for startup repair
        r"D:\ExampleProject\DataInfra-RedactionEverything\backend\uploads\file-1.png",
        settings.UPLOAD_DIR,
    ) == os.path.realpath(stored)


def test_normalize_store_path_recovers_mixed_wsl_windows_paths(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services import file_management_service as fms

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    stored = upload_dir / "file-2.pdf"
    stored.write_bytes(b"%PDF")
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(upload_dir))

    assert fms._normalize_store_path(  # noqa: SLF001 - regression coverage for startup repair
        r"/mnt/d/ExampleProject/DataInfra-RedactionEverything/backend/uploads/D:\ExampleProject\DataInfra-RedactionEverything\backend\uploads\file-2.pdf",
        settings.UPLOAD_DIR,
    ) == os.path.realpath(stored)


def test_repair_output_records_preserves_missing_but_safe_outputs(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services import file_management_service as fms

    output_dir = tmp_path / "outputs"
    output_dir.mkdir()
    missing_output = output_dir / "missing.pdf"
    store = DictStore({"file-1": {"output_path": str(missing_output), "redacted_count": 3}})
    monkeypatch.setattr(settings, "OUTPUT_DIR", str(output_dir))
    monkeypatch.setattr(fms, "file_store", store)

    assert fms.repair_file_store_output_records() == 0
    assert store["file-1"]["output_path"] == str(missing_output)
    assert store["file-1"]["redacted_count"] == 3


def test_restore_file_store_output_from_history(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services import file_management_service as fms

    output_dir = tmp_path / "outputs"
    output_dir.mkdir()
    historical_output = output_dir / "redacted.pdf"
    store = DictStore(
        {
            "file-1": {
                "entities": [{"text": "张三"}, {"text": "李四"}],
                "redaction_history": [
                    {
                        "output_path": str(historical_output),
                        "output_file_id": "out-1",
                    }
                ],
            }
        }
    )
    monkeypatch.setattr(settings, "OUTPUT_DIR", str(output_dir))
    monkeypatch.setattr(fms, "file_store", store)

    assert fms.restore_file_store_output_from_history() == 1
    assert store["file-1"]["output_path"] == os.path.realpath(historical_output)
    assert store["file-1"]["output_file_id"] == "out-1"
    assert store["file-1"]["redacted_count"] == 2


def test_entity_count_uses_active_recognition_items_not_redaction_occurrences():
    from app.services.file_management_service import entity_count, recognition_count_from_stored_fields

    info = {
        "output_path": "/tmp/redacted.pdf",
        "redacted_count": 9,
        "entities": [
            {"text": "Alice", "selected": True},
            {"text": "Bob", "selected": False},
            {"text": "Acme"},
        ],
        "bounding_boxes": {
            "1": [
                {"id": "box-1", "selected": True},
                {"id": "box-2", "selected": False},
            ]
        },
        "entity_map": {"legacy": "value"},
    }

    assert recognition_count_from_stored_fields(info) == 3
    assert entity_count(info) == 3


def test_entity_count_allows_review_to_deselect_everything():
    from app.services.file_management_service import entity_count

    info = {
        "output_path": "/tmp/redacted.pdf",
        "redacted_count": 4,
        "entities": [{"text": "Alice", "selected": False}],
        "bounding_boxes": {"1": [{"id": "box-1", "selected": False}]},
        "entity_map": {"legacy": "value"},
    }

    assert entity_count(info) == 0
