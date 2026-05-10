# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio
import threading
import time
from types import SimpleNamespace

from PIL import Image, ImageDraw

from app.core.has_image_categories import HAS_IMAGE_MODEL_CLASS_COUNT, HAS_IMAGE_MODEL_SLUGS
from app.services.hybrid_vision_service import OCRTextBlock
from app.services.ocr_service import OCRItem
from app.services.vision.has_text_payload import (
    _build_has_text_content,
    _build_has_text_payload,
    _build_has_text_type_names,
    _filter_blocks_for_has_text,
)
from app.services.vision.ocr_pipeline import (
    _augment_amount_entities_from_ocr,
    clear_ocr_text_block_cache,
    extract_table_cells,
    match_entities_to_ocr,
    run_paddle_ocr,
    run_has_text_analysis,
)
from app.services.vision.seal_detector import (
    detect_dark_seal_regions,
    detect_red_seal_regions,
)


def _block(text: str, width: int = 1000, height: int = 100) -> OCRTextBlock:
    return OCRTextBlock(
        text=text,
        polygon=[[0, 0], [width, 0], [width, height], [0, height]],
        confidence=0.98,
    )


class _OCRServiceStub:
    base_url = "http://ocr-cache-test"

    def __init__(self) -> None:
        self.text_calls = 0

    def is_available(self) -> bool:
        return True

    def extract_text_boxes(self, _image_bytes: bytes) -> list[OCRItem]:
        self.text_calls += 1
        return [
            OCRItem(
                text="Party A: Example Co.",
                x=0.1,
                y=0.2,
                width=0.5,
                height=0.1,
                confidence=0.97,
            )
        ]


def test_ocr_entity_match_uses_sub_boxes_in_multifield_rows():
    block = _block("联系人：沈样涛 电话：13451775049\n公司：苏州市纳达信息服务有限公司")

    regions = match_entities_to_ocr(
        [block],
        [
            {"type": "PERSON", "text": "沈样涛"},
            {"type": "PHONE", "text": "13451775049"},
            {"type": "COMPANY", "text": "苏州市纳达信息服务有限公司"},
        ],
    )

    by_text = {region.text: region for region in regions}
    assert by_text["沈样涛"].width < block.width * 0.4
    assert by_text["13451775049"].width < block.width * 0.5
    assert by_text["苏州市纳达信息服务有限公司"].entity_type == "COMPANY_NAME"
    assert by_text["苏州市纳达信息服务有限公司"].top > by_text["沈样涛"].top
    assert by_text["沈样涛"].height <= block.height / 2


def test_ocr_entity_match_uses_percent_value_for_amount_phrase():
    block = _block("Payment term: contract amount 40% as advance payment.", width=700, height=36)

    regions = match_entities_to_ocr(
        [block],
        [{"type": "AMOUNT", "text": "contract amount 40%"}],
    )

    assert [(region.entity_type, region.text) for region in regions] == [("AMOUNT", "40%")]
    assert regions[0].left > block.width * 0.45
    assert regions[0].width < block.width * 0.12


def test_ocr_entity_match_keeps_rmb_uppercase_lowercase_pair_complete():
    block = OCRTextBlock(
        "人民币大写：壹佰陆拾捌万肆仟元整，小写：（￥1684000.00元）。",
        [[0, 0], [760, 0], [760, 42], [0, 42]],
        0.98,
    )

    regions = match_entities_to_ocr(
        [block],
        [{"type": "AMOUNT", "text": "（￥1684000.00元）"}],
    )

    assert [(region.entity_type, region.text) for region in regions] == [
        ("AMOUNT", "人民币大写：壹佰陆拾捌万肆仟元整，小写：（￥1684000.00元）")
    ]
    assert regions[0].left == 0
    assert regions[0].width > block.width * 0.7


def test_ocr_amount_supplement_dedupes_decimal_and_integer_variants():
    entities = [{"type": "AMOUNT", "text": "1431400.00 yuan"}]
    blocks = [_block("1431400")]

    augmented = _augment_amount_entities_from_ocr(entities, blocks, ["AMOUNT"])

    assert augmented == entities


def test_ocr_entity_match_trusts_has_text_pdf_labels():
    block = _block("甲方：苏州市纳达信息服务有限公司\n乙方：苏州市人工智能有限公司\n开户银行：中信银行股份有限公司苏州相城支行")

    regions = match_entities_to_ocr(
        [block],
        [
            {"type": "LEGAL_PARTY", "text": "甲方"},
            {"type": "LEGAL_PARTY", "text": "乙方"},
            {"type": "BANK_NAME", "text": "开户银行"},
            {"type": "BANK_NAME", "text": "中信银行股份有限公司苏州相城支行"},
        ],
    )

    assert {region.text for region in regions} == {"甲方", "乙方", "开户银行", "中信银行股份有限公司苏州相城支行"}
    assert regions[0].width < block.width


def test_ocr_entity_match_trusts_has_text_entities_without_shape_rules():
    blocks = [
        _block("印章编号：3205020923387"),
        _block("CPU：鲲鹏920x4，NPU：昇腾，RAID支持"),
        _block("imgs/img_in_seal_box_555_143_758_338.jpg"),
        _block("型号：SZAI-A300"),
        _block("统一社会信用代码：91320505MA7ABCDE12"),
        _block("扫描全能王 创建"),
        _block("编号 75020"),
        _block("项目周期：60天内"),
        _block("登录密码：A1b2C3d4"),
        _block("SN：DEVICE20260501"),
    ]

    regions = match_entities_to_ocr(
        blocks,
        [
            {"type": "DRIVER_LICENSE", "text": "3205020923387"},
            {"type": "DEVICE_ID", "text": "CPU：鲲鹏920x4"},
            {"type": "URL_WEBSITE", "text": "imgs/img_in_seal_box_555_143_758_338.jpg"},
            {"type": "VIN", "text": "SZAI-A300"},
            {"type": "COMPANY_CODE", "text": "3205020923387"},
            {"type": "COMPANY_CODE", "text": "91320505MA7ABCDE12"},
            {"type": "ORG", "text": "扫描全能王"},
            {"type": "CONTRACT_NO", "text": "75020"},
            {"type": "CONTRACT_NO", "text": "507129"},
            {"type": "DATE", "text": "60天内"},
            {"type": "DEVICE_ID", "text": "SZAI-A300"},
            {"type": "DEVICE_ID", "text": "SN：DEVICE20260501"},
            {"type": "USERNAME_PASSWORD", "text": "A1b2C3d4"},
            {"type": "ORG", "text": "人民法院"},
        ],
    )

    matched = {(region.entity_type, region.text) for region in regions}
    assert ("CREDIT_CODE", "91320505MA7ABCDE12") in matched
    assert ("DEVICE_ID", "SN：DEVICE20260501") in matched
    assert ("USERNAME_PASSWORD", "A1b2C3d4") in matched
    assert ("DATE", "60天内") in matched
    assert ("URL_WEBSITE", "imgs/img_in_seal_box_555_143_758_338.jpg") in matched


