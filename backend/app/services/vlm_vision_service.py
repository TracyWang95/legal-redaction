from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import uuid
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import httpx
from PIL import Image, ImageOps

from app.core.config import settings
from app.models.schemas import BoundingBox
from app.services import model_config_service

logger = logging.getLogger(__name__)
_vlm_request_semaphore = asyncio.Semaphore(max(1, int(getattr(settings, "VLM_CONCURRENCY", 1) or 1)))


@dataclass(frozen=True)
class _DetectionView:
    name: str
    image_data: bytes
    width: int
    height: int
    crop_x: int
    crop_y: int
    crop_width: int
    crop_height: int
    original_width: int
    original_height: int


def _json_endpoint(base_url: str, suffix: str) -> str:
    base = (base_url or "").rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/{suffix.lstrip('/')}"
    return f"{base}/v1/{suffix.lstrip('/')}"


def _extract_json_payload(text: str) -> dict[str, Any]:
    raw = str(text or "").strip()
    if not raw:
        return {"objects": []}
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"(\{.*\}|\[.*\])", raw, re.S)
        if not match:
            return {"objects": [], "raw_response": text}
        data = json.loads(match.group(1))
    if isinstance(data, list):
        return {"objects": data}
    if isinstance(data, dict):
        objects = data.get("objects")
        if isinstance(objects, list):
            return data
    return {"objects": [], "raw_response": text}


def _type_rules(type_config: Any) -> list[str]:
    rules = getattr(type_config, "rules", None) or []
    if rules:
        return [str(rule).strip() for rule in rules if str(rule).strip()]
    description = str(getattr(type_config, "description", "") or "").strip()
    if description:
        return [description]
    return [str(getattr(type_config, "name", "") or type_config.id)]


def _type_checklist(type_config: Any) -> list[dict[str, str]]:
    checklist = getattr(type_config, "checklist", None) or []
    rows: list[dict[str, str]] = []
    for item in checklist:
        if isinstance(item, dict):
            rule = str(item.get("rule") or "").strip()
            positive = str(item.get("positive_prompt") or "").strip()
            negative = str(item.get("negative_prompt") or "").strip()
        else:
            rule = str(getattr(item, "rule", "") or "").strip()
            positive = str(getattr(item, "positive_prompt", "") or "").strip()
            negative = str(getattr(item, "negative_prompt", "") or "").strip()
        if rule:
            rows.append(
                {
                    "rule": rule,
                    "positive_prompt": positive,
                    "negative_prompt": negative,
                },
            )
    if rows:
        return rows
    return [{"rule": rule, "positive_prompt": "", "negative_prompt": ""} for rule in _type_rules(type_config)]


def _few_shot_messages(type_configs: list[Any]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    remaining = 5
    for item in type_configs:
        if remaining <= 0:
            break
        samples = getattr(item, "few_shot_samples", None) or []
        if not samples:
            continue
        enabled = bool(getattr(item, "few_shot_enabled", True))
        if not enabled:
            continue
        type_id = str(getattr(item, "id", "")).strip()
        name = str(getattr(item, "name", "") or type_id).strip()
        for sample in samples[:remaining]:
            if isinstance(sample, dict):
                sample_type = str(sample.get("type") or "positive").strip()
                image = str(sample.get("image") or "").strip()
                label = str(sample.get("label") or "").strip()
            else:
                sample_type = str(getattr(sample, "type", "positive") or "positive").strip()
                image = str(getattr(sample, "image", "") or "").strip()
                label = str(getattr(sample, "label", "") or "").strip()
            if not image:
                continue
            sample_kind = "positive" if sample_type == "positive" else "negative"
            sample_text = (
                f"Few-shot {sample_kind} sample for type_id={type_id}; name={name}. "
                f"{label or 'Learn this visual boundary and decision rule.'}"
            )
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": image}},
                        {"type": "text", "text": sample_text},
                    ],
                },
            )
            messages.append(
                {
                    "role": "assistant",
                    "content": (
                        f"Understood. This is a {sample_kind} reference for {type_id}. "
                        "Use it only as guidance for the final detection request."
                    ),
                },
            )
            remaining -= 1
            if remaining <= 0:
                break
    return messages


