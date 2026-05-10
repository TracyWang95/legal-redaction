"""
Hybrid Vision Service - 图像匿名化核心服务
PaddleOCR-VL（独立微服务@8082）+ HaS 本地模型（敏感信息识别）混合模式
完全离线运行，不依赖云端 API

This module defines the shared data classes (SensitiveRegion, OCRTextBlock) and
the HybridVisionService orchestrator.  The heavy logic lives in three focused
sub-modules under ``app.services.vision``:

- ``ocr_pipeline``   – OCR extraction, HaS NER, entity-to-OCR matching
- ``image_pipeline`` – VLM/OCR coordinate refinement, drawing, redaction
- ``region_merger``  – IoU calculation and region deduplication
"""
from __future__ import annotations

import asyncio
import base64
import inspect
import io
import logging
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

from PIL import Image

from app.core.config import settings
from app.models.type_mapping import canonical_type_id

VISUAL_ONLY_ENTITY_TYPES = {
    "SEAL",
    "SIGNATURE",
    "FINGERPRINT",
    "PHOTO",
    "QR_CODE",
    "HANDWRITING",
    "WATERMARK",
}

HAS_TEXT_SEMANTIC_ENTITY_TYPES = {
    "PERSON",
    "ID_CARD",
    "PASSPORT",
    "SOCIAL_SECURITY",
    "BIOMETRIC",
    "DRIVER_LICENSE",
    "MILITARY_ID",
    "PHONE",
    "EMAIL",
    "QQ_WECHAT_ID",
    "BANK_CARD",
    "BANK_ACCOUNT",
    "BANK_NAME",
    "PAYMENT_ACCOUNT",
    "TAX_ID",
    "IP_ADDRESS",
    "MAC_ADDRESS",
    "DEVICE_ID",
    "USERNAME_PASSWORD",
    "AUTH_SECRET",
    "BIRTH_DATE",
    "AGE",
    "GENDER",
    "NATIONALITY",
    "ETHNICITY",
    "MARITAL_STATUS",
    "ADDRESS",
    "POSTAL_CODE",
    "GPS_LOCATION",
    "EDUCATION",
    "WORK_UNIT",
    "DATE",
    "TIME",
    "LICENSE_PLATE",
    "VIN",
    "HEALTH_INFO",
    "MEDICAL_RECORD",
    "AMOUNT",
    "PROPERTY",
    "CRIMINAL_RECORD",
    "POLITICAL",
    "RELIGION",
    "SEXUAL_ORIENTATION",
    "CASE_NUMBER",
    "CONTRACT_NO",
    "LEGAL_DOC_NO",
    "LEGAL_PARTY",
    "LAWYER",
    "JUDGE",
    "WITNESS",
    "ORG",
    "COMPANY",
    "COMPANY_CODE",
    "URL_WEBSITE",
}


IMAGE_TEXT_ENTITY_TYPE_ALIASES = {
    "DATETIME": "DATE",
    "DATE_TIME": "DATE",
    "COMPANY": "ORG",
}


def _canonical_image_text_type(entity_type: str | None) -> str:
    value = str(entity_type or "").strip().upper()
    return canonical_type_id(IMAGE_TEXT_ENTITY_TYPE_ALIASES.get(value, value))


def _canonicalize_image_text_types(entity_type_ids: list[str]) -> list[str]:
    return list(dict.fromkeys(_canonical_image_text_type(type_id) for type_id in entity_type_ids))


def _needs_has_text_analysis(entity_type_ids: list[str]) -> bool:
    """Return whether selected vision types need semantic HaS NER."""
    return any(_canonical_image_text_type(type_id) in HAS_TEXT_SEMANTIC_ENTITY_TYPES for type_id in entity_type_ids)

# ---------------------------------------------------------------------------
# Shared data classes (imported by sub-modules and external consumers)
# ---------------------------------------------------------------------------

@dataclass
class SensitiveRegion:
    """敏感区域"""
    text: str
    entity_type: str
    left: int      # 像素坐标
    top: int
    width: int
    height: int
    confidence: float = 1.0
    source: str = "unknown"  # "ocr", "vlm", "merged"
    color: tuple[int, int, int] = (255, 0, 0)


