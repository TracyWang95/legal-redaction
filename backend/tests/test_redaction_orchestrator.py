"""Tests for redaction_orchestrator vision selection safeguards."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from app.models.schemas import BoundingBox, RedactionConfig, RedactionRequest
from app.services import redaction_orchestrator as orchestrator


class _DummyStore(dict):
    def set(self, key: str, value: dict) -> None:
        self[key] = value


class _DummyAsyncLock:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def test_detect_vision_falls_back_to_defaults_when_both_lists_empty():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                }
            }
        )
        lock = _DummyAsyncLock()
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def detect_with_dual_pipeline(self, **kwargs):
                captured.update(kwargs)
                return [], None

        def _fake_types(mode: str):
            if mode == "ocr_has":
                return [SimpleNamespace(id="ocr_1")]
            if mode == "has_image":
                return [SimpleNamespace(id="img_1")]
            return []

        fake_pipelines_db = {
            "ocr_has": SimpleNamespace(enabled=True),
            "has_image": SimpleNamespace(enabled=True),
        }

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "_get_file_store_lock", return_value=lock),
            patch.object(orchestrator, "VisionService", _FakeVisionService),
            patch("app.services.pipeline_service.get_pipeline_types_for_mode", side_effect=_fake_types),
            patch("app.services.pipeline_service.pipelines_db", fake_pipelines_db),
        ):
            await orchestrator.detect_vision(
                file_id="file-1",
                selected_ocr_has_types=[],
                selected_has_image_types=[],
                has_request=True,
            )

        ocr_types = captured.get("ocr_has_types")
        image_types = captured.get("has_image_types")
        assert isinstance(ocr_types, list) and len(ocr_types) == 1
        assert isinstance(image_types, list) and len(image_types) == 1
        assert getattr(ocr_types[0], "id", None) == "ocr_1"
        assert getattr(image_types[0], "id", None) == "img_1"

    asyncio.run(_run())


def test_detect_vision_falls_back_to_defaults_when_ids_are_invalid():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                }
            }
        )
        lock = _DummyAsyncLock()
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def detect_with_dual_pipeline(self, **kwargs):
                captured.update(kwargs)
                return [], None

        def _fake_types(mode: str):
            if mode == "ocr_has":
                return [SimpleNamespace(id="ocr_1")]
            if mode == "has_image":
                return [SimpleNamespace(id="img_1")]
            return []

        fake_pipelines_db = {
            "ocr_has": SimpleNamespace(enabled=True),
            "has_image": SimpleNamespace(enabled=True),
        }

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "_get_file_store_lock", return_value=lock),
            patch.object(orchestrator, "VisionService", _FakeVisionService),
            patch("app.services.pipeline_service.get_pipeline_types_for_mode", side_effect=_fake_types),
            patch("app.services.pipeline_service.pipelines_db", fake_pipelines_db),
        ):
            await orchestrator.detect_vision(
                file_id="file-1",
                selected_ocr_has_types=["missing_ocr"],
                selected_has_image_types=["missing_img"],
                has_request=True,
            )

        ocr_types = captured.get("ocr_has_types")
        image_types = captured.get("has_image_types")
        assert isinstance(ocr_types, list) and len(ocr_types) == 1
        assert isinstance(image_types, list) and len(image_types) == 1
        assert getattr(ocr_types[0], "id", None) == "ocr_1"
        assert getattr(image_types[0], "id", None) == "img_1"

    asyncio.run(_run())


def test_execute_redaction_groups_bounding_boxes_by_page():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.pdf",
                    "file_type": "pdf_scanned",
                }
            }
        )
        lock = _DummyAsyncLock()

        class _FakeRedactor:
            async def redact(self, **kwargs):
                return {
                    "output_file_id": "out-1",
                    "output_path": "D:/tmp/out.pdf",
                    "redacted_count": 2,
                    "entity_map": {},
                }

        request = RedactionRequest(
            file_id="file-1",
            entities=[],
            bounding_boxes=[
                BoundingBox(
                    id="b1",
                    x=0.1,
                    y=0.1,
                    width=0.2,
                    height=0.2,
                    page=1,
                    type="ID_CARD",
                ),
                BoundingBox(
                    id="b2",
                    x=0.3,
                    y=0.3,
                    width=0.2,
                    height=0.2,
                    page=2,
                    type="PERSON",
                ),
            ],
            config=RedactionConfig(),
        )

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "_get_file_store_lock", return_value=lock),
            patch.object(orchestrator, "Redactor", _FakeRedactor),
        ):
            await orchestrator.execute_redaction(request)

        grouped = store["file-1"].get("bounding_boxes")
        assert isinstance(grouped, dict)
        assert set(grouped.keys()) == {1, 2}
        assert len(grouped[1]) == 1
        assert len(grouped[2]) == 1

    asyncio.run(_run())
