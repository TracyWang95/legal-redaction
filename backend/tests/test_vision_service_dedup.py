import asyncio
import io
from pathlib import Path
from types import SimpleNamespace

from app.core.config import Settings, settings
from app.models.schemas import BoundingBox
from app.models.schemas import FileType
from app.services.hybrid_vision_service import OCRTextBlock, SensitiveRegion
from app.services.vision_service import (
    VisionService,
    _clear_pdf_text_layer_sparse_probe_cache,
    prime_pdf_text_layer_sparse_probe,
)
from app.services.vision.ocr_artifact_filter import (
    is_page_edge_ocr_artifact,
    region_has_visible_ink,
)
from PIL import Image, ImageDraw


def _box(
    box_id: str,
    box_type: str,
    source: str,
    *,
    x: float = 0.1,
    y: float = 0.1,
    width: float = 0.3,
    height: float = 0.2,
) -> BoundingBox:
    return BoundingBox(
        id=box_id,
        x=x,
        y=y,
        width=width,
        height=height,
        type=box_type,
        text=box_type,
        page=1,
        source=source,
    )


def test_redaction_pdf_jpeg_quality_defaults_to_professional_setting(tmp_path: Path):
    config = Settings(DATA_DIR=str(tmp_path), JWT_SECRET_KEY="test-secret")

    assert config.REDACTION_PDF_JPEG_QUALITY == 88


def test_redaction_pdf_jpeg_quality_clamps_out_of_range_values(tmp_path: Path):
    common = {"DATA_DIR": str(tmp_path), "JWT_SECRET_KEY": "test-secret"}

    assert Settings(**common, REDACTION_PDF_JPEG_QUALITY=59).REDACTION_PDF_JPEG_QUALITY == 60
    assert Settings(**common, REDACTION_PDF_JPEG_QUALITY=60).REDACTION_PDF_JPEG_QUALITY == 60
    assert Settings(**common, REDACTION_PDF_JPEG_QUALITY=95).REDACTION_PDF_JPEG_QUALITY == 95
    assert Settings(**common, REDACTION_PDF_JPEG_QUALITY=96).REDACTION_PDF_JPEG_QUALITY == 95


