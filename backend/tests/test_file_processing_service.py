"""Tests for file_processing_service: entity_type_ids pass-through and error propagation."""
from __future__ import annotations

import asyncio
import importlib
import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_entity(text: str, etype: str = "PERSON"):
    """Return a minimal Entity-like mock with a .type attribute."""
    ent = MagicMock()
    ent.type = etype
    ent.text = text
    return ent


def _fake_file_store(content: str = "some text", is_scanned: bool = False):
    """Return (file_store_mock, lock) that satisfy run_hybrid_ner / run_default_ner."""
    store = MagicMock()
    store.get.return_value = {
        "content": content,
        "is_scanned": is_scanned,
    }
    store.__contains__ = lambda self, key: True

    lock = asyncio.Lock()
    return store, lock


def _setup_hybrid_ner_module(mock_perform):
    """Inject a fake hybrid_ner_service module into sys.modules so that lazy
    imports inside file_processing_service resolve without triggering the real
    (broken-on-import) module.  Also sets HybridNERService.MAX_TEXT_LENGTH."""
    mod_name = "app.services.hybrid_ner_service"
    fake_mod = ModuleType(mod_name)
    fake_mod.perform_hybrid_ner = mock_perform
    fake_mod.HybridNERService = MagicMock()
    fake_mod.HybridNERService.MAX_TEXT_LENGTH = 100_000
    sys.modules[mod_name] = fake_mod


def _reload_fps():
    """Force-reload file_processing_service so it picks up current sys.modules
    and patches."""
    mod_name = "app.services.file_processing_service"
    if mod_name in sys.modules:
        return importlib.reload(sys.modules[mod_name])
    return importlib.import_module(mod_name)


# ---------------------------------------------------------------------------
# Issue 3 — run_default_ner must accept and forward entity_type_ids
# ---------------------------------------------------------------------------

class TestEntityTypeIdsPassThrough:
    """run_default_ner should accept entity_type_ids and use them to filter
    entity types, exactly like run_hybrid_ner does."""

    def test_run_default_ner_accepts_entity_type_ids(self):
        """run_default_ner(file_id, entity_type_ids=[...]) should select only
        the requested types from entity_types_db, not call get_enabled_types."""

        async def _run():
            store, lock = _fake_file_store()

            custom_type = MagicMock()
            custom_type.id = "custom_001"
            custom_type.enabled = True

            fake_db = {"custom_001": custom_type, "PERSON": MagicMock()}

            mock_perform = AsyncMock(return_value=[])
            _setup_hybrid_ner_module(mock_perform)

            fps = _reload_fps()

            with (
                patch.object(fps, "_store_and_lock", return_value=(store, lock)),
                patch("app.services.entity_type_service.entity_types_db", fake_db),
                patch("app.services.entity_type_service.get_enabled_types") as mock_get_enabled,
            ):
                await fps.run_default_ner("file-1", entity_type_ids=["custom_001"])

                # perform_hybrid_ner should have been called with only the custom type
                mock_perform.assert_called_once()
                _content_arg, types_arg = mock_perform.call_args[0]
                assert types_arg == [custom_type], (
                    "Expected only custom_001 type to be passed through"
                )
                # get_enabled_types must NOT be called when explicit IDs provided
                mock_get_enabled.assert_not_called()

        asyncio.run(_run())

    def test_run_default_ner_falls_back_to_enabled_types(self):
        """When entity_type_ids is None, run_default_ner should fall back to
        get_enabled_types() — same as before."""

        async def _run():
            store, lock = _fake_file_store()
            enabled_types = [MagicMock(), MagicMock()]

            mock_perform = AsyncMock(return_value=[])
            _setup_hybrid_ner_module(mock_perform)

            fps = _reload_fps()

            with (
                patch.object(fps, "_store_and_lock", return_value=(store, lock)),
                patch("app.services.entity_type_service.get_enabled_types", return_value=enabled_types),
            ):
                await fps.run_default_ner("file-1")

                _content_arg, types_arg = mock_perform.call_args[0]
                assert types_arg == enabled_types

        asyncio.run(_run())

    def test_api_endpoint_passes_entity_type_ids_to_run_default_ner(self):
        """POST /files/{file_id}/ner should forward the request's entity type
        IDs to run_default_ner so custom types are actually used."""

        async def _run():
            fake_result = {
                "entities": [],
                "entity_count": 0,
                "entity_summary": {},
            }
            with patch(
                "app.services.file_management_service.run_default_ner",
                new_callable=AsyncMock,
                return_value=fake_result,
            ) as mock_run:
                # Need to reload files module so it sees the patched _fms
                if "app.api.files" in sys.modules:
                    importlib.reload(sys.modules["app.api.files"])
                from app.api.files import extract_entities_with_config
                from app.models.schemas import NERRequest

                request = NERRequest(custom_entity_type_ids=["custom_001", "custom_002"])
                await extract_entities_with_config("file-1", request=request)

                mock_run.assert_called_once()
                call_kwargs = mock_run.call_args
                # entity_type_ids should be passed as a keyword argument
                assert "entity_type_ids" in call_kwargs.kwargs or (
                    len(call_kwargs.args) > 1 and call_kwargs.args[1] is not None
                ), "run_default_ner must receive entity_type_ids from the API endpoint"

        asyncio.run(_run())


