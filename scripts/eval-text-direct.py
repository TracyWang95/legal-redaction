# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Direct local text/DOCX evaluation.

This bypasses the authenticated HTTP API and calls the backend HybridNERService
in-process. It is intended for real-file regression checks when local auth is
enabled or browser/API flows are not available.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import re
import sys
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

SEMANTIC_ENTITY_TYPES = {"PERSON", "ORG", "COMPANY", "ADDRESS", "WORK_UNIT"}


@dataclass
class DirectEntityType:
    id: str
    name: str
    use_llm: bool = True
    regex_pattern: str = ""


class TextOnlyHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data.strip())

    def text(self) -> str:
        return "\n".join(self.parts)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate local text/DOCX files without API auth.")
    parser.add_argument("input", help="Text-like file path: .docx, .txt, .md, .html, or searchable .pdf")
    parser.add_argument("output_dir", nargs="?", default="output/playwright/eval-text-direct")
    parser.add_argument(
        "--types",
        default=os.environ.get("EVAL_TEXT_DIRECT_TYPES", ""),
        help="Comma-separated entity type ids. Default: enabled backend preset types.",
    )
    parser.add_argument(
        "--max-preview-chars",
        type=int,
        default=int(os.environ.get("EVAL_TEXT_DIRECT_MAX_PREVIEW_CHARS", "6000")),
        help="Max content chars in HTML preview. Full content is written to content.txt.",
    )
    return parser.parse_args()


def env_int(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, ""))
    except ValueError:
        return fallback


