# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio
from types import SimpleNamespace

from app.core.config import settings
from app.services.job_store import JobItemStatus
from app.services import file_operations
from app.services.task_queue import (
    SimpleTaskQueue,
    TaskItem,
    _effective_vision_page_concurrency,
)


def test_batch_vision_pages_run_with_bounded_concurrency(monkeypatch):
    async def _run():
        active = 0
        max_active = 0
        seen_pages: list[int] = []

        def fake_get_file_info(file_id: str):
            return {"page_count": 5}

        async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            seen_pages.append(page)
            await asyncio.sleep(0.01)
            active -= 1

        monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
        monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)
        monkeypatch.setattr("app.core.gpu_memory.query_gpu_memory", lambda: None)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_TIMEOUT", 5.0)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_CONCURRENCY", 2)

        queue = SimpleTaskQueue()
        await queue._run_vision(
            TaskItem(job_id="job", item_id="item", file_id="file"),
            {"ocr_has_types": ["ORG"], "has_image_types": ["official_seal"]},
        )

        assert sorted(seen_pages) == [1, 2, 3, 4, 5]
        assert max_active == 2

    asyncio.run(_run())


def test_batch_vision_records_concurrency_and_per_page_timings(monkeypatch):
    async def _run():
        class Store:
            def __init__(self):
                self.progress_updates = []
                self.performance_patches = []

            def update_item_progress(self, item_id, **kwargs):
                self.progress_updates.append((item_id, kwargs))

            def update_item_performance(self, item_id, patch):
                self.performance_patches.append((item_id, patch))

        def fake_get_file_info(file_id: str):
            return {
                "page_count": 2,
                "vision_quality": {
                    1: {
                        "duration_ms": {"ocr": 3},
                        "cache_status": {"ocr_text_blocks": "hit"},
                        "pipeline_status": {"ocr": {"completed": True}},
                    }
                },
            }

        async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
            await asyncio.sleep(0.01)
            if page == 1:
                return SimpleNamespace(
                    duration_ms={"ocr": 3},
                    cache_status={"ocr_text_blocks": "hit"},
                    pipeline_status={"ocr": {"completed": True}},
                    warnings=[],
                )
            return SimpleNamespace(
                duration_ms={},
                cache_status={"vision_result": "hit"},
                pipeline_status={},
                warnings=["cached"],
            )

        store = Store()
        queue = SimpleTaskQueue()
        monkeypatch.setattr(queue, "_get_store", lambda: store)
        monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
        monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)
        monkeypatch.setattr(
            "app.core.gpu_memory.query_gpu_memory",
            lambda: {"used_mb": 4096, "total_mb": 10240},
        )
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_TIMEOUT", 5.0)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_CONCURRENCY", 2)

        await queue._run_vision(
            TaskItem(job_id="job", item_id="item", file_id="file"),
            {"ocr_has_types": ["ORG"], "has_image_types": ["official_seal"]},
        )

        recognition_patches = [
            patch["recognition"]
            for _item_id, patch in store.performance_patches
            if "recognition" in patch
        ]
        setup_patch = next(p for p in recognition_patches if "page_concurrency_reason" in p)
        assert setup_patch["page_concurrency"] == 2
        assert setup_patch["page_concurrency_configured"] == 2
        assert setup_patch["page_concurrency_reason"] == "configured"
        assert setup_patch["gpu_memory"] == {
            "available": True,
            "used_mb": 4096,
            "total_mb": 10240,
            "used_ratio": 0.4,
        }

        page_meta = {}
        for patch in recognition_patches:
            for page, meta in (patch.get("pages") or {}).items():
                page_meta.setdefault(page, {}).update(meta)

        assert set(page_meta) == {"1", "2"}
        assert page_meta["1"]["started_at"]
        assert page_meta["1"]["finished_at"]
        assert page_meta["1"]["status"] == "completed"
        assert page_meta["1"]["page_concurrency"] == 2
        assert page_meta["1"]["duration_breakdown_ms"] == {"ocr": 3}
        assert page_meta["1"]["cache_status"] == {"ocr_text_blocks": "hit"}
        assert page_meta["2"]["started_at"]
        assert page_meta["2"]["finished_at"]
        assert page_meta["2"]["cache_status"] == {"vision_result": "hit"}
        assert page_meta["2"]["warnings"] == ["cached"]
        assert max(p["max_active_pages"] for p in recognition_patches if "max_active_pages" in p) == 2

    asyncio.run(_run())