# ---------------------------------------------------------------------------
# Issue 4 — Recognition errors must NOT be silently swallowed
# ---------------------------------------------------------------------------

class TestRecognitionErrorPropagation:
    """When perform_hybrid_ner raises an exception, the result must clearly
    indicate failure rather than returning empty entities."""

    def test_run_hybrid_ner_error_is_not_swallowed(self):
        """When perform_hybrid_ner raises, run_hybrid_ner must NOT return
        entities=[] as if recognition succeeded. It should either re-raise
        or return a dict with a recognition_failed flag."""

        async def _run():
            store, lock = _fake_file_store()
            enabled_types = [MagicMock()]

            mock_perform = AsyncMock(side_effect=RuntimeError("NER model crashed"))
            _setup_hybrid_ner_module(mock_perform)

            fps = _reload_fps()

            with (
                patch.object(fps, "_store_and_lock", return_value=(store, lock)),
                patch("app.services.entity_type_service.get_enabled_types", return_value=enabled_types),
            ):
                result = None
                raised = False
                try:
                    result = await fps.run_hybrid_ner("file-1")
                except Exception:
                    raised = True

                if raised:
                    # Option A: exception propagated — acceptable
                    pass
                else:
                    # Option B: returned a result — it MUST flag the failure
                    assert result is not None
                    assert result.get("recognition_failed") is True, (
                        "Result must have recognition_failed=True when NER crashes"
                    )
                    assert "error" in result, (
                        "Result must include an 'error' field describing what went wrong"
                    )
                    # entities should still be empty, but the flag makes it distinguishable
                    assert result["entity_count"] == 0

        asyncio.run(_run())

    def test_successful_recognition_has_no_failure_flag(self):
        """Normal successful recognition should NOT have recognition_failed."""

        async def _run():
            store, lock = _fake_file_store()
            ent = _make_entity("Alice", "PERSON")
            enabled_types = [MagicMock()]

            mock_perform = AsyncMock(return_value=[ent])
            _setup_hybrid_ner_module(mock_perform)

            fps = _reload_fps()

            with (
                patch.object(fps, "_store_and_lock", return_value=(store, lock)),
                patch("app.services.entity_type_service.get_enabled_types", return_value=enabled_types),
            ):
                result = await fps.run_hybrid_ner("file-1")

                assert result.get("recognition_failed", False) is False, (
                    "Successful recognition must not have recognition_failed=True"
                )
                assert result["entity_count"] == 1

        asyncio.run(_run())


class _FakeEntity:
    """Mimics Pydantic Entity — mutable attribute access."""

    def __init__(self, start: int, page: int = 1):
        self.start = start
        self.page = page


class TestAssignPagesToEntities:
    """_assign_pages_to_entities maps entity.start offsets back to page numbers.

    content is assumed to be "\\n\\n".join(pages), matching file_parser._parse_pdf.
    """

    def test_single_page_is_noop(self):
        fps = _reload_fps()
        ents = [_FakeEntity(start=5)]
        fps._assign_pages_to_entities(ents, ["only page"])
        assert ents[0].page == 1

    def test_empty_pages_is_noop(self):
        fps = _reload_fps()
        ents = [_FakeEntity(start=10)]
        fps._assign_pages_to_entities(ents, [])
        assert ents[0].page == 1

    def test_multi_page_offsets_resolve_correctly(self):
        """Three pages of lengths [10, 8, 12] joined by '\\n\\n' (2 chars)."""
        fps = _reload_fps()
        page1 = "x" * 10
        page2 = "y" * 8
        page3 = "z" * 12
        # Offsets: page1 [0,10), sep [10,12), page2 [12,20), sep [20,22), page3 [22,34)
        ents = [
            _FakeEntity(start=0),    # page 1
            _FakeEntity(start=9),    # still page 1 (last char)
            _FakeEntity(start=12),   # start of page 2
            _FakeEntity(start=19),   # still page 2
            _FakeEntity(start=22),   # page 3
            _FakeEntity(start=33),   # page 3
        ]
        fps._assign_pages_to_entities(ents, [page1, page2, page3])
        assert [e.page for e in ents] == [1, 1, 2, 2, 3, 3]

    def test_offset_past_content_falls_back_to_last_page(self):
        fps = _reload_fps()
        ents = [_FakeEntity(start=9999)]
        fps._assign_pages_to_entities(ents, ["aaa", "bbb"])
        assert ents[0].page == 2

    def test_accepts_dict_entities(self):
        fps = _reload_fps()
        ents = [{"start": 0}, {"start": 5}]
        fps._assign_pages_to_entities(ents, ["abc", "de"])  # lengths 3,2; page2 at offset 5
        assert ents[0]["page"] == 1
        assert ents[1]["page"] == 2
