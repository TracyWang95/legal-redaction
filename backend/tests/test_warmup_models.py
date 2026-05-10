# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import base64
import importlib.util
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


def _load_warmup_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "warmup_models.py"
    spec = importlib.util.spec_from_file_location("warmup_models_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _decode_png(value: str) -> Image.Image:
    return Image.open(BytesIO(base64.b64decode(value))).convert("RGB")


def test_warmup_generates_valid_probe_images():
    warmup = _load_warmup_module()

    white = _decode_png(warmup._white_pixel_png_base64())
    table = _decode_png(warmup._table_png_base64())

    assert white.size == (1, 1)
    assert table.size == (640, 420)
    assert table.getbbox() is not None


def test_warmup_ocr_structure_posts_table_payload(monkeypatch):
    warmup = _load_warmup_module()
    calls = []

    def fake_post_json(url, payload, *, timeout=warmup.TIMEOUT):
        calls.append((url, payload, timeout))
        return SimpleNamespace()

    monkeypatch.setattr(warmup, "_post_json", fake_post_json)

    assert warmup.warmup_ocr_structure() is True
    assert calls[0][0] == warmup.OCR_STRUCTURE_URL
    assert calls[0][1]["use_ocr_results_with_table_cells"] is True
    assert _decode_png(calls[0][1]["image"]).size == (640, 420)


def test_wait_for_services_explains_unreachable_direct_ports(monkeypatch, capsys):
    warmup = _load_warmup_module()

    monkeypatch.setattr(warmup, "check_service", lambda _url: False)
    monkeypatch.setattr(warmup, "probe_has_image", lambda: ("down", False))
    monkeypatch.setattr(warmup.time, "sleep", lambda _seconds: None)

    class FakeHttpx:
        @staticmethod
        def get(*_args, **_kwargs):
            raise RuntimeError("unreachable")

    monkeypatch.setattr(warmup, "httpx", FakeHttpx)

    assert warmup.wait_for_services(max_wait=1) is False
    captured = capsys.readouterr().out
    assert "same WSL/container network" in captured
