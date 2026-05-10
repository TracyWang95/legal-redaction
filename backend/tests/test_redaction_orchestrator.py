"""Tests for redaction_orchestrator vision selection safeguards."""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.models.schemas import BoundingBox, FileType, RedactionConfig, RedactionRequest
from app.services.redaction.image_redactor import ImageRedactorMixin
from app.services import redaction_orchestrator as orchestrator


class _DummyStore(dict):
    def set(self, key: str, value: dict) -> None:
        self[key] = value


class _DummyAsyncLock:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.fixture(autouse=True)
def _allow_fake_image_path(monkeypatch):
    real_isfile = os.path.isfile

    def _isfile(path):
        return str(path) == "D:/tmp/example.png" or real_isfile(path)

    monkeypatch.setattr(orchestrator.os.path, "isfile", _isfile)


def test_report_counts_confirmed_items_separately_from_replacement_occurrences(monkeypatch):
    store = {
        "file-1": {
            "original_filename": "contract.txt",
            "output_path": "/tmp/redacted.txt",
            "redacted_count": 12,
            "replacement_mode": "structured",
            "entities": [
                {"type": "PERSON", "confidence": 0.99, "source": "has", "selected": True},
                {"type": "ORG", "confidence": 0.9, "source": "has", "selected": False},
                {"type": "DATE", "confidence": 0.7, "source": "has", "selected": True},
            ],
            "bounding_boxes": {
                "1": [
                    {"type": "seal", "selected": True},
                    {"type": "signature", "selected": False},
                ]
            },
        }
    }
    monkeypatch.setattr(orchestrator, "_get_file_store", lambda: store)

    report = orchestrator.get_report("file-1")

    assert report.total_entities == 5
    assert report.redacted_entities == 3
    assert report.coverage_rate == 60.0


def test_report_does_not_fall_back_to_replacement_count_when_everything_is_deselected(monkeypatch):
    store = {
        "file-1": {
            "original_filename": "contract.txt",
            "output_path": "/tmp/redacted.txt",
            "redacted_count": 12,
            "replacement_mode": "structured",
            "entities": [
                {"type": "PERSON", "confidence": 0.99, "source": "has", "selected": False},
            ],
        }
    }
    monkeypatch.setattr(orchestrator, "_get_file_store", lambda: store)

    report = orchestrator.get_report("file-1")

    assert report.total_entities == 1
    assert report.redacted_entities == 0
    assert report.coverage_rate == 0.0


def test_redaction_config_defaults_scanned_images_to_mosaic_75():
    config = RedactionConfig()

    assert config.image_redaction_method == "mosaic"
    assert config.image_redaction_strength == 75


def test_image_redactor_direct_dict_config_defaults_to_mosaic_75():
    async def _run() -> None:
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def apply_redaction(self, *args, **kwargs):
                captured["args"] = args
                captured.update(kwargs)

        class _FakeImageRedactor(ImageRedactorMixin):
            def __init__(self):
                self.vision_service = _FakeVisionService()

        redactor = _FakeImageRedactor()
        await redactor._redact_image(
            "D:/tmp/in.png",
            FileType.IMAGE,
            [],
            "D:/tmp/out.png",
            {},
        )

        assert captured["image_method"] == "mosaic"
        assert captured["strength"] == 75
        assert captured["fill_color"] == "#000000"

    asyncio.run(_run())


def test_image_redactor_direct_dict_config_preserves_explicit_fill():
    async def _run() -> None:
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def apply_redaction(self, *args, **kwargs):
                captured["args"] = args
                captured.update(kwargs)

        class _FakeImageRedactor(ImageRedactorMixin):
            def __init__(self):
                self.vision_service = _FakeVisionService()

        redactor = _FakeImageRedactor()
        await redactor._redact_image(
            "D:/tmp/in.png",
            FileType.IMAGE,
            [],
            "D:/tmp/out.png",
            {
                "image_redaction_method": "fill",
                "image_redaction_strength": 42,
                "image_fill_color": "#ff00aa",
            },
        )

        assert captured["image_method"] == "fill"
        assert captured["strength"] == 42
        assert captured["fill_color"] == "#ff00aa"

    asyncio.run(_run())


