# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import builtins
import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw

from app.services.vision.seal_detector import (
    detect_dark_seal_regions,
    detect_red_seal_regions,
)


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts" / "eval-vision-direct.py"


def _load_eval_vision_direct():
    spec = importlib.util.spec_from_file_location("eval_vision_direct_for_test", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_local_profile_image_input_bypasses_pdf_path(tmp_path, monkeypatch):
    module = _load_eval_vision_direct()
    image_path = tmp_path / "sample.png"
    Image.new("RGB", (80, 40), "white").save(image_path)

    real_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name == "fitz":
            raise AssertionError("image profile must not import PyMuPDF")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)

    summary = module.profile_input_locally(
        image_path,
        scale=2.0,
        pages_arg="1",
        skip_seal_fallback=True,
        include_private=True,
    )

    assert summary["input_kind"] == "image"
    assert summary["page_count"] == 1
    assert summary["totals"]["render_ms"] == 0
    assert summary["totals"]["text_layer_ms"] == 0
    assert summary["pages"][0]["pdf_path_used"] is False
    assert summary["pages"][0]["render_ms"] is None


def test_red_seal_detector_keeps_tight_box_near_separate_red_ink():
    image = Image.new("RGB", (1000, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((410, 220, 560, 370), outline=(210, 20, 20), width=10)
    draw.polygon(
        [
            (485, 265),
            (500, 295),
            (530, 300),
            (505, 318),
            (510, 350),
            (485, 330),
            (460, 350),
            (465, 318),
            (440, 300),
            (470, 295),
        ],
        fill=(210, 20, 20),
    )
    draw.line((650, 260, 820, 260), fill=(210, 20, 20), width=4)

    regions = detect_red_seal_regions(image)

    assert len(regions) == 1
    assert 0.38 <= regions[0].x <= 0.43
    assert regions[0].width <= 0.18
    assert regions[0].height <= 0.22
    assert detect_dark_seal_regions(image) == []


def test_dark_seal_detector_keeps_grayscale_stamp_recall():
    image = Image.new("RGB", (1000, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((400, 220, 560, 380), outline=(45, 45, 45), width=8)
    draw.line((440, 300, 520, 300), fill=(45, 45, 45), width=5)
    draw.line((480, 260, 480, 340), fill=(45, 45, 45), width=5)

    regions = detect_dark_seal_regions(image)

    assert len(regions) == 1
    assert 0.37 <= regions[0].x <= 0.42
    assert 0.16 <= regions[0].width <= 0.20
    assert 0.20 <= regions[0].height <= 0.24
