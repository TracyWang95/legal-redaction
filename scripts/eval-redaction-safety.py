#!/usr/bin/env python
# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Public redaction safety gate for searchable PDF and DOCX files."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.models.schemas import Entity, ReplacementMode  # noqa: E402
from app.services.redaction.replacement_strategy import RedactionContext  # noqa: E402
from app.services.redaction.text_redactor import TextRedactorMixin  # noqa: E402


DEFAULT_FIXTURE_DIR = ROOT / "fixtures" / "benchmark"
DEFAULT_OUTPUT_DIR = ROOT / "output" / "playwright" / "eval-redaction-safety-public"


class DirectTextRedactor(TextRedactorMixin):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify public DOCX/PDF redaction removes extractable originals.")
    parser.add_argument("--fixture-dir", default=str(DEFAULT_FIXTURE_DIR))
    parser.add_argument("output_dir", nargs="?", default=str(DEFAULT_OUTPUT_DIR))
    return parser.parse_args()


def text_from_pdf(path: Path) -> str:
    doc = fitz.open(path)
    try:
        return "\n".join(page.get_text("text") for page in doc)
    finally:
        doc.close()


def word_xml_text(path: Path) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.startswith("word/") and name.endswith(".xml"):
                chunks.append(archive.read(name).decode("utf-8", errors="replace"))
    return "\n".join(chunks)


def redaction_entities() -> list[Entity]:
    originals = [
        ("Alice Zhang", "PERSON", "PERSON_001"),
        ("13451775049", "PHONE", "PHONE_001"),
        ("alice.zhang@example.test", "EMAIL", "EMAIL_001"),
        ("6222020202020202020", "BANK_CARD", "ACCOUNT_001"),
    ]
    return [
        Entity(id=f"public-{index}", text=text, type=entity_type, start=0, end=len(text), replacement=replacement)
        for index, (text, entity_type, replacement) in enumerate(originals, 1)
    ]


def context_for(entities: list[Entity]) -> RedactionContext:
    context = RedactionContext(ReplacementMode.CUSTOM)
    context.set_custom_replacements({entity.text: str(entity.replacement) for entity in entities})
    return context


def build_result(
    *,
    kind: str,
    input_path: Path,
    output_path: Path,
    elapsed_ms: int,
    redacted_count: int,
    extracted_text: str,
    entities: list[Entity],
) -> dict[str, Any]:
    missing_replacements = [
        str(entity.replacement)
        for entity in entities
        if entity.replacement and str(entity.replacement) not in extracted_text
    ]
    leaked_originals = [entity.text for entity in entities if entity.text in extracted_text]
    passed = redacted_count >= len(entities) and not leaked_originals and not missing_replacements
    return {
        "kind": kind,
        "input": str(input_path),
        "output": str(output_path),
        "elapsed_ms": elapsed_ms,
        "redacted_count": redacted_count,
        "expected_redactions": len(entities),
        "leaked_originals": leaked_originals,
        "missing_replacements": missing_replacements,
        "passed": passed,
    }


async def run_gate(fixture_dir: Path, output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    entities = redaction_entities()
    redactor = DirectTextRedactor()
    results = []

    docx_in = fixture_dir / "sample-redaction.docx"
    pdf_in = fixture_dir / "sample-redaction.pdf"
    docx_out = output_dir / "sample-redaction.redacted.docx"
    pdf_out = output_dir / "sample-redaction.redacted.pdf"

    start = time.perf_counter()
    docx_count = await redactor._redact_docx(str(docx_in), str(docx_out), entities, context_for(entities))
    results.append(
        build_result(
            kind="docx",
            input_path=docx_in,
            output_path=docx_out,
            elapsed_ms=round((time.perf_counter() - start) * 1000),
            redacted_count=docx_count,
            extracted_text=word_xml_text(docx_out),
            entities=entities,
        )
    )

    start = time.perf_counter()
    pdf_count = await redactor._redact_pdf_text(str(pdf_in), str(pdf_out), entities, context_for(entities))
    results.append(
        build_result(
            kind="pdf",
            input_path=pdf_in,
            output_path=pdf_out,
            elapsed_ms=round((time.perf_counter() - start) * 1000),
            redacted_count=pdf_count,
            extracted_text=text_from_pdf(pdf_out),
            entities=entities,
        )
    )

    failed = [
        f"{result['kind']}: leaked={result['leaked_originals']} missing={result['missing_replacements']}"
        for result in results
        if not result["passed"]
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "fixture_dir": str(fixture_dir),
        "output_dir": str(output_dir),
        "passed": not failed,
        "failed_checks": failed,
        "results": results,
    }


def main() -> int:
    args = parse_args()
    fixture_dir = Path(args.fixture_dir)
    output_dir = Path(args.output_dir)
    summary = asyncio.run(run_gate(fixture_dir, output_dir))
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"summary: {summary_path}")
    for result in summary["results"]:
        print(
            f"{result['kind']}: redacted={result['redacted_count']}/"
            f"{result['expected_redactions']} quality={'pass' if result['passed'] else 'fail'}"
        )
    print(f"quality={'pass' if summary['passed'] else 'fail'}")
    if not summary["passed"]:
        for failed in summary["failed_checks"]:
            print(f"quality gate failed: {failed}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