def test_preview_image_direct_dict_config_defaults_to_mosaic_75():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                }
            }
        )
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def preview_redaction(self, **kwargs):
                captured.update(kwargs)
                return b"preview"

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "VisionService", _FakeVisionService),
        ):
            result = await orchestrator.preview_image(
                file_id="file-1",
                bounding_boxes=[],
                page=1,
                config={},
            )

        assert result.image_base64 == "cHJldmlldw=="
        assert captured["image_method"] == "mosaic"
        assert captured["strength"] == 75
        assert captured["fill_color"] == "#000000"

    asyncio.run(_run())


def test_preview_image_direct_dict_config_preserves_explicit_fill():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                }
            }
        )
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def preview_redaction(self, **kwargs):
                captured.update(kwargs)
                return b"preview"

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "VisionService", _FakeVisionService),
        ):
            await orchestrator.preview_image(
                file_id="file-1",
                bounding_boxes=[],
                page=1,
                config={
                    "image_redaction_method": "fill",
                    "image_redaction_strength": "43",
                    "image_fill_color": "#112233",
                },
            )

        assert captured["image_method"] == "fill"
        assert captured["strength"] == 43
        assert captured["fill_color"] == "#112233"

    asyncio.run(_run())


def test_preview_image_visual_white_fill_is_converted_to_mosaic():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                }
            }
        )
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def preview_redaction(self, **kwargs):
                captured.update(kwargs)
                return b"preview"

        bbox = BoundingBox(
            id="seal-1",
            x=0.2,
            y=0.2,
            width=0.4,
            height=0.4,
            page=1,
            type="official_seal",
            source="has_image",
        )

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "VisionService", _FakeVisionService),
        ):
            await orchestrator.preview_image(
                file_id="file-1",
                bounding_boxes=[bbox],
                page=1,
                config={
                    "image_redaction_method": "fill",
                    "image_fill_color": "#ffffff",
                },
            )

        assert captured["image_method"] == "mosaic"
        assert captured["fill_color"] == "#ffffff"

    asyncio.run(_run())


def test_preview_image_oversized_box_is_clamped_and_uses_mosaic():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                }
            }
        )
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def preview_redaction(self, **kwargs):
                captured.update(kwargs)
                return b"preview"

        bbox = BoundingBox(
            id="wide-1",
            x=-0.1,
            y=0.05,
            width=1.25,
            height=0.9,
            page=1,
            type="official_seal",
            source="has_image",
        )

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "VisionService", _FakeVisionService),
        ):
            await orchestrator.preview_image(
                file_id="file-1",
                bounding_boxes=[bbox],
                page=1,
                config={
                    "image_redaction_method": "fill",
                    "image_fill_color": "#000000",
                },
            )

        passed_boxes = captured["bounding_boxes"]
        assert captured["image_method"] == "mosaic"
        assert isinstance(passed_boxes, list) and len(passed_boxes) == 1
        assert passed_boxes[0].x == 0.0
        assert passed_boxes[0].y == 0.05
        assert passed_boxes[0].width == 1.0
        assert passed_boxes[0].height == 0.9

    asyncio.run(_run())


def test_preview_image_drops_unselected_boxes_after_clamping():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                }
            }
        )
        captured: dict[str, object] = {}

        class _FakeVisionService:
            async def preview_redaction(self, **kwargs):
                captured.update(kwargs)
                return b"preview"

        selected = BoundingBox(
            id="selected",
            x=0.2,
            y=0.2,
            width=0.2,
            height=0.2,
            page=1,
            type="official_seal",
            source="has_image",
            selected=True,
        )
        unselected = BoundingBox(
            id="unselected",
            x=0.6,
            y=0.6,
            width=0.2,
            height=0.2,
            page=1,
            type="official_seal",
            source="has_image",
            selected=False,
        )

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "VisionService", _FakeVisionService),
        ):
            await orchestrator.preview_image(
                file_id="file-1",
                bounding_boxes=[selected, unselected],
                page=1,
                config={"image_redaction_method": "mosaic"},
            )

        passed_boxes = captured["bounding_boxes"]
        assert isinstance(passed_boxes, list)
        assert [box.id for box in passed_boxes] == ["selected"]

    asyncio.run(_run())


