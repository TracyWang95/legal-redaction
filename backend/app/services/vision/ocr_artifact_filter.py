# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Shared filters for OCR boxes that are scanner or page-edge artifacts."""

from __future__ import annotations

from PIL import Image

VISUAL_OCR_TYPES = {
    "BARCODE",
    "FACE",
    "FINGERPRINT",
    "HANDWRITING",
    "HANDWRITTEN_SIGNATURE",
    "OFFICIAL_SEAL",
    "PHOTO",
    "PORTRAIT",
    "QR_CODE",
    "QRCODE",
    "SEAL",
    "SIGNATURE",
    "STAMP",
    "WATERMARK",
}


def is_visual_ocr_type(entity_type: str | None) -> bool:
    return str(entity_type or "").strip().upper() in VISUAL_OCR_TYPES


def is_page_edge_ocr_artifact(
    left: int,
    top: int,
    region_width: int,
    region_height: int,
    page_width: int,
    page_height: int,
    entity_type: str | None = None,
) -> bool:
    if page_width <= 0 or page_height <= 0 or is_visual_ocr_type(entity_type):
        return False

    x = left / page_width
    y = top / page_height
    width = region_width / page_width
    height = region_height / page_height

    if x <= 0.015 and width >= 0.08:
        return True
    if x <= 0.04 and y <= 0.02 and width >= 0.10 and height >= 0.06:
        return True
    if y <= 0.012 and width >= 0.12 and height <= 0.05:
        return True
    if (x + width >= 0.965 or x >= 0.93) and height >= 0.06 and width <= 0.06:
        return True
    return y + height >= 0.975 and width >= 0.10 and height <= 0.035


def region_has_visible_ink(
    image: Image.Image,
    left: int,
    top: int,
    region_width: int,
    region_height: int,
) -> bool:
    width, height = image.size
    x1 = max(0, min(width, int(left)))
    y1 = max(0, min(height, int(top)))
    x2 = max(x1 + 1, min(width, int(left + region_width)))
    y2 = max(y1 + 1, min(height, int(top + region_height)))
    crop = image.crop((x1, y1, x2, y2)).convert("RGB")
    raw = crop.tobytes()
    area = max(1, crop.width * crop.height)
    ink = 0
    for idx in range(0, len(raw), 3):
        r, g, b = raw[idx], raw[idx + 1], raw[idx + 2]
        if min(r, g, b) < 185 or (r > 120 and r > g * 1.18 and r > b * 1.12):
            ink += 1
    density = ink / area
    page_area = max(1, width * height)
    region_area_ratio = area / page_area
    min_density = 0.004 if region_area_ratio < 0.006 else 0.008
    return density >= min_density
