# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio
from types import SimpleNamespace

from app.models.schemas import Entity
from app.services.hybrid_ner_service import HybridNERService


class _OfflineHasService:
    def is_available(self) -> bool:
        return False

    async def extract_entities(self, text, entity_types):  # pragma: no cover - must not be called
        raise AssertionError("offline HaS service should not be called")


class _EntityType:
    id = "ID_CARD"
    name = "身份证号"
    regex_pattern = None
    use_llm = False


class _TimeAliasEntityType:
    id = "TIME"
    name = "时间"
    regex_pattern = None
    use_llm = True


class _SemanticEntityType:
    id = "PERSON"
    name = "姓名"
    regex_pattern = None
    use_llm = True


class _OrgEntityType:
    id = "ORG"
    name = "机构/单位名称"
    regex_pattern = None
    use_llm = True


class _CompanyEntityType:
    id = "COMPANY"
    name = "公司名称"
    regex_pattern = None
    use_llm = True


class _AddressEntityType:
    id = "ADDRESS"
    name = "详细地址"
    regex_pattern = None
    use_llm = True


class _LegalPartyEntityType:
    id = "LEGAL_PARTY"
    name = "当事人"
    regex_pattern = None
    use_llm = True


class _CustomLawEntityType:
    id = "custom_law"
    name = "\u6cd5\u89c4\u540d\u79f0"
    regex_pattern = None
    use_llm = True


class _CountingHasService:
    def __init__(self):
        self.calls = 0

    def is_available(self) -> bool:
        return True

    async def extract_entities(self, text, entity_types):
        self.calls += 1
        return []


class _CapturingHasService(_CountingHasService):
    def __init__(self):
        super().__init__()
        self.texts = []
        self.type_ids = []

    async def extract_entities(self, text, entity_types):
        self.calls += 1
        self.texts.append(text)
        self.type_ids.append([entity_type.id for entity_type in entity_types])
        return []


class _OffsetHasService(_CountingHasService):
    def __init__(self, entity_text: str):
        super().__init__()
        self.entity_text = entity_text

    async def extract_entities(self, text, entity_types):
        self.calls += 1
        start = text.find(self.entity_text)
        return [
            Entity(
                id="has_chunk_0",
                text=self.entity_text,
                type=entity_types[0].id,
                start=max(0, start),
                end=max(0, start) + len(self.entity_text),
                page=1,
                confidence=0.88,
                source="has",
            )
        ]


class _HideFirstHasService(_CountingHasService):
    def __init__(self):
        super().__init__()
        self.hide_calls = 0

    async def extract_entities(self, text, entity_types):
        self.calls += 1
        target = "Guangdong Shenzhen Nanshan Court"
        start = text.find(target)
        return [
            Entity(
                id="has_ner_0",
                text=target,
                type="ORG",
                start=start,
                end=start + len(target),
                page=1,
                confidence=0.96,
                source="has",
                coref_id="<\u7ec4\u7ec7[1].\u53f8\u6cd5\u673a\u6784.\u5b8c\u6574\u540d\u79f0>",
            )
        ]

    async def extract_entities_with_hide(self, text, entity_types):
        self.hide_calls += 1
        target = "Guangdong Shenzhen Nanshan Court"
        start = text.find(target)
        return [
            Entity(
                id="has_hide_0",
                text=target,
                type="ORG",
                start=start,
                end=start + len(target),
                page=1,
                confidence=0.96,
                source="has",
                coref_id="<组织[1].司法机构.完整名称>",
            )
        ]


class _EmptyHideFallbackHasService(_CountingHasService):
    async def extract_entities_with_hide(self, text, entity_types):
        return []

    async def extract_entities(self, text, entity_types):
        self.calls += 1
        target = "Fallback Org"
        start = text.find(target)
        return [
            Entity(
                id="has_ner_0",
                text=target,
                type="ORG",
                start=start,
                end=start + len(target),
                page=1,
                confidence=0.88,
                source="has",
            )
        ]


class _CustomTypeHideCapableHasService(_CapturingHasService):
    def __init__(self):
        super().__init__()
        self.hide_calls = 0

    async def extract_entities_with_hide(self, text, entity_types):
        self.hide_calls += 1
        return []


def test_offline_has_service_still_returns_regex_entities():
    async def _run():
        service = HybridNERService(has_service_instance=_OfflineHasService())

        entities = await service.extract(
            "身份证号是110101199003071234",
            [_EntityType()],
        )

        assert [(entity.type, entity.text, entity.source) for entity in entities] == [
            ("ID_CARD", "110101199003071234", "regex")
        ]

    asyncio.run(_run())


