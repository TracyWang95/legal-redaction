import asyncio
from types import SimpleNamespace

from PIL import Image

from app.services.hybrid_vision_service import (
    HybridVisionService,
    OCRTextBlock,
    SensitiveRegion,
    _needs_has_text_analysis,
)
from app.services.vision.ocr_pipeline import run_has_text_analysis


def _block(text: str) -> OCRTextBlock:
    return OCRTextBlock(
        text=text,
        polygon=[[0, 0], [160, 0], [160, 32], [0, 32]],
        confidence=0.98,
    )


def test_image_pipeline_runs_has_only_for_semantic_text_types() -> None:
    assert _needs_has_text_analysis(["PERSON"]) is True
    assert _needs_has_text_analysis(["ORG", "ADDRESS"]) is True
    assert _needs_has_text_analysis(["AMOUNT"]) is True
    assert _needs_has_text_analysis(["PHONE", "EMAIL"]) is True
    assert _needs_has_text_analysis(["TIME"]) is True
    assert _needs_has_text_analysis(["SEAL", "QR_CODE"]) is False


def test_detect_and_draw_uses_has_text_for_image_text_entities_without_rules() -> None:
    service = object.__new__(HybridVisionService)
    calls: list[str] = []

    def prepare_image(_image_bytes):
        image = Image.new("RGB", (200, 80), "white")
        return image, 200, 80

    def run_paddle_ocr(*_args, **_kwargs):
        return [_block("合同总金额：1684000元")], []

    async def run_has_text_analysis(_blocks, _types):
        calls.append("has")
        return [{"type": "AMOUNT", "text": "1684000元"}]

    def match_entities_to_ocr(_blocks, _entities):
        return [
            SensitiveRegion(
                text="1684000元",
                entity_type="AMOUNT",
                left=20,
                top=10,
                width=80,
                height=20,
                source="ocr_has",
            )
        ]

    service._prepare_image = prepare_image
    service._run_paddle_ocr = run_paddle_ocr
    service._expand_table_blocks = lambda blocks: blocks
    service._run_has_text_analysis = run_has_text_analysis
    service._match_entities_to_ocr = match_entities_to_ocr
    service._draw_regions_on_image = lambda image, _regions: image

    regions, image_base64 = asyncio.run(
        service.detect_and_draw(
            b"fake-image",
            [SimpleNamespace(id="AMOUNT", name="金额")],
        )
    )

    assert calls == ["has"]
    assert [(region.entity_type, region.text, region.source) for region in regions] == [
        ("AMOUNT", "1684000元", "ocr_has")
    ]
    assert image_base64


def test_detect_and_draw_can_skip_preview_rendering() -> None:
    service = object.__new__(HybridVisionService)
    draw_calls = 0

    def prepare_image(_image_bytes):
        image = Image.new("RGB", (200, 80), "white")
        return image, 200, 80

    def draw_regions_on_image(image, _regions):
        nonlocal draw_calls
        draw_calls += 1
        return image

    service._prepare_image = prepare_image
    service._run_paddle_ocr = lambda *_args, **_kwargs: ([], [])
    service._expand_table_blocks = lambda blocks: blocks
    service._run_has_text_analysis = lambda *_args, **_kwargs: []
    service._match_entities_to_ocr = lambda *_args, **_kwargs: []
    service._draw_regions_on_image = draw_regions_on_image

    regions, image_base64 = asyncio.run(
        service.detect_and_draw(
            b"fake-image",
            [SimpleNamespace(id="AMOUNT", name="閲戦")],
            draw_result=False,
        )
    )

    assert regions == []
    assert image_base64 is None
    assert draw_calls == 0


def test_detect_and_draw_exposes_has_text_wait_metadata() -> None:
    service = object.__new__(HybridVisionService)

    def prepare_image(_image_bytes):
        image = Image.new("RGB", (200, 80), "white")
        return image, 200, 80

    async def run_has_text_analysis(_blocks, _types, stage_status=None):
        stage_status["has_text_slot_wait_ms"] = 123
        stage_status["has_text_cache_status"] = "model_call"
        return [{"type": "PERSON", "text": "Alice"}]

    service._prepare_image = prepare_image
    service._run_paddle_ocr = lambda *_args, **_kwargs: ([_block("Contact Alice")], [])
    service._expand_table_blocks = lambda blocks: blocks
    service._run_has_text_analysis = run_has_text_analysis
    service._match_entities_to_ocr = lambda *_args, **_kwargs: []
    service._draw_regions_on_image = lambda image, _regions: image

    regions, image_base64 = asyncio.run(
        service.detect_and_draw(
            b"fake-image",
            [SimpleNamespace(id="PERSON", name="Person")],
            draw_result=False,
        )
    )

    assert regions == []
    assert image_base64 is None
    assert service.last_duration_ms["has_text_slot_wait_ms"] == 123
    assert service.last_duration_ms["has_text_cache_status"] == "model_call"
    assert "has_ner" in service.last_duration_ms


def test_has_text_prompt_canonicalizes_time_to_date() -> None:
    seen: dict[str, list[str]] = {}

    class HasClientStub:
        def is_available(self):
            return True

        def ner(self, _text, chinese_types):
            seen["types"] = chinese_types
            return {"日期": ["08:30"]}

    entities = asyncio.run(
        run_has_text_analysis(
            [_block("会议时间：08:30")],
            HasClientStub(),
            [SimpleNamespace(id="DATE", name="日期"), SimpleNamespace(id="TIME", name="时间")],
        )
    )

    assert seen["types"] == ["日期"]
    assert entities == [{"type": "DATE", "text": "08:30"}]
