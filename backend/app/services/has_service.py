"""
HaS (Hide And Seek) 本地匿名化模型服务
基于 xuanwulab/HaS_Text_0209_0.6B_Q4（GGUF：HaS_Text_0209_0.6B_Q4_K_M.gguf）
通过 llama.cpp OpenAI 兼容接口调用

功能：
1. NER 敏感实体识别
2. 结构化语义标签匿名化
3. 指代消解（同一实体用相同ID）
4. 支持信息还原
"""

import asyncio
import logging
import re

logger = logging.getLogger(__name__)
from typing import Any

from app.models.schemas import Entity
from app.models.type_mapping import canonical_type_id
from app.services.has_client import HaSClient

# 类型别名，兼容 EntityTypeConfig 和 CustomEntityType
EntityTypeConfig = Any


class HaSService:
    """HaS NER 服务 - 用于混合 NER 架构"""

    # 统一引用 models/type_mapping.py 的单一数据源
    from app.models.type_mapping import TYPE_ID_TO_CN as TYPE_MAPPING_ID_TO_CN

    def __init__(self, base_url: str | None = None):
        self.client = HaSClient(base_url=base_url)

    def is_available(self) -> bool:
        """检查 HaS 服务是否可用"""
        return self.client.is_available()

    def _convert_entity_types_to_chinese(
        self,
        entity_types: list[EntityTypeConfig]
    ) -> list[str]:
        """将实体类型配置转换为 HaS 需要的中文类型列表"""
        chinese_types = []
        seen = set()
        for et in entity_types:
            # 优先使用映射
            type_id = canonical_type_id(getattr(et, "id", ""))
            if type_id in self.TYPE_MAPPING_ID_TO_CN:
                chinese_type = self.TYPE_MAPPING_ID_TO_CN[type_id]
            else:
                # 自定义类型使用名称
                chinese_type = et.name
            if chinese_type and chinese_type not in seen:
                seen.add(chinese_type)
                chinese_types.append(chinese_type)
        return chinese_types

    def _convert_entity_types_to_guidance(
        self,
        entity_types: list[EntityTypeConfig],
    ) -> list[dict[str, Any]]:
        from app.core.config import settings

        guidance: list[dict[str, Any]] = []
        for entity_type in entity_types:
            raw_type_id = str(getattr(entity_type, "id", "") or "").strip()
            type_id = canonical_type_id(raw_type_id)
            is_custom = self._is_custom_type_id(raw_type_id) or self._is_custom_type_id(type_id)
            if not is_custom and not settings.HAS_NER_BUILTIN_GUIDANCE_ENABLED:
                continue
            chinese_types = self._convert_entity_types_to_chinese([entity_type])
            if not chinese_types:
                continue
            description = str(getattr(entity_type, "description", "") or "").strip()
            examples = list(getattr(entity_type, "examples", []) or [])
            if not description and not examples:
                continue
            guidance.append({
                "type": chinese_types[0],
                "description": description,
                "examples": examples,
            })
        return guidance

    def _iter_ner_type_batches(
        self,
        entity_types: list[EntityTypeConfig],
    ) -> list[list[EntityTypeConfig]]:
        from app.core.config import settings

        seen_chinese_types: set[str] = set()
        ordered_types: list[EntityTypeConfig] = []
        builtin_types: list[EntityTypeConfig] = []
        custom_types: list[EntityTypeConfig] = []

        for entity_type in entity_types:
            chinese_types = self._convert_entity_types_to_chinese([entity_type])
            if not chinese_types:
                continue
            chinese_type = chinese_types[0]
            if chinese_type in seen_chinese_types:
                continue
            seen_chinese_types.add(chinese_type)
            ordered_types.append(entity_type)

            raw_type_id = str(getattr(entity_type, "id", "") or "").strip()
            type_id = canonical_type_id(raw_type_id)
            if self._is_custom_type_id(raw_type_id) or self._is_custom_type_id(type_id):
                custom_types.append(entity_type)
            else:
                builtin_types.append(entity_type)

        def chunk(items: list[EntityTypeConfig], size: int) -> list[list[EntityTypeConfig]]:
            return [items[index:index + size] for index in range(0, len(items), size)]

        if len(ordered_types) <= settings.HAS_NER_SINGLE_PASS_MAX_TYPES:
            return [ordered_types]

        batches: list[list[EntityTypeConfig]] = []
        batches.extend(chunk(builtin_types, settings.HAS_NER_MAX_TYPES_PER_REQUEST))
        batches.extend(chunk(custom_types, settings.HAS_NER_CUSTOM_MAX_TYPES_PER_REQUEST))
        return batches

    @staticmethod
    def _is_custom_type_id(type_id: str | None) -> bool:
        return str(type_id or "").strip().lower().startswith("custom_")

    def _build_requested_type_lookup(
        self,
        entity_types: list[EntityTypeConfig],
    ) -> tuple[set[str], dict[str, str], list[tuple[str, str]]]:
        requested_type_ids: set[str] = set()
        requested_type_by_name: dict[str, str] = {}
        custom_requested_types: list[tuple[str, str]] = []

        for entity_type in entity_types:
            raw_type_id = str(getattr(entity_type, "id", "") or "").strip()
            if not raw_type_id:
                continue
            type_id = canonical_type_id(raw_type_id)
            requested_type_ids.add(type_id)

            target_type_id = raw_type_id if self._is_custom_type_id(raw_type_id) else type_id
            exact_names = {
                raw_type_id,
                type_id,
                str(getattr(entity_type, "name", "") or "").strip(),
                *self._convert_entity_types_to_chinese([entity_type]),
            }
            for type_name in exact_names:
                if type_name:
                    requested_type_by_name[type_name] = target_type_id

            if self._is_custom_type_id(raw_type_id) or self._is_custom_type_id(type_id):
                custom_requested_types.append((raw_type_id, str(getattr(entity_type, "name", "") or "").strip()))

        return requested_type_ids, requested_type_by_name, custom_requested_types

    def _resolve_result_type_id(
        self,
        result_type_name: str,
        requested_type_by_name: dict[str, str],
        custom_requested_types: list[tuple[str, str]],
    ) -> str | None:
        result_type_name = str(result_type_name or "").strip()
        if not result_type_name:
            return None
        return requested_type_by_name.get(result_type_name)

    async def extract_entities(
        self,
        content: str,
        entity_types: list[EntityTypeConfig]
    ) -> list[Entity]:
        """
        使用 HaS 模型进行 NER 识别

        Args:
            content: 待识别文本
            entity_types: 要识别的实体类型配置

        Returns:
            识别到的实体列表
        """
        if not content.strip():
            return []

        (
            requested_type_ids,
            requested_type_by_name,
            custom_requested_types,
        ) = self._build_requested_type_lookup(entity_types)

        try:
            # 调用 HaS NER。全选默认清单时类型很多，小模型容易把大量空
            # bucket 也输出出来并触发 JSON 截断；按类型分组能让每次响应
            # 保持短而完整，同时仍然完全依赖 HaS 语义识别。
            from app.core.config import settings

            ner_result: dict[str, list[str]] = {}
            batches = self._iter_ner_type_batches(entity_types)
            max_parallel = max(1, int(settings.HAS_NER_MAX_PARALLEL_REQUESTS))
            semaphore = asyncio.Semaphore(max_parallel)

            async def run_batch(batch: list[EntityTypeConfig]) -> dict[str, list[str]]:
                batch_chinese_types = self._convert_entity_types_to_chinese(batch)
                if not batch_chinese_types:
                    return {}
                async with semaphore:
                    return await asyncio.to_thread(
                        self.client.ner,
                        content,
                        batch_chinese_types,
                        type_guidance=self._convert_entity_types_to_guidance(batch),
                    )

            batch_results = await asyncio.gather(
                *(run_batch(batch) for batch in batches),
                return_exceptions=True,
            )
            for batch_result in batch_results:
                if isinstance(batch_result, Exception):
                    logger.warning("HaS NER batch failed: %s", batch_result)
                    continue
                for result_type, values in batch_result.items():
                    if not isinstance(values, list):
                        continue
                    bucket = ner_result.setdefault(result_type, [])
                    for value in values:
                        if value and value not in bucket:
                            bucket.append(value)

            if not ner_result:
                return []

            # 转换为 Entity 对象
            entities = []
            entity_id = 0
            coref_map: dict[str, str] = {}  # text:type -> coref_id

            for chinese_type, entity_list in ner_result.items():
                # 映射中文类型到英文ID
                raw_entity_type_id = self._resolve_result_type_id(
                    chinese_type,
                    requested_type_by_name,
                    custom_requested_types,
                )

                for entity_text in entity_list:
                    if not entity_text:
                        continue

                    entity_type_id = self._coerce_result_type(
                        raw_entity_type_id,
                        requested_type_ids,
                        entity_text,
                    )
                    if entity_type_id is None:
                        continue

                    # 在原文中查找所有出现位置
                    start = 0
                    while True:
                        pos = content.find(entity_text, start)
                        if pos < 0:
                            break

                        # 指代消解：相同文本+类型使用相同 coref_id
                        coref_key = f"{entity_text}:{entity_type_id}"
                        if coref_key not in coref_map:
                            coref_map[coref_key] = f"coref_{len(coref_map)}"

                        entities.append(Entity(
                            id=f"has_{entity_id}",
                            text=entity_text,
                            type=entity_type_id,
                            start=pos,
                            end=pos + len(entity_text),
                            page=1,
                            confidence=0.95,
                            source="has",
                            coref_id=coref_map[coref_key],
                        ))

                        entity_id += 1
                        start = pos + len(entity_text)

            # 按位置排序
            entities.sort(key=lambda e: e.start)

            return entities

        except Exception as e:
            logger.exception("HaS NER 失败: %s", e)
            return []

    def _coerce_result_type(
        self,
        entity_type_id: str,
        requested_type_ids: set[str | None],
        entity_text: str,
    ) -> str | None:
        """Keep HaS output aligned with the caller-selected recognition list."""
        raw_entity_type_id = str(entity_type_id or "").strip()
        canonical_entity_type_id = canonical_type_id(entity_type_id)

        if canonical_entity_type_id not in requested_type_ids:
            return None
        if self._is_custom_type_id(raw_entity_type_id):
            return raw_entity_type_id
        return canonical_entity_type_id

    async def hide_text(
        self,
        content: str,
        entity_types: list[EntityTypeConfig]
    ) -> tuple[str, dict[str, list[str]]]:
        """
        使用 HaS 进行结构化语义标签匿名化

        Args:
            content: 原始文本
            entity_types: 要匿名化的实体类型

        Returns:
            (匿名化后文本, 映射表)
        """
        chinese_types = self._convert_entity_types_to_chinese(entity_types)

        try:
            masked_text, mapping = self.client.hide(content, chinese_types)
            return masked_text, mapping
        except Exception as e:
            logger.error("HaS Hide 失败: %s", e)
            return content, {}

    async def extract_entities_with_hide(
        self,
        content: str,
        entity_types: list[EntityTypeConfig],
    ) -> list[Entity]:
        """
        使用 HaS Hide 模式识别实体（带指代消解）

        基于结构化语义标签解析出实体位置和 coref_id。
        """
        if not content.strip():
            return []

        chinese_types = self._convert_entity_types_to_chinese(entity_types)
        (
            _requested_type_ids,
            requested_type_by_name,
            custom_requested_types,
        ) = self._build_requested_type_lookup(entity_types)

        try:
            masked_text, mapping = self.client.hide(
                content, chinese_types, use_history=True
            )
        except Exception as e:
            logger.error("HaS Hide 模式失败: %s", e)
            return []

        if not mapping:
            return []

        entities: list[Entity] = []
        used_positions: set[tuple[int, int]] = set()
        entity_id = 0

        def find_next_occurrence(text: str) -> int | None:
            start = 0
            while True:
                pos = content.find(text, start)
                if pos < 0:
                    return None
                end = pos + len(text)
                overlaps = any(not (end <= s or pos >= e) for s, e in used_positions)
                if not overlaps:
                    return pos
                start = pos + len(text)

        for tag_info in HaSTagParser.find_all_tags(masked_text):
            tag = tag_info.get("tag")
            if not tag:
                continue

            candidates = mapping.get(tag, [])
            if not candidates:
                continue

            # 使用第一个可定位的原文
            found_text = None
            found_pos = None
            for candidate in candidates:
                if not candidate:
                    continue
                pos = find_next_occurrence(candidate)
                if pos is not None:
                    found_text = candidate
                    found_pos = pos
                    break

            if found_text is None or found_pos is None:
                continue

            entity_type_cn = tag_info.get("entity_type") or "自定义"
            entity_type_id = self._resolve_result_type_id(
                entity_type_cn,
                requested_type_by_name,
                custom_requested_types,
            )
            if entity_type_id is None:
                continue

            start = found_pos
            end = found_pos + len(found_text)
            used_positions.add((start, end))

            entities.append(Entity(
                id=f"has_hide_{entity_id}",
                text=found_text,
                type=entity_type_id,
                start=start,
                end=end,
                page=1,
                confidence=0.96,
                source="has",
                coref_id=tag,
            ))
            entity_id += 1

        entities.sort(key=lambda e: e.start)
        return entities

    async def seek_text(
        self,
        masked_text: str,
        mapping: dict[str, list[str]] | None = None
    ) -> str:
        """
        使用 HaS 进行标签还原

        Args:
            masked_text: 匿名化后的文本
            mapping: 标签映射表

        Returns:
            还原后的原文
        """
        try:
            restored = self.client.seek(masked_text, mapping)
            return restored
        except Exception as e:
            logger.error("HaS Seek 失败: %s", e)
            return masked_text