def test_semantic_has_uses_ner_without_hide_roundtrip():
    async def _run():
        has_service = _HideFirstHasService()
        service = HybridNERService(has_service_instance=has_service)

        entities = await service.extract(
            "\u673a\u6784\uff1aGuangdong Shenzhen Nanshan Court",
            [_OrgEntityType()],
        )

        assert has_service.hide_calls == 0
        assert has_service.calls == 1
        assert [(entity.text, entity.type, entity.source, entity.coref_id) for entity in entities] == [
            (
                "Guangdong Shenzhen Nanshan Court",
                "ORG",
                "has",
                "<组织[1].司法机构.完整名称>",
            )
        ]

    asyncio.run(_run())


def test_semantic_has_falls_back_to_ner_when_hide_returns_no_mapping():
    async def _run():
        has_service = _EmptyHideFallbackHasService()
        service = HybridNERService(has_service_instance=has_service)

        entities = await service.extract("\u673a\u6784\uff1aFallback Org", [_OrgEntityType()])

        assert has_service.calls == 1
        assert [(entity.text, entity.type, entity.source) for entity in entities] == [
            ("Fallback Org", "ORG", "has")
        ]

    asyncio.run(_run())


def test_text_entity_presets_do_not_expose_deprecated_alias_types():
    from app.services.entity_type_service import PRESET_ENTITY_TYPES

    assert "TIME" in PRESET_ENTITY_TYPES
    assert "PERSONAL_ATTRIBUTE" not in PRESET_ENTITY_TYPES
    assert "MONEY" not in PRESET_ENTITY_TYPES


def test_regex_only_types_skip_has_service():
    async def _run():
        has_service = _CountingHasService()
        service = HybridNERService(has_service_instance=has_service)

        entities = await service.extract(
            "身份证号是110101199003071234",
            [_EntityType()],
        )

        assert has_service.calls == 0
        assert len(entities) == 1

    asyncio.run(_run())


def test_time_alias_is_canonicalized_to_date_and_skips_has_service():
    async def _run():
        has_service = _CountingHasService()
        service = HybridNERService(has_service_instance=has_service)

        entities = await service.extract("会议时间：2024-01-15 14:30", [_TimeAliasEntityType()])

        assert has_service.calls == 0
        assert [(entity.type, entity.text, entity.source) for entity in entities] == [
            ("DATE", "时间：2024-01-15 14:30", "regex")
        ]

    asyncio.run(_run())


def test_semantic_types_call_has_service():
    async def _run():
        has_service = _CountingHasService()
        service = HybridNERService(has_service_instance=has_service)

        await service.extract("联系人：张三", [_SemanticEntityType()])

        assert has_service.calls == 1

    asyncio.run(_run())


def test_semantic_has_uses_candidate_lines_instead_of_full_document():
    async def _run():
        has_service = _CapturingHasService()
        service = HybridNERService(has_service_instance=has_service)
        boilerplate = "本协议各方应按照法律法规履行项目交付、验收、付款和保密义务。" * 80
        text = (
            f"{boilerplate}\n"
            "甲方：北京智能科技有限公司\n"
            "注册地址：北京市海淀区中关村大街1号\n"
            "联系人：张三\n"
            f"{boilerplate}"
        )

        await service.extract(text, [_OrgEntityType(), _AddressEntityType(), _SemanticEntityType()])

        assert has_service.calls == 1
        sent_text = has_service.texts[0]
        assert "北京智能科技有限公司" in sent_text
        assert "北京市海淀区中关村大街1号" in sent_text
        assert "联系人：张三" in sent_text
        assert len(sent_text) < len(text) / 5
        assert has_service.type_ids == [["ORG", "ADDRESS", "PERSON"]]

    asyncio.run(_run())


def test_semantic_has_dedupes_company_alias_to_org():
    async def _run():
        has_service = _CapturingHasService()
        service = HybridNERService(has_service_instance=has_service)

        await service.extract("甲方：北京智能科技有限公司", [_CompanyEntityType(), _OrgEntityType()])

        assert has_service.calls == 1
        assert has_service.type_ids == [["ORG"]]

    asyncio.run(_run())