def test_batch_vision_uses_returned_page_metadata_without_extra_file_info_reads(monkeypatch):
    async def _run():
        class Store:
            def update_item_progress(self, item_id, **kwargs):
                pass

            def update_item_performance(self, item_id, patch):
                pass

        get_file_info_calls = 0

        def fake_get_file_info(file_id: str):
            nonlocal get_file_info_calls
            get_file_info_calls += 1
            return {"page_count": 2}

        async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
            return SimpleNamespace(
                duration_ms={"request_total_ms": 5},
                cache_status={"vision_result": "hit"},
                pipeline_status={"ocr_has": {"completed": True}},
                warnings=[],
            )

        queue = SimpleTaskQueue()
        monkeypatch.setattr(queue, "_get_store", lambda: Store())
        monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
        monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)
        monkeypatch.setattr("app.core.gpu_memory.query_gpu_memory", lambda: None)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_TIMEOUT", 5.0)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_CONCURRENCY", 2)

        await queue._run_vision(
            TaskItem(job_id="job", item_id="item", file_id="file"),
            {"ocr_has_types": ["ORG"], "has_image_types": ["official_seal"]},
        )

        assert get_file_info_calls == 1

    asyncio.run(_run())


def test_batch_vision_duration_breakdown_includes_pipeline_stage_status(monkeypatch):
    async def _run():
        class Store:
            def __init__(self):
                self.performance_patches = []

            def update_item_progress(self, item_id, **kwargs):
                pass

            def update_item_performance(self, item_id, patch):
                self.performance_patches.append((item_id, patch))

        def fake_get_file_info(file_id: str):
            return {"page_count": 1}

        async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
            return SimpleNamespace(
                duration_ms={"ocr_has": 100, "total": 120},
                cache_status={},
                pipeline_status={
                    "ocr_has": {
                        "completed": True,
                        "stage_duration_ms": {
                            "ocr": 50,
                            "has_ner": 40,
                            "has_text_slot_wait_ms": 7950,
                            "has_text_model_ms": 37791,
                            "has_text_cache_status": "model_call",
                        },
                    }
                },
                warnings=[],
            )

        store = Store()
        queue = SimpleTaskQueue()
        monkeypatch.setattr(queue, "_get_store", lambda: store)
        monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
        monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)
        monkeypatch.setattr("app.core.gpu_memory.query_gpu_memory", lambda: None)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_TIMEOUT", 5.0)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_CONCURRENCY", 2)

        await queue._run_vision(
            TaskItem(job_id="job", item_id="item", file_id="file"),
            {"ocr_has_types": ["ORG"], "has_image_types": []},
        )

        page_patch = {}
        for _item_id, patch in store.performance_patches:
            recognition = patch.get("recognition") or {}
            page_patch.update((recognition.get("pages") or {}).get("1") or {})

        assert page_patch["duration_breakdown_ms"]["ocr_has"] == 100
        assert page_patch["duration_breakdown_ms"]["total"] == 120
        assert page_patch["duration_breakdown_ms"]["ocr_has.has_text_slot_wait_ms"] == 7950
        assert page_patch["duration_breakdown_ms"]["ocr_has.has_text_model_ms"] == 37791
        assert page_patch["duration_breakdown_ms"]["ocr_has.has_text_cache_status"] == "model_call"

    asyncio.run(_run())