def test_ocr_entity_match_keeps_has_text_type_without_context_rewrite():
    blocks = [
        _block("数字账号：0052283506044428"),
        _block("编号：1234567890123456"),
    ]

    regions = match_entities_to_ocr(
        blocks,
        [
            {"type": "DEVICE_ID", "text": "0052283506044428"},
            {"type": "DEVICE_ID", "text": "1234567890123456"},
        ],
    )

    assert [(region.entity_type, region.text) for region in regions] == [
        ("DEVICE_ID", "0052283506044428"),
        ("DEVICE_ID", "1234567890123456"),
    ]


def test_ocr_entity_match_keeps_time_distinct_from_date():
    block = _block("会议时间：08:30")

    regions = match_entities_to_ocr(
        [block],
        [{"type": "TIME", "text": "08:30"}],
    )

    assert [(region.entity_type, region.text) for region in regions] == [("TIME", "08:30")]


def test_ocr_entity_match_preserves_requested_datetime_tag():
    block = _block("机构：Example Lab\n日期时间：2026-05-06 08:30")

    regions = match_entities_to_ocr(
        [block],
        [
            {"type": "机构", "text": "Example Lab"},
            {"type": "日期时间", "text": "2026-05-06 08:30"},
        ],
    )

    assert [(region.entity_type, region.text) for region in regions] == [
        ("ORG", "Example Lab"),
        ("日期时间", "2026-05-06 08:30"),
    ]


def test_ocr_entity_match_canonicalizes_company_and_company_code():
    blocks = [
        _block("Example Technology Co., Ltd."),
        _block("91320505MA7ABCDE12"),
    ]

    regions = match_entities_to_ocr(
        blocks,
        [
            {"type": "COMPANY", "text": "Example Technology Co., Ltd."},
            {"type": "COMPANY_CODE", "text": "91320505MA7ABCDE12"},
        ],
    )

    assert [(region.entity_type, region.text) for region in regions] == [
        ("COMPANY_NAME", "Example Technology Co., Ltd."),
        ("CREDIT_CODE", "91320505MA7ABCDE12"),
    ]


def test_has_text_filter_keeps_all_ocr_text_for_has_semantics():
    blocks = [
        _block("根据《中华人民共和国民法典》等有关法律法规，双方遵循平等、自愿、公平和诚实信用原则。"),
        _block("甲方联系人：沈样涛 电话：13451775049"),
        _block("地址：苏州工业园区金鸡湖大道99号"),
        _block("苏州市人工智能有限公司"),
    ]

    filtered = _filter_blocks_for_has_text(blocks, ["PERSON", "ORG", "ADDRESS"])

    assert filtered == blocks


def test_has_text_content_dedupes_repeated_ocr_blocks_without_regex():
    blocks = [
        _block("Party A: Example Co."),
        _block(" Party A: Example Co. "),
        _block("Address: 1 Road"),
    ]

    texts, content = _build_has_text_content(blocks, max_chars=10_000)

    assert texts == ["Party A: Example Co.", "Address: 1 Road"]
    assert content == "Party A: Example Co.\nAddress: 1 Road"


def test_has_text_content_dedupes_contained_ocr_blocks_without_regex():
    blocks = [
        _block("Example Co."),
        _block("Party A: Example Co. Address: 1 Road"),
        _block("Address: 1 Road"),
        _block("Invoice total"),
    ]

    payload = _build_has_text_payload(blocks, max_chars=10_000)

    assert payload.texts == ["Party A: Example Co. Address: 1 Road", "Invoice total"]
    assert payload.content == "Party A: Example Co. Address: 1 Road\nInvoice total"
    assert payload.eligible_block_count == 4
    assert payload.duplicate_block_count == 2


def test_has_text_content_splits_multiline_aggregate_blocks_before_dedupe():
    blocks = [
        _block("Party A: Example Co.\nAddress: 1 Road\nParty A: Example Co."),
        _block("Address: 1 Road"),
    ]

    payload = _build_has_text_payload(blocks, max_chars=10_000)

    assert payload.texts == ["Party A: Example Co.", "Address: 1 Road"]
    assert payload.content == "Party A: Example Co.\nAddress: 1 Road"
    assert payload.eligible_block_count == 4
    assert payload.duplicate_block_count == 2


def test_has_text_content_caps_request_length():
    blocks = [_block("abcdefghij"), _block("klmnopqrst")]

    texts, content = _build_has_text_content(blocks, max_chars=15)

    assert texts == ["abcdefghij", "klmn"]
    assert content == "abcdefghij\nklmn"


def test_has_text_payload_reports_dedup_and_truncation_stats():
    blocks = [
        _block("abcdefghij"),
        _block(" abcdefghij "),
        _block("klmnopqrst"),
    ]

    payload = _build_has_text_payload(blocks, max_chars=15)

    assert payload.texts == ["abcdefghij", "klmn"]
    assert payload.content == "abcdefghij\nklmn"
    assert payload.source_block_count == 3
    assert payload.eligible_block_count == 3
    assert payload.duplicate_block_count == 1
    assert payload.input_chars == 30
    assert payload.emitted_chars == 15
    assert payload.truncated is True


def test_has_text_payload_caps_single_coarse_blocks_without_regex():
    blocks = [
        _block("a" * 20),
        _block("tail"),
    ]

    payload = _build_has_text_payload(blocks, max_chars=100, max_block_chars=8)

    assert payload.texts == ["a" * 8, "tail"]
    assert payload.content == f"{'a' * 8}\ntail"
    assert payload.clipped_block_count == 1
    assert payload.input_chars == 24
    assert payload.omitted_chars == 12
    assert payload.truncated is False


def test_has_text_type_names_are_stable_deduped_and_canonical_without_expansion():
    types = [
        SimpleNamespace(id="COMPANY", name="Company"),
        SimpleNamespace(id="ORG", name="Organization"),
        SimpleNamespace(id="INSTITUTION_NAME", name="Institution"),
        SimpleNamespace(id="DATE_TIME", name="Date time"),
        SimpleNamespace(id="TIMESTAMP", name="Timestamp"),
        SimpleNamespace(id="SEAL", name="Seal"),
        SimpleNamespace(id="CUSTOM_RISK", name="Custom risk"),
    ]

    assert _build_has_text_type_names(types) == ["公司名称", "组织机构", "机构名称", "日期", "Custom risk"]