def env_bool(name: str, fallback: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return fallback
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def split_csv(value: str | None) -> list[str] | None:
    if not value:
        return None
    items = [item.strip() for item in value.split(",") if item.strip()]
    return items or None


def load_custom_regex_types() -> dict[str, dict[str, str]]:
    raw = os.environ.get("EVAL_TEXT_DIRECT_CUSTOM_REGEX_JSON", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid EVAL_TEXT_DIRECT_CUSTOM_REGEX_JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("EVAL_TEXT_DIRECT_CUSTOM_REGEX_JSON must be an object")
    custom: dict[str, dict[str, str]] = {}
    for raw_id, config in parsed.items():
        entity_id = str(raw_id or "").strip()
        if not entity_id:
            continue
        if isinstance(config, str):
            custom[entity_id] = {"name": entity_id, "pattern": config}
        elif isinstance(config, dict):
            custom[entity_id] = {
                "name": str(config.get("name") or entity_id),
                "pattern": str(config.get("pattern") or ""),
            }
    return custom


def read_text_with_fallbacks(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_bytes().decode("utf-8", errors="replace")


def extract_docx_text(path: Path) -> str:
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    parts: list[str] = []
    with zipfile.ZipFile(path) as archive:
        document_xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(document_xml)
    for paragraph in root.iter(f"{namespace}p"):
        runs: list[str] = []
        for node in paragraph.iter():
            if node.tag == f"{namespace}t" and node.text:
                runs.append(node.text)
            elif node.tag == f"{namespace}tab":
                runs.append("\t")
            elif node.tag == f"{namespace}br":
                runs.append("\n")
        line = "".join(runs).strip()
        if line:
            parts.append(line)
    return "\n".join(parts)


def extract_html_text(path: Path) -> str:
    parser = TextOnlyHTMLParser()
    parser.feed(read_text_with_fallbacks(path))
    return parser.text()


def extract_pdf_text(path: Path) -> str:
    try:
        import fitz
    except Exception as exc:  # pragma: no cover - depends on local install
        raise RuntimeError("PyMuPDF is required for PDF text extraction. Install package 'pymupdf'.") from exc
    doc = fitz.open(path)
    return "\n\n".join(page.get_text("text") for page in doc)


def parse_local_file(path: Path) -> tuple[str, dict[str, Any]]:
    suffix = path.suffix.lower()
    metadata = {"file_type": suffix.lstrip(".") or "unknown", "parser": "direct"}
    if suffix == ".docx":
        return extract_docx_text(path), {**metadata, "parser": "ooxml"}
    if suffix in {".html", ".htm"}:
        return extract_html_text(path), {**metadata, "parser": "html.parser"}
    if suffix == ".pdf":
        return extract_pdf_text(path), {**metadata, "parser": "pymupdf-text"}
    if suffix in {".txt", ".md", ".csv", ".json", ".log"}:
        return read_text_with_fallbacks(path), {**metadata, "parser": "text"}
    return read_text_with_fallbacks(path), metadata


def load_entity_types(selected_ids: list[str] | None) -> list[DirectEntityType]:
    preset_path = BACKEND_DIR / "config" / "preset_entity_types.json"
    presets = json.loads(preset_path.read_text(encoding="utf-8"))
    selected_set = set(selected_ids or [])
    custom_regex_types = load_custom_regex_types()
    entity_types: list[DirectEntityType] = []
    for entity_id, config in presets.items():
        if not config.get("enabled", True):
            continue
        if selected_set and entity_id not in selected_set:
            continue
        entity_types.append(
            DirectEntityType(
                id=entity_id,
                name=str(config.get("name") or entity_id),
                use_llm=bool(config.get("use_llm", True)),
            )
        )
    missing = sorted(selected_set - {entity_type.id for entity_type in entity_types})
    if missing:
        for item in missing:
            custom = custom_regex_types.get(item)
            if custom and custom.get("pattern"):
                entity_types.append(
                    DirectEntityType(
                        id=item,
                        name=custom.get("name") or item,
                        use_llm=False,
                        regex_pattern=custom["pattern"],
                    )
                )
            else:
                entity_types.append(DirectEntityType(id=item, name=item, use_llm=True))
    return entity_types


def serialize_entity(entity: Any) -> dict[str, Any]:
    if hasattr(entity, "model_dump"):
        data = entity.model_dump()
    elif hasattr(entity, "dict"):
        data = entity.dict()
    elif isinstance(entity, dict):
        data = dict(entity)
    else:
        data = dict(vars(entity))
    return {
        **data,
        "confidence": round(float(data.get("confidence", 0) or 0), 4),
    }


def summarize_entities(entities: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    by_type: dict[str, int] = {}
    by_source: dict[str, int] = {}
    for entity in entities:
        entity_type = str(entity.get("type") or "unknown")
        source = str(entity.get("source") or "unknown")
        by_type[entity_type] = by_type.get(entity_type, 0) + 1
        by_source[source] = by_source.get(source, 0) + 1
    return {"by_type": by_type, "by_source": by_source}


def analyze_text(summary: dict[str, Any], entities: list[dict[str, Any]]) -> list[str]:
    warnings: list[str] = []
    if summary["content_chars"] == 0:
        warnings.append("parsed content is empty")
    if summary["content_chars"] > 0 and not entities:
        warnings.append("content parsed but no entities were detected")
    if summary["selected_entity_types"] and not any(
        entity.get("type") in summary["selected_entity_types"] for entity in entities
    ):
        warnings.append("detected entities do not overlap selected entity types")
    if summary["content_chars"] > 200 and len(entities) == 1:
        warnings.append("only one entity found in a non-trivial document")
    return warnings


def has_semantic_hit(entities: list[dict[str, Any]]) -> bool:
    for entity in entities:
        source = str(entity.get("source") or "").lower()
        if entity.get("type") in SEMANTIC_ENTITY_TYPES and ("has" in source or "semantic" in source):
            return True
    return False


def build_quality_gate(summary: dict[str, Any], entities: list[dict[str, Any]]) -> dict[str, Any]:
    thresholds = {
        "min_entities": env_int("EVAL_TEXT_DIRECT_MIN_ENTITIES", 1),
        "min_content_chars": env_int("EVAL_TEXT_DIRECT_MIN_CONTENT_CHARS", 1),
        "max_warnings": env_int("EVAL_TEXT_DIRECT_MAX_WARNINGS", -1),
        "max_parse_ms": env_int("EVAL_TEXT_DIRECT_MAX_PARSE_MS", 0),
        "max_ner_ms": env_int("EVAL_TEXT_DIRECT_MAX_NER_MS", 0),
        "require_semantic_hit": env_bool("EVAL_TEXT_DIRECT_REQUIRE_SEMANTIC_HIT", False),
    }
    failed: list[str] = []
    warning_count = len(summary.get("warnings") or []) + len(summary.get("qa_warnings") or [])
    entity_count = int(summary.get("entity_count") or 0)
    content_chars = int(summary.get("content_chars") or 0)

    if summary.get("error"):
        failed.append(f"error: {summary['error']}")
    if entity_count < thresholds["min_entities"]:
        failed.append(f"entity count {entity_count} < {thresholds['min_entities']}")
    if content_chars < thresholds["min_content_chars"]:
        failed.append(f"content chars {content_chars} < {thresholds['min_content_chars']}")
    if thresholds["max_warnings"] >= 0 and warning_count > thresholds["max_warnings"]:
        failed.append(f"warnings {warning_count} > {thresholds['max_warnings']}")
    if thresholds["max_parse_ms"] > 0 and summary.get("parse_ms", 0) > thresholds["max_parse_ms"]:
        failed.append(f"parse elapsed {summary['parse_ms']}ms > {thresholds['max_parse_ms']}ms")
    if thresholds["max_ner_ms"] > 0 and summary.get("ner_ms", 0) > thresholds["max_ner_ms"]:
        failed.append(f"NER elapsed {summary['ner_ms']}ms > {thresholds['max_ner_ms']}ms")
    selected_semantic = [item for item in summary.get("selected_entity_types", []) if item in SEMANTIC_ENTITY_TYPES]
    if thresholds["require_semantic_hit"] and selected_semantic and not has_semantic_hit(entities):
        failed.append("semantic entity types selected but no HaS/semantic entity hit")

    return {
        "passed": not failed,
        "failed_checks": failed,
        "thresholds": thresholds,
        "warning_count": warning_count,
        "entity_count": entity_count,
        "content_chars": content_chars,
    }


def entity_preview(entity: dict[str, Any]) -> str:
    text = str(entity.get("text") or "")
    return html.escape(text[:120])


def render_report(summary: dict[str, Any], content: str, entities: list[dict[str, Any]], max_preview_chars: int) -> str:
    gate = summary["quality_gate"]
    status = "PASS" if gate["passed"] else "FAIL"
    status_color = "#0f766e" if gate["passed"] else "#b91c1c"
    preview = html.escape(content[:max_preview_chars])
    if len(content) > max_preview_chars:
        preview += "\n..."
    warning_items = "".join(
        f"<li>{html.escape(item)}</li>" for item in (summary.get("warnings") or []) + (summary.get("qa_warnings") or [])
    ) or "<li>None</li>"
    failed_items = "".join(f"<li>{html.escape(item)}</li>" for item in gate["failed_checks"]) or "<li>None</li>"
    rows = "".join(
        "<tr>"
        f"<td>{html.escape(str(entity.get('type', '')))}</td>"
        f"<td>{html.escape(str(entity.get('source', '')))}</td>"
        f"<td>{entity_preview(entity)}</td>"
        f"<td>{html.escape(str(entity.get('start', '')))}-{html.escape(str(entity.get('end', '')))}</td>"
        f"<td>{html.escape(str(entity.get('confidence', '')))}</td>"
        "</tr>"
        for entity in entities[:300]
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Direct Text Eval</title>
  <style>
    body {{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 32px; color: #172033; background: #f8fafc; }}
    main {{ max-width: 1180px; margin: 0 auto; }}
    section {{ background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 18px; margin: 16px 0; }}
    h1, h2 {{ margin: 0 0 12px; }}
    .status {{ color: white; background: {status_color}; display: inline-flex; padding: 4px 10px; border-radius: 999px; font-weight: 700; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }}
    .metric {{ border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }}
    .metric strong {{ display: block; font-size: 22px; margin-top: 4px; }}
    pre {{ white-space: pre-wrap; word-break: break-word; background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 6px; max-height: 520px; overflow: auto; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }}
  </style>
</head>
<body>
<main>
  <h1>Direct Text Eval <span class="status">{status}</span></h1>
  <section>
    <h2>Quality Gate</h2>
    <ul>{failed_items}</ul>
    <div class="grid">
      <div class="metric">Entities<strong>{summary["entity_count"]}</strong></div>
      <div class="metric">Content chars<strong>{summary["content_chars"]}</strong></div>
      <div class="metric">Parse ms<strong>{summary["parse_ms"]}</strong></div>
      <div class="metric">NER ms<strong>{summary["ner_ms"]}</strong></div>
      <div class="metric">Warnings<strong>{gate["warning_count"]}</strong></div>
    </div>
  </section>
  <section>
    <h2>Input</h2>
    <p>{html.escape(summary["input"])}</p>
    <p>Parser: {html.escape(str(summary["parser"]))}</p>
    <p>Selected types: {html.escape(", ".join(summary["selected_entity_types"]))}</p>
  </section>
  <section>
    <h2>Warnings</h2>
    <ul>{warning_items}</ul>
  </section>
  <section>
    <h2>Entities</h2>
    <table>
      <thead><tr><th>Type</th><th>Source</th><th>Text</th><th>Span</th><th>Confidence</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
  </section>
  <section>
    <h2>Content Preview</h2>
    <pre>{preview}</pre>
  </section>
</main>
</body>
</html>
"""


async def run_ner(content: str, entity_types: list[DirectEntityType]) -> list[dict[str, Any]]:
    from app.services.hybrid_ner_service import HybridNERService

    service = HybridNERService()
    entities = await service.extract(content, entity_types)
    return [serialize_entity(entity) for entity in entities]


async def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    out_dir = Path(args.output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    error: str | None = None
    parse_start = time.perf_counter()
    try:
        content, parser_meta = parse_local_file(input_path)
    except Exception as exc:
        content = ""
        parser_meta = {"file_type": input_path.suffix.lstrip(".") or "unknown", "parser": "error"}
        error = str(exc)
    parse_ms = round((time.perf_counter() - parse_start) * 1000)

    selected_ids = split_csv(args.types)
    entity_types = load_entity_types(selected_ids)
    ner_start = time.perf_counter()
    entities: list[dict[str, Any]] = []
    if not error:
        try:
            entities = await run_ner(content, entity_types)
        except Exception as exc:
            error = str(exc)
    ner_ms = round((time.perf_counter() - ner_start) * 1000)

    if selected_ids and not entity_types:
        warnings.append("no selected entity types were loaded")
    if not selected_ids:
        warnings.append("using all enabled preset entity types; set EVAL_TEXT_DIRECT_TYPES for focused gates")

    entity_summary = summarize_entities(entities)
    summary: dict[str, Any] = {
        "input": str(input_path),
        "output_dir": str(out_dir),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "file_type": parser_meta["file_type"],
        "parser": parser_meta["parser"],
        "content_chars": len(content),
        "selected_entity_types": [entity_type.id for entity_type in entity_types],
        "parse_ms": parse_ms,
        "ner_ms": ner_ms,
        "entity_count": len(entities),
        "entity_summary": entity_summary["by_type"],
        "source_summary": entity_summary["by_source"],
        "warnings": warnings,
        "error": error,
    }
    summary["qa_warnings"] = analyze_text(summary, entities)
    summary["quality_gate"] = build_quality_gate(summary, entities)

    (out_dir / "content.txt").write_text(content, encoding="utf-8")
    (out_dir / "entities.json").write_text(json.dumps(entities, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "report.html").write_text(
        render_report(summary, content, entities, args.max_preview_chars),
        encoding="utf-8",
    )

    quality = "pass" if summary["quality_gate"]["passed"] else "fail"
    print(
        f"Direct text eval complete: quality={quality} "
        f"entities={summary['entity_count']} chars={summary['content_chars']} "
        f"report={out_dir / 'report.html'}"
    )
    if quality != "pass":
        for failed in summary["quality_gate"]["failed_checks"]:
            print(f"quality gate failed: {failed}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