def test_detect_vision_respects_empty_type_lists():
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
            last_warnings = ["has_image failed: unavailable"]
            last_pipeline_status = {
                "ocr_has": {"ran": True, "failed": False, "region_count": 1},
                "has_image": {"ran": True, "failed": True, "region_count": 0},
            }
            last_duration_ms = {"ocr_has": 12, "has_image": 34, "total": 50}

            async def detect_with_dual_pipeline(self, **kwargs):
                captured.update(kwargs)
                return [], None

        def _fake_types(mode: str, *, enabled_only: bool = True):
            if mode == "ocr_has":
                return [SimpleNamespace(id="ocr_1")]
            if mode == "has_image":
                if enabled_only:
                    return [SimpleNamespace(id="img_1")]
                return [SimpleNamespace(id="img_1"), SimpleNamespace(id="paper")]
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
            result = await orchestrator.detect_vision(
                file_id="file-1",
                selected_ocr_has_types=[],
                selected_has_image_types=[],
                has_request=True,
            )

        assert captured.get("ocr_has_types") is None
        assert captured.get("has_image_types") is None
        assert store["file-1"]["vision_quality"][1]["warnings"] == [
            "has_image failed: unavailable"
        ]
        assert store["file-1"]["vision_quality"][1]["pipeline_status"]["has_image"]["failed"] is True
        assert {
            "ocr_has": 12,
            "has_image": 34,
            "total": 50,
        }.items() <= store["file-1"]["vision_quality"][1]["duration_ms"].items()
        assert result.duration_ms["total"] == 50

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

        def _fake_types(mode: str, *, enabled_only: bool = True):
            if mode == "ocr_has":
                return [SimpleNamespace(id="ocr_1")]
            if mode == "has_image":
                if enabled_only:
                    return [SimpleNamespace(id="img_1")]
                return [SimpleNamespace(id="img_1"), SimpleNamespace(id="paper")]
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
        assert {getattr(t, "id", None) for t in image_types} == {"img_1"}

    asyncio.run(_run())


def test_detect_vision_does_not_fallback_to_has_image_defaults_for_ocr_only_visual_ids():
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

        def _fake_types(mode: str, *, enabled_only: bool = True):
            if mode == "ocr_has":
                return [SimpleNamespace(id="ocr_1")]
            if mode == "has_image":
                if enabled_only:
                    return [SimpleNamespace(id="face"), SimpleNamespace(id="official_seal")]
                return [SimpleNamespace(id="face"), SimpleNamespace(id="official_seal")]
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
                selected_ocr_has_types=["ocr_1"],
                selected_has_image_types=["signature", "handwritten"],
                has_request=True,
            )

        ocr_types = captured.get("ocr_has_types")
        assert isinstance(ocr_types, list) and [t.id for t in ocr_types] == ["ocr_1"]
        assert captured.get("has_image_types") is None

    asyncio.run(_run())


def test_detect_vision_allows_explicit_paper_selection():
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

        def _fake_types(mode: str, *, enabled_only: bool = True):
            if mode == "ocr_has":
                return [SimpleNamespace(id="ocr_1")]
            if mode == "has_image":
                if enabled_only:
                    return [SimpleNamespace(id="img_1")]
                return [SimpleNamespace(id="img_1"), SimpleNamespace(id="paper")]
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
                selected_has_image_types=["paper"],
                has_request=True,
            )

        ocr_types = captured.get("ocr_has_types")
        image_types = captured.get("has_image_types")
        assert ocr_types is None
        assert isinstance(image_types, list) and len(image_types) == 1
        assert getattr(image_types[0], "id", None) == "paper"

    asyncio.run(_run())


def test_detect_vision_reuses_cached_page_for_same_effective_selection():
    async def _run() -> None:
        signature = {
            "version": 2,
            "page": 1,
            "ocr_has_types": ["ocr_1"],
            "has_image_types": ["img_1"],
            "vlm_types": [],
        }
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                    "bounding_boxes": {
                        1: [
                            {
                                "id": "cached-1",
                                "x": 0.1,
                                "y": 0.2,
                                "width": 0.3,
                                "height": 0.4,
                                "page": 1,
                                "type": "img_1",
                            }
                        ]
                    },
                    "vision_quality": {1: {"warnings": ["cached"], "pipeline_status": {}}},
                    "vision_detection_signature": {1: signature},
                }
            }
        )
        lock = _DummyAsyncLock()

        class _FakeVisionService:
            async def detect_with_dual_pipeline(self, **_kwargs):
                raise AssertionError("cached vision result should not call model pipelines")

        def _fake_types(mode: str, *, enabled_only: bool = True):
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
            result = await orchestrator.detect_vision(
                file_id="file-1",
                selected_ocr_has_types=["ocr_1"],
                selected_has_image_types=["img_1"],
                has_request=True,
            )

        assert [box.id for box in result.bounding_boxes] == ["cached-1"]
        assert result.warnings == ["cached"]
        assert result.cache_status["vision_result"] == "hit"
        assert result.duration_ms["request_total_ms"] >= 0

    asyncio.run(_run())


