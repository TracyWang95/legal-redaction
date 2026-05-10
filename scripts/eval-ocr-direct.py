# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Direct OCR microservice evaluation for PDFs and images.

This intentionally bypasses the authenticated backend API and calls the OCR
service on port 8082 directly. It gives a fast, inspectable baseline for real
scanned files when browser/API eval flows are blocked by local auth.
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


VISUAL_OCR_LABELS = {"seal", "fingerprint", "photo", "qr_code", "barcode", "handwriting", "watermark"}

HAS_IMAGE_CONTEXT = {
    "has_image_model_run": False,
    "class_count": 21,
    "class_id_range": [0, 20],
    "scope": "OCR-only eval; HaS Image model hits and seal fallback are reported by eval-vision-direct.py",
}


def parse_args() -> argparse.Namespace:
    write_pages_default = os.environ.get("EVAL_OCR_WRITE_PAGES", "").lower() in {"1", "true", "yes", "on"}
    parser = argparse.ArgumentParser(description="Evaluate the OCR microservice directly.")
    parser.add_argument("input", help="PDF or image path")
    parser.add_argument("output_dir", nargs="?", default="output/playwright/eval-ocr-direct")
    parser.add_argument("--scale", type=float, default=2.0, help="PDF render scale. Default: 2.0")
    parser.add_argument(
        "--mode",
        choices=["structure", "vl", "both"],
        default=os.environ.get("EVAL_OCR_DIRECT_MODE", "structure"),
        help="OCR endpoint mode. Default: structure",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("OCR_BASE_URL", "http://127.0.0.1:8082"),
        help="OCR service base URL. Default: http://127.0.0.1:8082",
    )
    parser.add_argument(
        "--max-new-tokens",
        type=int,
        default=int(os.environ.get("OCR_MAX_NEW_TOKENS", "1024")),
        help="PaddleOCR-VL max_new_tokens for --mode vl/both. Default: 1024",
    )
    parser.add_argument(
        "--pages",
        nargs="+",
        default=os.environ.get("EVAL_OCR_PAGES", ""),
        help="Optional 1-based page selection for PDFs, for example 5, 1,3-4, or shell-split 1 3-4.",
    )
    parser.add_argument(
        "--write-pages",
        action="store_true",
        default=write_pages_default,
        help="Write OCR overlay PNGs. Can also be enabled with EVAL_OCR_WRITE_PAGES=true.",
    )
    parser.add_argument(
        "--min-total-boxes",
        type=int,
        default=int(os.environ.get("EVAL_OCR_MIN_TOTAL_BOXES", "-1")),
        help="Fail below this total OCR box count. Default: evaluated page count.",
    )
    parser.add_argument(
        "--min-page-boxes",
        type=int,
        default=int(os.environ.get("EVAL_OCR_MIN_PAGE_BOXES", "1")),
        help="Fail when any evaluated page has fewer OCR boxes. Default: 1.",
    )
    parser.add_argument(
        "--max-warnings",
        type=int,
        default=int(os.environ.get("EVAL_OCR_MAX_WARNINGS", "-1")),
        help="Fail when warning count exceeds this value. Use -1 to disable.",
    )
    parser.add_argument(
        "--max-errors",
        type=int,
        default=int(os.environ.get("EVAL_OCR_MAX_ERRORS", "0")),
        help="Fail when endpoint error count exceeds this value. Default: 0.",
    )
    return parser.parse_args()


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