def test_redaction_pdf_jpeg_quality_reads_environment(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("REDACTION_PDF_JPEG_QUALITY", "94")

    config = Settings(DATA_DIR=str(tmp_path), JWT_SECRET_KEY="test-secret")

    assert config.REDACTION_PDF_JPEG_QUALITY == 94


def test_deduplicate_keeps_has_image_box_overlapping_ocr_table_text():
    service = VisionService.__new__(VisionService)
    ocr_table_text = _box("ocr-1", "AMOUNT", "ocr_has")
    face_in_table_cell = _box("hi-1", "face", "has_image")

    merged = service._deduplicate_boxes([ocr_table_text, face_in_table_cell])

    assert {box.id for box in merged} == {"ocr-1", "hi-1"}


def test_deduplicate_merges_same_visual_target_from_ocr_and_has_image():
    service = VisionService.__new__(VisionService)
    ocr_seal = _box("ocr-1", "SEAL", "ocr_has")
    has_image_seal = _box("hi-1", "official_seal", "has_image")

    merged = service._deduplicate_boxes([ocr_seal, has_image_seal])

    assert [box.id for box in merged] == ["ocr-1"]


def test_deduplicate_keeps_cross_modal_boxes_when_semantic_targets_differ():
    service = VisionService.__new__(VisionService)
    cases = [
        (
            _box("ocr-date", "DATE", "ocr_has", x=0.56, y=0.39, width=0.19, height=0.04),
            _box("vlm-mark", "signature", "vlm", x=0.53, y=0.39, width=0.30, height=0.15),
        ),
        (
            _box("ocr-amount", "AMOUNT", "ocr_has", x=0.2, y=0.2, width=0.18, height=0.05),
            _box("hi-face", "face", "has_image", x=0.18, y=0.18, width=0.22, height=0.18),
        ),
        (
            _box("hi-seal", "official_seal", "has_image", x=0.45, y=0.32, width=0.24, height=0.16),
            _box("vlm-mark", "handwriting", "vlm", x=0.42, y=0.35, width=0.30, height=0.18),
        ),
    ]

    for first, second in cases:
        merged = service._deduplicate_boxes([first, second])
        assert {box.id for box in merged} == {first.id, second.id}


def test_deduplicate_merges_cross_modal_boxes_when_semantic_target_matches():
    service = VisionService.__new__(VisionService)
    has_image_seal = _box("hi-seal", "official_seal", "has_image")
    vlm_seal = _box("vlm-seal", "seal", "vlm")

    merged = service._deduplicate_boxes([has_image_seal, vlm_seal])

    assert [box.id for box in merged] == ["hi-seal"]


def test_dual_pipeline_runs_sequential_by_default(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()
    events: list[str] = []

    class FileParserStub:
        async def read_image(self, _file_path):
            return image_bytes

    async def detect_ocr(_image_data, _page, _types):
        events.append("ocr-start")
        await asyncio.sleep(0)
        events.append("ocr-end")
        return ([_box("ocr-1", "ORG", "ocr_has")], None)

    async def detect_has_image(_image_data, _page, _types):
        events.append("image-start")
        await asyncio.sleep(0)
        events.append("image-end")
        return ([_box("image-1", "official_seal", "has_image", x=0.6)], None)

    service.file_parser = FileParserStub()
    service._detect_with_ocr_has = detect_ocr
    service._detect_with_has_image = detect_has_image
    service._draw_boxes_on_image = lambda *_args, **_kwargs: "preview"
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    boxes, preview = asyncio.run(
        service.detect_with_dual_pipeline(
            "dummy.png",
            FileType.IMAGE,
            ocr_has_types=["ORG"],
            has_image_types=["official_seal"],
        )
    )

    assert events == ["ocr-start", "ocr-end", "image-start", "image-end"]
    assert [box.source for box in boxes] == ["ocr_has", "has_image"]
    assert preview == "preview"
    assert service.last_pipeline_status["ocr_has"]["region_count"] == 1
    assert service.last_pipeline_status["has_image"]["region_count"] == 1
    assert isinstance(service.last_pipeline_status["ocr_has"]["duration_ms"], int)
    assert isinstance(service.last_pipeline_status["has_image"]["duration_ms"], int)
    assert set(service.last_duration_ms) >= {"ocr_has", "has_image", "total"}
    assert service.last_warnings == []


def test_dual_pipeline_records_partial_failure_status(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        async def read_image(self, _file_path):
            return image_bytes

    async def detect_ocr(_image_data, _page, _types):
        return ([_box("ocr-1", "ORG", "ocr_has")], None)

    async def detect_has_image(_image_data, _page, _types):
        raise RuntimeError("vision model unavailable")

    service.file_parser = FileParserStub()
    service._detect_with_ocr_has = detect_ocr
    service._detect_with_has_image = detect_has_image
    service._draw_boxes_on_image = lambda *_args, **_kwargs: "preview"
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    boxes, preview = asyncio.run(
        service.detect_with_dual_pipeline(
            "dummy.png",
            FileType.IMAGE,
            ocr_has_types=["ORG"],
            has_image_types=["official_seal"],
        )
    )

    assert [box.id for box in boxes] == ["ocr-1"]
    assert preview == "preview"
    assert service.last_pipeline_status["ocr_has"]["failed"] is False
    assert service.last_pipeline_status["has_image"]["failed"] is True
    assert isinstance(service.last_pipeline_status["has_image"]["duration_ms"], int)
    assert "vision model unavailable" in service.last_pipeline_status["has_image"]["error"]
    assert service.last_warnings == ["has_image failed: vision model unavailable"]


def test_dual_pipeline_records_pdf_render_and_total_duration(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        async def get_pdf_page_image(self, _file_path, _page):
            await asyncio.sleep(0)
            return image_bytes

    async def detect_ocr(_image_data, _page, _types):
        return ([_box("ocr-1", "ORG", "ocr_has")], None)

    service.file_parser = FileParserStub()
    service._detect_with_ocr_has = detect_ocr
    service._draw_boxes_on_image = lambda *_args, **_kwargs: "preview"
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    boxes, preview = asyncio.run(
        service.detect_with_dual_pipeline(
            "dummy.pdf",
            FileType.PDF_SCANNED,
            ocr_has_types=["ORG"],
            has_image_types=None,
        )
    )

    assert [box.id for box in boxes] == ["ocr-1"]
    assert preview == "preview"
    assert isinstance(service.last_duration_ms["pdf_render_ms"], int)
    assert isinstance(service.last_duration_ms["ocr_has"], int)
    assert service.last_duration_ms["has_image"] == 0
    assert isinstance(service.last_duration_ms["total"], int)


def test_parallel_dual_pipeline_shares_pdf_render_within_page(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        last_pdf_page_image_cache_hit = False
        render_calls = 0

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            await asyncio.sleep(0.01)
            return image_bytes

    async def detect_ocr(_image_data, _page, _types):
        return ([_box("ocr-1", "ORG", "ocr_has")], None)

    async def detect_has_image(_image_data, _page, _types):
        return ([_box("image-1", "official_seal", "has_image", x=0.6)], None)

    parser = FileParserStub()
    service.file_parser = parser
    service._detect_with_ocr_has = detect_ocr
    service._detect_with_has_image = detect_has_image
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", False)
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", True)

    boxes, preview = asyncio.run(
        service.detect_with_dual_pipeline(
            "dummy.pdf",
            FileType.PDF_SCANNED,
            ocr_has_types=["ORG"],
            has_image_types=["official_seal"],
            include_result_image=False,
        )
    )

    assert preview is None
    assert parser.render_calls == 1
    assert sorted(box.source for box in boxes) == ["has_image", "ocr_has"]
    assert service.last_duration_ms["pdf_render_cache_hit"] is False


def test_single_ocr_pdf_uses_text_layer_before_render_or_image_ocr(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        render_calls = 0
        last_pdf_page_image_cache_hit = False
        last_pdf_page_text_blocks_cache_hit = True

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            return image_bytes

        async def get_pdf_page_text_blocks(self, _file_path, _page):
            return (
                [
                    OCRTextBlock(
                        text="Supplier Example Incorporated",
                        polygon=[[10, 10], [210, 10], [210, 30], [10, 30]],
                    )
                ],
                400,
                300,
            )

    class HybridStub:
        last_duration_ms = {"ocr": 0, "has_ner": 4, "match": 1, "total": 5}

        async def detect_from_text_blocks(self, blocks, _types):
            assert blocks[0].text.startswith("Supplier")
            return [
                SensitiveRegion(
                    text="Supplier Example Incorporated",
                    entity_type="ORG",
                    left=10,
                    top=10,
                    width=200,
                    height=20,
                    source="pdf_text_layer",
                )
            ]

    async def fail_image_ocr(*_args, **_kwargs):
        raise AssertionError("image OCR should not run for dense native PDF text")

    parser = FileParserStub()
    service.file_parser = parser
    service.hybrid_service = HybridStub()
    service._detect_with_ocr_has = fail_image_ocr
    service._draw_boxes_on_image = lambda *_args, **_kwargs: "preview"
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_MIN_CHARS", 8)

    boxes, preview = asyncio.run(
        service.detect_sensitive_regions(
            "dummy.pdf",
            FileType.PDF,
            page=1,
            draw_result=False,
            pipeline_mode="ocr_has",
            pipeline_types=["ORG"],
        )
    )

    assert preview is None
    assert parser.render_calls == 0
    assert len(boxes) == 1
    assert boxes[0].source_detail == "pdf_text_layer"
    assert service.last_duration_ms["pdf_text_layer_used"] is True
    assert service.last_duration_ms["pdf_text_layer"]["cache_hit"] is True
    assert "pdf_render_ms" not in service.last_duration_ms
    assert service.last_pipeline_status["ocr_has"]["stage_duration_ms"]["pdf_text_layer_extract"] >= 0


def test_single_image_ocr_never_uses_pdf_text_layer_or_render(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        read_calls = 0
        render_calls = 0
        text_layer_calls = 0

        async def read_image(self, _file_path):
            self.read_calls += 1
            return image_bytes

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            raise AssertionError("image detection must not render a PDF page")

        async def get_pdf_page_text_blocks(self, _file_path, _page):
            self.text_layer_calls += 1
            raise AssertionError("image detection must not inspect a PDF text layer")

    async def detect_ocr(image_data, _page, _types):
        assert image_data == image_bytes
        return ([_box("ocr-1", "ORG", "ocr_has")], None)

    parser = FileParserStub()
    service.file_parser = parser
    service._detect_with_ocr_has = detect_ocr
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", True)

    boxes, preview = asyncio.run(
        service.detect_sensitive_regions(
            "dummy.png",
            FileType.IMAGE,
            page=1,
            draw_result=False,
            pipeline_mode="ocr_has",
            pipeline_types=["ORG"],
        )
    )

    assert preview is None
    assert [box.id for box in boxes] == ["ocr-1"]
    assert parser.read_calls == 1
    assert parser.render_calls == 0
    assert parser.text_layer_calls == 0
    assert "pdf_render_ms" not in service.last_duration_ms
    assert "pdf_text_layer_used" not in service.last_duration_ms


def test_dual_pipeline_uses_pdf_text_layer_before_image_ocr(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        last_pdf_page_image_cache_hit = False
        render_calls = 0

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            return image_bytes

        async def get_pdf_page_text_blocks(self, _file_path, _page):
            return (
                [
                    OCRTextBlock(
                        text="采购单位 北京示例科技有限公司",
                        polygon=[[10, 10], [210, 10], [210, 30], [10, 30]],
                    )
                ],
                400,
                300,
            )

    class HybridStub:
        last_duration_ms = {"ocr": 0, "has_ner": 5, "match": 1, "total": 6}

        async def detect_from_text_blocks(self, blocks, _types):
            assert blocks[0].text.startswith("采购单位")
            return [
                SensitiveRegion(
                    text="北京示例科技有限公司",
                    entity_type="ORG",
                    left=80,
                    top=10,
                    width=130,
                    height=20,
                    source="pdf_text_layer",
                )
            ]

    async def fail_image_ocr(*_args, **_kwargs):
        raise AssertionError("image OCR should not run for dense native PDF text")

    parser = FileParserStub()
    service.file_parser = parser
    service.hybrid_service = HybridStub()
    service._detect_with_ocr_has = fail_image_ocr
    service._draw_boxes_on_image = lambda *_args, **_kwargs: None
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_MIN_CHARS", 8)
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    boxes, preview = asyncio.run(
        service.detect_with_dual_pipeline(
            "dummy.pdf",
            FileType.PDF,
            ocr_has_types=["ORG"],
            has_image_types=None,
            include_result_image=False,
        )
    )

    assert preview is None
    assert parser.render_calls == 0
    assert len(boxes) == 1
    assert boxes[0].source_detail == "pdf_text_layer"
    assert boxes[0].evidence_source == "ocr_has"
    assert service.last_pipeline_status["ocr_has"]["stage_duration_ms"]["ocr"] == 0
    assert service.last_duration_ms["pdf_text_layer"]["char_count"] > 0


def test_dual_pipeline_tries_text_layer_for_ocr_classified_scanned_pdf(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        last_pdf_page_image_cache_hit = False
        render_calls = 0

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            return image_bytes

        async def get_pdf_page_text_blocks(self, _file_path, _page):
            return (
                [
                    OCRTextBlock(
                        text="联系人 张三",
                        polygon=[[10, 10], [90, 10], [90, 30], [10, 30]],
                    )
                ],
                200,
                100,
            )

    class HybridStub:
        last_duration_ms = {"ocr": 0, "has_ner": 2, "match": 1, "total": 3}

        async def detect_from_text_blocks(self, _blocks, _types):
            return [
                SensitiveRegion(
                    text="张三",
                    entity_type="PERSON",
                    left=50,
                    top=10,
                    width=28,
                    height=20,
                    source="pdf_text_layer",
                )
            ]

    async def fail_image_ocr(*_args, **_kwargs):
        raise AssertionError("image OCR should not run when scanned PDF has dense text layer")

    parser = FileParserStub()
    service.file_parser = parser
    service.hybrid_service = HybridStub()
    service._detect_with_ocr_has = fail_image_ocr
    service._draw_boxes_on_image = lambda *_args, **_kwargs: None
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_MIN_CHARS", 4)
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    boxes, _preview = asyncio.run(
        service.detect_with_dual_pipeline(
            "dummy.pdf",
            FileType.PDF_SCANNED,
            ocr_has_types=["PERSON"],
            has_image_types=None,
            include_result_image=False,
        )
    )

    assert parser.render_calls == 0
    assert len(boxes) == 1
    assert boxes[0].source_detail == "pdf_text_layer"


def test_scanned_pdf_skips_text_layer_after_extremely_sparse_page(monkeypatch, tmp_path: Path):
    _clear_pdf_text_layer_sparse_probe_cache()
    pdf_path = tmp_path / "scan.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sparse text layer probe cache test")

    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        last_pdf_page_image_cache_hit = False
        render_calls = 0
        text_layer_calls = 0

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            return image_bytes

        async def get_pdf_page_text_blocks(self, _file_path, page):
            self.text_layer_calls += 1
            return (
                [
                    OCRTextBlock(
                        text=f"x{page}",
                        polygon=[[10, 10], [20, 10], [20, 20], [10, 20]],
                    )
                ],
                200,
                100,
            )

    async def detect_ocr(_image_data, page, _types):
        return ([_box(f"ocr-{page}", "ORG", "ocr_has")], None)

    parser = FileParserStub()
    service.file_parser = parser
    service._detect_with_ocr_has = detect_ocr
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_MIN_CHARS", 10)
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    try:
        for page in (1, 2, 3):
            boxes, preview = asyncio.run(
                service.detect_with_dual_pipeline(
                    str(pdf_path),
                    FileType.PDF_SCANNED,
                    page=page,
                    ocr_has_types=["ORG"],
                    has_image_types=None,
                    include_result_image=False,
                )
            )
            assert preview is None
            assert [box.id for box in boxes] == [f"ocr-{page}"]

        assert parser.text_layer_calls == 1
        assert parser.render_calls == 3
        assert service.last_duration_ms["pdf_text_layer_skipped_sparse_file"] is True
    finally:
        _clear_pdf_text_layer_sparse_probe_cache()


def test_scanned_pdf_moderate_sparse_text_layer_still_needs_two_probes(monkeypatch, tmp_path: Path):
    _clear_pdf_text_layer_sparse_probe_cache()
    pdf_path = tmp_path / "moderate-scan.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 moderate sparse text layer probe cache test")

    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        last_pdf_page_image_cache_hit = False
        render_calls = 0
        text_layer_calls = 0

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            return image_bytes

        async def get_pdf_page_text_blocks(self, _file_path, page):
            self.text_layer_calls += 1
            return (
                [
                    OCRTextBlock(
                        text=f"sparse{page}",
                        polygon=[[10, 10], [20, 10], [20, 20], [10, 20]],
                    )
                ],
                200,
                100,
            )

    async def detect_ocr(_image_data, page, _types):
        return ([_box(f"ocr-{page}", "ORG", "ocr_has")], None)

    parser = FileParserStub()
    service.file_parser = parser
    service._detect_with_ocr_has = detect_ocr
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_MIN_CHARS", 10)
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    try:
        for page in (1, 2, 3):
            boxes, preview = asyncio.run(
                service.detect_with_dual_pipeline(
                    str(pdf_path),
                    FileType.PDF_SCANNED,
                    page=page,
                    ocr_has_types=["ORG"],
                    has_image_types=None,
                    include_result_image=False,
                )
            )
            assert preview is None
            assert [box.id for box in boxes] == [f"ocr-{page}"]

        assert parser.text_layer_calls == 2
        assert parser.render_calls == 3
        assert service.last_duration_ms["pdf_text_layer_skipped_sparse_file"] is True
    finally:
        _clear_pdf_text_layer_sparse_probe_cache()


def test_scanned_pdf_concurrent_pages_share_sparse_text_layer_probe(monkeypatch, tmp_path: Path):
    _clear_pdf_text_layer_sparse_probe_cache()
    pdf_path = tmp_path / "concurrent-scan.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 concurrent sparse text layer probe cache test")

    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        last_pdf_page_image_cache_hit = False
        render_calls = 0
        text_layer_calls = 0

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            return image_bytes

        async def get_pdf_page_text_blocks(self, _file_path, page):
            self.text_layer_calls += 1
            await asyncio.sleep(0.01)
            return (
                [
                    OCRTextBlock(
                        text=f"x{page}",
                        polygon=[[10, 10], [20, 10], [20, 20], [10, 20]],
                    )
                ],
                200,
                100,
            )

    async def detect_ocr(_image_data, page, _types):
        return ([_box(f"ocr-{page}", "ORG", "ocr_has")], None)

    parser = FileParserStub()

    def make_service() -> VisionService:
        service = VisionService.__new__(VisionService)
        service.file_parser = parser
        service._detect_with_ocr_has = detect_ocr
        return service

    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_MIN_CHARS", 10)
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    async def run_page(page: int):
        service = make_service()
        return await service.detect_with_dual_pipeline(
            str(pdf_path),
            FileType.PDF_SCANNED,
            page=page,
            ocr_has_types=["ORG"],
            has_image_types=None,
            include_result_image=False,
        )

    async def run_pages():
        return await asyncio.gather(run_page(1), run_page(2))

    try:
        results = asyncio.run(run_pages())
    finally:
        _clear_pdf_text_layer_sparse_probe_cache()

    assert [[box.id for box in boxes] for boxes, _preview in results] == [["ocr-1"], ["ocr-2"]]
    assert parser.text_layer_calls == 1


def test_scanned_pdf_prime_sparse_text_layer_probe_skips_page_fanout(monkeypatch, tmp_path: Path):
    _clear_pdf_text_layer_sparse_probe_cache()
    pdf_path = tmp_path / "prime-scan.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 prime sparse text layer probe test")

    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()

    class FileParserStub:
        last_pdf_page_image_cache_hit = False
        last_pdf_page_text_blocks_cache_hit = False
        render_calls = 0
        text_layer_calls = 0

        async def get_pdf_page_image(self, _file_path, _page):
            self.render_calls += 1
            return image_bytes

        async def get_pdf_page_text_blocks(self, _file_path, page):
            self.text_layer_calls += 1
            return (
                [
                    OCRTextBlock(
                        text=f"x{page}",
                        polygon=[[10, 10], [20, 10], [20, 20], [10, 20]],
                    )
                ],
                200,
                100,
            )

    async def detect_ocr(_image_data, page, _types):
        return ([_box(f"ocr-{page}", "ORG", "ocr_has")], None)

    parser = FileParserStub()

    def make_service() -> VisionService:
        service = VisionService.__new__(VisionService)
        service.file_parser = parser
        service._detect_with_ocr_has = detect_ocr
        return service

    monkeypatch.setattr("app.services.vision_service.FileParser", lambda: parser)
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "PDF_TEXT_LAYER_MIN_CHARS", 10)
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    async def run_pages():
        probe = await prime_pdf_text_layer_sparse_probe(str(pdf_path), FileType.PDF_SCANNED, page=1)
        results = await asyncio.gather(
            make_service().detect_with_dual_pipeline(
                str(pdf_path),
                FileType.PDF_SCANNED,
                page=1,
                ocr_has_types=["ORG"],
                has_image_types=None,
                include_result_image=False,
            ),
            make_service().detect_with_dual_pipeline(
                str(pdf_path),
                FileType.PDF_SCANNED,
                page=2,
                ocr_has_types=["ORG"],
                has_image_types=None,
                include_result_image=False,
            ),
        )
        return probe, results

    try:
        probe, results = asyncio.run(run_pages())
    finally:
        _clear_pdf_text_layer_sparse_probe_cache()

    assert probe["ran"] is True
    assert probe["sparse"] is True
    assert probe["skip_after_probe"] is True
    assert [[box.id for box in boxes] for boxes, _preview in results] == [["ocr-1"], ["ocr-2"]]
    assert parser.text_layer_calls == 1
    assert parser.render_calls == 2


def test_dual_pipeline_skips_subpipeline_preview_rendering(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    image_bytes = buffer.getvalue()
    draw_flags: list[bool] = []

    class FileParserStub:
        async def read_image(self, _file_path):
            return image_bytes

    async def detect_ocr(_image_data, _page, _types, draw_result=True):
        draw_flags.append(draw_result)
        return ([_box("ocr-1", "ORG", "ocr_has")], "unused-ocr-preview" if draw_result else None)

    async def detect_has_image(_image_data, _page, _types, draw_result=True):
        draw_flags.append(draw_result)
        return ([_box("image-1", "official_seal", "has_image", x=0.6)], "unused-image-preview" if draw_result else None)

    service.file_parser = FileParserStub()
    service._detect_with_ocr_has = detect_ocr
    service._detect_with_has_image = detect_has_image
    service._draw_boxes_on_image = lambda *_args, **_kwargs: "merged-preview"
    monkeypatch.setattr(settings, "VISION_DUAL_PIPELINE_PARALLEL", False)

    _boxes, preview = asyncio.run(
        service.detect_with_dual_pipeline(
            "dummy.png",
            FileType.IMAGE,
            ocr_has_types=["ORG"],
            has_image_types=["official_seal"],
        )
    )

    assert draw_flags == [False, False]
    assert preview == "merged-preview"


def test_has_image_boxes_preserve_confidence_and_source_detail(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fake_detect_privacy_regions(*_args, **_kwargs):
        return [
            {
                "x": 0.1,
                "y": 0.2,
                "width": 0.3,
                "height": 0.4,
                "category": "face",
                "confidence": 0.37,
            }
        ]

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=2,
            pipeline_types=[SimpleNamespace(id="face")],
        )
    )

    assert len(boxes) == 1
    assert boxes[0].confidence == 0.37
    assert boxes[0].source == "has_image"
    assert boxes[0].source_detail == "has_image"
    assert boxes[0].evidence_source == "has_image_model"


def test_has_image_filters_unsupported_types_before_model_call(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    seen = {}

    async def fake_detect_privacy_regions(*_args, **kwargs):
        seen["category_slugs"] = kwargs.get("category_slugs")
        return []

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )

    asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=[SimpleNamespace(id="official_seal"), SimpleNamespace(id="not_a_model_class")],
        )
    )

    assert seen["category_slugs"] == ["official_seal"]


def test_fallback_edge_seal_boxes_carry_review_warnings(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (120, 180), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fake_detect_privacy_regions(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )
    monkeypatch.setattr(
        "app.services.vision_service.detect_red_seal_regions",
        lambda _img: [
            SimpleNamespace(x=0.982, y=0.35, width=0.012, height=0.18, confidence=0.72)
        ],
    )
    monkeypatch.setattr(
        "app.services.vision_service.detect_dark_seal_regions",
        lambda _img: [],
    )

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=[SimpleNamespace(id="official_seal")],
        )
    )

    assert len(boxes) == 1
    assert boxes[0].source == "has_image"
    assert boxes[0].source_detail == "local_red_seal_fallback"
    assert boxes[0].evidence_source == "local_fallback"
    assert boxes[0].evidence_source != "has_image_model"
    assert boxes[0].warnings == ["fallback_detector", "edge_seal", "seam_seal"]


def test_fallback_seal_dedupes_box_contained_in_model_hit(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (200, 200), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fake_detect_privacy_regions(*_args, **_kwargs):
        return [
            {
                "x": 0.20,
                "y": 0.20,
                "width": 0.45,
                "height": 0.45,
                "category": "official_seal",
                "confidence": 0.81,
            }
        ]

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )
    monkeypatch.setattr(
        "app.services.vision_service.detect_red_seal_regions",
        lambda _img: [SimpleNamespace(x=0.34, y=0.34, width=0.12, height=0.12, confidence=0.72)],
    )
    monkeypatch.setattr("app.services.vision_service.detect_dark_seal_regions", lambda _img: [])

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=[SimpleNamespace(id="official_seal")],
        )
    )

    assert len(boxes) == 1
    assert boxes[0].evidence_source == "has_image_model"