def test_semantic_has_chunk_offsets_are_relocated_to_original_text():
    async def _run():
        target = "Alice Example"
        has_service = _OffsetHasService(target)
        service = HybridNERService(has_service_instance=has_service)
        service.SEMANTIC_LINE_HINTS = ("contact person",)
        prefix = "general boilerplate without semantic hints. " * 30
        text = f"{prefix}\ncontact person: {target}\nother terms"

        entities = await service.extract(text, [_SemanticEntityType()])

        assert has_service.calls == 1
        assert [(entity.text, entity.start, entity.end, entity.source) for entity in entities] == [
            (target, text.index(target), text.index(target) + len(target), "has")
        ]

    asyncio.run(_run())


def test_llm_selected_non_regex_type_is_sent_to_has():
    async def _run():
        has_service = _CountingHasService()
        service = HybridNERService(has_service_instance=has_service)

        await service.extract("甲方：北京智能科技有限公司", [_LegalPartyEntityType()])

        assert has_service.calls == 1

    asyncio.run(_run())


def test_available_has_path_skips_semantic_regex_noise():
    async def _run():
        has_service = _CapturingHasService()
        service = HybridNERService(has_service_instance=has_service)
        text = "\u745e\u4e30\u6052\u6cf0\u516c\u53f8\u5728\u4e8b\u53d1\u540e\u4ec5\u5411\u539f\u544a\u57ab\u4ed8\u3002"

        entities = await service.extract(text, [_OrgEntityType()])

        assert has_service.calls == 1
        assert entities == []

    asyncio.run(_run())


def test_regex_supplements_only_deterministic_types_when_has_is_available():
    async def _run():
        has_service = _CapturingHasService()
        service = HybridNERService(has_service_instance=has_service)
        text = (
            "\u88ab\u544a\uff1a\u6df1\u5733\u5e02\u745e\u4e30\u6052\u6cf0\u8d38\u6613\u6709\u9650\u516c\u53f8\u3002"
            "Email: zhangsan@example.com"
        )

        entities = await service.extract(
            text,
            [
                _OrgEntityType(),
                SimpleNamespace(id="EMAIL", name="Email", use_llm=False),
            ],
        )

        assert has_service.calls == 1
        assert [(entity.type, entity.text, entity.source) for entity in entities] == [
            ("EMAIL", "zhangsan@example.com", "regex")
        ]

    asyncio.run(_run())


def test_custom_llm_type_from_selected_config_is_sent_to_has():
    async def _run():
        has_service = _CapturingHasService()
        service = HybridNERService(has_service_instance=has_service)

        await service.extract(
            "\u6839\u636e\u300a\u4e2d\u534e\u4eba\u6c11\u5171\u548c\u56fd\u6c11\u6cd5\u5178\u300b\u7b2c\u4e00\u5343\u4e00\u767e\u4e03\u5341\u4e5d\u6761\u4e4b\u89c4\u5b9a",
            [_CustomLawEntityType()],
        )

        assert has_service.calls == 1
        assert has_service.type_ids == [["custom_law"]]

    asyncio.run(_run())


def test_custom_llm_type_skips_hide_and_uses_single_ner_call():
    async def _run():
        has_service = _CustomTypeHideCapableHasService()
        service = HybridNERService(has_service_instance=has_service)

        await service.extract(
            "\u6839\u636e\u300a\u4e2d\u534e\u4eba\u6c11\u5171\u548c\u56fd\u6c11\u6cd5\u5178\u300b\u4e4b\u89c4\u5b9a",
            [_CustomLawEntityType()],
        )

        assert has_service.hide_calls == 0
        assert has_service.calls == 1

    asyncio.run(_run())


