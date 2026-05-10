# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from app.models.schemas import Entity, ReplacementMode
from app.services.redaction.replacement_strategy import RedactionContext


def test_structured_replacement_rejects_incompatible_has_tag_type():
    context = RedactionContext(ReplacementMode.STRUCTURED)
    entity = Entity(
        id="e1",
        text="420102198507159988",
        type="ID_CARD",
        start=0,
        end=18,
        coref_id="<金融账户[001].银行卡.号码>",
    )

    replacement = context.get_replacement(entity)

    assert replacement != "<金融账户[001].银行卡.号码>"
    assert "身份证" in replacement or "证件" in replacement


def test_structured_replacement_accepts_compatible_has_tag_type():
    context = RedactionContext(ReplacementMode.STRUCTURED)
    entity = Entity(
        id="e1",
        text="广东省深圳市南山区人民法院",
        type="ORG",
        start=0,
        end=13,
        coref_id="<组织[1].司法机关.完整名称>",
    )

    assert context.get_replacement(entity) == "<组织[1].司法机关.完整名称>"


def test_coref_aliases_are_all_exposed_in_entity_map():
    context = RedactionContext(ReplacementMode.STRUCTURED)
    full_name = "\u6df1\u5733\u5e02\u745e\u4e30\u6052\u6cf0\u8d38\u6613\u6709\u9650\u516c\u53f8"
    alias = "\u745e\u4e30\u6052\u6cf0\u516c\u53f8"

    first = Entity(
        id="e1",
        text=full_name,
        type="ORG",
        start=0,
        end=len(full_name),
        coref_id="coref_001",
    )
    second = Entity(
        id="e2",
        text=alias,
        type="ORG",
        start=30,
        end=30 + len(alias),
        coref_id="coref_001",
    )

    replacement = context.get_replacement(first)

    assert context.get_replacement(second) == replacement
    assert context.entity_map[full_name] == replacement
    assert context.entity_map[alias] == replacement


def test_custom_structured_replacement_uses_configured_type_label(monkeypatch):
    context = RedactionContext(ReplacementMode.STRUCTURED)
    entity = Entity(
        id="e1",
        text="10,000.00 元",
        type="custom_amount",
        start=0,
        end=11,
    )

    monkeypatch.setattr(
        "app.services.entity_type_service.entity_types_db",
        {"custom_amount": type("Cfg", (), {"name": "金额", "tag_template": None})()},
    )

    assert context.get_replacement(entity) == "<金额[001].合同金额.数值>"


def test_custom_structured_replacement_falls_back_to_configured_name(monkeypatch):
    context = RedactionContext(ReplacementMode.STRUCTURED)
    entity = Entity(
        id="e1",
        text="粤0305民初12345号",
        type="custom_anything",
        start=0,
        end=13,
    )

    monkeypatch.setattr(
        "app.services.entity_type_service.entity_types_db",
        {"custom_anything": type("Cfg", (), {"name": "用户自定义字段", "tag_template": None})()},
    )

    assert context.get_replacement(entity) == "<用户自定义字段[001].完整值>"


def test_custom_structured_replacement_normalizes_uppercase_custom_id(monkeypatch):
    context = RedactionContext(ReplacementMode.STRUCTURED)
    entity = Entity(
        id="e1",
        text="2025\u5e741\u67081\u65e5",
        type="CUSTOM_C95CCBDA",
        start=0,
        end=9,
    )

    monkeypatch.setattr(
        "app.services.entity_type_service.entity_types_db",
        {
            "custom_c95ccbda": type(
                "Cfg",
                (),
                {
                    "name": "\u65f6\u95f4\u4fe1\u606f",
                    "tag_template": "<\u65f6\u95f4\u4fe1\u606f[{index}].\u65e5\u671f.\u5e74\u6708\u65e5>",
                },
            )()
        },
    )

    assert context.get_replacement(entity) == "<\u65f6\u95f4\u4fe1\u606f[001].\u65e5\u671f.\u5e74\u6708\u65e5>"


def test_custom_structured_replacement_uses_configured_tag_template(monkeypatch):
    context = RedactionContext(ReplacementMode.STRUCTURED)
    entity = Entity(
        id="e1",
        text="《中华人民共和国民法典》",
        type="custom_law",
        start=0,
        end=11,
    )

    monkeypatch.setattr(
        "app.services.entity_type_service.entity_types_db",
        {
            "custom_law": type(
                "Cfg",
                (),
                {"name": "法规名称", "tag_template": "<法规名称[{index}].法律.完整名称>"},
            )()
        },
    )

    assert context.get_replacement(entity) == "<法规名称[001].法律.完整名称>"