def test_fallback_seal_dedupes_red_and_dark_nested_hits(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (200, 200), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fake_detect_privacy_regions(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )
    monkeypatch.setattr(
        "app.services.vision_service.detect_red_seal_regions",
        lambda _img: [SimpleNamespace(x=0.30, y=0.30, width=0.20, height=0.20, confidence=0.72)],
    )
    monkeypatch.setattr(
        "app.services.vision_service.detect_dark_seal_regions",
        lambda _img: [SimpleNamespace(x=0.34, y=0.34, width=0.10, height=0.10, confidence=0.66)],
    )

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=[SimpleNamespace(id="official_seal")],
        )
    )

    assert len(boxes) == 1
    assert boxes[0].source_detail == "local_red_seal_fallback"
    assert "low_confidence" not in boxes[0].warnings


def test_fallback_dark_seal_low_confidence_warning(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (200, 200), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fake_detect_privacy_regions(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )
    monkeypatch.setattr("app.services.vision_service.detect_red_seal_regions", lambda _img: [])
    monkeypatch.setattr(
        "app.services.vision_service.detect_dark_seal_regions",
        lambda _img: [SimpleNamespace(x=0.30, y=0.30, width=0.20, height=0.20, confidence=0.66)],
    )

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=[SimpleNamespace(id="official_seal")],
        )
    )

    assert len(boxes) == 1
    assert boxes[0].warnings == ["fallback_detector", "low_confidence"]