def test_batch_vision_primes_scanned_pdf_sparse_text_layer_before_pages(monkeypatch):
    async def _run():
        class Store:
            def __init__(self):
                self.performance_patches = []

            def update_item_progress(self, item_id, **kwargs):
                pass

            def update_item_performance(self, item_id, patch):
                self.performance_patches.append((item_id, patch))

        calls: list[str] = []

        def fake_get_file_info(file_id: str):
            return {
                "file_type": "pdf_scanned",
                "file_path": "D:/tmp/scan.pdf",
                "page_count": 2,
            }

        async def fake_prime(file_path, file_type, *, page=1):
            calls.append(f"prime:{file_path}:{file_type}:{page}")
            return {"ran": True, "sparse": True, "skip_after_probe": True}

        async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
            calls.append(f"page:{page}")
            return SimpleNamespace(duration_ms={}, cache_status={}, pipeline_status={}, warnings=[])

        store = Store()
        queue = SimpleTaskQueue()
        monkeypatch.setattr(queue, "_get_store", lambda: store)
        monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
        monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)
        monkeypatch.setattr("app.services.vision_service.prime_pdf_text_layer_sparse_probe", fake_prime)
        monkeypatch.setattr("app.core.gpu_memory.query_gpu_memory", lambda: None)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_TIMEOUT", 5.0)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_CONCURRENCY", 2)

        await queue._run_vision(
            TaskItem(job_id="job", item_id="item", file_id="file"),
            {"ocr_has_types": ["ORG"], "has_image_types": []},
        )

        assert calls[0] == "prime:D:/tmp/scan.pdf:pdf_scanned:1"
        assert sorted(calls[1:]) == ["page:1", "page:2"]
        setup_patch = next(
            patch["recognition"]
            for _item_id, patch in store.performance_patches
            if "recognition" in patch and "pdf_text_layer_sparse_probe" in patch["recognition"]
        )
        assert setup_patch["pdf_text_layer_sparse_probe"]["skip_after_probe"] is True

    asyncio.run(_run())


def test_scanned_pdf_default_page_concurrency_respects_configured_value():
    assert _effective_vision_page_concurrency(
        {"file_type": "pdf_scanned"},
        pages=6,
        configured=2,
    ) == 2


def test_high_gpu_memory_caps_page_concurrency_to_one():
    assert _effective_vision_page_concurrency(
        {"file_type": "pdf_scanned"},
        pages=6,
        configured=4,
        gpu_memory={"used_mb": 9216, "total_mb": 10240},
    ) == 1


def test_normal_gpu_memory_does_not_downgrade_configured_concurrency():
    assert _effective_vision_page_concurrency(
        {"file_type": "pdf_scanned"},
        pages=6,
        configured=4,
        gpu_memory={"used_mb": 4096, "total_mb": 10240},
    ) == 4


def test_vision_page_concurrency_respects_user_override():
    assert _effective_vision_page_concurrency(
        {"file_type": "pdf_scanned"},
        pages=6,
        configured=1,
    ) == 1
    assert _effective_vision_page_concurrency(
        {"file_type": "pdf_scanned"},
        pages=6,
        configured=4,
    ) == 4
    assert _effective_vision_page_concurrency(
        {"file_type": "image"},
        pages=6,
        configured=2,
    ) == 2


def test_batch_vision_empty_type_lists_are_preserved(monkeypatch):
    async def _run():
        calls = []

        def fake_get_file_info(file_id: str):
            return {"page_count": 1}

        async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
            calls.append((ocr_has_types, has_image_types))

        monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
        monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)
        monkeypatch.setattr("app.core.gpu_memory.query_gpu_memory", lambda: None)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_TIMEOUT", 5.0)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_CONCURRENCY", 2)

        queue = SimpleTaskQueue()
        await queue._run_vision(
            TaskItem(job_id="job", item_id="item", file_id="file"),
            {"ocr_has_types": [], "has_image_types": []},
        )

        assert calls == [([], [])]

    asyncio.run(_run())


def test_batch_vision_missing_type_lists_use_orchestrator_defaults(monkeypatch):
    async def _run():
        calls = []

        def fake_get_file_info(file_id: str):
            return {"page_count": 1}

        async def fake_vision_detect(file_id, page, ocr_has_types, has_image_types):
            calls.append((ocr_has_types, has_image_types))

        monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)
        monkeypatch.setattr(file_operations, "vision_detect", fake_vision_detect)
        monkeypatch.setattr("app.core.gpu_memory.query_gpu_memory", lambda: None)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_TIMEOUT", 5.0)
        monkeypatch.setattr(settings, "BATCH_RECOGNITION_PAGE_CONCURRENCY", 1)

        queue = SimpleTaskQueue()
        await queue._run_vision(
            TaskItem(job_id="job", item_id="item", file_id="file"),
            {},
        )

        assert calls == [(None, None)]

    asyncio.run(_run())


def test_file_operations_vision_detect_skips_result_image_by_default(monkeypatch):
    async def _run():
        captured = {}

        async def fake_detect_vision(**kwargs):
            captured.update(kwargs)

        monkeypatch.setattr(
            "app.services.redaction_orchestrator.detect_vision",
            fake_detect_vision,
        )

        await file_operations.vision_detect("file", 2, ["ocr"], ["img"])

        assert captured["include_result_image"] is False
        assert captured["page"] == 2

    asyncio.run(_run())


