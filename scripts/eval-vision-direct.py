# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Direct local vision evaluation for PDFs and images.

This bypasses the authenticated backend API and talks to the local OCR and
HaS Image microservices directly. It is meant for real-file regression checks
when browser/API eval is blocked by local auth.
"""

from __future__ import annotations

import argparse
import base64
import html
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.services.vision.seal_detector import (  # noqa: E402
    detect_dark_seal_regions,
    detect_red_seal_regions,
)
from app.services.vision.ocr_artifact_filter import (  # noqa: E402
    is_page_edge_ocr_artifact as is_page_edge_ocr_artifact_pixels,
    region_has_visible_ink as region_has_visible_ink_pixels,
)
from app.core.has_image_categories import (  # noqa: E402
    OCR_FALLBACK_ONLY_VISUAL_SLUGS,
    SLUG_TO_CLASS_ID,
    normalize_visual_slug,
)

VISUAL_LABELS = {
    "seal",
    "official_seal",
    "fingerprint",
    "photo",
    "qr_code",
    "barcode",
    "signature",
    "handwritten",
    "hand_written",
    "handwritten_signature",
    "handwriting",
    "watermark",
}

VISUAL_TARGET_ALIASES = {
    "seal": {"seal", "official_seal", "stamp"},
    "official_seal": {"seal", "official_seal", "stamp"},
    "stamp": {"seal", "official_seal", "stamp"},
    "face": {"face", "photo", "portrait"},
    "photo": {"face", "photo", "portrait"},
    "portrait": {"face", "photo", "portrait"},
    "qr_code": {"qr_code", "qrcode", "barcode"},
    "qrcode": {"qr_code", "qrcode", "barcode"},
    "barcode": {"qr_code", "qrcode", "barcode"},
}

VISUAL_SOURCE_PRIORITY = {
    "has_image": 4,
    "ocr_ocr": 3,
    "red_seal_fallback": 2,
    "dark_seal_fallback": 2,
}

SEAL_FALLBACK_SOURCES = {"red_seal_fallback", "dark_seal_fallback"}
SIGNATURE_FALLBACK_SLUGS = set(OCR_FALLBACK_ONLY_VISUAL_SLUGS)
SIGNATURE_FALLBACK_WARNINGS = [
    "signature_handwriting_fallback",
    "not_has_image_model_class",
    "not_counted_as_has_image",
]
HAS_IMAGE_MODEL_SLUGS = [
    slug for slug, _class_id in sorted(SLUG_TO_CLASS_ID.items(), key=lambda item: item[1])
]
HAS_IMAGE_CONTRACT = {
    "class_count": len(SLUG_TO_CLASS_ID),
    "class_id_range": [0, len(SLUG_TO_CLASS_ID) - 1],
    "model_source": "has_image",
    "model_slugs": HAS_IMAGE_MODEL_SLUGS,
    "seal_fallback_sources": sorted(SEAL_FALLBACK_SOURCES),
    "signature_fallback_slugs": sorted(SIGNATURE_FALLBACK_SLUGS),
    "fallback_scope": "official_seal and signature/handwriting supplements only; not HaS Image model classes",
}


def parse_args() -> argparse.Namespace:
    write_pages_default = os.environ.get("EVAL_VISION_DIRECT_WRITE_PAGES", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    parser = argparse.ArgumentParser(description="Evaluate local vision services directly.")
    parser.add_argument("input", help="PDF or image path")
    parser.add_argument("output_dir", nargs="?", default="output/playwright/eval-vision-direct")
    parser.add_argument(
        "--pages",
        nargs="+",
        default=os.environ.get("EVAL_VISION_DIRECT_PAGES", ""),
        help="Optional 1-based page selection, for example 5, 1,3-4, or shell-split 1 3-4.",
    )
    parser.add_argument("--scale", type=float, default=float(os.environ.get("EVAL_VISION_DIRECT_SCALE", "2.0")))
    parser.add_argument("--ocr-base-url", default=os.environ.get("OCR_BASE_URL", "http://127.0.0.1:8082"))
    parser.add_argument("--has-image-base-url", default=os.environ.get("HAS_IMAGE_BASE_URL", "http://127.0.0.1:8081"))
    parser.add_argument("--ocr-mode", choices=["structure", "vl", "both", "off"], default=os.environ.get("EVAL_VISION_DIRECT_OCR_MODE", "both"))
    parser.add_argument("--max-new-tokens", type=int, default=int(os.environ.get("OCR_MAX_NEW_TOKENS", "1024")))
    parser.add_argument("--has-image-categories", default=os.environ.get("EVAL_IMAGE_TYPES", ""))
    parser.add_argument("--skip-has-image", action="store_true", default=os.environ.get("EVAL_VISION_DIRECT_SKIP_HAS_IMAGE", "").lower() in {"1", "true", "yes", "on"})
    parser.add_argument("--skip-seal-fallback", action="store_true")
    parser.add_argument(
        "--profile-input-only",
        action="store_true",
        default=os.environ.get("EVAL_VISION_DIRECT_PROFILE_INPUT_ONLY", "").lower() in {"1", "true", "yes", "on"},
        help="Only profile local PDF/image decode, render, text-layer, and fallback detector costs; no service calls.",
    )
    parser.add_argument(
        "--keep-ocr-artifacts",
        action="store_true",
        help="Keep OCR regions that look like scanner/page-edge or blank-area artifacts.",
    )
    parser.add_argument(
        "--keep-ocr-text-regions",
        action="store_true",
        default=os.environ.get("EVAL_VISION_DIRECT_KEEP_OCR_TEXT", "").lower() in {"1", "true", "yes", "on"},
        help="Keep non-visual OCR text/structure regions in final regions and overlays instead of diagnostics only.",
    )
    parser.add_argument("--write-pages", action="store_true", default=write_pages_default)
    parser.add_argument(
        "--min-total-visual-regions",
        type=int,
        default=int(os.environ.get("EVAL_VISION_DIRECT_MIN_TOTAL_VISUAL", "1")),
        help="Fail when the whole run has fewer visual regions.",
    )
    parser.add_argument(
        "--min-page-visual-regions",
        type=int,
        default=int(os.environ.get("EVAL_VISION_DIRECT_MIN_PAGE_VISUAL", "1")),
        help="Fail when any evaluated page has fewer visual regions.",
    )
    parser.add_argument(
        "--min-total-has-image-regions",
        type=int,
        default=int(os.environ.get("EVAL_VISION_DIRECT_MIN_TOTAL_HAS_IMAGE", "0")),
        help="Fail when the whole run has fewer regions from the HaS Image service.",
    )
    parser.add_argument(
        "--min-page-has-image-regions",
        type=int,
        default=int(os.environ.get("EVAL_VISION_DIRECT_MIN_PAGE_HAS_IMAGE", "0")),
        help="Fail when any evaluated page has fewer regions from the HaS Image service.",
    )
    parser.add_argument(
        "--max-warnings",
        type=int,
        default=int(os.environ.get("EVAL_VISION_DIRECT_MAX_WARNINGS", "20")),
        help="Fail when warning count exceeds this value. Use -1 to disable.",
    )
    parser.add_argument(
        "--max-errors",
        type=int,
        default=int(os.environ.get("EVAL_VISION_DIRECT_MAX_ERRORS", "0")),
        help="Fail when service error count exceeds this value. Use -1 to disable.",
    )
    parser.add_argument(
        "--include-private-report-details",
        action="store_true",
        default=os.environ.get("EVAL_REPORT_INCLUDE_PRIVATE_DETAILS", "").lower() in {"1", "true", "yes", "on"},
        help="Write raw input paths and OCR text into local-only reports. Default reports redact them.",
    )
    return parser.parse_args()


def short_hash(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def private_safe_path_ref(input_path: Path, include_private: bool) -> dict[str, Any]:
    resolved = input_path.resolve()
    ref: dict[str, Any] = {
        "label": f"input-01{input_path.suffix.lower()}",
        "extension": input_path.suffix.lower(),
        "path_sha256": short_hash(str(resolved)),
        "basename_sha256": short_hash(input_path.name),
    }
    if include_private:
        ref["path"] = str(resolved)
        ref["basename"] = input_path.name
    return ref


def report_output_dir(output_dir: Path, include_private: bool) -> str:
    resolved = output_dir.resolve()
    if include_private:
        return str(resolved)
    try:
        relative = resolved.relative_to(Path.cwd().resolve())
        return str(relative).replace("\\", "/")
    except ValueError:
        return f"output-{short_hash(str(resolved))}"


def sanitize_region_for_report(region: dict[str, Any], include_private: bool) -> dict[str, Any]:
    if include_private:
        return region
    safe = dict(region)
    text = str(safe.get("text") or "")
    label = str(safe.get("type") or "")
    if text and text != label:
        safe["text"] = "[redacted]"
        safe["text_redacted"] = True
    return safe


def sanitize_regions_for_report(regions: list[dict[str, Any]], include_private: bool) -> list[dict[str, Any]]:
    return [sanitize_region_for_report(region, include_private) for region in regions]


def normalize_pages_arg(value: str | list[str] | tuple[str, ...] | None) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        raw = ",".join(str(item).strip() for item in value if str(item).strip())
    else:
        raw = str(value).strip()
    return ",".join(token for token in raw.replace(",", " ").split() if token)


def parse_pages(value: str | list[str] | tuple[str, ...] | None, page_count: int) -> list[int]:
    normalized = normalize_pages_arg(value)
    if not normalized:
        return list(range(1, page_count + 1))
    selected: list[int] = []
    for part in normalized.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            left, right = token.split("-", 1)
            start = int(left)
            end = int(right)
            if end < start:
                raise ValueError(f"invalid page range: {token}")
            selected.extend(range(start, end + 1))
        else:
            selected.append(int(token))
    deduped = list(dict.fromkeys(selected))
    invalid = [page for page in deduped if page < 1 or page > page_count]
    if invalid:
        raise ValueError(f"page selection out of range 1-{page_count}: {invalid}")
    return deduped


def load_pages(input_path: Path, scale: float, pages_arg: str) -> list[tuple[int, Image.Image]]:
    if input_path.suffix.lower() == ".pdf":
        try:
            import fitz
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("PyMuPDF is required for PDF input. Install package 'pymupdf'.") from exc
        doc = fitz.open(input_path)
        try:
            matrix = fitz.Matrix(max(0.5, scale), max(0.5, scale))
            pages: list[tuple[int, Image.Image]] = []
            for page_number in parse_pages(pages_arg, len(doc)):
                pix = doc[page_number - 1].get_pixmap(matrix=matrix, alpha=False)
                pages.append((page_number, Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")))
            return pages
        finally:
            doc.close()
    selected_pages = parse_pages(pages_arg, 1)
    return [(selected_pages[0], Image.open(input_path).convert("RGB"))]


def elapsed_ms(start: float) -> int:
    return max(0, round((time.perf_counter() - start) * 1000))


def count_pdf_text_blocks(raw: dict[str, Any]) -> tuple[int, int]:
    block_count = 0
    char_count = 0
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            text = "".join(str(span.get("text", "")) for span in line.get("spans", [])).strip()
            if not text:
                continue
            block_count += 1
            char_count += len(text)
    return block_count, char_count


def profile_input_locally(
    input_path: Path,
    *,
    scale: float,
    pages_arg: str | list[str] | tuple[str, ...] | None,
    skip_seal_fallback: bool,
    include_private: bool,
) -> dict[str, Any]:
    wall_start = time.perf_counter()
    input_kind = "pdf" if input_path.suffix.lower() == ".pdf" else "image"
    page_rows: list[dict[str, Any]] = []

    if input_kind == "pdf":
        try:
            import fitz
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("PyMuPDF is required for PDF input. Install package 'pymupdf'.") from exc
        doc = fitz.open(input_path)
        try:
            selected_pages = parse_pages(pages_arg, len(doc))
            matrix = fitz.Matrix(max(0.5, scale), max(0.5, scale))
            for page_number in selected_pages:
                page = doc[page_number - 1]
                row: dict[str, Any] = {"page": page_number}

                text_start = time.perf_counter()
                raw_text = page.get_text("dict")
                row["text_layer_ms"] = elapsed_ms(text_start)
                row["text_blocks"], row["text_chars"] = count_pdf_text_blocks(raw_text)

                render_start = time.perf_counter()
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                row["render_ms"] = elapsed_ms(render_start)
                row["width"] = pix.width
                row["height"] = pix.height
                row["pixels"] = pix.width * pix.height

                encode_start = time.perf_counter()
                png_bytes = pix.tobytes("png")
                row["png_encode_ms"] = elapsed_ms(encode_start)
                row["png_bytes"] = len(png_bytes)

                decode_start = time.perf_counter()
                image = Image.open(io.BytesIO(png_bytes)).convert("RGB")
                row["image_decode_ms"] = elapsed_ms(decode_start)

                if skip_seal_fallback:
                    row["seal_fallback_ms"] = 0
                    row["red_seals"] = 0
                    row["dark_seals"] = 0
                else:
                    fallback_start = time.perf_counter()
                    red_seals = detect_red_seal_regions(image)
                    dark_seals = detect_dark_seal_regions(image)
                    row["seal_fallback_ms"] = elapsed_ms(fallback_start)
                    row["red_seals"] = len(red_seals)
                    row["dark_seals"] = len(dark_seals)

                page_rows.append(row)
        finally:
            doc.close()
    else:
        selected_pages = parse_pages(pages_arg, 1)
        read_start = time.perf_counter()
        image_bytes = input_path.read_bytes()
        read_ms = elapsed_ms(read_start)
        decode_start = time.perf_counter()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        decode_ms = elapsed_ms(decode_start)
        row = {
            "page": selected_pages[0],
            "read_ms": read_ms,
            "image_decode_ms": decode_ms,
            "width": image.width,
            "height": image.height,
            "pixels": image.width * image.height,
            "bytes": len(image_bytes),
            "text_layer_ms": None,
            "text_blocks": None,
            "text_chars": None,
            "render_ms": None,
            "png_encode_ms": None,
            "png_bytes": None,
            "pdf_path_used": False,
        }
        if skip_seal_fallback:
            row["seal_fallback_ms"] = 0
            row["red_seals"] = 0
            row["dark_seals"] = 0
        else:
            fallback_start = time.perf_counter()
            red_seals = detect_red_seal_regions(image)
            dark_seals = detect_dark_seal_regions(image)
            row["seal_fallback_ms"] = elapsed_ms(fallback_start)
            row["red_seals"] = len(red_seals)
            row["dark_seals"] = len(dark_seals)
        page_rows.append(row)

    numeric_totals: dict[str, int] = {}
    for key in (
        "read_ms",
        "text_layer_ms",
        "render_ms",
        "png_encode_ms",
        "image_decode_ms",
        "seal_fallback_ms",
        "png_bytes",
        "bytes",
        "pixels",
        "red_seals",
        "dark_seals",
        "text_blocks",
        "text_chars",
    ):
        values = [row.get(key) for row in page_rows]
        numeric_totals[key] = int(sum(value for value in values if isinstance(value, (int, float))))

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "profile_input_only",
        "input": private_safe_path_ref(input_path, include_private),
        "input_kind": input_kind,
        "scale": scale,
        "selected_pages": [row["page"] for row in page_rows],
        "page_count": len(page_rows),
        "wall_ms": elapsed_ms(wall_start),
        "totals": numeric_totals,
        "pages": page_rows,
        "notes": [
            "PDF inputs measure native text-layer extraction before render.",
            "Image inputs bypass PyMuPDF and have null PDF render/text-layer fields.",
            "Service OCR and HaS Image network/model time are intentionally excluded.",
        ],
    }


def image_to_base64(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def post_json(url: str, payload: dict[str, Any], timeout: float = 360.0) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot connect to {url}: {exc}") from exc


def normalize_region(raw: dict[str, Any], *, source: str, label_key: str = "label") -> dict[str, Any]:
    raw_label = str(raw.get(label_key) or raw.get("category") or "text")
    normalized_label = normalize_visual_slug(raw_label)
    label = normalized_label if normalized_label in SIGNATURE_FALLBACK_SLUGS else raw_label
    text = str(raw.get("text") or label)
    source_detail = str(raw.get("source_detail") or source)
    warnings = [str(item) for item in raw.get("warnings", [])] if isinstance(raw.get("warnings"), list) else []
    if source.startswith("ocr_") and normalized_label in SIGNATURE_FALLBACK_SLUGS:
        source_detail = f"{normalized_label}_ocr_fallback_not_has_image"
        for warning in SIGNATURE_FALLBACK_WARNINGS:
            if warning not in warnings:
                warnings.append(warning)
    return {
        "source": source,
        "source_detail": source_detail,
        "type": label,
        "text": text,
        "x": round(float(raw.get("x", 0)), 6),
        "y": round(float(raw.get("y", 0)), 6),
        "width": round(float(raw.get("width", 0)), 6),
        "height": round(float(raw.get("height", 0)), 6),
        "confidence": round(float(raw.get("confidence", 0.0)), 4),
        "chars": len(text),
        "warnings": warnings,
    }


def fallback_seal_warnings(x: float, y: float, width: float, height: float) -> list[str]:
    warnings = ["fallback_detector"]
    right = x + width
    bottom = y + height
    if x <= 0.04 or y <= 0.04 or right >= 0.96 or bottom >= 0.96:
        warnings.append("edge_seal")
    if x <= 0.025 or right >= 0.975 or (width <= 0.07 and height >= 0.10):
        warnings.append("seam_seal")
    return warnings


def seal_region_to_dict(kind: str, region: Any) -> dict[str, Any]:
    source = f"{kind}_seal_fallback"
    x = round(float(region.x), 6)
    y = round(float(region.y), 6)
    width = round(float(region.width), 6)
    height = round(float(region.height), 6)
    return {
        "source": source,
        "source_detail": source,
        "type": "official_seal",
        "text": "official_seal",
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "confidence": round(float(region.confidence), 4),
        "chars": 0,
        "warnings": fallback_seal_warnings(x, y, width, height),
    }


def ocr_endpoints(mode: str) -> list[str]:
    if mode == "off":
        return []
    if mode == "structure":
        return ["structure"]
    if mode == "vl":
        return ["ocr"]
    return ["structure", "ocr"]


def run_ocr(base_url: str, endpoint: str, image_b64: str, max_new_tokens: int) -> tuple[list[dict[str, Any]], int]:
    payload: dict[str, Any] = {"image": image_b64}
    if endpoint == "ocr":
        payload["max_new_tokens"] = max(128, min(4096, int(max_new_tokens)))
    start = time.perf_counter()
    data = post_json(f"{base_url.rstrip('/')}/{endpoint}", payload)
    elapsed_ms = round((time.perf_counter() - start) * 1000)
    regions = [normalize_region(item, source=f"ocr_{endpoint}") for item in data.get("boxes", [])]
    return regions, elapsed_ms


def normalized_region_pixels(region: dict[str, Any], image: Image.Image) -> tuple[int, int, int, int]:
    width, height = image.size
    x1 = max(0, min(width, int(float(region.get("x", 0)) * width)))
    y1 = max(0, min(height, int(float(region.get("y", 0)) * height)))
    x2 = max(x1 + 1, min(width, int((float(region.get("x", 0)) + float(region.get("width", 0))) * width)))
    y2 = max(y1 + 1, min(height, int((float(region.get("y", 0)) + float(region.get("height", 0))) * height)))
    return x1, y1, x2, y2


def is_page_edge_ocr_artifact(region: dict[str, Any]) -> bool:
    scale = 1_000_000
    x1 = int(float(region.get("x", 0)) * scale)
    y1 = int(float(region.get("y", 0)) * scale)
    x2 = int((float(region.get("x", 0)) + float(region.get("width", 0))) * scale)
    y2 = int((float(region.get("y", 0)) + float(region.get("height", 0))) * scale)
    return is_page_edge_ocr_artifact_pixels(
        x1,
        y1,
        x2 - x1,
        y2 - y1,
        scale,
        scale,
        str(region.get("type", "")),
    )


def region_has_visible_ink(image: Image.Image, region: dict[str, Any]) -> bool:
    x1, y1, x2, y2 = normalized_region_pixels(region, image)
    return region_has_visible_ink_pixels(image, x1, y1, x2 - x1, y2 - y1)


def filter_ocr_artifacts(image: Image.Image, regions: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    removed_by_reason: dict[str, int] = {}
    removed_by_source: dict[str, int] = {}
    for region in regions:
        source = str(region.get("source", ""))
        if not source.startswith("ocr_"):
            kept.append(region)
            continue

        reason = ""
        if is_page_edge_ocr_artifact(region):
            reason = "page_edge"
        elif not region_has_visible_ink(image, region):
            reason = "low_ink"

        if not reason:
            kept.append(region)
            continue

        removed_by_reason[reason] = removed_by_reason.get(reason, 0) + 1
        removed_by_source[source] = removed_by_source.get(source, 0) + 1

    return kept, {
        "input_regions": len(regions),
        "output_regions": len(kept),
        "removed_regions": len(regions) - len(kept),
        "removed_by_reason": removed_by_reason,
        "removed_by_source": removed_by_source,
    }


def is_ocr_region(region: dict[str, Any]) -> bool:
    return str(region.get("source", "")).startswith("ocr_")


def is_visual_region(region: dict[str, Any]) -> bool:
    return str(region.get("type", "")).strip().lower() in VISUAL_LABELS


def split_ocr_text_diagnostics(regions: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    removed_by_source: dict[str, int] = {}

    for region in regions:
        if is_ocr_region(region) and not is_visual_region(region):
            diagnostics.append(region)
            source = str(region.get("source", "unknown"))
            removed_by_source[source] = removed_by_source.get(source, 0) + 1
        else:
            kept.append(region)

    return kept, diagnostics, {
        "input_regions": len(regions),
        "output_regions": len(kept),
        "diagnostic_regions": len(diagnostics),
        "diagnostic_by_source": removed_by_source,
    }


def run_has_image(base_url: str, image_b64: str, categories: list[str] | None) -> tuple[list[dict[str, Any]], int, list[str]]:
    payload: dict[str, Any] = {"image_base64": image_b64}
    if categories is not None:
        payload["categories"] = categories
    start = time.perf_counter()
    data = post_json(f"{base_url.rstrip('/')}/detect", payload)
    elapsed_ms = round((time.perf_counter() - start) * 1000)
    regions: list[dict[str, Any]] = []
    warnings: list[str] = []
    for item in data.get("boxes", []):
        slug = normalize_visual_slug(item.get("category"))
        if slug not in SLUG_TO_CLASS_ID:
            warnings.append(
                f"has_image skipped unsupported model response category '{item.get('category', '')}' "
                "because it is not in the fixed 21-class HaS Image contract"
            )
            continue
        normalized_item = dict(item)
        normalized_item["category"] = slug
        regions.append(normalize_region(normalized_item, source="has_image", label_key="category"))
    return regions, elapsed_ms, warnings


def split_csv(value: str) -> list[str] | None:
    if not value.strip():
        return None
    return [item.strip() for item in value.replace(",", " ").split() if item.strip()]


def model_categories_for_has_image(categories: list[str] | None) -> list[str] | None:
    if categories is None:
        return None
    return [
        slug
        for category in categories
        if (slug := normalize_visual_slug(category)) in SLUG_TO_CLASS_ID
    ]


def wants_fallback_category(categories: list[str] | None, aliases: set[str]) -> bool:
    if categories is None:
        return True
    return any(category in aliases for category in categories)


def draw_regions(image: Image.Image, regions: list[dict[str, Any]]) -> Image.Image:
    out = image.copy()
    draw = ImageDraw.Draw(out)
    width, height = out.size
    colors = {
        "ocr_structure": (37, 99, 235),
        "ocr_ocr": (220, 38, 38),
        "has_image": (126, 34, 206),
        "red_seal_fallback": (220, 38, 38),
        "dark_seal_fallback": (17, 24, 39),
    }
    for index, region in enumerate(regions, 1):
        color = colors.get(str(region["source"]), (15, 118, 110))
        x1 = int(float(region["x"]) * width)
        y1 = int(float(region["y"]) * height)
        x2 = int((float(region["x"]) + float(region["width"])) * width)
        y2 = int((float(region["y"]) + float(region["height"])) * height)
        x1 = max(0, min(width - 1, x1))
        y1 = max(0, min(height - 1, y1))
        x2 = max(x1 + 1, min(width, x2))
        y2 = max(y1 + 1, min(height, y2))
        draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
        draw.text((x1 + 3, max(0, y1 - 14)), str(index), fill=color)
    return out


def summarize_regions(regions: list[dict[str, Any]]) -> dict[str, Any]:
    by_source: dict[str, int] = {}
    by_type: dict[str, int] = {}
    visual_review_by_issue: dict[str, int] = {}
    for region in regions:
        by_source[region["source"]] = by_source.get(region["source"], 0) + 1
        by_type[region["type"]] = by_type.get(region["type"], 0) + 1
        if str(region["type"]).lower() in VISUAL_LABELS and isinstance(region.get("warnings"), list):
            for issue in region["warnings"]:
                issue_key = str(issue)
                visual_review_by_issue[issue_key] = visual_review_by_issue.get(issue_key, 0) + 1
    fallback_count = sum(by_source.get(source, 0) for source in SEAL_FALLBACK_SOURCES)
    signature_fallback_count = sum(
        1
        for region in regions
        if normalize_visual_slug(region.get("type")) in SIGNATURE_FALLBACK_SLUGS
        and str(region.get("source", "")).startswith("ocr_")
    )
    return {
        "region_count": len(regions),
        "char_count": sum(int(region["chars"]) for region in regions),
        "by_source": by_source,
        "by_type": by_type,
        "visual_review_by_issue": visual_review_by_issue,
        "visual_count": sum(1 for region in regions if str(region["type"]).lower() in VISUAL_LABELS),
        "has_image_count": sum(1 for region in regions if region["source"] == "has_image"),
        "has_image_model_count": by_source.get("has_image", 0),
        "seal_fallback_count": fallback_count,
        "signature_fallback_count": signature_fallback_count,
        "red_seal_fallback_count": by_source.get("red_seal_fallback", 0),
        "dark_seal_fallback_count": by_source.get("dark_seal_fallback", 0),
    }


def region_area(region: dict[str, Any]) -> float:
    return max(0.0, float(region.get("width", 0)) * float(region.get("height", 0)))


def region_iou(left: dict[str, Any], right: dict[str, Any]) -> float:
    x1 = max(float(left["x"]), float(right["x"]))
    y1 = max(float(left["y"]), float(right["y"]))
    x2 = min(float(left["x"]) + float(left["width"]), float(right["x"]) + float(right["width"]))
    y2 = min(float(left["y"]) + float(left["height"]), float(right["y"]) + float(right["height"]))
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    union = region_area(left) + region_area(right) - inter
    return inter / union if union > 0 else 0.0


def region_overlap_ratio(left: dict[str, Any], right: dict[str, Any]) -> float:
    x1 = max(float(left["x"]), float(right["x"]))
    y1 = max(float(left["y"]), float(right["y"]))
    x2 = min(float(left["x"]) + float(left["width"]), float(right["x"]) + float(right["width"]))
    y2 = min(float(left["y"]) + float(left["height"]), float(right["y"]) + float(right["height"]))
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    smaller = max(0.000001, min(region_area(left), region_area(right)))
    return inter / smaller


def is_same_visual_target(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_type = str(left.get("type", "")).strip().lower()
    right_type = str(right.get("type", "")).strip().lower()
    if left_type == right_type and left_type in VISUAL_LABELS:
        return True
    return (
        right_type in VISUAL_TARGET_ALIASES.get(left_type, set())
        or left_type in VISUAL_TARGET_ALIASES.get(right_type, set())
    )


def visual_source_priority(region: dict[str, Any]) -> int:
    source = str(region.get("source", ""))
    if str(region.get("type", "")).strip().lower() not in VISUAL_LABELS:
        return 0
    return VISUAL_SOURCE_PRIORITY.get(source, 1)


def are_duplicate_visual_regions(candidate: dict[str, Any], existing: dict[str, Any]) -> bool:
    if not is_same_visual_target(candidate, existing):
        return False
    return region_iou(candidate, existing) >= 0.25 or region_overlap_ratio(candidate, existing) >= 0.65


def dedupe_visual_regions(regions: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    removed_by_source: dict[str, int] = {}
    replacements = 0

    for region in regions:
        duplicate_index = next(
            (
                index
                for index, existing in enumerate(merged)
                if are_duplicate_visual_regions(region, existing)
            ),
            None,
        )
        if duplicate_index is None:
            merged.append(region)
            continue

        existing = merged[duplicate_index]
        candidate_priority = visual_source_priority(region)
        existing_priority = visual_source_priority(existing)
        replace = candidate_priority > existing_priority or (
            candidate_priority == existing_priority
            and float(region.get("confidence", 0)) > float(existing.get("confidence", 0))
            and region_area(region) <= region_area(existing) * 1.25
        )
        removed = existing if replace else region
        removed_source = str(removed.get("source", "unknown"))
        removed_by_source[removed_source] = removed_by_source.get(removed_source, 0) + 1
        if replace:
            merged[duplicate_index] = region
            replacements += 1

    return merged, {
        "input_regions": len(regions),
        "output_regions": len(merged),
        "removed_regions": len(regions) - len(merged),
        "removed_by_source": removed_by_source,
        "replacements": replacements,
    }


def page_warnings(page: int, regions: list[dict[str, Any]], timings: dict[str, int]) -> list[str]:
    warnings: list[str] = []
    visual_regions = [region for region in regions if str(region["type"]).lower() in VISUAL_LABELS]
    if not visual_regions:
        warnings.append(f"page {page}: no visual sensitive regions detected")
    large = [
        region
        for region in visual_regions
        if float(region["width"]) * float(region["height"]) >= 0.04
    ]
    for region in large:
        area = float(region["width"]) * float(region["height"])
        warnings.append(f"page {page}: large {region['type']} region from {region['source']} covers {area:.1%}")
    for source, elapsed_ms in timings.items():
        if elapsed_ms > 120_000:
            warnings.append(f"page {page}: slow {source} call ({elapsed_ms / 1000:.1f}s)")
    if any(region["source"] in {"red_seal_fallback", "dark_seal_fallback"} for region in visual_regions):
        warnings.append(f"page {page}: fallback visual detector contributed regions; inspect overlay")
    signature_fallback_regions = [
        region
        for region in visual_regions
        if normalize_visual_slug(region.get("type")) in SIGNATURE_FALLBACK_SLUGS
        and str(region.get("source", "")).startswith("ocr_")
    ]
    if signature_fallback_regions:
        warnings.append(
            f"page {page}: {len(signature_fallback_regions)} signature/handwriting fallback region(s) "
            "came from OCR/local evidence, not HaS Image model classes"
        )
    edge_seals = sum(
        1 for region in visual_regions
        if isinstance(region.get("warnings"), list) and "edge_seal" in region["warnings"]
    )
    seam_seals = sum(
        1 for region in visual_regions
        if isinstance(region.get("warnings"), list) and "seam_seal" in region["warnings"]
    )
    if edge_seals:
        warnings.append(f"page {page}: {edge_seals} edge seal region(s) need review")
    if seam_seals:
        warnings.append(f"page {page}: {seam_seals} seam seal region(s) need review")
    return warnings


def build_quality_gate(summary: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    thresholds = {
        "min_total_visual_regions": max(0, int(args.min_total_visual_regions)),
        "min_page_visual_regions": max(0, int(args.min_page_visual_regions)),
        "min_total_has_image_regions": max(0, int(args.min_total_has_image_regions)),
        "min_page_has_image_regions": max(0, int(args.min_page_has_image_regions)),
        "max_warnings": int(args.max_warnings),
        "max_errors": int(args.max_errors),
    }
    failed_checks: list[str] = []
    total_visual = int(summary["total_visual_regions"])
    if total_visual < thresholds["min_total_visual_regions"]:
        failed_checks.append(
            f"total visual regions {total_visual} < {thresholds['min_total_visual_regions']}"
        )
    total_has_image = int(summary["total_has_image_regions"])
    if total_has_image < thresholds["min_total_has_image_regions"]:
        failed_checks.append(
            f"total HaS Image regions {total_has_image} < {thresholds['min_total_has_image_regions']}"
        )
    for page in summary["pages"]:
        page_visual = int(page["visual_count"])
        if page_visual < thresholds["min_page_visual_regions"]:
            failed_checks.append(
                f"page {page['page']} visual regions {page_visual} < {thresholds['min_page_visual_regions']}"
            )
        page_has_image = int(page["has_image_count"])
        if page_has_image < thresholds["min_page_has_image_regions"]:
            failed_checks.append(
                f"page {page['page']} HaS Image regions {page_has_image} < {thresholds['min_page_has_image_regions']}"
            )
    warning_count = len(summary["warnings"])
    if thresholds["max_warnings"] >= 0 and warning_count > thresholds["max_warnings"]:
        failed_checks.append(f"warnings {warning_count} > {thresholds['max_warnings']}")
    error_count = sum(len(page.get("errors", [])) for page in summary["pages"])
    if thresholds["max_errors"] >= 0 and error_count > thresholds["max_errors"]:
        failed_checks.append(f"errors {error_count} > {thresholds['max_errors']}")
    return {
        "passed": not failed_checks,
        "thresholds": thresholds,
        "failed_checks": failed_checks,
        "warning_count": warning_count,
        "error_count": error_count,
    }


def render_review_queue(pages: list[dict[str, Any]]) -> str:
    def esc(value: Any) -> str:
        return html.escape(str(value), quote=True)

    rows = [
        page for page in pages
        if page.get("warnings") or int(page.get("has_image_count", 0)) == 0 or int(page.get("visual_count", 0)) == 0
    ]
    if not rows:
        return '<p class="muted">No priority pages.</p>'
    items = []
    for page in rows:
        page_number = int(page["page"])
        reason = "; ".join(page.get("warnings") or ["check visual coverage"])
        items.append(
            f'<li><a href="#page-{page_number:02d}">Page {page_number}</a>: '
            f'{page["visual_count"]} visual / {page["has_image_count"]} HaS Image. '
            f'<span class="warnings">{esc(reason)}</span></li>'
        )
    return f"<ul>{''.join(items)}</ul>"


def write_report(output_dir: Path, summary: dict[str, Any]) -> None:
    def esc(value: Any) -> str:
        return html.escape(str(value), quote=True)

    warnings_html = "".join(f"<li>{esc(item)}</li>" for item in summary["warnings"]) or "<li>No warnings</li>"
    review_queue_html = render_review_queue(summary["pages"])
    quality_gate = summary.get("quality_gate", {})
    failed_html = (
        "".join(f"<li>{esc(item)}</li>" for item in quality_gate.get("failed_checks", []))
        or "<li>No failed checks</li>"
    )
    deduplication = summary.get("deduplication", {})
    removed_by_source = deduplication.get("removed_by_source", {}) or {}
    removed_text = ", ".join(f"{key}: {value}" for key, value in removed_by_source.items()) or "none"
    artifact_filter = summary.get("ocr_artifact_filter", {})
    artifact_reason_text = ", ".join(
        f"{key}: {value}" for key, value in (artifact_filter.get("removed_by_reason", {}) or {}).items()
    ) or "none"
    artifact_source_text = ", ".join(
        f"{key}: {value}" for key, value in (artifact_filter.get("removed_by_source", {}) or {}).items()
    ) or "none"
    ocr_text_filter = summary.get("ocr_text_filter", {})
    ocr_text_source_text = ", ".join(
        f"{key}: {value}" for key, value in (ocr_text_filter.get("diagnostic_by_source", {}) or {}).items()
    ) or "none"
    visual_review_text = ", ".join(
        f"{key}: {value}" for key, value in (summary.get("visual_review_by_issue", {}) or {}).items()
    ) or "none"
    detector_contract = summary.get("detector_contract", {})
    contract_text = (
        f"HaS Image model source '{detector_contract.get('model_source', 'has_image')}' uses "
        f"{detector_contract.get('class_count', 21)} fixed classes "
        f"{esc(detector_contract.get('class_id_range', [0, 20]))}; "
        f"seal fallback sources are separate: "
        f"{', '.join(detector_contract.get('seal_fallback_sources', [])) or 'none'}; "
        f"signature/handwriting fallback slugs are separate: "
        f"{', '.join(detector_contract.get('signature_fallback_slugs', [])) or 'none'}."
    )
    status_class = "pass" if quality_gate.get("passed") else "fail"
    status_text = "PASS" if quality_gate.get("passed") else "FAIL"
    page_sections = []
    for page in summary["pages"]:
        overlay = page.get("overlay_image")
        overlay_html = (
            f'<a href="{esc(overlay)}"><img src="{esc(overlay)}" alt="page {page["page"]} overlay"></a>'
            if overlay
            else "-"
        )
        source_text = ", ".join(f"{key}: {value}" for key, value in page["by_source"].items()) or "-"
        type_text = ", ".join(f"{key}: {value}" for key, value in page["by_type"].items()) or "-"
        issue_text = ", ".join(
            f"{key}: {value}" for key, value in (page.get("visual_review_by_issue", {}) or {}).items()
        ) or "-"
        warning_text = "<br>".join(esc(item) for item in page["warnings"]) or "-"
        page_artifact_filter = page.get("ocr_artifact_filter", {})
        page_artifact_removed = int(page_artifact_filter.get("removed_regions", 0) or 0)
        page_ocr_text_filter = page.get("ocr_text_filter", {})
        page_ocr_text_diagnostics = int(page_ocr_text_filter.get("diagnostic_regions", 0) or 0)
        page_sections.append(
            f"""
            <section id="page-{int(page['page']):02d}">
              <h2>Page {page['page']}</h2>
              <table>
                <tr><th>regions</th><td>{page['region_count']}</td></tr>
                <tr><th>visual</th><td>{page['visual_count']}</td></tr>
                <tr><th>HaS Image</th><td>{page['has_image_count']}</td></tr>
                <tr><th>HaS Image model</th><td>{page['has_image_model_count']}</td></tr>
                <tr><th>seal fallback</th><td>{page['seal_fallback_count']} total; red {page['red_seal_fallback_count']}, dark {page['dark_seal_fallback_count']}</td></tr>
                <tr><th>signature fallback</th><td>{page['signature_fallback_count']} OCR/local; not HaS Image</td></tr>
                <tr><th>sources</th><td>{esc(source_text)}</td></tr>
                <tr><th>types</th><td>{esc(type_text)}</td></tr>
                <tr><th>visual review issues</th><td>{esc(issue_text)}</td></tr>
                <tr><th>OCR artifact filter</th><td>{page_artifact_removed} removed</td></tr>
                <tr><th>OCR text diagnostics</th><td>{page_ocr_text_diagnostics} diagnostic-only</td></tr>
                <tr><th>warnings</th><td class="warnings">{warning_text}</td></tr>
                <tr><th>overlay</th><td>{overlay_html}</td></tr>
              </table>
            </section>
            """
        )
    html_text = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Direct Vision Evaluation</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; background: #f8fafc; }}
    header, section {{ background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }}
    .metric {{ border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; background: #f9fafb; }}
    .metric b {{ display: block; font-size: 24px; margin-top: 4px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ border-bottom: 1px solid #e5e7eb; padding: 7px; text-align: left; vertical-align: top; }}
    img {{ width: min(520px, 100%); border: 1px solid #e5e7eb; border-radius: 6px; }}
    .warnings {{ color: #92400e; }}
    .muted {{ color: #6b7280; }}
    .pass {{ color: #047857; }}
    .fail {{ color: #b91c1c; }}
  </style>
</head>
<body>
  <header>
    <h1>Direct Vision Evaluation</h1>
    <p>{esc(summary['input'])}</p>
    <div class="metrics">
      <div class="metric">Pages<b>{summary['page_count']}</b></div>
      <div class="metric">Regions<b>{summary['total_regions']}</b></div>
      <div class="metric">Visual<b>{summary['total_visual_regions']}</b></div>
      <div class="metric">HaS Image<b>{summary['total_has_image_regions']}</b></div>
      <div class="metric">Seal Fallback<b>{summary['total_seal_fallback_regions']}</b></div>
      <div class="metric">Signature Fallback<b>{summary['total_signature_fallback_regions']}</b></div>
      <div class="metric">Warnings<b>{len(summary['warnings'])}</b></div>
      <div class="metric">Quality<b class="{status_class}">{status_text}</b></div>
      <div class="metric">Deduped<b>{esc(deduplication.get('removed_regions', 0))}</b></div>
      <div class="metric">Wall ms<b>{summary['wall_ms']}</b></div>
    </div>
    <p class="muted">Dedup input {esc(deduplication.get('input_regions', summary['total_regions']))} -> output {esc(deduplication.get('output_regions', summary['total_regions']))}; removed by source: {esc(removed_text)}.</p>
    <p class="muted">{contract_text}</p>
    <p class="muted">Visual review issues by tag: {esc(visual_review_text)}.</p>
    <p class="muted">OCR artifact filter removed {esc(artifact_filter.get('removed_regions', 0))} regions; by reason: {esc(artifact_reason_text)}; by source: {esc(artifact_source_text)}.</p>
    <p class="muted">OCR text diagnostics moved {esc(ocr_text_filter.get('diagnostic_regions', 0))} non-visual OCR regions out of final overlays; by source: {esc(ocr_text_source_text)}.</p>
    <h2>Quality Gate</h2>
    <ul class="{status_class}">{failed_html}</ul>
    <h2>Warnings</h2>
    <ul class="warnings">{warnings_html}</ul>
    <h2>Review Queue</h2>
    {review_queue_html}
  </header>
  {''.join(page_sections)}
</body>
</html>
"""
    (output_dir / "report.html").write_text(html_text, encoding="utf-8")


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    include_private = bool(args.include_private_report_details)
    input_ref = private_safe_path_ref(input_path, include_private)
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.profile_input_only:
        summary = profile_input_locally(
            input_path,
            scale=args.scale,
            pages_arg=args.pages,
            skip_seal_fallback=args.skip_seal_fallback,
            include_private=include_private,
        )
        summary["output_dir"] = report_output_dir(output_dir, include_private)
        output_path = output_dir / "local-profile-summary.json"
        output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        totals = summary["totals"]
        print(f"local profile: {output_path}")
        print(
            f"kind={summary['input_kind']} pages={summary['page_count']} wall={summary['wall_ms']}ms "
            f"text={totals.get('text_layer_ms', 0)}ms render={totals.get('render_ms', 0)}ms "
            f"png={totals.get('png_encode_ms', 0)}ms decode={totals.get('image_decode_ms', 0)}ms "
            f"seal_fallback={totals.get('seal_fallback_ms', 0)}ms"
        )
        for page in summary["pages"]:
            print(
                f"page-{int(page['page']):02d}: text={page.get('text_layer_ms')}ms "
                f"chars={page.get('text_chars')} render={page.get('render_ms')}ms "
                f"png={page.get('png_encode_ms')}ms decode={page.get('image_decode_ms')}ms "
                f"seal_fallback={page.get('seal_fallback_ms')}ms "
                f"seals={int(page.get('red_seals') or 0) + int(page.get('dark_seals') or 0)}"
            )
        return 0
    pages = load_pages(input_path, args.scale, args.pages)
    categories = split_csv(args.has_image_categories)
    has_image_model_categories = model_categories_for_has_image(categories)
    all_warnings: list[str] = []
    page_summaries: list[dict[str, Any]] = []
    total_dedup_input_regions = 0
    total_dedup_removed_by_source: dict[str, int] = {}
    total_dedup_replacements = 0
    total_artifact_input_regions = 0
    total_artifact_removed_by_reason: dict[str, int] = {}
    total_artifact_removed_by_source: dict[str, int] = {}
    total_ocr_text_input_regions = 0
    total_ocr_text_diagnostic_regions = 0
    total_ocr_text_diagnostic_by_source: dict[str, int] = {}
    total_visual_review_by_issue: dict[str, int] = {}
    wall_start = time.perf_counter()

    for page_number, image in pages:
        image_b64 = image_to_base64(image)
        regions: list[dict[str, Any]] = []
        timings: dict[str, int] = {}
        errors: list[str] = []
        extra_warnings: list[str] = []

        for endpoint in ocr_endpoints(args.ocr_mode):
            try:
                ocr_regions, elapsed_ms = run_ocr(args.ocr_base_url, endpoint, image_b64, args.max_new_tokens)
                timings[f"ocr_{endpoint}"] = elapsed_ms
                regions.extend(ocr_regions)
            except Exception as exc:
                errors.append(f"ocr_{endpoint}: {exc}")

        if not args.skip_has_image and (has_image_model_categories is None or len(has_image_model_categories) > 0):
            try:
                has_regions, elapsed_ms, has_image_warnings = run_has_image(args.has_image_base_url, image_b64, has_image_model_categories)
                timings["has_image"] = elapsed_ms
                regions.extend(has_regions)
                extra_warnings.extend(f"page {page_number}: {warning}" for warning in has_image_warnings)
            except Exception as exc:
                errors.append(f"has_image: {exc}")

        if (
            not args.skip_seal_fallback
            and wants_fallback_category(categories, {"seal", "official_seal", "stamp"})
        ):
            regions.extend(seal_region_to_dict("red", region) for region in detect_red_seal_regions(image))
            regions.extend(seal_region_to_dict("dark", region) for region in detect_dark_seal_regions(image))
        if args.keep_ocr_artifacts:
            artifact_filter = {
                "input_regions": len(regions),
                "output_regions": len(regions),
                "removed_regions": 0,
                "removed_by_reason": {},
                "removed_by_source": {},
            }
        else:
            regions, artifact_filter = filter_ocr_artifacts(image, regions)
        total_artifact_input_regions += int(artifact_filter["input_regions"])
        for reason, count in artifact_filter["removed_by_reason"].items():
            total_artifact_removed_by_reason[reason] = total_artifact_removed_by_reason.get(reason, 0) + int(count)
        for source, count in artifact_filter["removed_by_source"].items():
            total_artifact_removed_by_source[source] = total_artifact_removed_by_source.get(source, 0) + int(count)

        if args.keep_ocr_text_regions:
            ocr_text_diagnostics: list[dict[str, Any]] = []
            ocr_text_filter = {
                "input_regions": len(regions),
                "output_regions": len(regions),
                "diagnostic_regions": 0,
                "diagnostic_by_source": {},
            }
        else:
            regions, ocr_text_diagnostics, ocr_text_filter = split_ocr_text_diagnostics(regions)
        total_ocr_text_input_regions += int(ocr_text_filter["input_regions"])
        total_ocr_text_diagnostic_regions += int(ocr_text_filter["diagnostic_regions"])
        for source, count in ocr_text_filter["diagnostic_by_source"].items():
            total_ocr_text_diagnostic_by_source[source] = (
                total_ocr_text_diagnostic_by_source.get(source, 0) + int(count)
            )

        regions, deduplication = dedupe_visual_regions(regions)
        total_dedup_input_regions += int(deduplication["input_regions"])
        total_dedup_replacements += int(deduplication["replacements"])
        for source, count in deduplication["removed_by_source"].items():
            total_dedup_removed_by_source[source] = total_dedup_removed_by_source.get(source, 0) + int(count)

        report_regions = sanitize_regions_for_report(regions, include_private)
        report_ocr_text_diagnostics = sanitize_regions_for_report(ocr_text_diagnostics, include_private)
        page_summary = {
            "page": page_number,
            "width": image.width,
            "height": image.height,
            "timings": timings,
            "errors": errors,
            "ocr_artifact_filter": artifact_filter,
            "ocr_text_filter": ocr_text_filter,
            "ocr_diagnostic_regions": report_ocr_text_diagnostics,
            "deduplication": deduplication,
            "regions": report_regions,
            **summarize_regions(regions),
        }
        page_summary["warnings"] = page_warnings(page_number, regions, timings) + extra_warnings + [
            f"page {page_number}: {error}" for error in errors
        ]
        for issue, count in page_summary["visual_review_by_issue"].items():
            total_visual_review_by_issue[issue] = total_visual_review_by_issue.get(issue, 0) + int(count)
        all_warnings.extend(page_summary["warnings"])
        page_name = f"page-{page_number:02d}"
        (output_dir / f"{page_name}.json").write_text(json.dumps(report_regions, ensure_ascii=False, indent=2), encoding="utf-8")
        if report_ocr_text_diagnostics:
            (output_dir / f"{page_name}-ocr-diagnostics.json").write_text(
                json.dumps(report_ocr_text_diagnostics, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        if args.write_pages:
            overlay_name = f"{page_name}-vision.png"
            draw_regions(image, regions).save(output_dir / overlay_name)
            page_summary["overlay_image"] = overlay_name
        page_summaries.append(page_summary)
        print(
            f"{page_name}: {page_summary['region_count']} regions, "
            f"{page_summary['visual_count']} visual, "
            f"{page_summary['has_image_count']} has_image, "
            f"warnings={len(page_summary['warnings'])}"
        )

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": input_ref["label"],
        "input_ref": input_ref,
        "output_dir": report_output_dir(output_dir, include_private),
        "privacy": {
            "private_details": include_private,
            "note": (
                "Private report details are enabled; paths and OCR text may appear."
                if include_private
                else "Private paths and OCR text are redacted by default. Set EVAL_REPORT_INCLUDE_PRIVATE_DETAILS=1 for local-only raw details."
            ),
        },
        "ocr_mode": args.ocr_mode,
        "ocr_base_url": args.ocr_base_url,
        "has_image_base_url": args.has_image_base_url,
        "has_image_categories": categories,
        "has_image_model_categories": has_image_model_categories,
        "detector_contract": HAS_IMAGE_CONTRACT,
        "keep_ocr_artifacts": bool(args.keep_ocr_artifacts),
        "keep_ocr_text_regions": bool(args.keep_ocr_text_regions),
        "page_count": len(page_summaries),
        "selected_pages": [page["page"] for page in page_summaries],
        "wall_ms": round((time.perf_counter() - wall_start) * 1000),
        "total_regions": sum(int(page["region_count"]) for page in page_summaries),
        "total_visual_regions": sum(int(page["visual_count"]) for page in page_summaries),
        "total_has_image_regions": sum(int(page["has_image_count"]) for page in page_summaries),
        "total_has_image_model_regions": sum(int(page["has_image_model_count"]) for page in page_summaries),
        "total_seal_fallback_regions": sum(int(page["seal_fallback_count"]) for page in page_summaries),
        "total_signature_fallback_regions": sum(int(page["signature_fallback_count"]) for page in page_summaries),
        "total_red_seal_fallback_regions": sum(int(page["red_seal_fallback_count"]) for page in page_summaries),
        "total_dark_seal_fallback_regions": sum(int(page["dark_seal_fallback_count"]) for page in page_summaries),
        "ocr_artifact_filter": {
            "input_regions": total_artifact_input_regions,
            "output_regions": total_artifact_input_regions - sum(total_artifact_removed_by_reason.values()),
            "removed_regions": sum(total_artifact_removed_by_reason.values()),
            "removed_by_reason": total_artifact_removed_by_reason,
            "removed_by_source": total_artifact_removed_by_source,
        },
        "ocr_text_filter": {
            "input_regions": total_ocr_text_input_regions,
            "output_regions": total_ocr_text_input_regions - total_ocr_text_diagnostic_regions,
            "diagnostic_regions": total_ocr_text_diagnostic_regions,
            "diagnostic_by_source": total_ocr_text_diagnostic_by_source,
        },
        "visual_review_by_issue": total_visual_review_by_issue,
        "deduplication": {
            "input_regions": total_dedup_input_regions,
            "output_regions": sum(int(page["region_count"]) for page in page_summaries),
            "removed_regions": total_dedup_input_regions - sum(int(page["region_count"]) for page in page_summaries),
            "removed_by_source": total_dedup_removed_by_source,
            "replacements": total_dedup_replacements,
        },
        "warnings": all_warnings,
        "pages": page_summaries,
    }
    summary["quality_gate"] = build_quality_gate(summary, args)
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(output_dir, summary)
    print(f"summary: {output_dir / 'summary.json'}")
    print(f"report: {output_dir / 'report.html'}")
    print(
        f"pages={summary['page_count']} regions={summary['total_regions']} "
        f"visual={summary['total_visual_regions']} has_image={summary['total_has_image_regions']} "
        f"warnings={len(all_warnings)} "
        f"quality={'pass' if summary['quality_gate']['passed'] else 'fail'}"
    )
    if not summary["quality_gate"]["passed"]:
        for failed_check in summary["quality_gate"]["failed_checks"]:
            print(f"quality gate failed: {failed_check}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