def test_fallback_seal_skips_tiny_non_edge_fragments(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (200, 200), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fake_detect_privacy_regions(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )
    monkeypatch.setattr(
        "app.services.vision_service.detect_red_seal_regions",
        lambda _img: [SimpleNamespace(x=0.50, y=0.50, width=0.006, height=0.006, confidence=0.72)],
    )
    monkeypatch.setattr("app.services.vision_service.detect_dark_seal_regions", lambda _img: [])

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=[SimpleNamespace(id="official_seal")],
        )
    )

    assert boxes == []


def test_has_image_does_not_send_signature_or_handwritten_to_model(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fail_if_model_called(*_args, **_kwargs):
        raise AssertionError("signature/handwritten must not reach HaS Image model request")

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fail_if_model_called,
    )

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=[
                SimpleNamespace(id="signature"),
                SimpleNamespace(id="handwritten"),
                SimpleNamespace(id="handwritten_signature"),
            ],
        )
    )

    assert boxes == []


def test_has_image_drops_unsupported_model_response_categories(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fake_detect_privacy_regions(*_args, **_kwargs):
        return [
            {
                "x": 0.1,
                "y": 0.1,
                "width": 0.2,
                "height": 0.2,
                "category": "signature",
                "confidence": 0.99,
            },
            {
                "x": 0.2,
                "y": 0.2,
                "width": 0.2,
                "height": 0.2,
                "category": "hand-written",
                "confidence": 0.98,
            },
            {
                "x": 0.3,
                "y": 0.3,
                "width": 0.2,
                "height": 0.2,
                "category": "official-seal",
                "confidence": 0.77,
            },
        ]

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )
    monkeypatch.setattr("app.services.vision_service.detect_red_seal_regions", lambda _img: [])
    monkeypatch.setattr("app.services.vision_service.detect_dark_seal_regions", lambda _img: [])

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=None,
        )
    )

    assert [box.type for box in boxes] == ["official_seal"]
    assert boxes[0].source == "has_image"
    assert boxes[0].source_detail == "has_image"
    assert boxes[0].confidence == 0.77


