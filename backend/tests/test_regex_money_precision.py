# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from app.services.regex_service import regex_service


def test_money_requires_currency_marker_or_amount_unit():
    text = (
        "合同编号2026-001，统一社会信用代码91110108123456789X，"
        "项目周期为2026年02月23日至2026年03月01日，"
        "合同总价人民币 12,345.67 元，服务费3000元，预算¥8000。"
    )

    entities = regex_service.extract(text, entity_types=["MONEY"])
    values = [entity["text"].strip() for entity in entities]

    assert values == ["人民币 12,345.67 元", "3000元", "¥8000"]


def test_amount_uses_same_money_patterns_for_default_entity_type():
    text = "人民币大写：壹佰陆拾捌万肆仟元整，小写：￥1684000.00元，税率13%。"

    entities = regex_service.extract(text, entity_types=["AMOUNT"])
    values = [entity["text"].strip() for entity in entities]

    assert values == ["壹佰陆拾捌万肆仟元整", "￥1684000.00元"]


def test_money_alias_is_not_exposed_or_extracted_as_separate_type():
    text = "合同总价人民币 12,345.67 元，服务费3000元。"

    entities = regex_service.extract(text, entity_types=["MONEY", "AMOUNT"])

    assert [(entity["type"], entity["text"].strip()) for entity in entities] == [
        ("AMOUNT", "人民币 12,345.67 元"),
        ("AMOUNT", "3000元"),
    ]
    assert "MONEY" not in regex_service.get_supported_types()


def test_amount_does_not_capture_percent_rates():
    text = "违约金按合同金额10%计算，税率13%，利率3.85%，合同金额500,000元。"

    entities = regex_service.extract(text, entity_types=["AMOUNT"])
    values = [entity["text"].strip() for entity in entities]

    assert values == ["500,000元"]