def test_detect_vision_force_bypasses_cached_page():
    async def _run() -> None:
        signature = {
            "version": 2,
            "page": 1,
            "ocr_has_types": ["ocr_1"],
            "has_image_types": ["img_1"],
            "vlm_types": [],
        }
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.png",
                    "file_type": "image",
                    "bounding_boxes": {1: []},
                    "vision_detection_signature": {1: signature},
                }
            }
        )
        lock = _DummyAsyncLock()
        calls = 0

        class _FakeVisionService:
            last_warnings: list[str] = []
            last_pipeline_status: dict[str, dict] = {}

            async def detect_with_dual_pipeline(self, **_kwargs):
                nonlocal calls
                calls += 1
                return [], None

        def _fake_types(mode: str, *, enabled_only: bool = True):
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
                selected_ocr_has_types=["ocr_1"],
                selected_has_image_types=["img_1"],
                has_request=True,
                force=True,
            )

        assert calls == 1

    asyncio.run(_run())


def test_detect_vision_reports_force_refresh_cache_status():
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

        class _FakeVisionService:
            last_warnings: list[str] = []
            last_pipeline_status: dict[str, dict] = {}
            last_duration_ms = {"total": 7}

            async def detect_with_dual_pipeline(self, **_kwargs):
                return [], None

        def _fake_types(mode: str, *, enabled_only: bool = True):
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
            result = await orchestrator.detect_vision(
                file_id="file-1",
                selected_ocr_has_types=["ocr_1"],
                selected_has_image_types=["img_1"],
                has_request=True,
                force=True,
            )

        assert result.cache_status["vision_result"] == "force_refresh"
        assert result.cache_status["force"] is True
        assert result.duration_ms["request_total_ms"] >= 0

    asyncio.run(_run())


def test_detect_vision_can_skip_result_image_rendering():
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
            last_warnings: list[str] = []
            last_pipeline_status: dict[str, dict] = {}

            async def detect_with_dual_pipeline(self, **kwargs):
                captured.update(kwargs)
                return [], None

        def _fake_types(mode: str, *, enabled_only: bool = True):
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
            result = await orchestrator.detect_vision(
                file_id="file-1",
                selected_ocr_has_types=["ocr_1"],
                selected_has_image_types=["img_1"],
                has_request=True,
                include_result_image=False,
            )

        assert captured["include_result_image"] is False
        assert result.result_image is None

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


def test_execute_redaction_stores_review_selection_count_in_version_history():
    async def _run() -> None:
        store = _DummyStore(
            {
                "file-1": {
                    "file_path": "D:/tmp/example.txt",
                    "file_type": "txt",
                    "entities": [{"id": "old", "text": "old", "type": "PERSON", "start": 0, "end": 3}],
                    "bounding_boxes": {"1": [{"id": "old-box", "selected": True}]},
                }
            }
        )
        lock = _DummyAsyncLock()

        class _FakeRedactor:
            async def redact(self, **kwargs):
                return {
                    "output_file_id": "out-1",
                    "output_path": "D:/tmp/out.txt",
                    "redacted_count": 7,
                    "entity_map": {"Alice": "[PERSON]"},
                }

        request = RedactionRequest(
            file_id="file-1",
            entities=[
                {
                    "id": "e1",
                    "text": "Alice",
                    "type": "PERSON",
                    "start": 0,
                    "end": 5,
                    "selected": True,
                    "source": "has",
                },
                {
                    "id": "e2",
                    "text": "Bob",
                    "type": "PERSON",
                    "start": 8,
                    "end": 11,
                    "selected": False,
                    "source": "has",
                },
            ],
            bounding_boxes=[],
            config=RedactionConfig(),
        )

        with (
            patch.object(orchestrator, "_get_file_store", return_value=store),
            patch.object(orchestrator, "_get_file_store_lock", return_value=lock),
            patch.object(orchestrator, "Redactor", _FakeRedactor),
        ):
            await orchestrator.execute_redaction(request)

        info = store["file-1"]
        assert len(info["entities"]) == 2
        assert info["entities"][1]["selected"] is False
        assert info["bounding_boxes"] == {}
        history = info["redaction_history"][-1]
        assert history["redacted_count"] == 1
        assert history["replacement_count"] == 7

    asyncio.run(_run())
