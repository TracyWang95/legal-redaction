# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio

from app.models.schemas import Entity
from app.services.hybrid_ner_service import HybridNERService


class _EntityType:
    regex_pattern = None
    use_llm = True
    description = None
    examples = []

    def __init__(self, type_id: str, name: str):
        self.id = type_id
        self.name = name


class _OverbroadCompanyHasService:
    def is_available(self) -> bool:
        return True

    async def extract_entities(self, text, entity_types):
        target = "瑞丰恒泰公司员工"
        start = text.find(target)
        return [
            Entity(
                id="has_0",
                text=target,
                type="COMPANY_NAME",
                start=start,
                end=start + len(target),
                page=1,
                confidence=0.95,
                source="has",
            )
        ]


def test_organization_role_tail_is_trimmed_to_atomic_company_schema():
    async def _run():
        service = HybridNERService(has_service_instance=_OverbroadCompanyHasService())

        entities = await service.extract(
            "根据法律规定，张建军系瑞丰恒泰公司员工，应由用人单位承担责任。",
            [_EntityType("COMPANY_NAME", "公司名称")],
        )

        assert [(entity.type, entity.text) for entity in entities] == [
            ("COMPANY_NAME", "瑞丰恒泰公司")
        ]

    asyncio.run(_run())
