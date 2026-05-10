#!/usr/bin/env python
# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Offline seal fallback evaluation for PDFs and images.

This intentionally avoids the backend API. It is useful when local auth blocks
browser/API flows, or when only the lightweight visual fallback detectors need
to be checked against real contracts.
"""

from __future__ import annotations

import argparse
import html
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from PIL import Image, ImageDraw  # noqa: E402

from app.services.vision.seal_detector import detect_dark_seal_regions, detect_red_seal_regions  # noqa: E402

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
DEFAULT_MAX_REGION_AREA = 0.05
SEAL_FALLBACK_CONTEXT = {
    "has_image_model_run": False,
    "has_image_class_count": 21,
    "has_image_class_id_range": [0, 20],
    "detector_scope": "Offline red/dark seal fallback only; model hits are reported by eval-vision-direct.py",
    "fallback_kinds": ["red", "dark"],
}


def parse_args() -> argparse.Namespace:
    write_pages_default = os.environ.get("EVAL_SEAL_WRITE_PAGES", "").lower() in {"1", "true", "yes", "on"}
    parser = argparse.ArgumentParser(
        description="Run offline seal fallback detection on a PDF or image.",
        epilog="Set EVAL_SEAL_WRITE_PAGES=true when invoking through npm on shells that consume -- flags.",
    )
    parser.add_argument("input", help="PDF or image path")
    parser.add_argument("output_dir", nargs="?", default="output/playwright/eval-seal-offline")
    parser.add_argument("--scale", type=float, default=2.0, help="PDF render scale. Default: 2.0")
    parser.add_argument(
        "--min-total-regions",
        type=int,
        default=int(os.environ.get("EVAL_SEAL_MIN_TOTAL_REGIONS", "1")),
        help="Fail when the whole run has fewer seal candidates. Default: 1.",
    )
    parser.add_argument(
        "--min-page-regions",
        type=int,
        default=int(os.environ.get("EVAL_SEAL_MIN_PAGE_REGIONS", "0")),
        help="Fail when any page has fewer seal candidates. Default: 0.",
    )
    parser.add_argument(
        "--max-warnings",
        type=int,
        default=int(os.environ.get("EVAL_SEAL_MAX_WARNINGS", "-1")),
        help="Fail when warning count exceeds this value. Use -1 to disable. Default: -1.",
    )
    parser.add_argument(
        "--max-high-warnings",
        type=int,
        default=int(os.environ.get("EVAL_SEAL_MAX_HIGH_WARNINGS", "0")),
        help="Fail when high-severity warning count exceeds this value. Default: 0.",
    )
    parser.add_argument(
        "--max-region-area",
        type=float,
        default=float(os.environ.get("EVAL_SEAL_MAX_REGION_AREA", str(DEFAULT_MAX_REGION_AREA))),
        help="Fail when any seal candidate bbox exceeds this normalized page area. Default: 0.05.",
    )
    parser.add_argument(
        "--write-pages",
        action="store_true",
        default=write_pages_default,
        help="Write annotated page PNGs. Can also be enabled with EVAL_SEAL_WRITE_PAGES=true.",
    )
    return parser.parse_args()


def load_pages(input_path: Path, scale: float) -> list[Image.Image]:
    ext = input_path.suffix.lower()
    if ext == ".pdf":
        try:
            import fitz
        except Exception as exc:  # pragma: no cover - depends on local install
            raise RuntimeError("PyMuPDF is required for PDF input. Install package 'pymupdf'.") from exc
        doc = fitz.open(input_path)
        pages: list[Image.Image] = []
        matrix = fitz.Matrix(scale, scale)
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            pages.append(Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"))
        return pages
    return [Image.open(input_path).convert("RGB")]


def region_to_dict(kind: str, region: Any) -> dict[str, Any]:
    edge = region.x <= 0.04 or region.y <= 0.04 or region.x + region.width >= 0.96 or region.y + region.height >= 0.96
    return {
        "kind": kind,
        "type": "official_seal",
        "x": round(float(region.x), 6),
        "y": round(float(region.y), 6),
        "width": round(float(region.width), 6),
        "height": round(float(region.height), 6),
        "area": round(float(region.width * region.height), 6),
        "confidence": round(float(region.confidence), 4),
        "edge": edge,
    }


def page_warnings(
    page_number: int,
    regions: list[dict[str, Any]],
    *,
    max_region_area: float,
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    edge_regions = [region for region in regions if region["edge"]]
    large_regions = [region for region in regions if region["area"] > max_region_area]
    right_edge = [region for region in edge_regions if region["x"] + region["width"] >= 0.94]
    if len(right_edge) >= 3:
        warnings.append({
            "severity": "medium",
            "page": page_number,
            "message": f"{len(right_edge)} right-edge seam/fragment seal candidates; inspect for missed or over-split seam stamps.",
        })
    elif edge_regions:
        warnings.append({
            "severity": "medium",
            "page": page_number,
            "message": "edge seal candidates present; inspect corner/seam stamp alignment.",
        })
    if large_regions:
        largest = max(region["area"] for region in large_regions)
        warnings.append({
            "severity": "high",
            "page": page_number,
            "message": (
                f"oversized seal candidate area {largest:.1%} > max {max_region_area:.1%}; "
                "inspect for whole-block seal bbox or over-redaction."
            ),
        })
    return warnings


def warning_label(item: dict[str, Any]) -> str:
    return f"page {int(item['page'])}: {item['message']}"


def sorted_warning_details(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        items,
        key=lambda item: (
            SEVERITY_RANK.get(str(item.get("severity", "medium")), SEVERITY_RANK["medium"]),
            int(item.get("page", 0)),
            str(item.get("message", "")),
        ),
    )


def build_quality_gate(summary: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    failed: list[str] = []
    min_total_regions = int(args.min_total_regions)
    min_page_regions = int(args.min_page_regions)
    max_warnings = int(args.max_warnings)
    max_high_warnings = int(args.max_high_warnings)
    max_region_area = float(args.max_region_area)
    high_warnings = [
        item for item in summary["warning_details"] if str(item.get("severity", "")).lower() == "high"
    ]
    region_areas = [
        float(region["area"])
        for page in summary["pages"]
        for region in page["regions"]
    ]
    oversized_region_areas = [area for area in region_areas if area > max_region_area]
    if summary["total_regions"] < min_total_regions:
        failed.append(f"total seal candidates {summary['total_regions']} < {min_total_regions}")
    if min_page_regions > 0:
        for page in summary["pages"]:
            if page["region_count"] < min_page_regions:
                failed.append(f"page {page['page']} seal candidates {page['region_count']} < {min_page_regions}")
    if max_warnings >= 0 and len(summary["warnings"]) > max_warnings:
        failed.append(f"warnings {len(summary['warnings'])} > {max_warnings}")
    if max_high_warnings >= 0 and len(high_warnings) > max_high_warnings:
        failed.append(f"high-severity warnings {len(high_warnings)} > {max_high_warnings}")
    if oversized_region_areas:
        failed.append(f"seal candidate area {max(oversized_region_areas):.1%} > max {max_region_area:.1%}")
    return {
        "passed": not failed,
        "thresholds": {
            "min_total_regions": min_total_regions,
            "min_page_regions": min_page_regions,
            "max_warnings": max_warnings,
            "max_high_warnings": max_high_warnings,
            "max_region_area": max_region_area,
        },
        "failed_checks": failed,
        "warning_count": len(summary["warnings"]),
        "high_warning_count": len(high_warnings),
        "total_regions": summary["total_regions"],
    }


def draw_regions(image: Image.Image, regions: list[dict[str, Any]]) -> Image.Image:
    out = image.copy()
    draw = ImageDraw.Draw(out)
    width, height = out.size
    for region in regions:
        color = (220, 38, 38) if region["kind"] == "red" else (31, 41, 55)
        x1 = int(region["x"] * width)
        y1 = int(region["y"] * height)
        x2 = int((region["x"] + region["width"]) * width)
        y2 = int((region["y"] + region["height"]) * height)
        draw.rectangle([x1, y1, x2, y2], outline=color, width=4)
        draw.text((x1 + 4, max(0, y1 - 18)), region["kind"], fill=color)
    return out


def write_report(output_dir: Path, summary: dict[str, Any]) -> None:
    def esc(value: Any) -> str:
        return html.escape(str(value), quote=True)

    def normalize_warning(item: Any) -> dict[str, Any]:
        if isinstance(item, dict):
            return {
                "severity": str(item.get("severity", "medium")),
                "page": int(item.get("page", 0)),
                "message": str(item.get("message", "")),
            }
        match = re.match(r"page\s+(\d+):\s*(.*)", str(item))
        if not match:
            return {"severity": "medium", "page": 0, "message": str(item)}
        return {"severity": "medium", "page": int(match.group(1)), "message": match.group(2)}

    def warning_item_html(item: Any) -> str:
        warning = normalize_warning(item)
        severity = warning["severity"] if warning["severity"] in SEVERITY_RANK else "medium"
        severity_html = f'<span class="severity severity-{severity}">{esc(severity)}</span>'
        page_number = int(warning["page"])
        text = esc(warning["message"])
        if page_number <= 0:
            return f"<li>{severity_html} {text}</li>"
        return f'<li>{severity_html} <a href="#page-{page_number:02d}">Page {page_number}</a>: {text}</li>'

    report_warnings = summary.get("warning_details", summary["warnings"])
    gate = summary.get("quality_gate", {})
    fallback_context = summary.get("fallback_context", SEAL_FALLBACK_CONTEXT)
    fallback_context_text = (
        f"This report is seal fallback only: {', '.join(fallback_context.get('fallback_kinds', []))}. "
        f"HaS Image model was not run here; its contract is "
        f"{fallback_context.get('has_image_class_count', 21)} fixed classes "
        f"{esc(fallback_context.get('has_image_class_id_range', [0, 20]))}."
    )
    failures_html = "".join(f"<li>{esc(item)}</li>" for item in gate.get("failed_checks", [])) or "<li>No failed checks</li>"
    gate_class = "pass" if gate.get("passed") else "fail"
    warnings_html = "".join(warning_item_html(item) for item in report_warnings) or "<li>No warnings</li>"
    page_sections: list[str] = []
    for page in summary["pages"]:
        page_number = int(page["page"])
        image_name = f"page-{page_number:02d}-seal.png"
        image_path = output_dir / image_name
        rows = []
        for region in page["regions"]:
            rows.append(
                "<tr>"
                f"<td>{esc(region['kind'])}</td>"
                f"<td>{region['x']:.3f}</td>"
                f"<td>{region['y']:.3f}</td>"
                f"<td>{region['width']:.3f}</td>"
                f"<td>{region['height']:.3f}</td>"
                f"<td>{region['area']:.3%}</td>"
                f"<td>{'yes' if region['edge'] else 'no'}</td>"
                "</tr>"
            )
        table_body = "".join(rows) or '<tr><td colspan="7">No seal candidates</td></tr>'
        page_warning_items = page.get("warning_details", page["warnings"])
        page_warning_html = "".join(warning_item_html(item) for item in page_warning_items) or "<li>No page warnings</li>"
        image_html = (
            f'<a href="{esc(image_name)}"><img src="{esc(image_name)}" alt="page {page_number} seal overlay"></a>'
            if image_path.exists()
            else "<div class=\"placeholder\">Run with EVAL_SEAL_WRITE_PAGES=true to generate overlay image.</div>"
        )
        page_sections.append(
            f"""
            <section id="page-{page_number:02d}">
              <h2>Page {page_number}</h2>
              <div class="page-grid">
                <div>{image_html}</div>
                <div>
                  <p><strong>{page['region_count']}</strong> candidates: red {page['red_count']}, dark {page['dark_count']}</p>
                  <ul class="warnings">{page_warning_html}</ul>
                  <table>
                    <thead><tr><th>kind</th><th>x</th><th>y</th><th>w</th><th>h</th><th>area</th><th>edge</th></tr></thead>
                    <tbody>{table_body}</tbody>
                  </table>
                </div>
              </div>
            </section>
            """
        )

    html_text = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Offline Seal Evaluation</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; color: #111827; background: #f8fafc; }}
    header, section {{ background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }}
    h1, h2 {{ margin: 0 0 12px; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }}
    .metric {{ border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; background: #f9fafb; }}
    .metric b {{ display: block; font-size: 24px; margin-top: 4px; }}
    .warnings {{ color: #92400e; }}
    .warnings a {{ color: #92400e; font-weight: 700; }}
    .severity {{ display: inline-block; min-width: 48px; border-radius: 999px; padding: 2px 7px; margin-right: 6px; color: #fff; font-size: 11px; font-weight: 700; text-transform: uppercase; text-align: center; }}
    .severity-high {{ background: #b91c1c; }}
    .severity-medium {{ background: #b45309; }}
    .severity-low {{ background: #475569; }}
    .pass {{ color: #047857; }}
    .fail {{ color: #b91c1c; }}
    .page-grid {{ display: grid; grid-template-columns: minmax(280px, 1fr) minmax(320px, 0.8fr); gap: 16px; align-items: start; }}
    img {{ max-width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ border-bottom: 1px solid #e5e7eb; padding: 6px; text-align: left; }}
    th {{ background: #f3f4f6; }}
    .placeholder {{ border: 1px dashed #cbd5e1; border-radius: 6px; padding: 24px; color: #64748b; }}
    @media (max-width: 900px) {{ .page-grid {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <header>
    <h1>Offline Seal Evaluation</h1>
    <p>{esc(summary['input'])}</p>
    <div class="metrics">
      <div class="metric">Pages<b>{summary['page_count']}</b></div>
      <div class="metric">Candidates<b>{summary['total_regions']}</b></div>
      <div class="metric">Red<b>{summary['red_count']}</b></div>
      <div class="metric">Dark<b>{summary['dark_count']}</b></div>
      <div class="metric">Warnings<b>{len(summary['warnings'])}</b></div>
      <div class="metric">Quality<b class="{gate_class}">{'PASS' if gate.get('passed') else 'FAIL'}</b></div>
    </div>
    <p>{fallback_context_text}</p>
    <h2>Quality Gate</h2>
    <ul class="{gate_class}">{failures_html}</ul>
    <h2>Review Queue</h2>
    <ul class="warnings">{warnings_html}</ul>
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

    pages = load_pages(input_path, max(0.5, float(args.scale)))
    page_summaries: list[dict[str, Any]] = []
    all_warning_details: list[dict[str, Any]] = []
    total_regions = 0

    for index, image in enumerate(pages, 1):
        red = [region_to_dict("red", region) for region in detect_red_seal_regions(image)]
        dark = [region_to_dict("dark", region) for region in detect_dark_seal_regions(image)]
        regions = red + dark
        warnings = page_warnings(index, regions, max_region_area=float(args.max_region_area))
        sorted_page_warnings = sorted_warning_details(warnings)
        all_warning_details.extend(sorted_page_warnings)
        total_regions += len(regions)
        page_summary = {
            "page": index,
            "image_size": list(image.size),
            "red_count": len(red),
            "dark_count": len(dark),
            "region_count": len(regions),
            "regions": regions,
            "warnings": [warning_label(warning) for warning in sorted_page_warnings],
            "warning_details": sorted_page_warnings,
        }
        page_summaries.append(page_summary)
        if args.write_pages:
            draw_regions(image, regions).save(output_dir / f"page-{index:02d}-seal.png")

    sorted_all_warnings = sorted_warning_details(all_warning_details)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(input_path),
        "output_dir": str(output_dir),
        "page_count": len(pages),
        "total_regions": total_regions,
        "red_count": sum(page["red_count"] for page in page_summaries),
        "dark_count": sum(page["dark_count"] for page in page_summaries),
        "fallback_context": SEAL_FALLBACK_CONTEXT,
        "warnings": [warning_label(warning) for warning in sorted_all_warnings],
        "warning_details": sorted_all_warnings,
        "pages": page_summaries,
    }
    summary["quality_gate"] = build_quality_gate(summary, args)
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(output_dir, summary)
    print(f"wrote {output_dir / 'summary.json'}")
    print(f"wrote {output_dir / 'report.html'}")
    print(
        f"pages={summary['page_count']} regions={summary['total_regions']} "
        f"warnings={len(sorted_all_warnings)} quality={'pass' if summary['quality_gate']['passed'] else 'fail'}"
    )
    if not summary["quality_gate"]["passed"]:
        for check in summary["quality_gate"]["failed_checks"]:
            print(f"quality gate failed: {check}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