def test_has_image_clamps_model_boxes_to_page_bounds(monkeypatch):
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (80, 60), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    async def fake_detect_privacy_regions(*_args, **_kwargs):
        return [
            {
                "x": -0.05,
                "y": 0.95,
                "width": 1.2,
                "height": 0.2,
                "category": "face",
                "confidence": 0.88,
            },
            {
                "x": 0.4,
                "y": 0.4,
                "width": 0.0,
                "height": 0.2,
                "category": "qr_code",
                "confidence": 0.92,
            },
        ]

    monkeypatch.setattr(
        "app.services.vision_service.detect_privacy_regions",
        fake_detect_privacy_regions,
    )

    boxes, _preview = asyncio.run(
        service._detect_with_has_image(
            buffer.getvalue(),
            page=1,
            pipeline_types=None,
        )
    )

    assert len(boxes) == 1
    assert boxes[0].type == "face"
    assert boxes[0].x == 0.0
    assert boxes[0].y == 0.95
    assert boxes[0].width == 1.0
    assert round(boxes[0].height, 6) == 0.05
    assert boxes[0].source == "has_image"
    assert boxes[0].source_detail == "has_image"


def test_pdf_redaction_embeds_jpeg_page_rasters(tmp_path: Path, monkeypatch):
    import fitz

    source_pdf = tmp_path / "scan.pdf"
    output_pdf = tmp_path / "redacted.pdf"

    page_image = Image.new("RGB", (900, 1200), "#f8f8f2")
    draw = ImageDraw.Draw(page_image)
    for y in range(80, 1120, 36):
        draw.line((80, y, 820, y), fill="#222222", width=2)
    draw.ellipse((550, 300, 700, 450), outline="#cc2222", width=10)

    image_buffer = io.BytesIO()
    page_image.save(image_buffer, format="PNG")
    image_buffer.seek(0)

    doc = fitz.open()
    page = doc.new_page(width=450, height=600)
    page.insert_image(page.rect, stream=image_buffer.getvalue())
    doc.save(source_pdf)
    doc.close()

    jpeg_save_kwargs = []
    original_save = Image.Image.save

    def capture_save(image, fp, format=None, **params):
        if format == "JPEG":
            jpeg_save_kwargs.append(dict(params))
        return original_save(image, fp, format=format, **params)

    monkeypatch.setattr(settings, "REDACTION_PDF_JPEG_QUALITY", 61)
    monkeypatch.setattr(Image.Image, "save", capture_save)

    box = BoundingBox(
        id="seal-1",
        x=0.60,
        y=0.24,
        width=0.20,
        height=0.16,
        type="official_seal",
        text="official_seal",
        page=1,
        source="has_image",
    )

    service = VisionService.__new__(VisionService)
    asyncio.run(
        service._redact_pdf(
            str(source_pdf),
            [box],
            str(output_pdf),
            image_method="fill",
            strength=75,
            fill_color="#000000",
        )
    )

    raw = output_pdf.read_bytes()
    assert b"DCTDecode" in raw
    assert jpeg_save_kwargs == [{"quality": 61, "optimize": True}]
    assert output_pdf.stat().st_size < 1_000_000

    redacted = fitz.open(output_pdf)
    assert redacted.page_count == 1
    redacted.close()