class VlmVisionService:
    """Checklist-driven VLM detector for custom visual features."""

    def __init__(self) -> None:
        self.last_raw_response: str | None = None

    def build_prompt(self, type_configs: list[Any]) -> str:
        coord_mode = int(settings.VLM_COORD_MODE)
        lines: list[str] = [
            "Detect only these visual features. Return compact JSON only.",
            "No explanation. No markdown.",
            "Checklist:",
        ]
        for item in type_configs:
            type_id = str(getattr(item, "id", "")).strip()
            name = str(getattr(item, "name", "") or type_id).strip()
            lines.append(f"- type_id={type_id}; name={name}")
            for index, row in enumerate(_type_checklist(item), start=1):
                lines.append(f"  {index}. Check: {row['rule']}")
                if row["positive_prompt"]:
                    lines.append(f"     Positive: {row['positive_prompt']}")
                if row["negative_prompt"]:
                    lines.append(f"     Negative: {row['negative_prompt']}")
            negative_enabled = bool(getattr(item, "negative_prompt_enabled", False))
            negative = str(getattr(item, "negative_prompt", "") or "").strip()
            if negative_enabled and negative:
                lines.append(f"  Exclude: {negative}")

        allowed_ids = ", ".join(str(getattr(item, "id", "")) for item in type_configs)
        lines.extend(
            [
                'Schema: {"objects":[{"type_id":"signature","label":"signature","box_2d":[xmin,ymin,xmax,ymax],"confidence":0.8,"rule_matched":"signature#1","text":""}]}',
                f"Allowed type_id: {allowed_ids}",
                f"Coordinates are integers in 0..{coord_mode}, origin top-left.",
                "Use one tight box per visible instance. Include faint, partial, occluded, and repeated instances.",
                "Do not merge separate instances into one box. Do not box nearby text, lines, or blank background.",
                "Max 40 objects.",
                'If none, return {"objects":[]}.',
            ],
        )
        return "\n".join(lines)

    def _encode_view(
        self,
        image: Image.Image,
        *,
        name: str,
        crop_x: int,
        crop_y: int,
        crop_width: int,
        crop_height: int,
        original_width: int,
        original_height: int,
        max_side: int,
    ) -> _DetectionView:
        view = image.copy()
        if max(view.size) > max_side:
            view.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        encoded = BytesIO()
        view.save(encoded, format="JPEG", quality=90, optimize=True)
        return _DetectionView(
            name=name,
            image_data=encoded.getvalue(),
            width=view.width,
            height=view.height,
            crop_x=crop_x,
            crop_y=crop_y,
            crop_width=crop_width,
            crop_height=crop_height,
            original_width=original_width,
            original_height=original_height,
        )

    def _detection_views(self, image: Image.Image) -> list[_DetectionView]:
        original_width, original_height = image.size
        full_max_side = max(256, int(getattr(settings, "VLM_MAX_IMAGE_SIDE", 640) or 640))
        return [
            self._encode_view(
                image,
                name="full",
                crop_x=0,
                crop_y=0,
                crop_width=original_width,
                crop_height=original_height,
                original_width=original_width,
                original_height=original_height,
                max_side=full_max_side,
            )
        ]

    async def detect(
        self,
        image_data: bytes,
        page: int,
        type_configs: list[Any],
    ) -> list[BoundingBox]:
        if not type_configs:
            return []
        config = model_config_service.get_vlm_config()
        if not config:
            logger.info("VLM skipped: vlm_service is disabled or missing")
            return []

        img = ImageOps.exif_transpose(Image.open(BytesIO(image_data))).convert("RGB")
        views = self._detection_views(img)
        prompt = self.build_prompt(type_configs)
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"
        max_tokens = int(config.max_tokens or 256)
        max_tokens = max(256, min(max_tokens, 512))
        base_payload: dict[str, Any] = {
            "model": config.model_name or settings.VLM_MODEL_NAME,
            "messages": [],
            "temperature": min(float(config.temperature or 0.1), 0.2),
            "top_p": float(config.top_p or 0.6),
            "max_tokens": max_tokens,
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if config.enable_thinking is False:
            base_payload["thinking"] = {"type": "disabled"}
            base_payload["enable_thinking"] = False

        url = _json_endpoint(config.base_url or settings.VLM_BASE_URL, "chat/completions")
        logger.info(
            "VLM request started: model=%s url=%s types=%d image=%dx%d views=%d timeout=%.1fs",
            base_payload["model"],
            url,
            len(type_configs),
            img.width,
            img.height,
            len(views),
            float(settings.VLM_TIMEOUT),
        )
        boxes: list[BoundingBox] = []
        raw_responses: list[str] = []
        async with _vlm_request_semaphore:
            async with httpx.AsyncClient(timeout=float(settings.VLM_TIMEOUT), trust_env=False) as client:
                for view in views:
                    image_base64 = base64.b64encode(view.image_data).decode("ascii")
                    view_prompt = (
                        f"{prompt}\nDetection view: {view.name}. "
                        "Coordinates must be relative to the supplied image for this request."
                    )
                    payload = {
                        **base_payload,
                        "messages": [
                            *_few_shot_messages(type_configs),
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
                                    },
                                    {"type": "text", "text": view_prompt},
                                ],
                            },
                        ],
                    }
                    response = await client.post(url, headers=headers, json=payload)
                    response.raise_for_status()
                    data = response.json()
                    content = str(data.get("choices", [{}])[0].get("message", {}).get("content", ""))
                    raw_responses.append(f"[{view.name}] {content}")
                    parsed = _extract_json_payload(content)
                    view_boxes = self._objects_to_boxes(
                        parsed.get("objects") or [],
                        type_configs,
                        view,
                        page,
                    )
                    for bbox in view_boxes:
                        if not any(self._is_duplicate(bbox, existing) for existing in boxes):
                            boxes.append(bbox)
        self.last_raw_response = "\n".join(raw_responses)
        logger.info("VLM request parsed %d boxes", len(boxes))
        return boxes

    def _objects_to_boxes(
        self,
        objects: list[Any],
        type_configs: list[Any],
        view: _DetectionView,
        page: int,
    ) -> list[BoundingBox]:
        by_id = {str(getattr(item, "id", "")): item for item in type_configs}
        name_to_id = {
            str(getattr(item, "name", "") or "").strip(): str(getattr(item, "id", ""))
            for item in type_configs
        }
        boxes: list[BoundingBox] = []
        for index, obj in enumerate(objects):
            if not isinstance(obj, dict):
                continue
            confidence = self._confidence(obj.get("confidence"))
            if confidence < 0.3:
                continue
            type_id = str(obj.get("type_id") or "").strip()
            if type_id not in by_id:
                type_id = name_to_id.get(str(obj.get("label") or "").strip(), "")
            if type_id not in by_id and len(type_configs) == 1:
                type_id = str(getattr(type_configs[0], "id", ""))
            if type_id not in by_id:
                continue
            normalized = self._normalize_box(obj.get("box_2d"), view.width, view.height)
            if normalized is None:
                continue
            x, y, box_width, box_height = normalized
            abs_x = view.crop_x + x * view.crop_width
            abs_y = view.crop_y + y * view.crop_height
            abs_width = box_width * view.crop_width
            abs_height = box_height * view.crop_height
            type_config = by_id[type_id]
            label = str(getattr(type_config, "name", "") or obj.get("label") or type_id)
            text = str(obj.get("text") or label).strip() or label
            bbox = BoundingBox(
                id=f"vlm_{index}_{uuid.uuid4().hex[:8]}",
                x=abs_x / view.original_width,
                y=abs_y / view.original_height,
                width=abs_width / view.original_width,
                height=abs_height / view.original_height,
                type=type_id,
                text=text,
                page=page,
                confidence=confidence,
                source="vlm",
                source_detail=f"{obj.get('rule_matched') or 'vlm'}:{view.name}",
                evidence_source="vlm_model",
            )
            if not any(self._is_duplicate(bbox, existing) for existing in boxes):
                boxes.append(bbox)
        return boxes

    @staticmethod
    def _confidence(value: Any) -> float:
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return 0.8

    @staticmethod
    def _normalize_box(raw_box: Any, width: int, height: int) -> tuple[float, float, float, float] | None:
        if not isinstance(raw_box, list | tuple) or len(raw_box) != 4:
            return None
        try:
            x1, y1, x2, y2 = [float(v) for v in raw_box]
        except (TypeError, ValueError):
            return None
        coord = max(1.0, float(settings.VLM_COORD_MODE))
        # Accept either 0..1000 VLM coordinates or direct pixel coordinates.
        if max(x1, y1, x2, y2) <= coord * 1.05:
            x1, x2 = x1 / coord * width, x2 / coord * width
            y1, y2 = y1 / coord * height, y2 / coord * height
        x1, x2 = sorted((max(0.0, min(float(width), x1)), max(0.0, min(float(width), x2))))
        y1, y2 = sorted((max(0.0, min(float(height), y1)), max(0.0, min(float(height), y2))))
        if x2 - x1 < 2 or y2 - y1 < 2:
            return None
        if ((x2 - x1) * (y2 - y1)) / max(1.0, width * height) > 0.85:
            return None
        return x1 / width, y1 / height, (x2 - x1) / width, (y2 - y1) / height

    @staticmethod
    def _is_duplicate(candidate: BoundingBox, existing: BoundingBox) -> bool:
        if candidate.type != existing.type:
            return False
        x1 = max(candidate.x, existing.x)
        y1 = max(candidate.y, existing.y)
        x2 = min(candidate.x + candidate.width, existing.x + existing.width)
        y2 = min(candidate.y + candidate.height, existing.y + existing.height)
        if x2 <= x1 or y2 <= y1:
            return False
        inter = (x2 - x1) * (y2 - y1)
        area_a = candidate.width * candidate.height
        area_b = existing.width * existing.height
        union = area_a + area_b - inter
        smaller = min(area_a, area_b)
        return (inter / union if union > 0 else 0.0) > 0.3 or (
            inter / smaller if smaller > 0 else 0.0
        ) > 0.7

    @staticmethod
    def _overlap_ratio(candidate: BoundingBox, existing: BoundingBox) -> float:
        x1 = max(candidate.x, existing.x)
        y1 = max(candidate.y, existing.y)
        x2 = min(candidate.x + candidate.width, existing.x + existing.width)
        y2 = min(candidate.y + candidate.height, existing.y + existing.height)
        if x2 <= x1 or y2 <= y1:
            return 0.0
        inter = (x2 - x1) * (y2 - y1)
        area = max(candidate.width * candidate.height, 1e-9)
        return inter / area