# 标签解析工具
class HaSTagParser:
    """HaS 结构化语义标签解析器"""

    # 标签正则: <类型[序号].子类型.属性>
    TAG_PATTERN = re.compile(r'<([^>\[]+)\[(\d+)\]\.([^>\.]+)\.([^>]+)>')

    @classmethod
    def parse_tag(cls, tag: str) -> dict | None:
        """解析标签"""
        match = cls.TAG_PATTERN.match(tag)
        if match:
            return {
                "entity_type": match.group(1),
                "entity_id": match.group(2),
                "sub_type": match.group(3),
                "attribute": match.group(4),
            }
        return None

    @classmethod
    def find_all_tags(cls, text: str) -> list[dict]:
        """在文本中查找所有标签"""
        tags = []
        for match in cls.TAG_PATTERN.finditer(text):
            tags.append({
                "tag": match.group(),
                "start": match.start(),
                "end": match.end(),
                **cls.parse_tag(match.group()),
            })
        return tags

    @classmethod
    def generate_tag(
        cls,
        entity_type: str,
        entity_id: int,
        sub_type: str,
        attribute: str
    ) -> str:
        """生成标签"""
        return f"<{entity_type}[{entity_id:03d}].{sub_type}.{attribute}>"


# 全局服务实例
has_service = HaSService()