def load_pages(input_path: Path, scale: float, pages_arg: str = "") -> list[tuple[int, Image.Image]]:
    if input_path.suffix.lower() == ".pdf":
        try:
            import fitz
        except Exception as exc:  # pragma: no cover - depends on local install
            raise RuntimeError("PyMuPDF is required for PDF input. Install package 'pymupdf'.") from exc
        doc = fitz.open(input_path)
        matrix = fitz.Matrix(max(0.5, scale), max(0.5, scale))
        pages: list[tuple[int, Image.Image]] = []
        for page_number in parse_pages(pages_arg, len(doc)):
            page = doc[page_number - 1]
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            pages.append((page_number, Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")))
        return pages
    selected_pages = parse_pages(pages_arg, 1)
    return [(selected_pages[0], Image.open(input_path).convert("RGB"))]


def image_to_base64(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def post_json(url: str, payload: dict[str, Any], timeout: float = 360.0) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"HTTP {exc.code} from {url}: {text}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot connect to {url}: {exc}") from exc


def normalize_box(box: dict[str, Any]) -> dict[str, Any]:
    text = str(box.get("text", ""))
    return {
        "text": text,
        "x": round(float(box.get("x", 0)), 6),
        "y": round(float(box.get("y", 0)), 6),
        "width": round(float(box.get("width", 0)), 6),
        "height": round(float(box.get("height", 0)), 6),
        "confidence": round(float(box.get("confidence", 0)), 4),
        "label": str(box.get("label", "text")),
        "chars": len(text),
    }


def summarize_boxes(boxes: list[dict[str, Any]]) -> dict[str, Any]:
    labels: dict[str, int] = {}
    for box in boxes:
        labels[box["label"]] = labels.get(box["label"], 0) + 1
    visual_labels = {
        label: count
        for label, count in labels.items()
        if label.lower() in VISUAL_OCR_LABELS
    }
    return {
        "box_count": len(boxes),
        "char_count": sum(int(box["chars"]) for box in boxes),
        "labels": labels,
        "visual_labels": visual_labels,
        "samples": [box["text"][:80] for box in boxes[:8]],
    }


def layout_quality_warnings(endpoint: str, page: int, boxes: list[dict[str, Any]]) -> list[str]:
    """Flag OCR that has text but poor box granularity for redaction review.

    Character count alone can look healthy when a table or whole paragraph is
    returned as one huge box. These warnings make that failure mode visible in
    real-file eval reports.
    """
    if not boxes:
        return []
    warnings: list[str] = []
    char_count = sum(int(box["chars"]) for box in boxes)
    labels: dict[str, int] = {}
    largest_area = 0.0
    largest_label = ""
    for box in boxes:
        labels[box["label"]] = labels.get(box["label"], 0) + 1
        area = float(box["width"]) * float(box["height"])
        if area > largest_area:
            largest_area = area
            largest_label = box["label"]

    if endpoint == "ocr" and labels.get("table", 0) and len(boxes) <= 4 and char_count >= 250:
        warnings.append(
            f"page {page} {endpoint}: coarse table layout ({len(boxes)} boxes, {char_count} chars); compare structure endpoint for cell-level boxes"
        )
    if largest_area >= 0.35 and char_count >= 250:
        warnings.append(
            f"page {page} {endpoint}: very large {largest_label or 'text'} box covers {largest_area:.0%} of page; inspect redaction box precision"
        )
    if len(boxes) <= 5 and char_count >= 450:
        warnings.append(
            f"page {page} {endpoint}: coarse OCR segmentation ({len(boxes)} boxes for {char_count} chars)"
        )
    return warnings


def draw_ocr_boxes(image: Image.Image, boxes: list[dict[str, Any]], endpoint: str) -> Image.Image:
    out = image.copy()
    draw = ImageDraw.Draw(out)
    width, height = out.size
    color = (37, 99, 235) if endpoint == "structure" else (220, 38, 38)
    for index, box in enumerate(boxes, 1):
        x1 = int(float(box["x"]) * width)
        y1 = int(float(box["y"]) * height)
        x2 = int((float(box["x"]) + float(box["width"])) * width)
        y2 = int((float(box["y"]) + float(box["height"])) * height)
        x1 = max(0, min(width - 1, x1))
        y1 = max(0, min(height - 1, y1))
        x2 = max(x1 + 1, min(width, x2))
        y2 = max(y1 + 1, min(height, y2))
        draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
        draw.text((x1 + 3, max(0, y1 - 14)), str(index), fill=color)
    return out


def page_warnings(endpoint: str, page: int, elapsed_ms: int, box_count: int, char_count: int) -> list[str]:
    warnings: list[str] = []
    if box_count == 0:
        warnings.append(f"page {page} {endpoint}: no OCR boxes returned")
    elif char_count < 200:
        warnings.append(f"page {page} {endpoint}: sparse OCR text ({char_count} chars)")
    if elapsed_ms > 120_000:
        warnings.append(f"page {page} {endpoint}: slow OCR call ({elapsed_ms / 1000:.1f}s)")
    return warnings


def page_review_items(endpoint: str, page: int, visual_labels: dict[str, int]) -> list[str]:
    if not visual_labels:
        return []
    label_text = ", ".join(f"{label}={count}" for label, count in sorted(visual_labels.items()))
    return [f"page {page} {endpoint}: visual OCR labels detected ({label_text})"]


def run_endpoint(base_url: str, endpoint: str, image_b64: str, max_new_tokens: int) -> tuple[dict[str, Any], int]:
    url = f"{base_url.rstrip('/')}/{endpoint}"
    payload: dict[str, Any] = {"image": image_b64}
    if endpoint == "ocr":
        payload["max_new_tokens"] = max(128, min(4096, int(max_new_tokens)))
    start = time.perf_counter()
    data = post_json(url, payload)
    elapsed_ms = round((time.perf_counter() - start) * 1000)
    return data, elapsed_ms


def build_quality_gate(summary: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    expected_pages = max(1, int(summary["page_count"]))
    min_total_boxes = int(args.min_total_boxes)
    if min_total_boxes < 0:
        min_total_boxes = expected_pages
    thresholds = {
        "min_total_boxes": max(0, min_total_boxes),
        "min_page_boxes": max(0, int(args.min_page_boxes)),
        "max_warnings": int(args.max_warnings),
        "max_errors": int(args.max_errors),
    }
    failed_checks: list[str] = []
    total_boxes = int(summary["total_boxes"])
    if total_boxes < thresholds["min_total_boxes"]:
        failed_checks.append(f"total boxes {total_boxes} < {thresholds['min_total_boxes']}")
    for page in summary["pages"]:
        page_boxes = sum(int(result["box_count"]) for result in page["results"])
        if page_boxes < thresholds["min_page_boxes"]:
            failed_checks.append(f"page {page['page']} boxes {page_boxes} < {thresholds['min_page_boxes']}")
    warning_count = len(summary["warnings"])
    if thresholds["max_warnings"] >= 0 and warning_count > thresholds["max_warnings"]:
        failed_checks.append(f"warnings {warning_count} > {thresholds['max_warnings']}")
    error_count = sum(1 for page in summary["pages"] for result in page["results"] if result.get("error"))
    if thresholds["max_errors"] >= 0 and error_count > thresholds["max_errors"]:
        failed_checks.append(f"errors {error_count} > {thresholds['max_errors']}")
    return {
        "passed": not failed_checks,
        "thresholds": thresholds,
        "failed_checks": failed_checks,
        "warning_count": warning_count,
        "error_count": error_count,
        "total_boxes": total_boxes,
    }


def write_report(output_dir: Path, summary: dict[str, Any]) -> None:
    def esc(value: Any) -> str:
        return html.escape(str(value), quote=True)

    def warning_html_item(item: str) -> str:
        parts = str(item).split(" ", 2)
        if len(parts) >= 3 and parts[0] == "page" and parts[1].isdigit():
            page_number = int(parts[1])
            return f'<li><a href="#page-{page_number:02d}">Page {page_number}</a>: {esc(parts[2])}</li>'
        return f"<li>{esc(item)}</li>"

    def review_html_item(item: str) -> str:
        parts = str(item).split(" ", 2)
        if len(parts) >= 3 and parts[0] == "page" and parts[1].isdigit():
            page_number = int(parts[1])
            return f'<li><a href="#page-{page_number:02d}">Page {page_number}</a>: {esc(parts[2])}</li>'
        return f"<li>{esc(item)}</li>"

    warning_html = "".join(warning_html_item(item) for item in summary["warnings"]) or "<li>No warnings</li>"
    review_html = "".join(review_html_item(item) for item in summary["review_items"]) or "<li>No review items</li>"
    quality_gate = summary.get("quality_gate", {})
    failed_html = (
        "".join(f"<li>{esc(item)}</li>" for item in quality_gate.get("failed_checks", []))
        or "<li>No failed checks</li>"
    )
    status_class = "pass" if quality_gate.get("passed") else "fail"
    status_text = "PASS" if quality_gate.get("passed") else "FAIL"
    has_image_context = summary.get("has_image_context", HAS_IMAGE_CONTEXT)
    has_image_context_text = (
        f"HaS Image model was not run in this OCR report. The model contract is "
        f"{has_image_context.get('class_count', 21)} fixed classes "
        f"{esc(has_image_context.get('class_id_range', [0, 20]))}; "
        "model hits and seal fallback counts belong to the vision report."
    )
    page_sections: list[str] = []
    for page in summary["pages"]:
        endpoint_rows = []
        for result in page["results"]:
            image_name = result.get("overlay_image")
            image_path = output_dir / image_name if image_name else None
            image_html = (
                f'<a href="{esc(image_name)}"><img src="{esc(image_name)}" alt="page {page["page"]} {result["endpoint"]} OCR overlay"></a>'
                if image_name and image_path and image_path.exists()
                else "-"
            )
            samples = "<br>".join(esc(sample) for sample in result["samples"])
            labels = ", ".join(f"{key}: {value}" for key, value in result["labels"].items()) or "-"
            endpoint_rows.append(
                "<tr>"
                f"<td>{esc(result['endpoint'])}</td>"
                f"<td>{result['box_count']}</td>"
                f"<td>{result['char_count']}</td>"
                f"<td>{result['elapsed_ms']}</td>"
                f"<td>{esc(labels)}</td>"
                f"<td>{image_html}</td>"
                f"<td>{samples}</td>"
                "</tr>"
            )
        page_sections.append(
            f"""
            <section id="page-{int(page['page']):02d}">
              <h2>Page {page['page']}</h2>
              <p>{page['width']} x {page['height']} px</p>
              <table>
                <thead><tr><th>endpoint</th><th>boxes</th><th>chars</th><th>ms</th><th>labels</th><th>overlay</th><th>samples</th></tr></thead>
                <tbody>{''.join(endpoint_rows)}</tbody>
              </table>
            </section>
            """
        )

    html_text = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Direct OCR Evaluation</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; background: #f8fafc; }}
    header, section {{ background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }}
    h1, h2 {{ margin: 0 0 12px; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }}
    .metric {{ border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; background: #f9fafb; }}
    .metric b {{ display: block; font-size: 24px; margin-top: 4px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ border-bottom: 1px solid #e5e7eb; padding: 6px; text-align: left; vertical-align: top; }}
    th {{ background: #f3f4f6; }}
    img {{ width: min(360px, 100%); border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; }}
    .warnings {{ color: #92400e; }}
    .warnings a {{ color: #92400e; font-weight: 700; }}
    .review-items {{ color: #075985; }}
    .review-items a {{ color: #075985; font-weight: 700; }}
    .pass {{ color: #047857; }}
    .fail {{ color: #b91c1c; }}
  </style>
</head>
<body>
  <header>
    <h1>Direct OCR Evaluation</h1>
    <p>{esc(summary['input'])}</p>
    <div class="metrics">
      <div class="metric">Pages<b>{summary['page_count']}</b></div>
      <div class="metric">Endpoints<b>{', '.join(summary['endpoints'])}</b></div>
      <div class="metric">Boxes<b>{summary['total_boxes']}</b></div>
      <div class="metric">Chars<b>{summary['total_chars']}</b></div>
      <div class="metric">Warnings<b>{len(summary['warnings'])}</b></div>
      <div class="metric">Review Items<b>{len(summary['review_items'])}</b></div>
      <div class="metric">Quality<b class="{status_class}">{status_text}</b></div>
    </div>
    <p>{has_image_context_text}</p>
    <h2>Quality Gate</h2>
    <ul class="{status_class}">{failed_html}</ul>
    <h2>Warnings</h2>
    <ul class="warnings">{warning_html}</ul>
    <h2>Review Items</h2>
    <ul class="review-items">{review_html}</ul>
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
    output_dir.mkdir(parents=True, exist_ok=True)
    endpoints = ["structure"] if args.mode == "structure" else ["ocr"] if args.mode == "vl" else ["structure", "ocr"]
    pages = load_pages(input_path, args.scale, args.pages)
    page_summaries: list[dict[str, Any]] = []
    warnings: list[str] = []
    review_items: list[str] = []

    for page_number, image in pages:
        image_b64 = image_to_base64(image)
        page_results: list[dict[str, Any]] = []
        for endpoint in endpoints:
            try:
                data, elapsed_ms = run_endpoint(args.base_url, endpoint, image_b64, args.max_new_tokens)
                boxes = [normalize_box(box) for box in data.get("boxes", [])]
                endpoint_summary = {
                    "endpoint": endpoint,
                    "elapsed_ms": elapsed_ms,
                    **summarize_boxes(boxes),
                }
                warnings.extend(
                    page_warnings(
                        endpoint,
                        page_number,
                        elapsed_ms,
                        int(endpoint_summary["box_count"]),
                        int(endpoint_summary["char_count"]),
                    )
                )
                warnings.extend(layout_quality_warnings(endpoint, page_number, boxes))
                review_items.extend(
                    page_review_items(
                        endpoint,
                        page_number,
                        endpoint_summary["visual_labels"],
                    )
                )
                (output_dir / f"page-{page_number:02d}-{endpoint}.json").write_text(
                    json.dumps(boxes, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                if args.write_pages:
                    overlay_name = f"page-{page_number:02d}-{endpoint}.png"
                    draw_ocr_boxes(image, boxes, endpoint).save(output_dir / overlay_name)
                    endpoint_summary["overlay_image"] = overlay_name
            except Exception as exc:
                endpoint_summary = {
                    "endpoint": endpoint,
                    "elapsed_ms": 0,
                    "box_count": 0,
                    "char_count": 0,
                    "labels": {},
                    "visual_labels": {},
                    "samples": [],
                    "error": str(exc),
                }
                warnings.append(f"page {page_number} {endpoint}: {exc}")
            page_results.append(endpoint_summary)
            print(
                f"page-{page_number:02d} {endpoint}: "
                f"{endpoint_summary['box_count']} boxes, {endpoint_summary['char_count']} chars, "
                f"{endpoint_summary['elapsed_ms']}ms"
            )
        page_summaries.append({
            "page": page_number,
            "width": image.width,
            "height": image.height,
            "results": page_results,
        })

    total_boxes = sum(int(result["box_count"]) for page in page_summaries for result in page["results"])
    total_chars = sum(int(result["char_count"]) for page in page_summaries for result in page["results"])
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(input_path),
        "output_dir": str(output_dir),
        "base_url": args.base_url,
        "mode": args.mode,
        "endpoints": endpoints,
        "selected_pages": [page["page"] for page in page_summaries],
        "max_new_tokens": max(128, min(4096, int(args.max_new_tokens))),
        "page_count": len(page_summaries),
        "total_boxes": total_boxes,
        "total_chars": total_chars,
        "has_image_context": HAS_IMAGE_CONTEXT,
        "warnings": warnings,
        "review_items": review_items,
        "pages": page_summaries,
    }
    summary["quality_gate"] = build_quality_gate(summary, args)
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(output_dir, summary)
    print(f"summary: {output_dir / 'summary.json'}")
    print(f"report: {output_dir / 'report.html'}")
    print(
        f"pages={summary['page_count']} boxes={total_boxes} chars={total_chars} "
        f"warnings={len(warnings)} review_items={len(review_items)} "
        f"quality={'pass' if summary['quality_gate']['passed'] else 'fail'}"
    )
    if not summary["quality_gate"]["passed"]:
        for failed_check in summary["quality_gate"]["failed_checks"]:
            print(f"quality gate failed: {failed_check}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