@dataclass
class OCRTextBlock:
    """OCR 识别的文本块（bbox 在构造时缓存，避免每次 property 访问重算）"""
    text: str
    polygon: list[list[float]]  # 四边形顶点 [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
    confidence: float = 1.0

    # 构造后缓存的 bbox 值
    _bbox_cache: tuple[int, int, int, int] = field(default=(0, 0, 0, 0), init=False, repr=False)

    def __post_init__(self):
        xs = [p[0] for p in self.polygon]
        ys = [p[1] for p in self.polygon]
        self._bbox_cache = (int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys)))

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        return self._bbox_cache

    @property
    def left(self) -> int:
        return self._bbox_cache[0]

    @property
    def top(self) -> int:
        return self._bbox_cache[1]

    @property
    def width(self) -> int:
        return self._bbox_cache[2] - self._bbox_cache[0]

    @property
    def height(self) -> int:
        return self._bbox_cache[3] - self._bbox_cache[1]


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class HybridVisionService:
    """
    混合视觉匿名化服务（完全离线）
    1. PaddleOCR-VL：文字检测+识别（获取精确位置）
    2. HaS 本地模型：敏感信息类型识别（理解语义）
    3. 融合两者结果
    """

    def __init__(self):
        self._ocr_service = None   # OCR HTTP 客户端
        self._has_client = None    # HaS NER 客户端
        self._has_ready = False
        self.last_duration_ms: dict[str, Any] = {}
        self._init_services()

    def _init_services(self):
        """初始化 OCR 和 HaS 服务"""
        try:
            from app.services.ocr_service import ocr_service
            self._ocr_service = ocr_service
            logger.info("OCR client initialized (will check availability at runtime)")
        except Exception as e:
            logger.warning("OCR client init failed: %s", e)
            self._ocr_service = None

        try:
            from app.services.has_client import HaSClient
            self._has_client = HaSClient()
            self._has_ready = False
            self._has_service = True
            logger.info("HaS Client initialized (availability checked on first NER call)")
        except Exception as e:
            logger.warning("HaS Client init failed: %s", e)
            self._has_client = None
            self._has_ready = False

    # ------------------------------------------------------------------
    # Delegated helpers (keep old private names for any internal callers)
    # ------------------------------------------------------------------

    def _prepare_image(self, image_bytes: bytes) -> tuple[Image.Image, int, int]:
        from app.services.vision.ocr_pipeline import prepare_image
        return prepare_image(image_bytes)

    def _run_paddle_ocr(
        self,
        image: Image.Image,
        *,
        require_visual_regions: bool = False,
        selected_entity_types: list[str] | None = None,
        stage_status: dict[str, Any] | None = None,
    ) -> tuple[list[OCRTextBlock], list[SensitiveRegion]]:
        from app.services.vision.ocr_pipeline import run_paddle_ocr
        return run_paddle_ocr(
            image,
            self._ocr_service,
            require_visual_regions=require_visual_regions,
            selected_entity_types=selected_entity_types,
            stage_status=stage_status,
        )

    async def _run_has_text_analysis(
        self,
        ocr_blocks: list[OCRTextBlock],
        vision_types: list | None = None,
        stage_status: dict[str, Any] | None = None,
    ) -> list[dict]:
        # Lazy re-init (service may have started after us)
        if not self._has_client:
            try:
                from app.services.has_client import HaSClient
                self._has_client = HaSClient()
            except Exception:
                pass
        from app.services.vision.ocr_pipeline import run_has_text_analysis
        return await run_has_text_analysis(ocr_blocks, self._has_client, vision_types, stage_status=stage_status)

    async def _invoke_has_text_analysis(
        self,
        ocr_blocks: list[OCRTextBlock],
        vision_types: list | None,
        stage_status: dict[str, Any],
    ) -> list[dict]:
        """Call HaS Text while preserving older test doubles with two args."""
        func = self._run_has_text_analysis
        try:
            signature = inspect.signature(func)
            accepts_status = (
                "stage_status" in signature.parameters
                or any(param.kind == inspect.Parameter.VAR_KEYWORD for param in signature.parameters.values())
            )
        except (TypeError, ValueError):
            accepts_status = True
        if accepts_status:
            return await func(ocr_blocks, vision_types, stage_status=stage_status)
        return await func(ocr_blocks, vision_types)

    def _extract_table_cells(self, table_html: str, block: OCRTextBlock) -> list[OCRTextBlock]:
        from app.services.vision.ocr_pipeline import extract_table_cells
        return extract_table_cells(table_html, block)

    def _expand_table_blocks(self, ocr_blocks: list[OCRTextBlock]) -> list[OCRTextBlock]:
        from app.services.vision.ocr_pipeline import expand_table_blocks
        return expand_table_blocks(ocr_blocks)

    def _match_entities_to_ocr(
        self,
        ocr_blocks: list[OCRTextBlock],
        entities: list[dict],
    ) -> list[SensitiveRegion]:
        from app.services.vision.ocr_pipeline import match_entities_to_ocr
        return match_entities_to_ocr(ocr_blocks, entities)

    def _match_ocr_to_vlm(
        self,
        ocr_blocks: list[OCRTextBlock],
        vlm_regions: list[SensitiveRegion],
        iou_threshold: float = 0.3,
    ) -> list[SensitiveRegion]:
        from app.services.vision.image_pipeline import match_ocr_to_vlm
        return match_ocr_to_vlm(ocr_blocks, vlm_regions, iou_threshold)

    def _draw_regions_on_image(
        self,
        image: Image.Image,
        regions: list[SensitiveRegion],
    ) -> Image.Image:
        from app.services.vision.image_pipeline import draw_regions_on_image
        return draw_regions_on_image(image, regions)

    def _merge_regions(
        self,
        regions1: list[SensitiveRegion],
        regions2: list[SensitiveRegion],
        iou_threshold: float = 0.5,
    ) -> list[SensitiveRegion]:
        from app.services.vision.region_merger import merge_regions
        return merge_regions(regions1, regions2, iou_threshold)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def detect_from_text_blocks(
        self,
        ocr_blocks: list[OCRTextBlock],
        vision_types: list | None = None,
    ) -> list[SensitiveRegion]:
        """Run HaS Text over already-positioned text blocks.

        This is used for born-digital PDF pages where PyMuPDF can provide
        native text coordinates. It skips image OCR but keeps semantic
        detection inside HaS Text.
        """
        perf_start = time.perf_counter()
        duration_ms: dict[str, Any] = {"prepare": 0, "ocr": 0}
        self.last_duration_ms = duration_ms

        if vision_types:
            entity_type_ids = _canonicalize_image_text_types([t.id for t in vision_types])
            logger.info("PDF text layer enabled types: %s", [t.name for t in vision_types])
        else:
            entity_type_ids = _canonicalize_image_text_types([
                "PERSON", "ORG", "COMPANY", "PHONE", "EMAIL",
                "ID_CARD", "BANK_CARD", "ACCOUNT_NAME", "BANK_NAME",
                "ACCOUNT_NUMBER", "ADDRESS", "DATE",
            ])

        entities = []
        expanded_blocks = self._expand_table_blocks(ocr_blocks)
        if expanded_blocks and _needs_has_text_analysis(entity_type_ids):
            ner_start = time.perf_counter()
            entities = await self._invoke_has_text_analysis(expanded_blocks, vision_types, duration_ms)
            duration_ms["has_ner"] = round((time.perf_counter() - ner_start) * 1000)
            logger.info(
                "PDF text layer HaS NER finished in %.2fs, entities=%d",
                duration_ms["has_ner"] / 1000,
                len(entities),
            )
        else:
            duration_ms["has_ner"] = 0
            logger.info("PDF text layer HaS NER skipped")

        if entities:
            match_start = time.perf_counter()
            regions = self._match_entities_to_ocr(ocr_blocks, entities)
            duration_ms["match"] = round((time.perf_counter() - match_start) * 1000)
        else:
            regions = []
            duration_ms["match"] = 0

        duration_ms["draw"] = 0
        duration_ms["total"] = round((time.perf_counter() - perf_start) * 1000)
        logger.info(
            "PDF text layer total finished in %.2fs, regions=%d",
            duration_ms["total"] / 1000,
            len(regions),
        )
        return regions

    async def detect_and_draw(
        self,
        image_bytes: bytes,
        vision_types: list | None = None,
        draw_result: bool = True,
    ) -> tuple[list[SensitiveRegion], str | None]:
        """
        检测敏感信息并在图像上绘制

        流程：
        1. PaddleOCR 提取所有文字和精确坐标
        2. HaS 分析文字内容，识别敏感实体（不依赖坐标）
        3. 用文字匹配把敏感实体映射回 OCR 坐标

        Args:
            image_bytes: 图像字节
            vision_types: 用户启用的视觉类型配置列表 (VisionTypeConfig 对象)

        Returns:
            (敏感区域列表, base64编码的带框图像)
        """
        perf_start = time.perf_counter()
        duration_ms: dict[str, Any] = {}
        self.last_duration_ms = duration_ms

        # 准备图像
        prepare_start = time.perf_counter()
        image, width, height = self._prepare_image(image_bytes)
        duration_ms["prepare"] = round((time.perf_counter() - prepare_start) * 1000)
        logger.info("Image size: %dx%d", width, height)

        # 把用户配置转换为类型 ID 列表
        if vision_types:
            entity_type_ids = _canonicalize_image_text_types([t.id for t in vision_types])
            logger.info("User enabled types: %s", [t.name for t in vision_types])
        else:
            entity_type_ids = _canonicalize_image_text_types([
                "PERSON", "ORG", "COMPANY", "PHONE", "EMAIL",
                "ID_CARD", "BANK_CARD", "ACCOUNT_NAME", "BANK_NAME",
                "ACCOUNT_NUMBER", "ADDRESS", "DATE",
            ])

        # 1. 运行 OCR。默认以 PP-StructureV3/文本行为主，VL 仅在
        # run_paddle_ocr 内部发现结构化 OCR 过于稀疏时兜底。
        require_visual_regions = bool(settings.OCR_REQUIRE_VL_FOR_VISUAL_REGIONS)
        ocr_start = time.perf_counter()
        ocr_blocks, visual_regions = await asyncio.to_thread(
            self._run_paddle_ocr,
            image,
            require_visual_regions=require_visual_regions,
            selected_entity_types=entity_type_ids,
            stage_status=duration_ms,
        )
        duration_ms["ocr"] = round((time.perf_counter() - ocr_start) * 1000)
        logger.info("OCR finished in %.2fs, blocks=%d", duration_ms["ocr"] / 1000, len(ocr_blocks))

        all_regions: list[SensitiveRegion] = []

        # 1.5 添加视觉敏感区域（公章等）
        for vr in visual_regions:
            if vr.entity_type in entity_type_ids:
                all_regions.append(vr)
                logger.debug("VL added %s: %s", vr.entity_type, vr.text)
            else:
                logger.debug("VL skipped %s (not in enabled types)", vr.entity_type)

        if ocr_blocks:
            logger.debug("OCR all texts: %s", [b.text for b in ocr_blocks])

            # 展开表格
            ocr_blocks_for_ner = self._expand_table_blocks(ocr_blocks)

            # 2. HaS NER
            entities = []
            if _needs_has_text_analysis(entity_type_ids):
                ner_start = time.perf_counter()
                entities = await self._invoke_has_text_analysis(ocr_blocks_for_ner, vision_types, duration_ms)
                duration_ms["has_ner"] = round((time.perf_counter() - ner_start) * 1000)
                logger.info("HaS NER finished in %.2fs, entities=%d", duration_ms["has_ner"] / 1000, len(entities))
            else:
                duration_ms["has_ner"] = 0
                logger.info("HaS NER skipped; selected vision types are visual-only")

            # 3. 映射实体到 OCR 坐标
            if entities:
                match_start = time.perf_counter()
                matched_regions = self._match_entities_to_ocr(ocr_blocks, entities)
                all_regions.extend(matched_regions)
                duration_ms["match"] = round((time.perf_counter() - match_start) * 1000)
                logger.info("OCR match finished in %.2fs, matches=%d", duration_ms["match"] / 1000, len(matched_regions))
            else:
                duration_ms["match"] = 0

        else:
            duration_ms.setdefault("has_ner", 0)
            duration_ms.setdefault("match", 0)
            logger.warning("PaddleOCR returned no text blocks")

        logger.info("Final detected %d sensitive regions", len(all_regions))

        # 5. 绘制结果
        if not draw_result:
            duration_ms["draw"] = 0
            duration_ms["total"] = round((time.perf_counter() - perf_start) * 1000)
            logger.info("Hybrid total finished in %.2fs (draw skipped)", duration_ms["total"] / 1000)
            return all_regions, None

        draw_start = time.perf_counter()
        result_image = self._draw_regions_on_image(image, all_regions)
        duration_ms["draw"] = round((time.perf_counter() - draw_start) * 1000)
        logger.info("Draw finished in %.2fs", duration_ms["draw"] / 1000)

        # 6. Base64
        buffer = io.BytesIO()
        result_image.save(buffer, format="PNG")
        result_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        duration_ms["total"] = round((time.perf_counter() - perf_start) * 1000)
        logger.info("Hybrid total finished in %.2fs", duration_ms["total"] / 1000)

        return all_regions, result_base64

    async def apply_redaction(
        self,
        image_bytes: bytes,
        regions: list[SensitiveRegion],
        redaction_color: tuple[int, int, int] = (0, 0, 0),
    ) -> bytes:
        """应用匿名化（用纯色块覆盖敏感区域）"""
        from app.services.vision.image_pipeline import apply_redaction as _apply_redaction

        image, _, _ = self._prepare_image(image_bytes)
        result = _apply_redaction(image, regions, redaction_color)

        buffer = io.BytesIO()
        result.save(buffer, format="PNG")
        return buffer.getvalue()


# 单例
_hybrid_service: HybridVisionService | None = None

def get_hybrid_vision_service() -> HybridVisionService:
    global _hybrid_service
    if _hybrid_service is None:
        _hybrid_service = HybridVisionService()
    return _hybrid_service