def test_file_operations_vision_detect_returns_detection_result(monkeypatch):
    async def _run():
        sentinel = object()

        async def fake_detect_vision(**kwargs):
            return sentinel

        monkeypatch.setattr(
            "app.services.redaction_orchestrator.detect_vision",
            fake_detect_vision,
        )

        assert await file_operations.vision_detect("file", 1, ["ocr"], ["img"]) is sentinel

    asyncio.run(_run())


def test_queue_dedupes_by_task_stage_so_skip_review_can_enqueue_redaction():
    class Store:
        def __init__(self):
            self.status_updates = []

        def update_item_status(self, item_id, status, **kwargs):
            self.status_updates.append((item_id, status, kwargs))

    queue = SimpleTaskQueue()
    recognition = TaskItem(job_id="job", item_id="item", file_id="file", task_type="recognition")
    queue._pending_items.add(queue._task_key(recognition))

    store = Store()
    queue._mark_recognition_complete(recognition, {"skip_item_review": True}, store)

    assert store.status_updates == [("item", JobItemStatus.AWAITING_REVIEW, {})]
    assert queue.queue_size == 1
    redaction = queue._queue.get_nowait()
    assert redaction.task_type == "redaction"
    assert redaction.item_id == "item"
    assert queue._task_key(redaction) in queue._pending_items


def test_queue_still_skips_duplicate_same_stage_items():
    queue = SimpleTaskQueue()
    task = TaskItem(job_id="job", item_id="item", file_id="file", task_type="recognition")

    queue.enqueue(task)
    queue.enqueue(task)

    assert queue.queue_size == 1


def test_queue_prioritizes_short_recognition_items(monkeypatch):
    def fake_get_file_info(file_id: str):
        return {
            "large-pdf": {"file_type": "pdf_scanned", "page_count": 6},
            "short-image": {"file_type": "image", "page_count": 1},
            "short-text": {"file_type": "txt", "file_size": 512},
        }[file_id]

    monkeypatch.setattr(file_operations, "get_file_info", fake_get_file_info)

    queue = SimpleTaskQueue()
    queue.enqueue(TaskItem(job_id="job", item_id="large", file_id="large-pdf", task_type="recognition"))
    queue.enqueue(TaskItem(job_id="job", item_id="image", file_id="short-image", task_type="recognition"))
    queue.enqueue(TaskItem(job_id="job", item_id="text", file_id="short-text", task_type="recognition"))

    assert [queue._queue.get_nowait().item_id for _ in range(3)] == ["text", "image", "large"]


def test_queue_keeps_recognition_before_redaction_when_reordering(monkeypatch):
    monkeypatch.setattr(
        file_operations,
        "get_file_info",
        lambda _file_id: {"file_type": "pdf_scanned", "page_count": 6},
    )

    queue = SimpleTaskQueue()
    queue.enqueue(TaskItem(job_id="job", item_id="redact", file_id="short", task_type="redaction"))
    queue.enqueue(TaskItem(job_id="job", item_id="recognize", file_id="large", task_type="recognition"))

    assert queue._queue.get_nowait().task_type == "recognition"


def test_queue_active_item_ids_include_current_and_pending_items():
    queue = SimpleTaskQueue()
    current = TaskItem(job_id="job", item_id="current", file_id="file")
    pending = TaskItem(job_id="job", item_id="pending", file_id="file")

    queue._current[0] = current
    queue._pending_items.add(queue._task_key(pending))

    assert queue._active_item_ids() == {"current", "pending"}


def test_queue_records_enqueue_and_start_wait_ms(monkeypatch):
    class Store:
        def __init__(self):
            self.patches = []

        def update_item_performance(self, item_id, patch):
            self.patches.append((item_id, patch))

    store = Store()
    queue = SimpleTaskQueue()
    monkeypatch.setattr(queue, "_get_store", lambda: store)

    task = TaskItem(job_id="job", item_id="item", file_id="file", task_type="recognition")
    queue.enqueue(task)
    queue._record_task_started(task, store)

    assert store.patches[0][0] == "item"
    assert store.patches[0][1]["recognition"]["queued_at"]
    assert store.patches[1][1]["recognition"]["started_at"]
    assert store.patches[1][1]["recognition"]["queue_wait_ms"] >= 0