def test_has_text_type_names_do_not_change_has_image_model_contract():
    assert HAS_IMAGE_MODEL_CLASS_COUNT == 21
    before = set(HAS_IMAGE_MODEL_SLUGS)

    names = _build_has_text_type_names([
        SimpleNamespace(id="COMPANY", name="Company"),
        SimpleNamespace(id="DATE_TIME", name="Date time"),
        SimpleNamespace(id="SEAL", name="Seal"),
    ])

    assert names == ["公司名称", "日期"]
    assert HAS_IMAGE_MODEL_CLASS_COUNT == 21
    assert HAS_IMAGE_MODEL_SLUGS == before


def test_has_text_analysis_can_skip_short_ocr_text_without_calling_has(monkeypatch):
    monkeypatch.setattr(
        "app.services.vision.ocr_pipeline.settings.HAS_VISION_MIN_TEXT_CHARS_FOR_NER",
        5,
    )

    class HasClientStub:
        def is_available(self):
            return True

        def ner(self, _text, _types):
            raise AssertionError("HaS should not be called for short OCR text")

    entities = asyncio.run(
        run_has_text_analysis(
            [_block("abc")],
            HasClientStub(),
            [SimpleNamespace(id="PERSON", name="浜哄悕")],
        )
    )

    assert entities == []


def test_has_text_analysis_calls_ner_without_health_preflight():
    seen: dict[str, object] = {}

    class HasClientStub:
        def is_available(self):
            raise AssertionError("vision HaS path should not preflight /models")

        def ner(self, text, chinese_types):
            seen["text"] = text
            seen["types"] = chinese_types
            return {"PERSON": ["Alice"]}

    status = {}
    entities = asyncio.run(
        run_has_text_analysis(
            [_block("Contact Alice")],
            HasClientStub(),
            [SimpleNamespace(id="PERSON", name="Person")],
            stage_status=status,
        )
    )

    assert seen["text"] == "Contact Alice"
    assert entities == [{"type": "PERSON", "text": "Alice"}]
    assert status["has_text_cache_status"] == "model_call"
    assert status["has_text_model_ms"] >= 0
    assert status["has_text_entity_count"] == 1


def test_has_text_analysis_honors_recent_negative_health_without_probe():
    class HasClientStub:
        _health_checked_at = time.monotonic()
        _health_ready = False

        def is_available(self):
            raise AssertionError("recent negative health should be read from cached state")

        def ner(self, _text, _types):
            raise AssertionError("HaS should not be called after recent negative health")

    status = {}
    entities = asyncio.run(
        run_has_text_analysis(
            [_block("Contact Alice")],
            HasClientStub(),
            [SimpleNamespace(id="PERSON", name="Person")],
            stage_status=status,
        )
    )

    assert entities == []


def test_has_text_analysis_serializes_concurrent_local_ner_calls():
    active = 0
    max_active = 0
    guard = threading.Lock()

    class HasClientStub:
        def ner(self, text, _types):
            nonlocal active, max_active
            with guard:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.02)
            with guard:
                active -= 1
            return {"PERSON": [text.split()[-1]]}

    async def run_two_pages():
        return await asyncio.gather(
            run_has_text_analysis(
                [_block("Contact Alice")],
                HasClientStub(),
                [SimpleNamespace(id="PERSON", name="Person")],
            ),
            run_has_text_analysis(
                [_block("Contact Bob")],
                HasClientStub(),
                [SimpleNamespace(id="PERSON", name="Person")],
            ),
        )

    results = asyncio.run(run_two_pages())

    assert max_active == 1
    assert results == [
        [{"type": "PERSON", "text": "Alice"}],
        [{"type": "PERSON", "text": "Bob"}],
    ]


def test_has_text_analysis_uses_cached_ner_before_local_slot_wait():
    seen: dict[str, object] = {}

    class HasClientStub:
        def get_cached_ner(self, text, chinese_types):
            seen["text"] = text
            seen["types"] = chinese_types
            return {"姓名": ["Alice"]}

        def ner(self, _text, _types):
            raise AssertionError("cached HaS NER should not call the model")

    status = {}
    entities = asyncio.run(
        run_has_text_analysis(
            [_block("Contact Alice")],
            HasClientStub(),
            [SimpleNamespace(id="PERSON", name="Person")],
            stage_status=status,
        )
    )

    assert seen["text"] == "Contact Alice"
    assert seen["types"] == ["姓名"]
    assert entities == [{"type": "PERSON", "text": "Alice"}]
    assert status["has_text_cache_status"] == "hit_before_slot"
    assert status["has_text_slot_wait_ms"] == 0
    assert status["has_text_model_ms"] == 0
    assert status["has_text_entity_count"] == 1
    assert status["has_text_unique_blocks"] == 1


def test_has_text_analysis_supplements_table_amount_digits_from_ocr():
    class HasClientStub:
        def ner(self, _text, _types):
            return {"AMOUNT": ["1684000 yuan"]}

    blocks = [
        _block("item"),
        _block("715700"),
        _block("1431400"),
        _block("252600"),
        _block("total 1684000 yuan"),
        _block("3205020923387"),
        _block("2"),
        _block("480GBSSD"),
    ]

    entities = asyncio.run(
        run_has_text_analysis(
            blocks,
            HasClientStub(),
            [SimpleNamespace(id="AMOUNT", name="Amount")],
        )
    )

    amount_texts = [entity["text"] for entity in entities if entity["type"] == "AMOUNT"]
    assert amount_texts == ["1684000 yuan", "715700", "1431400", "252600"]

    regions = match_entities_to_ocr(blocks, entities)
    matched_amounts = {region.text for region in regions if region.entity_type == "AMOUNT"}
    assert {"715700", "1431400", "252600", "1684000 yuan"} <= matched_amounts
    assert "3205020923387" not in matched_amounts
    assert "2" not in matched_amounts
    assert "480GBSSD" not in matched_amounts


