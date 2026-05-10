# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""File parser path traversal prevention tests (P0-6)."""
from __future__ import annotations

import asyncio
import os

import fitz

from app.core.file_validation import safe_path_in_dir

# ── P0-6: Path validation in file_parser ─────────────────────


class TestSafePathInDir:
    """Unit tests for the safe_path_in_dir utility."""

    def test_path_inside_dir(self, tmp_path):
        allowed = str(tmp_path)
        target = os.path.join(allowed, "file.txt")
        assert safe_path_in_dir(target, allowed) is True

    def test_path_outside_dir(self, tmp_path):
        allowed = str(tmp_path / "uploads")
        os.makedirs(allowed, exist_ok=True)
        target = str(tmp_path / "secrets" / "key.txt")
        assert safe_path_in_dir(target, allowed) is False

    def test_path_traversal_dotdot(self, tmp_path):
        allowed = str(tmp_path / "uploads")
        os.makedirs(allowed, exist_ok=True)
        target = os.path.join(allowed, "..", "secrets", "key.txt")
        assert safe_path_in_dir(target, allowed) is False

    def test_path_is_dir_itself(self, tmp_path):
        allowed = str(tmp_path)
        assert safe_path_in_dir(allowed, allowed) is True


class TestFileParserPathValidation:
    """The file parser must reject paths outside UPLOAD_DIR."""

    def test_convert_with_libreoffice_rejects_outside_path(self, tmp_path, monkeypatch):
        """_convert_with_libreoffice should reject paths outside UPLOAD_DIR."""
        upload_dir = str(tmp_path / "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        outside_path = str(tmp_path / "malicious.doc")
        with open(outside_path, "w") as f:
            f.write("fake doc")

        from app.core.config import settings
        monkeypatch.setattr(settings, "UPLOAD_DIR", upload_dir)

        from app.services.file_parser import FileParser
        parser = FileParser()
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                parser._convert_with_libreoffice(outside_path)
            )
            assert result is None
        finally:
            loop.close()

    def test_convert_doc_to_docx_rejects_outside_path(self, tmp_path, monkeypatch):
        """_convert_doc_to_docx should block path traversal attempts."""
        upload_dir = str(tmp_path / "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        outside_path = os.path.join(str(tmp_path), "..", "etc", "passwd")

        from app.core.config import settings
        monkeypatch.setattr(settings, "UPLOAD_DIR", upload_dir)

        from app.services.file_parser import FileParser
        parser = FileParser()
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(
                parser._convert_doc_to_docx(outside_path)
            )
            assert result is None
        finally:
            loop.close()

    def test_path_validation_allows_inside_path(self, tmp_path):
        """Paths inside UPLOAD_DIR should pass validation."""
        upload_dir = str(tmp_path / "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        inside_path = os.path.join(upload_dir, "valid.doc")
        with open(inside_path, "w") as f:
            f.write("fake doc")
        assert safe_path_in_dir(inside_path, upload_dir) is True

    def test_pdf_page_image_cache_reuses_rendered_page(self, tmp_path, monkeypatch):
        upload_dir = str(tmp_path / "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        pdf_path = os.path.join(upload_dir, "sample.pdf")
        doc = fitz.open()
        page = doc.new_page(width=120, height=80)
        page.insert_text((12, 30), "cache test")
        doc.save(pdf_path)
        doc.close()

        from app.core.config import settings
        monkeypatch.setattr(settings, "UPLOAD_DIR", upload_dir)
        monkeypatch.setattr(settings, "PDF_PAGE_IMAGE_CACHE_PAGES", 8)

        from app.services import file_parser as file_parser_module
        from app.services.file_parser import FileParser

        FileParser._pdf_page_image_cache.clear()
        open_calls = 0
        original_open = file_parser_module.fitz.open

        def counting_open(*args, **kwargs):
            nonlocal open_calls
            open_calls += 1
            return original_open(*args, **kwargs)

        monkeypatch.setattr(file_parser_module.fitz, "open", counting_open)
        parser = FileParser()
        loop = asyncio.new_event_loop()
        try:
            first = loop.run_until_complete(parser.get_pdf_page_image(pdf_path, 1))
            assert parser.last_pdf_page_image_cache_hit is False
            second = loop.run_until_complete(parser.get_pdf_page_image(pdf_path, 1))
            assert parser.last_pdf_page_image_cache_hit is True
        finally:
            loop.close()
            FileParser._pdf_page_image_cache.clear()

        assert first == second
        assert open_calls == 1

    def test_pdf_page_text_blocks_use_native_pdf_coordinates(self, tmp_path, monkeypatch):
        upload_dir = str(tmp_path / "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        pdf_path = os.path.join(upload_dir, "text-layer.pdf")
        doc = fitz.open()
        page = doc.new_page(width=240, height=160)
        page.insert_text((24, 48), "Acme Contract 2026", fontsize=12)
        doc.save(pdf_path)
        doc.close()

        from app.core.config import settings
        monkeypatch.setattr(settings, "UPLOAD_DIR", upload_dir)

        from app.services.file_parser import FileParser
        parser = FileParser()
        loop = asyncio.new_event_loop()
        try:
            blocks, width, height = loop.run_until_complete(
                parser.get_pdf_page_text_blocks(pdf_path, 1, dpi=144)
            )
        finally:
            loop.close()

        assert width == 480
        assert height == 320
        assert any("Acme Contract" in block.text for block in blocks)
        first = next(block for block in blocks if "Acme Contract" in block.text)
        assert first.left >= 40
        assert first.top >= 70

    def test_pdf_page_text_blocks_cache_reuses_native_text_layer(self, tmp_path, monkeypatch):
        upload_dir = str(tmp_path / "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        pdf_path = os.path.join(upload_dir, "text-layer-cache.pdf")
        doc = fitz.open()
        page = doc.new_page(width=240, height=160)
        page.insert_text((24, 48), "Acme Contract Cache", fontsize=12)
        doc.save(pdf_path)
        doc.close()

        from app.core.config import settings
        monkeypatch.setattr(settings, "UPLOAD_DIR", upload_dir)
        monkeypatch.setattr(settings, "PDF_PAGE_TEXT_BLOCK_CACHE_PAGES", 8)

        from app.services import file_parser as file_parser_module
        from app.services.file_parser import FileParser

        FileParser._pdf_page_text_blocks_cache.clear()
        open_calls = 0
        original_open = file_parser_module.fitz.open

        def counting_open(*args, **kwargs):
            nonlocal open_calls
            open_calls += 1
            return original_open(*args, **kwargs)

        monkeypatch.setattr(file_parser_module.fitz, "open", counting_open)
        parser = FileParser()
        loop = asyncio.new_event_loop()
        try:
            first_blocks, first_width, first_height = loop.run_until_complete(
                parser.get_pdf_page_text_blocks(pdf_path, 1, dpi=144)
            )
            assert parser.last_pdf_page_text_blocks_cache_hit is False
            first_blocks[0].text = "mutated caller copy"
            second_blocks, second_width, second_height = loop.run_until_complete(
                parser.get_pdf_page_text_blocks(pdf_path, 1, dpi=144)
            )
            assert parser.last_pdf_page_text_blocks_cache_hit is True
        finally:
            loop.close()
            FileParser._pdf_page_text_blocks_cache.clear()

        assert open_calls == 1
        assert (first_width, first_height) == (second_width, second_height)
        assert any("Acme Contract Cache" in block.text for block in second_blocks)