def test_region_visible_ink_filter_skips_blank_ocr_boxes():
    image = Image.new("RGB", (400, 300), "white")
    draw = ImageDraw.Draw(image)
    draw.text((210, 120), "13451775049", fill="black")

    assert not region_has_visible_ink(image, 0, 0, 160, 80)
    assert region_has_visible_ink(image, 200, 110, 120, 40)


def test_page_edge_ocr_artifact_filter_skips_scanner_margin_boxes():
    assert is_page_edge_ocr_artifact(
        left=2, top=120, region_width=90, region_height=20, page_width=1000, page_height=800
    )
    assert is_page_edge_ocr_artifact(
        left=40, top=2, region_width=140, region_height=20, page_width=1000, page_height=800
    )
    assert not is_page_edge_ocr_artifact(
        left=40, top=120, region_width=90, region_height=20, page_width=1000, page_height=800
    )
    assert not is_page_edge_ocr_artifact(
        left=2, top=120, region_width=20, region_height=20, page_width=1000, page_height=800
    )


def test_page_edge_ocr_artifact_filter_skips_right_edge_text_and_footer():
    assert is_page_edge_ocr_artifact(
        left=30, top=8, region_width=171, region_height=94, page_width=1000, page_height=800
    )
    assert is_page_edge_ocr_artifact(
        left=936, top=514, region_width=46, region_height=104, page_width=1000, page_height=800
    )
    assert is_page_edge_ocr_artifact(
        left=802, top=770, region_width=167, region_height=14, page_width=1000, page_height=800
    )
    assert not is_page_edge_ocr_artifact(
        left=936, top=514, region_width=46, region_height=104, page_width=1000, page_height=800, entity_type="SEAL"
    )
    assert not is_page_edge_ocr_artifact(
        left=30, top=8, region_width=171, region_height=94, page_width=1000, page_height=800, entity_type="SEAL"
    )


