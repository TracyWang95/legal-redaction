# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from app.services.vision_config import resolve_optional_type_list


def test_resolve_optional_type_list_preserves_explicit_empty_list():
    assert resolve_optional_type_list({"ocr_has_types": []}, "ocr_has_types") == []


def test_resolve_optional_type_list_returns_none_when_selection_is_missing():
    assert resolve_optional_type_list({}, "ocr_has_types") is None


def test_resolve_optional_type_list_uses_legacy_alias_when_primary_missing():
    assert resolve_optional_type_list(
        {"selected_has_image_types": ["official_seal"]},
        "has_image_types",
        "selected_has_image_types",
    ) == ["official_seal"]


def test_resolve_optional_type_list_treats_scalar_string_as_one_type():
    assert resolve_optional_type_list({"ocr_has_types": "ORG"}, "ocr_has_types") == ["ORG"]


def test_default_job_runner_ports_preserve_missing_vision_type_defaults(monkeypatch):
    import asyncio

    from app.services import file_operations
    from app.services.job_runner import DefaultJobRunnerPorts

    calls = []

    def fake_get_file_info(file_id: str):
        return {"page_count": 1}

    async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
        calls.append((file_id, page, ocr_has_types, has_image_types))

    monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
    monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)

    asyncio.run(DefaultJobRunnerPorts().vision_pages("file", {}))

    assert calls == [("file", 1, None, None)]


def test_default_job_runner_ports_preserve_explicit_empty_vision_type_lists(monkeypatch):
    import asyncio

    from app.services import file_operations
    from app.services.job_runner import DefaultJobRunnerPorts

    calls = []

    def fake_get_file_info(file_id: str):
        return {"page_count": 1}

    async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
        calls.append((ocr_has_types, has_image_types))

    monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
    monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)

    asyncio.run(
        DefaultJobRunnerPorts().vision_pages(
            "file",
            {"ocr_has_types": [], "has_image_types": []},
        )
    )

    assert calls == [([], [])]


def test_default_job_runner_ports_caps_page_concurrency_when_gpu_memory_is_high(monkeypatch):
    import asyncio

    from app.core.config import settings
    from app.services import file_operations
    from app.services.job_runner import DefaultJobRunnerPorts

    active = 0
    max_active = 0

    def fake_get_file_info(file_id: str):
        return {"file_type": "pdf_scanned", "page_count": 3}

    async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1

    monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
    monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)
    monkeypatch.setattr(
        "app.core.gpu_memory.query_gpu_memory",
        lambda: {"used_mb": 9216, "total_mb": 10240},
    )
    monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_TIMEOUT", 5.0)
    monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_CONCURRENCY", 4)

    asyncio.run(DefaultJobRunnerPorts().vision_pages("file", {}))

    assert max_active == 1
