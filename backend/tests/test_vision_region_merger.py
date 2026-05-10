# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from app.services.hybrid_vision_service import SensitiveRegion
from app.services.vision.region_merger import merge_regions


def _region(entity_type: str, text: str, width: int) -> SensitiveRegion:
    return SensitiveRegion(
        text=text,
        entity_type=entity_type,
        left=100,
        top=50,
        width=width,
        height=20,
        source="ocr_has",
    )


def test_merge_regions_dedupes_same_text_overlap_by_specific_type():
    merged = merge_regions(
        [
            _region("PERSON", "沈样涛", 54),
            _region("LEGAL_PARTY", "沈样涛", 72),
        ],
        [],
    )

    assert [(region.entity_type, region.text) for region in merged] == [("PERSON", "沈样涛")]


def test_merge_regions_prefers_tighter_same_type_amount_box():
    broad = SensitiveRegion(
        text="小写：（￥1684000.00元）",
        entity_type="AMOUNT",
        left=100,
        top=50,
        width=280,
        height=20,
        source="text_match",
    )
    tight = SensitiveRegion(
        text="￥1684000.00元",
        entity_type="AMOUNT",
        left=180,
        top=50,
        width=150,
        height=20,
        source="text_match",
    )

    merged = merge_regions([broad], [tight])

    assert len(merged) == 1
    assert merged[0].text == "￥1684000.00元"
    assert merged[0].width == 150


def test_merge_regions_keeps_existing_when_larger_same_type_box_arrives():
    prefix = SensitiveRegion(
        text="￥1431400",
        entity_type="AMOUNT",
        left=100,
        top=50,
        width=110,
        height=20,
        source="text_match",
    )
    complete = SensitiveRegion(
        text="￥1431400，00元",
        entity_type="AMOUNT",
        left=100,
        top=50,
        width=180,
        height=20,
        source="text_match",
    )

    merged = merge_regions([prefix], [complete])

    assert len(merged) == 1
    assert merged[0].text == "￥1431400"
