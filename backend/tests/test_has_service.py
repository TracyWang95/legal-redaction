# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio
from unittest.mock import patch

import httpx

from app.services.has_client import HaSClient
from app.services.has_service import HaSService


class _OrgType:
    id = "ORG"
    name = "机构/单位名称"


class _CompanyType:
    id = "COMPANY"
    name = "公司名称"


class _DateTimeType:
    id = "DATE_TIME"
    name = "日期时间"


class _CustomLawType:
    id = "custom_law"
    name = "\u6cd5\u89c4\u540d\u79f0"


class _CustomType:
    def __init__(self, index: int):
        self.id = f"custom_{index}"
        self.name = f"\u81ea\u5b9a\u4e49{index}"


class _FakeCustomHaSClient:
    def __init__(self):
        self.entity_types = None

    def ner(self, text, entity_types, **_kwargs):
        self.entity_types = entity_types
        return {
            "\u6cd5\u5f8b\u6cd5\u89c4": ["\u300a\u4e2d\u534e\u4eba\u6c11\u5171\u548c\u56fd\u6c11\u6cd5\u5178\u300b"],
            "\u6cd5\u6761\u5f15\u7528": ["\u7b2c\u4e00\u5343\u4e00\u767e\u4e03\u5341\u4e5d\u6761"],
        }


class _FakeExactCustomHaSClient:
    def __init__(self):
        self.entity_types = None

    def ner(self, text, entity_types, **_kwargs):
        self.entity_types = entity_types
        return {
            "\u6cd5\u89c4\u540d\u79f0": ["\u300a\u4e2d\u534e\u4eba\u6c11\u5171\u548c\u56fd\u6c11\u6cd5\u5178\u300b"],
        }


class _FakeHaSClient:
    def __init__(self):
        self.entity_types = None

    def ner(self, text, entity_types, **_kwargs):
        self.entity_types = entity_types
        values = {
            "组织机构": ["北京智能科技有限公司（盖章）"],
            "公司名称": ["北京智能科技有限公司（盖章）"],
            "工作单位": ["北京智能科技有限公司（盖章）"],
            "日期时间": ["2026-05-06 08:30"],
            "日期": ["2026-05-06 08:30"],
            "金额": ["500元"],
        }
        return {type_name: values[type_name] for type_name in entity_types if type_name in values}


def test_has_client_availability_treats_busy_health_payload_as_online():
    client = HaSClient()

    with patch.object(client._http_client, "get") as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {"ready": False, "status": "busy"}

        assert client.is_available() is True


def test_has_client_availability_treats_timeout_open_port_as_online(monkeypatch):
    client = HaSClient()

    monkeypatch.setattr("app.core.health_checks._tcp_port_open", lambda *_args, **_kwargs: True)
    with patch.object(client._http_client, "get", side_effect=httpx.ReadTimeout("worker occupied")):
        assert client.is_available() is True


def test_has_service_accepts_only_exact_requested_has_tags():
    async def _run():
        service = HaSService()
        service.client = _FakeHaSClient()

        entities = await service.extract_entities(
            "北京智能科技有限公司（盖章） 合同金额500元",
            [_OrgType()],
        )

        assert [(entity.type, entity.text) for entity in entities] == [
            ("ORG", "北京智能科技有限公司（盖章）")
        ]

    asyncio.run(_run())


def test_has_service_batches_many_custom_types_separately_from_builtin_types(monkeypatch):
    async def _run():
        service = HaSService()
        monkeypatch.setattr("app.core.config.settings.HAS_NER_MAX_TYPES_PER_REQUEST", 3)
        monkeypatch.setattr(
            "app.core.config.settings.HAS_NER_CUSTOM_MAX_TYPES_PER_REQUEST",
            2,
        )
        monkeypatch.setattr("app.core.config.settings.HAS_NER_SINGLE_PASS_MAX_TYPES", 3)

        batches = service._iter_ner_type_batches(
            [_OrgType(), _DateTimeType(), *[_CustomType(index) for index in range(5)]]
        )

        assert [[getattr(entity_type, "id") for entity_type in batch] for batch in batches] == [
            ["ORG", "DATE_TIME"],
            ["custom_0", "custom_1"],
            ["custom_2", "custom_3"],
            ["custom_4"],
        ]

    asyncio.run(_run())


def test_has_service_keeps_company_selection_as_company_name():
    async def _run():
        service = HaSService()
        service.client = _FakeHaSClient()

        entities = await service.extract_entities(
            "北京智能科技有限公司（盖章） 合同金额500元",
            [_CompanyType()],
        )

        assert [(entity.type, entity.text) for entity in entities] == [
            ("COMPANY_NAME", "北京智能科技有限公司（盖章）")
        ]

    asyncio.run(_run())


def test_has_service_dedupes_alias_prompt_types_and_canonicalizes_dates():
    async def _run():
        service = HaSService()
        fake_client = _FakeHaSClient()
        service.client = fake_client

        entities = await service.extract_entities(
            "北京智能科技有限公司（盖章） 2026-05-06 08:30",
            [_OrgType(), _CompanyType(), _DateTimeType()],
        )

        assert fake_client.entity_types == ["组织机构", "公司名称", "日期"]
        assert [(entity.type, entity.text) for entity in entities] == [
            ("ORG", "北京智能科技有限公司（盖章）"),
            ("COMPANY_NAME", "北京智能科技有限公司（盖章）"),
            ("DATE", "2026-05-06 08:30"),
        ]

    asyncio.run(_run())


def test_has_service_does_not_guess_related_model_labels_for_custom_type():
    async def _run():
        service = HaSService()
        fake_client = _FakeCustomHaSClient()
        service.client = fake_client

        entities = await service.extract_entities(
            "\u6839\u636e\u300a\u4e2d\u534e\u4eba\u6c11\u5171\u548c\u56fd\u6c11\u6cd5\u5178\u300b\u7b2c\u4e00\u5343\u4e00\u767e\u4e03\u5341\u4e5d\u6761\u4e4b\u89c4\u5b9a",
            [_CustomLawType()],
        )

        assert fake_client.entity_types == ["\u6cd5\u89c4\u540d\u79f0"]
        assert entities == []

    asyncio.run(_run())


def test_has_service_accepts_exact_custom_ner_tag_only():
    async def _run():
        service = HaSService()
        fake_client = _FakeExactCustomHaSClient()
        service.client = fake_client

        entities = await service.extract_entities(
            "\u6839\u636e\u300a\u4e2d\u534e\u4eba\u6c11\u5171\u548c\u56fd\u6c11\u6cd5\u5178\u300b\u4e4b\u89c4\u5b9a",
            [_CustomLawType()],
        )

        assert fake_client.entity_types == ["\u6cd5\u89c4\u540d\u79f0"]
        assert [(entity.type, entity.text) for entity in entities] == [
            ("custom_law", "\u300a\u4e2d\u534e\u4eba\u6c11\u5171\u548c\u56fd\u6c11\u6cd5\u5178\u300b"),
        ]

    asyncio.run(_run())