def test_expand_ocr_region_adds_type_aware_padding():
    left, top, width, height = VisionService._expand_ocr_region(
        left=500,
        top=200,
        region_width=80,
        region_height=20,
        page_width=1000,
        page_height=800,
        entity_type="PHONE",
    )

    assert left < 500
    assert top < 200
    assert left + width > 580
    assert top + height > 220


def test_ocr_has_region_filter_keeps_has_text_amount_outputs():
    assert VisionService._should_keep_ocr_has_region("AMOUNT", "13%")
    assert VisionService._should_keep_ocr_has_region("AMOUNT", "百分之六")
    assert VisionService._should_keep_ocr_has_region("AMOUNT", "￥1684000.00元")
    assert VisionService._should_keep_ocr_has_region("AMOUNT", "总计：1684000元")


def test_ocr_has_region_filter_keeps_has_text_date_outputs():
    assert VisionService._should_keep_ocr_has_region("DATE", "合同签订并生效后60天内完成供货")
    assert VisionService._should_keep_ocr_has_region("DATE", "2024年8月22日")
    assert VisionService._should_keep_ocr_has_region("DATE", "签订日期：8月22日")


def test_expand_ocr_region_uses_wider_padding_for_short_names():
    person_left, _top, person_width, _height = VisionService._expand_ocr_region(
        left=500,
        top=200,
        region_width=36,
        region_height=18,
        page_width=1000,
        page_height=800,
        entity_type="PERSON",
    )
    generic_left, _top, generic_width, _height = VisionService._expand_ocr_region(
        left=500,
        top=200,
        region_width=36,
        region_height=18,
        page_width=1000,
        page_height=800,
        entity_type="UNKNOWN",
    )

    assert person_left < generic_left
    assert person_width > generic_width