def test_has_text_analysis_dedupes_concurrent_duplicate_ner_before_slot():
    active = 0
    max_active = 0
    calls = []
    guard = threading.Lock()

    class HasClientStub:
        def get_cached_ner(self, _text, _types):
            return None

        def ner(self, text, _types):
            nonlocal active, max_active
            with guard:
                active += 1
                max_active = max(max_active, active)
                calls.append(text)
            time.sleep(0.03)
            with guard:
                active -= 1
            return {"PERSON": [text.split()[-1]]}

    client = HasClientStub()
    statuses = [{}, {}, {}]

    async def run_pages():
        return await asyncio.gather(
            run_has_text_analysis(
                [_block("Contact Alice")],
                client,
                [SimpleNamespace(id="PERSON", name="Person")],
                stage_status=statuses[0],
            ),
            run_has_text_analysis(
                [_block("Contact Alice")],
                client,
                [SimpleNamespace(id="PERSON", name="Person")],
                stage_status=statuses[1],
            ),
            run_has_text_analysis(
                [_block("Contact Bob")],
                client,
                [SimpleNamespace(id="PERSON", name="Person")],
                stage_status=statuses[2],
            ),
        )

    results = asyncio.run(run_pages())

    assert max_active == 1
    assert calls.count("Contact Alice") == 1
    assert calls.count("Contact Bob") == 1
    assert sorted(status["has_text_cache_status"] for status in statuses) == [
        "model_call",
        "model_call",
        "shared_inflight",
    ]
    assert sum(1 for status in statuses if status["has_text_duplicate_wait_ms"] > 0) == 1
    assert sum(1 for status in statuses if status["has_text_model_ms"] > 0) == 2
    assert results == [
        [{"type": "PERSON", "text": "Alice"}],
        [{"type": "PERSON", "text": "Alice"}],
        [{"type": "PERSON", "text": "Bob"}],
    ]


def test_has_text_analysis_dedupes_duplicate_ner_across_client_instances_before_slot():
    calls = []
    guard = threading.Lock()

    class HasClientStub:
        base_url = "http://has-text-dedupe-test"

        def get_cached_ner(self, _text, _types):
            return None

        def ner(self, text, _types):
            with guard:
                calls.append(text)
            time.sleep(0.03)
            return {"PERSON": [text.split()[-1]]}

    async def run_pages():
        return await asyncio.gather(
            run_has_text_analysis(
                [_block("Contact Alice")],
                HasClientStub(),
                [SimpleNamespace(id="PERSON", name="Person")],
            ),
            run_has_text_analysis(
                [_block("Contact Alice")],
                HasClientStub(),
                [SimpleNamespace(id="PERSON", name="Person")],
            ),
        )

    results = asyncio.run(run_pages())

    assert calls == ["Contact Alice"]
    assert results == [
        [{"type": "PERSON", "text": "Alice"}],
        [{"type": "PERSON", "text": "Alice"}],
    ]


def test_has_text_analysis_uses_selected_schema_without_result_expansion():
    seen: dict[str, list[str]] = {}

    class HasClientStub:
        def is_available(self):
            return True

        def ner(self, _text, chinese_types):
            seen["types"] = chinese_types
            return {
                "公司名称": ["Example Co."],
                "组织机构": ["Example Lab"],
                "日期": ["2026-05-06 08:30"],
            }

    entities = asyncio.run(
        run_has_text_analysis(
            [_block("Example Co. Example Lab 2026-05-06 08:30")],
            HasClientStub(),
            [
                SimpleNamespace(id="COMPANY", name="公司"),
                SimpleNamespace(id="ORG", name="组织"),
                SimpleNamespace(id="DATE_TIME", name="日期时间"),
            ],
        )
    )

    assert seen["types"] == ["公司名称", "组织机构", "日期"]
    assert entities == [
        {"type": "COMPANY_NAME", "text": "Example Co."},
        {"type": "ORG", "text": "Example Lab"},
        {"type": "DATE", "text": "2026-05-06 08:30"},
    ]


def test_ocr_text_block_cache_reuses_same_image_across_type_configs(monkeypatch):
    clear_ocr_text_block_cache()
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", False)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_TEXT_BLOCK_CACHE_TTL_SEC", 300.0)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_TEXT_BLOCK_CACHE_MAX_ITEMS", 16)

    image = Image.new("RGB", (200, 100), "white")
    service = _OCRServiceStub()
    first_status = {}
    second_status = {}

    first_blocks, first_visual = run_paddle_ocr(
        image,
        service,
        selected_entity_types=["PERSON"],
        stage_status=first_status,
    )
    second_blocks, second_visual = run_paddle_ocr(
        image,
        service,
        selected_entity_types=["AMOUNT"],
        stage_status=second_status,
    )

    assert service.text_calls == 1
    assert first_status["ocr_vl_cache_status"] == "miss"
    assert second_status["ocr_vl_cache_status"] == "hit"
    assert first_status["ocr_cache_misses"] == 1
    assert second_status["ocr_cache_hits"] == 1
    assert [block.text for block in first_blocks] == ["Party A: Example Co."]
    assert [block.text for block in second_blocks] == ["Party A: Example Co."]
    assert first_visual == []
    assert second_visual == []
    assert first_blocks[0] is not second_blocks[0]
    clear_ocr_text_block_cache()


def test_ocr_text_block_singleflight_shares_concurrent_cache_miss(monkeypatch):
    clear_ocr_text_block_cache()
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", False)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_TEXT_BLOCK_CACHE_TTL_SEC", 300.0)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_TEXT_BLOCK_CACHE_MAX_ITEMS", 16)

    class SlowOCRService(_OCRServiceStub):
        def extract_text_boxes(self, image_bytes: bytes) -> list[OCRItem]:
            self.text_calls += 1
            time.sleep(0.05)
            return [
                OCRItem(
                    text="Party A: Example Co.",
                    x=0.1,
                    y=0.2,
                    width=0.5,
                    height=0.1,
                    confidence=0.97,
                )
            ]

    service = SlowOCRService()
    image = Image.new("RGB", (200, 100), "white")
    statuses = [{}, {}]
    results: list[tuple[list[OCRTextBlock], list]] = []

    def worker(index: int) -> None:
        results.append(run_paddle_ocr(image, service, stage_status=statuses[index]))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=3)

    assert len(results) == 2
    assert service.text_calls == 1
    assert all([block.text for block in blocks] == ["Party A: Example Co."] for blocks, _ in results)
    assert sorted(status.get("ocr_vl_cache_status") for status in statuses) == ["miss", "shared_inflight"]
    clear_ocr_text_block_cache()


def test_paddle_ocr_skips_effectively_blank_page_before_service_probe():
    class ShouldNotProbeService:
        def is_available(self):
            raise AssertionError("blank pages should not probe OCR service health")

        def extract_text_boxes(self, _image_bytes: bytes):
            raise AssertionError("blank pages should not call OCR inference")

    status = {}
    blocks, visual_regions = run_paddle_ocr(
        Image.new("RGB", (1000, 1400), "white"),
        ShouldNotProbeService(),
        stage_status=status,
    )

    assert blocks == []
    assert visual_regions == []
    assert status["ocr_blank_page_skipped"] is True
    assert status["ocr_blank_dark_ratio"] == 0.0
    assert status["ocr_blank_ink_ratio"] == 0.0