def test_legal_lines_are_sent_to_has_and_has_wins_semantic_overlap():
    async def _run():
        text = (
            "\uff082025\uff09\u7ca40305\u6c11\u521d12345\u53f7\n"
            "\u5e7f\u4e1c\u7701\u6df1\u5733\u5e02\u5357\u5c71\u533a\u4eba\u6c11\u6cd5\u9662\n"
            "\u6c11\u4e8b\u5224\u51b3\u4e66\n"
            "\u539f\u544a\uff1a\u8d75\u96ea\u6885\uff0c\u5973\uff0c\u6c49\u65cf\u3002\n"
            "\u5ba1\u5224\u5458\uff1a\u5468\u660e\n"
            "\u4e66\u8bb0\u5458\uff1a\u674e\u6653\u60a6\n"
        )
        target_org = "\u5e7f\u4e1c\u7701\u6df1\u5733\u5e02\u5357\u5c71\u533a\u4eba\u6c11\u6cd5\u9662"

        class LegalHasService:
            def __init__(self):
                self.texts = []

            def is_available(self):
                return True

            async def extract_entities(self, chunk_text, entity_types):
                self.texts.append(chunk_text)
                return [
                    Entity(
                        id="has_org",
                        text=target_org,
                        type="ORG",
                        start=chunk_text.find(target_org),
                        end=chunk_text.find(target_org) + len(target_org),
                        page=1,
                        confidence=0.88,
                        source="has",
                    )
                ]

        has_service = LegalHasService()
        service = HybridNERService(has_service_instance=has_service)

        entities = await service.extract(
            text,
            [
                SimpleNamespace(id="PERSON", name="Person", use_llm=True),
                SimpleNamespace(id="ORG", name="Org", use_llm=True),
            ],
        )

        sent_text = "\n".join(has_service.texts)
        assert "\u539f\u544a\uff1a\u8d75\u96ea\u6885" in sent_text
        assert "\u5ba1\u5224\u5458\uff1a\u5468\u660e" in sent_text
        assert "\u4e66\u8bb0\u5458\uff1a\u674e\u6653\u60a6" in sent_text
        assert "\u6c11\u4e8b\u5224\u51b3\u4e66" not in sent_text

        org_entities = [entity for entity in entities if entity.text == target_org]
        assert [(entity.type, entity.source) for entity in org_entities] == [("ORG", "has")]

    asyncio.run(_run())


def test_has_confirmed_full_org_backfills_short_alias_mentions():
    async def _run():
        text = (
            "\u88ab\u544a\uff1a\u6df1\u5733\u5e02\u745e\u4e30\u6052\u6cf0\u8d38\u6613\u6709\u9650\u516c\u53f8\u3002"
            "\u5f20\u5efa\u519b\u7cfb\u745e\u4e30\u6052\u6cf0\u516c\u53f8\u5458\u5de5\u3002"
            "\u745e\u4e30\u6052\u6cf0\u516c\u53f8\u5728\u4e8b\u53d1\u540e\u4ec5\u5411\u539f\u544a\u57ab\u4ed8\u3002"
        )
        full_org = "\u6df1\u5733\u5e02\u745e\u4e30\u6052\u6cf0\u8d38\u6613\u6709\u9650\u516c\u53f8"
        alias = "\u745e\u4e30\u6052\u6cf0\u516c\u53f8"

        class AliasHasService:
            def is_available(self):
                return True

            async def extract_entities(self, chunk_text, entity_types):
                start = chunk_text.find(full_org)
                return [
                    Entity(
                        id="has_full_org",
                        text=full_org,
                        type="ORG",
                        start=start,
                        end=start + len(full_org),
                        page=1,
                        confidence=0.95,
                        source="has",
                    )
                ]

        service = HybridNERService(has_service_instance=AliasHasService())
        entities = await service.extract(text, [_OrgEntityType()])

        alias_entities = [entity for entity in entities if entity.text == alias]
        assert [(entity.start, entity.source) for entity in alias_entities] == [
            (text.index(alias), "has"),
            (text.rindex(alias), "has"),
        ]
        assert len({entity.coref_id for entity in entities if entity.text in {full_org, alias}}) == 1

    asyncio.run(_run())


def test_org_alias_coref_uses_generic_name_similarity_not_literal_cases():
    async def _run():
        service = HybridNERService(has_service_instance=_OfflineHasService())
        text = (
            "\u7532\u65b9\uff1a\u5317\u4eac\u661f\u6d77\u79d1\u6280\u6709\u9650\u516c\u53f8\uff0c\u4f4f\u6240\u5730\u5317\u4eac\u5e02\u6d77\u6dc0\u533a\u3002"
            "\u661f\u6d77\u516c\u53f8\u5728\u4e8b\u540e\u51fa\u5177\u8bf4\u660e\u3002"
            "\u4e59\u65b9\uff1a\u4e0a\u6d77\u660e\u8fbe\u533b\u9662\u3002"
        )

        entities = await service.extract(text, [_OrgEntityType()])
        by_text = {entity.text: entity for entity in entities}

        assert by_text["\u661f\u6d77\u516c\u53f8"].coref_id == by_text[
            "\u5317\u4eac\u661f\u6d77\u79d1\u6280\u6709\u9650\u516c\u53f8"
        ].coref_id
        assert by_text["\u4e0a\u6d77\u660e\u8fbe\u533b\u9662"].coref_id != by_text[
            "\u5317\u4eac\u661f\u6d77\u79d1\u6280\u6709\u9650\u516c\u53f8"
        ].coref_id

    asyncio.run(_run())
