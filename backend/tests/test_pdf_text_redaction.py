# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio

import fitz

from app.models.schemas import Entity, ReplacementMode
from app.services.redaction.replacement_strategy import RedactionContext
from app.services.redaction.text_redactor import TextRedactorMixin


class _TextRedactor(TextRedactorMixin):
    pass


def _write_text_pdf(path, text: str) -> None:
    doc = fitz.open()
    page = doc.new_page(width=420, height=240)
    page.insert_text(fitz.Point(72, 92), text, fontsize=12)
    doc.save(path)
    doc.close()


def _extract_pdf_text(path) -> str:
    doc = fitz.open(path)
    try:
        return "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


def test_pdf_text_redaction_removes_original_text_from_extractable_content(tmp_path):
    input_path = tmp_path / "source.pdf"
    output_path = tmp_path / "redacted.pdf"
    _write_text_pdf(input_path, "Alice Zhang phone 13451775049")

    context = RedactionContext(ReplacementMode.CUSTOM)
    context.set_custom_replacements({
        "Alice Zhang": "PERSON_001",
        "13451775049": "PHONE_001",
    })
    entities = [
        Entity(id="e1", text="Alice Zhang", type="PERSON", start=0, end=11),
        Entity(id="e2", text="13451775049", type="PHONE", start=18, end=29),
    ]

    redacted_count = asyncio.run(
        _TextRedactor()._redact_pdf_text(str(input_path), str(output_path), entities, context)
    )

    extracted = _extract_pdf_text(output_path)
    assert redacted_count == 2
    assert "Alice Zhang" not in extracted
    assert "13451775049" not in extracted
    assert "PERSON_001" in extracted
    assert "PHONE_001" in extracted