def test_paddle_ocr_blank_page_guard_preserves_small_text_pages(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", False)

    image = Image.new("RGB", (1000, 1400), "white")
    draw = ImageDraw.Draw(image)
    draw.text((80, 120), "Name: Alice", fill=(0, 0, 0))
    service = _OCRServiceStub()

    blocks, visual_regions = run_paddle_ocr(image, service, stage_status={})

    assert service.text_calls == 1
    assert [block.text for block in blocks] == ["Party A: Example Co."]
    assert visual_regions == []


def test_ocr_text_block_cache_is_scoped_to_image_bytes_and_config(monkeypatch):
    clear_ocr_text_block_cache()
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", False)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_TEXT_BLOCK_CACHE_TTL_SEC", 300.0)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_TEXT_BLOCK_CACHE_MAX_ITEMS", 16)

    service = _OCRServiceStub()
    image = Image.new("RGB", (200, 100), "white")
    other_image = Image.new("RGB", (201, 100), "white")

    run_paddle_ocr(image, service, selected_entity_types=["PERSON"], stage_status={})
    hit_status = {}
    run_paddle_ocr(image, service, selected_entity_types=["PHONE"], stage_status=hit_status)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_MAX_NEW_TOKENS", 1536)
    config_status = {}
    run_paddle_ocr(image, service, selected_entity_types=["PHONE"], stage_status=config_status)
    image_status = {}
    run_paddle_ocr(other_image, service, selected_entity_types=["PHONE"], stage_status=image_status)

    assert service.text_calls == 3
    assert hit_status["ocr_vl_cache_status"] == "hit"
    assert config_status["ocr_vl_cache_status"] == "miss"
    assert image_status["ocr_vl_cache_status"] == "miss"
    clear_ocr_text_block_cache()


def test_paddle_ocr_reuses_encoded_image_between_structure_and_vl(monkeypatch):
    clear_ocr_text_block_cache()
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY_MIN_BOXES", 2)

    class SparseStructureService:
        base_url = "http://ocr-encode-reuse-test"

        def __init__(self) -> None:
            self.structure_calls = 0
            self.text_calls = 0

        def is_available(self) -> bool:
            return True

        def extract_structure_boxes(self, _image_bytes: bytes) -> list[OCRItem]:
            self.structure_calls += 1
            return [
                OCRItem(
                    text="sparse structure",
                    x=0.1,
                    y=0.1,
                    width=0.4,
                    height=0.1,
                    confidence=0.9,
                    label="text",
                )
            ]

        def extract_text_boxes(self, _image_bytes: bytes) -> list[OCRItem]:
            self.text_calls += 1
            return [
                OCRItem(
                    text="vl fallback",
                    x=0.2,
                    y=0.2,
                    width=0.3,
                    height=0.1,
                    confidence=0.9,
                    label="text",
                )
            ]

    from app.services.vision import ocr_pipeline

    encode_calls = 0
    original_encode = ocr_pipeline._image_png_bytes

    def counting_encode(image):
        nonlocal encode_calls
        encode_calls += 1
        return original_encode(image)

    monkeypatch.setattr(ocr_pipeline, "_image_png_bytes", counting_encode)
    service = SparseStructureService()

    blocks, visual_regions = run_paddle_ocr(Image.new("RGB", (200, 100), "white"), service)

    assert [block.text for block in blocks] == ["vl fallback"]
    assert visual_regions == []
    assert service.structure_calls == 1
    assert service.text_calls == 1
    assert encode_calls == 1
    clear_ocr_text_block_cache()


def test_property_match_extends_common_document_title_suffix():
    block = OCRTextBlock(
        "信创AI一体机采购合同",
        [[0, 0], [220, 0], [220, 24], [0, 24]],
        0.98,
    )

    regions = match_entities_to_ocr(
        [block],
        [{"type": "PROPERTY", "text": "信创AI一体机采购"}],
    )

    assert len(regions) == 1
    assert regions[0].text == "信创AI一体机采购合同"
    assert regions[0].left + regions[0].width >= 210


def test_red_seal_fallback_detects_full_and_edge_stamps():
    image = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse([520, 120, 690, 290], outline=(220, 0, 0), width=8)
    draw.text((570, 190), "公章", fill=(220, 0, 0))
    draw.arc([765, 430, 845, 590], start=95, end=265, fill=(220, 0, 0), width=8)

    regions = detect_red_seal_regions(image)

    assert len(regions) >= 2
    assert any(region.x > 0.6 and region.width > 0.1 for region in regions)
    assert any(region.x + region.width > 0.96 for region in regions)