def test_expand_ocr_region_uses_wider_padding_for_long_accounts():
    account_left, _top, account_width, _height = VisionService._expand_ocr_region(
        left=250,
        top=200,
        region_width=180,
        region_height=18,
        page_width=1000,
        page_height=800,
        entity_type="BANK_ACCOUNT",
    )
    generic_left, _top, generic_width, _height = VisionService._expand_ocr_region(
        left=250,
        top=200,
        region_width=180,
        region_height=18,
        page_width=1000,
        page_height=800,
        entity_type="UNKNOWN",
    )

    assert account_left < generic_left
    assert account_width > generic_width


def test_expand_ocr_region_uses_wider_padding_for_organization_names():
    org_left, _top, org_width, _height = VisionService._expand_ocr_region(
        left=300,
        top=160,
        region_width=220,
        region_height=24,
        page_width=1000,
        page_height=800,
        entity_type="ORG",
    )
    generic_left, _top, generic_width, _height = VisionService._expand_ocr_region(
        left=300,
        top=160,
        region_width=220,
        region_height=24,
        page_width=1000,
        page_height=800,
        entity_type="UNKNOWN",
    )

    assert org_left < generic_left
    assert org_width > generic_width


def test_expand_normalized_visual_box_clamps_to_page_bounds():
    x, y, width, height = VisionService._expand_normalized_visual_box(
        0.99,
        0.01,
        0.05,
        0.1,
        pad_x=0.02,
        pad_y=0.02,
    )

    assert x == 0.97
    assert y == 0.0
    assert x + width == 1.0
    assert y + height == 0.13


def test_expand_fallback_seal_box_uses_restrained_padding_for_edge_seams():
    x, y, width, height = VisionService._expand_fallback_seal_box(
        0.982,
        0.35,
        0.012,
        0.18,
    )

    assert x == 0.978
    assert y == 0.347
    assert x + width == 0.998
    assert y + height == 0.533


def test_expand_fallback_seal_box_keeps_small_margin_for_full_stamps():
    x, y, width, height = VisionService._expand_fallback_seal_box(
        0.30,
        0.15,
        0.20,
        0.14,
    )

    assert x == 0.294
    assert y == 0.146
    assert round(width, 3) == 0.212
    assert round(height, 3) == 0.148


def test_refine_official_seal_box_tightens_to_red_ink():
    image = Image.new("RGB", (1000, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((410, 220, 560, 370), outline=(210, 20, 20), width=10)
    draw.polygon([(485, 265), (500, 295), (530, 300), (505, 318), (510, 350), (485, 330), (460, 350), (465, 318), (440, 300), (470, 295)], fill=(210, 20, 20))

    x, y, width, height = VisionService._refine_normalized_official_seal_box(
        image,
        0.30,
        0.10,
        0.35,
        0.45,
    )

    assert x > 0.35
    assert y > 0.20
    assert width < 0.25
    assert height < 0.30


def test_refine_official_seal_box_keeps_ambiguous_non_red_box():
    image = Image.new("RGB", (1000, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((420, 240, 560, 360), outline="black", width=4)

    assert VisionService._refine_normalized_official_seal_box(
        image,
        0.30,
        0.10,
        0.35,
        0.45,
    ) == (0.30, 0.10, 0.35, 0.45)


def test_official_seal_fill_uses_explicit_mask_rectangle():
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (240, 180), "white")
    draw = ImageDraw.Draw(image)
    draw.line((20, 90, 220, 90), fill="black", width=3)
    draw.ellipse((80, 50, 150, 120), outline=(220, 20, 20), width=6)
    bbox = _box(
        "seal",
        "official_seal",
        "has_image",
        x=0.2,
        y=0.2,
        width=0.6,
        height=0.6,
    )

    service._apply_box_effect(image, bbox, 240, 180, "fill", 75, "#000000")

    assert image.getpixel((115, 52)) == (0, 0, 0)
    assert image.getpixel((115, 90)) == (0, 0, 0)
    assert image.getpixel((30, 90)) == (0, 0, 0)


def test_official_seal_fill_uses_explicit_mask_not_paper_background():
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (160, 120), "white")
    draw = ImageDraw.Draw(image)
    draw.line((20, 60, 140, 60), fill="black", width=3)
    draw.ellipse((48, 28, 112, 92), outline=(245, 222, 222), width=8)
    draw.ellipse((54, 34, 106, 86), outline=(218, 35, 35), width=3)
    bbox = _box(
        "seal",
        "official_seal",
        "has_image",
        x=0.2,
        y=0.15,
        width=0.6,
        height=0.75,
    )

    service._apply_box_effect(image, bbox, 160, 120, "fill", 75, "#000000")

    assert image.getpixel((80, 28)) == (0, 0, 0)
    assert image.getpixel((80, 34)) == (0, 0, 0)
    assert image.getpixel((80, 60)) == (0, 0, 0)


def test_official_seal_mosaic_keeps_visible_replacement_not_white_erase():
    service = VisionService.__new__(VisionService)
    image = Image.new("RGB", (240, 180), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((78, 48, 152, 122), outline=(220, 20, 20), width=5)
    draw.line((88, 85, 142, 85), fill=(220, 20, 20), width=4)
    draw.line((115, 58, 115, 112), fill=(220, 20, 20), width=4)
    bbox = _box(
        "seal",
        "official_seal",
        "has_image",
        x=0.2,
        y=0.2,
        width=0.6,
        height=0.6,
    )

    service._apply_box_effect(image, bbox, 240, 180, "mosaic", 75, "#000000")

    redacted_roi = image.crop((48, 36, 192, 144))
    visible_replacement_pixels = sum(
        1 for r, g, b in redacted_roi.getdata() if g < 248 or b < 248 or r < 248
    )

    assert visible_replacement_pixels > 0