def test_red_seal_fallback_splits_stacked_overlapping_stamps():
    image = Image.new("RGB", (800, 1100), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse([270, 70, 510, 310], outline=(220, 0, 0), width=10)
    draw.polygon(
        [
            (390, 150),
            (410, 195),
            (455, 200),
            (420, 225),
            (430, 270),
            (390, 245),
            (350, 270),
            (360, 225),
            (325, 200),
            (370, 195),
        ],
        fill=(220, 0, 0),
    )
    draw.ellipse([265, 285, 515, 535], outline=(220, 0, 0), width=10)
    draw.polygon(
        [
            (390, 370),
            (412, 418),
            (462, 425),
            (422, 452),
            (432, 500),
            (390, 472),
            (348, 500),
            (358, 452),
            (318, 425),
            (368, 418),
        ],
        fill=(220, 0, 0),
    )

    regions = detect_red_seal_regions(image)
    central = [region for region in regions if 0.25 < region.x < 0.50 and region.width > 0.16]

    assert len(central) >= 2
    assert all(region.width * region.height < 0.055 for region in central)


def test_red_seal_fallback_does_not_merge_adjacent_stamps_into_oversized_box():
    image = Image.new("RGB", (900, 600), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse([250, 210, 370, 330], outline=(220, 0, 0), width=8)
    draw.polygon(
        [
            (310, 240),
            (320, 265),
            (345, 268),
            (325, 283),
            (330, 310),
            (310, 295),
            (290, 310),
            (295, 283),
            (275, 268),
            (300, 265),
        ],
        fill=(220, 0, 0),
    )
    draw.ellipse([384, 210, 504, 330], outline=(220, 0, 0), width=8)
    draw.polygon(
        [
            (444, 240),
            (454, 265),
            (479, 268),
            (459, 283),
            (464, 310),
            (444, 295),
            (424, 310),
            (429, 283),
            (409, 268),
            (434, 265),
        ],
        fill=(220, 0, 0),
    )

    regions = detect_red_seal_regions(image)
    central = [region for region in regions if 0.20 < region.x < 0.60 and 0.30 < region.y < 0.40]

    assert len(central) >= 2
    assert all(region.width < 0.18 for region in central)
    assert not any(region.width > 0.24 for region in central)


def test_dark_seal_fallback_detects_copied_full_and_edge_stamps():
    image = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse([150, 250, 330, 430], outline=(35, 35, 35), width=8)
    draw.text((195, 320), "集团公司", fill=(35, 35, 35))
    draw.arc([720, 700, 880, 880], start=95, end=270, fill=(35, 35, 35), width=8)
    draw.line([430, 520, 620, 610], fill=(35, 35, 35), width=10)

    regions = detect_dark_seal_regions(image)

    assert len(regions) >= 2
    assert any(0.15 < region.x < 0.35 and region.width > 0.12 for region in regions)
    assert any(region.x + region.width > 0.94 for region in regions)
    assert all(region.width / region.height < 2.35 for region in regions if region.x + region.width < 0.94)


def test_red_seal_fallback_detects_narrow_edge_seam_stamp():
    image = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(image)
    draw.arc([792, 300, 980, 560], start=100, end=260, fill=(220, 0, 0), width=8)
    draw.arc([794, 330, 930, 530], start=105, end=255, fill=(220, 0, 0), width=5)

    regions = detect_red_seal_regions(image)

    edge_regions = [region for region in regions if region.x + region.width > 0.985 and region.height > 0.10]
    assert edge_regions
    assert all(region.width < 0.08 for region in edge_regions)


def test_dark_seal_fallback_detects_narrow_edge_seam_stamp():
    image = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(image)
    draw.arc([790, 300, 980, 570], start=100, end=260, fill=(45, 45, 45), width=9)
    draw.arc([792, 335, 930, 535], start=105, end=255, fill=(45, 45, 45), width=6)

    regions = detect_dark_seal_regions(image)

    assert any(region.x + region.width > 0.985 and region.height > 0.10 for region in regions)


def test_seal_fallback_ignores_straight_edge_lines():
    red_image = Image.new("RGB", (800, 1000), "white")
    red_draw = ImageDraw.Draw(red_image)
    red_draw.line([796, 220, 796, 760], fill=(220, 0, 0), width=8)

    dark_image = Image.new("RGB", (800, 1000), "white")
    dark_draw = ImageDraw.Draw(dark_image)
    dark_draw.line([796, 220, 796, 760], fill=(45, 45, 45), width=9)

    assert detect_red_seal_regions(red_image) == []
    assert detect_dark_seal_regions(dark_image) == []


def test_dark_seal_fallback_ignores_bottom_scan_line():
    image = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(image)
    draw.line([20, 940, 180, 945], fill=(45, 45, 45), width=10)

    assert detect_dark_seal_regions(image) == []


def test_dark_seal_fallback_avoids_whole_text_block_for_copied_seal():
    image = Image.new("RGB", (804, 1152), "white")
    draw = ImageDraw.Draw(image)
    draw.text((84, 258), "Account: 0383 2700 0400 3104 0", fill=(35, 35, 35))
    draw.text((86, 330), "Party A", fill=(35, 35, 35))
    draw.text((86, 380), "Shanghai Example Company", fill=(35, 35, 35))
    draw.ellipse([170, 275, 325, 430], outline=(35, 35, 35), width=7)
    draw.arc([188, 292, 307, 412], start=15, end=330, fill=(35, 35, 35), width=4)
    draw.text((212, 342), "SEAL", fill=(35, 35, 35))

    regions = detect_dark_seal_regions(image)

    assert regions
    assert all(region.width * region.height <= 0.05 for region in regions)


def test_extract_table_cells_preserves_rowspan_occupied_columns():
    block = OCRTextBlock(
        text="",
        polygon=[[100, 200], [500, 200], [500, 500], [100, 500]],
        confidence=1,
    )
    html_table = (
        "<table>"
        "<tr><th rowspan='2'>设备</th><th>单价</th><th>合价</th></tr>"
        "<tr><td>715700</td><td>1431400</td></tr>"
        "<tr><td colspan='2'>合计</td><td>1684000</td></tr>"
        "</table>"
    )

    cells = extract_table_cells(html_table, block)
    by_text = {cell.text: cell for cell in cells}

    assert by_text["设备"].left == 100
    assert by_text["设备"].top == 200
    assert by_text["设备"].width == 133
    assert by_text["设备"].height == 200
    assert by_text["715700"].left == 233
    assert by_text["1431400"].left == 366
    assert by_text["715700"].top == by_text["1431400"].top == 300
    assert by_text["合计"].left == 100
    assert by_text["合计"].width == 266
    assert by_text["1684000"].left == 366


def test_ocr_entity_match_dedupes_same_text_overlapping_regions():
    block = _block("联系人：沈样涛 电话：13451775049")

    regions = match_entities_to_ocr(
        [block],
        [
            {"type": "PERSON", "text": "沈样涛"},
            {"type": "LEGAL_PARTY", "text": "沈样涛"},
        ],
    )

    assert [(region.entity_type, region.text) for region in regions] == [("PERSON", "沈样涛")]


def test_ocr_entity_match_covers_repeated_entities_across_blocks():
    blocks = [
        OCRTextBlock("甲方：苏州市纳达信息服务有限公司", [[0, 0], [360, 0], [360, 30], [0, 30]], 0.98),
        OCRTextBlock("乙方负责向苏州市纳达信息服务有限公司交付材料", [[0, 80], [520, 80], [520, 110], [0, 110]], 0.98),
        OCRTextBlock("服务单位：苏州市纳达信息服务有限公司", [[0, 160], [420, 160], [420, 190], [0, 190]], 0.98),
    ]

    regions = match_entities_to_ocr(
        blocks,
        [{"type": "ORG", "text": "苏州市纳达信息服务有限公司"}],
    )

    assert len(regions) == 3
    assert {region.top for region in regions} == {0, 80, 160}


def test_ocr_entity_match_table_fallback_scans_later_blocks():
    blocks = [
        OCRTextBlock("<table>合同编号：HT-2026-001", [[0, 0], [300, 0], [300, 40], [0, 40]], 0.98),
        OCRTextBlock(
            "<table>账号：1234567890123456789",
            [[0, 80], [360, 80], [360, 120], [0, 120]],
            0.98,
        ),
    ]

    regions = match_entities_to_ocr(
        blocks,
        [{"type": "BANK_ACCOUNT", "text": "1234567890123456789"}],
    )

    assert [(region.entity_type, region.text, region.source, region.top) for region in regions] == [
        ("BANK_ACCOUNT", "1234567890123456789", "table_fallback", 80)
    ]


def test_ocr_entity_match_covers_repeated_entities_in_same_block():
    block = OCRTextBlock(
        "项目名称：信创AI一体机采购；乙方负责信创AI一体机采购的实施。",
        [[0, 0], [720, 0], [720, 40], [0, 40]],
        0.98,
    )

    regions = match_entities_to_ocr(
        [block],
        [{"type": "PROPERTY", "text": "信创AI一体机采购"}],
    )

    assert len(regions) == 2
    assert regions[0].left < regions[1].left


def test_ocr_entity_match_caps_tall_paragraph_blocks_to_line_height():
    normal = OCRTextBlock(
        text="甲方联系人：沈样涛 电话：13451775049",
        polygon=[[0, 0], [540, 0], [540, 30], [0, 30]],
        confidence=0.98,
    )
    tall = OCRTextBlock(
        text="人民币大写：壹佰陆拾捌万肆仟元整，小写：（￥1684000.00元）。其中，设备费用￥1431400.00元，增值税税率为13%；集成服务费用￥252600.00元，增值税税率为6%。",
        polygon=[[0, 80], [940, 80], [940, 170], [0, 170]],
        confidence=0.98,
    )

    regions = match_entities_to_ocr(
        [normal, tall],
        [
            {"type": "AMOUNT", "text": "￥1431400.00元"},
            {"type": "AMOUNT", "text": "￥252600.00元"},
        ],
    )

    assert len(regions) == 2
    assert all(region.height <= 36 for region in regions)
    assert all(region.width < tall.width * 0.25 for region in regions)
    by_text = {region.text: region for region in regions}
    assert by_text["￥1431400.00元"].top > tall.top
    assert by_text["￥1431400.00元"].left < tall.width * 0.35
    assert by_text["￥252600.00元"].left > by_text["￥1431400.00元"].left


class _StructureFallbackOcrService:
    def is_available(self) -> bool:
        return True

    def extract_text_boxes(self, image_bytes):
        return [
            OCRItem(
                text="合同清单",
                x=0.1,
                y=0.1,
                width=0.2,
                height=0.05,
                confidence=0.9,
                label="text",
            )
        ]

    def extract_structure_boxes(self, image_bytes):
        return [
            OCRItem(
                text="迅骁一体机",
                x=0.2,
                y=0.3,
                width=0.15,
                height=0.04,
                confidence=0.95,
                label="table_cell",
            ),
            OCRItem(
                text="1431400",
                x=0.8,
                y=0.3,
                width=0.08,
                height=0.04,
                confidence=0.95,
                label="table_cell",
            ),
        ]


class _SparsePrimaryTableFallbackNoCacheService:
    base_url = "http://ocr-structure-reuse-test"

    def __init__(self) -> None:
        self.available_calls = 0
        self.text_calls = 0
        self.structure_calls = 0

    def is_available(self) -> bool:
        self.available_calls += 1
        return True

    def extract_text_boxes(self, image_bytes):
        self.text_calls += 1
        return [
            OCRItem(
                text="<table><tr><td>table total</td></tr></table>",
                x=0.1,
                y=0.1,
                width=0.8,
                height=0.6,
                confidence=0.9,
                label="table",
            )
        ]

    def extract_structure_boxes(self, image_bytes):
        self.structure_calls += 1
        return [
            OCRItem(
                text="1431400",
                x=0.8,
                y=0.3,
                width=0.08,
                height=0.04,
                confidence=0.95,
                label="table_cell",
            )
        ]


class _MergedSealOcrService:
    def is_available(self) -> bool:
        return True

    def extract_text_boxes(self, image_bytes):
        return [
            OCRItem(
                text="[公章]",
                x=0.25,
                y=0.07,
                width=0.5,
                height=0.72,
                confidence=0.92,
                label="seal",
            )
        ]


class _StructurePrimaryWithVlSealOcrService(_StructureFallbackOcrService):
    def extract_text_boxes(self, image_bytes):
        return [
            OCRItem(
                text="[公章]",
                x=0.3,
                y=0.12,
                width=0.2,
                height=0.2,
                confidence=0.92,
                label="seal",
            )
        ]


def test_paddle_ocr_splits_stacked_red_seals_from_merged_vl_box():
    image = Image.new("RGB", (400, 700), color="white")
    draw = ImageDraw.Draw(image)
    draw.ellipse([120, 70, 280, 230], outline=(220, 0, 0), width=12)
    draw.line([200, 105, 200, 195], fill=(220, 0, 0), width=10)
    draw.ellipse([120, 280, 280, 440], outline=(220, 0, 0), width=12)
    draw.line([200, 315, 200, 405], fill=(220, 0, 0), width=10)

    blocks, visual_regions = run_paddle_ocr(
        image,
        _MergedSealOcrService(),
        require_visual_regions=True,
    )

    assert blocks == []
    assert len(visual_regions) == 2
    assert all(region.height < 260 for region in visual_regions)
    assert visual_regions[1].top > visual_regions[0].top


def test_paddle_ocr_skips_structure_primary_when_selected_ocr_type_needs_visual_regions(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY_MIN_BOXES", 1)

    image = Image.new("RGB", (1000, 600), color="white")

    blocks, visual_regions = run_paddle_ocr(
        image,
        _StructurePrimaryWithVlSealOcrService(),
        selected_entity_types=["SEAL"],
    )

    assert blocks == []
    assert [(region.entity_type, region.source) for region in visual_regions] == [("SEAL", "paddleocr_vl")]


def test_paddle_ocr_prefers_structure_primary_when_dense_enough(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY_MIN_BOXES", 2)

    image = Image.new("RGB", (1000, 600), color="white")

    blocks, visual_regions = run_paddle_ocr(image, _StructureFallbackOcrService())

    assert visual_regions == []
    assert {block.text for block in blocks} == {"迅骁一体机", "1431400"}


def test_paddle_ocr_reuses_sparse_structure_primary_for_fallback_without_cache(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY_MIN_BOXES", 2)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_TEXT_BLOCK_CACHE_TTL_SEC", 0.0)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_TEXT_BLOCK_CACHE_MAX_ITEMS", 0)

    image = Image.new("RGB", (1000, 600), color="white")
    service = _SparsePrimaryTableFallbackNoCacheService()
    status: dict[str, object] = {}

    blocks, visual_regions = run_paddle_ocr(
        image,
        service,
        selected_entity_types=["AMOUNT"],
        stage_status=status,
    )

    assert service.available_calls == 1
    assert service.text_calls == 1
    assert service.structure_calls == 1
    assert status["ocr_structure_fallback_reused_primary"] is True
    assert "ocr_structure_ms" in status
    assert "ocr_vl_ms" in status
    assert visual_regions == []
    assert [block.text for block in blocks] == ["1431400"]


def test_paddle_ocr_uses_structure_primary_for_document_text_pages(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY_MIN_BOXES", 2)

    image = Image.new("RGB", (1000, 600), color="white")

    blocks, visual_regions = run_paddle_ocr(
        image,
        _StructureFallbackOcrService(),
        selected_entity_types=["PERSON"],
    )

    assert visual_regions == []
    assert {block.text for block in blocks} == {"迅骁一体机", "1431400"}


def test_adaptive_paddle_ocr_uses_structure_first_for_table_amount_pages(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY_MIN_BOXES", 2)

    image = Image.new("RGB", (1000, 600), color="white")
    pixels = image.load()
    for y in (120, 240, 360, 480):
        for yy in range(y - 3, y + 4):
            for x in range(80, 920):
                pixels[x, yy] = (0, 0, 0)
    for x in (120, 320, 520, 720, 900):
        for xx in range(x - 3, x + 4):
            for y in range(80, 520):
                pixels[xx, y] = (0, 0, 0)

    blocks, visual_regions = run_paddle_ocr(
        image,
        _StructureFallbackOcrService(),
        selected_entity_types=["AMOUNT"],
    )

    assert visual_regions == []
    assert {block.text for block in blocks} == {"迅骁一体机", "1431400"}


def test_paddle_ocr_skips_structure_primary_when_visual_regions_are_required(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY_MIN_BOXES", 2)

    image = Image.new("RGB", (1000, 600), color="white")

    blocks, visual_regions = run_paddle_ocr(
        image,
        _StructureFallbackOcrService(),
        require_visual_regions=True,
    )

    assert visual_regions == []
    assert {block.text for block in blocks} == {"合同清单"}


def test_paddle_ocr_uses_structure_fallback_when_vl_is_sparse(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", False)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_MIN_VL_BOXES", 12)

    image = Image.new("RGB", (1000, 600), color="white")
    pixels = image.load()
    for y in (120, 240, 360, 480):
        for yy in range(y - 3, y + 4):
            for x in range(80, 920):
                pixels[x, yy] = (0, 0, 0)
    for x in (120, 320, 520, 720, 900):
        for xx in range(x - 3, x + 4):
            for y in range(80, 520):
                pixels[xx, y] = (0, 0, 0)

    blocks, visual_regions = run_paddle_ocr(image, _StructureFallbackOcrService())

    assert visual_regions == []
    assert {block.text for block in blocks} == {"合同清单", "迅骁一体机", "1431400"}


def test_paddle_ocr_does_not_use_structure_fallback_for_sparse_non_table_pages(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", False)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_MIN_VL_BOXES", 12)

    image = Image.new("RGB", (1000, 600), color="white")

    blocks, visual_regions = run_paddle_ocr(image, _StructureFallbackOcrService())

    assert visual_regions == []
    assert {block.text for block in blocks} == {"合同清单"}


class _StructureFallbackTableMarkupOcrService(_StructureFallbackOcrService):
    def extract_text_boxes(self, image_bytes):
        return [
            OCRItem(
                text="<table><tr><td>合同清单</td></tr></table>",
                x=0.1,
                y=0.1,
                width=0.8,
                height=0.6,
                confidence=0.9,
                label="table",
            )
        ]


def test_paddle_ocr_uses_structure_fallback_for_sparse_table_markup(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", False)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_MIN_VL_BOXES", 12)

    image = Image.new("RGB", (1000, 600), color="white")

    blocks, visual_regions = run_paddle_ocr(image, _StructureFallbackTableMarkupOcrService())

    assert visual_regions == []
    assert {block.text for block in blocks} == {"迅骁一体机", "1431400"}


class _DenseCoarseTableWithSealOcrService(_StructureFallbackOcrService):
    def extract_text_boxes(self, image_bytes):
        rows = [
            OCRItem(
                text=f"正文段落{i}",
                x=0.08,
                y=0.04 + i * 0.035,
                width=0.26,
                height=0.025,
                confidence=0.9,
                label="text",
            )
            for i in range(13)
        ]
        return [
            *rows,
            OCRItem(
                text="<table><tr><td>合同清单</td><td>1431400</td></tr></table>",
                x=0.1,
                y=0.54,
                width=0.82,
                height=0.34,
                confidence=0.9,
                label="table",
            ),
            OCRItem(
                text="[公章]",
                x=0.72,
                y=0.12,
                width=0.15,
                height=0.15,
                confidence=0.9,
                label="seal",
            ),
        ]


def test_paddle_ocr_refines_dense_coarse_table_markup_even_when_visual_types_selected(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_MIN_VL_BOXES", 12)

    image = Image.new("RGB", (1000, 600), color="white")

    blocks, visual_regions = run_paddle_ocr(
        image,
        _DenseCoarseTableWithSealOcrService(),
        selected_entity_types=["SEAL"],
    )

    assert [region.entity_type for region in visual_regions] == ["SEAL"]
    assert not any(block.text.lstrip().startswith("<table") for block in blocks)
    assert "1431400" in {block.text for block in blocks}


class _StructureFallbackMixedPageOcrService(_StructureFallbackTableMarkupOcrService):
    def extract_structure_boxes(self, image_bytes):
        return [
            *super().extract_structure_boxes(image_bytes),
            OCRItem(
                text="产品示意图",
                x=0.55,
                y=0.2,
                width=0.3,
                height=0.35,
                confidence=0.9,
                label="figure",
            ),
        ]


def test_paddle_ocr_structure_fallback_ignores_non_text_figure_regions(monkeypatch):
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_ENABLED", True)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_PRIMARY", False)
    monkeypatch.setattr("app.services.vision.ocr_pipeline.settings.OCR_STRUCTURE_MIN_VL_BOXES", 12)

    image = Image.new("RGB", (1000, 600), color="white")

    blocks, visual_regions = run_paddle_ocr(image, _StructureFallbackMixedPageOcrService())

    assert visual_regions == []
    assert {block.text for block in blocks} == {"迅骁一体机", "1431400"}
