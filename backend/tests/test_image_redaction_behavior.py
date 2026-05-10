# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

from app.models.schemas import BoundingBox, FileType
from app.services.redaction.image_redactor import ImageRedactorMixin
from app.services.vision_service import VisionService


class _ImageRedactor(ImageRedactorMixin):
    def __init__(self) -> None:
        self.vision_service = VisionService.__new__(VisionService)


def _non_white_pixels(image: Image.Image) -> int:
    return sum(1 for r, g, b in image.getdata() if r < 248 or g < 248 or b < 248)


def _non_black_pixels(image: Image.Image) -> int:
    return sum(1 for r, g, b in image.getdata() if r > 8 or g > 8 or b > 8)


def test_image_redaction_mosaic_does_not_erase_red_stamp_to_white(tmp_path: Path):
    input_path = tmp_path / "stamp.png"
    output_path = tmp_path / "stamp-redacted.png"

    image = Image.new("RGB", (240, 180), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((78, 48, 152, 122), outline=(220, 20, 20), width=5)
    draw.line((88, 85, 142, 85), fill=(220, 20, 20), width=4)
    draw.line((115, 58, 115, 112), fill=(220, 20, 20), width=4)
    image.save(input_path)

    bbox = BoundingBox(
        id="seal-1",
        x=0.2,
        y=0.2,
        width=0.6,
        height=0.6,
        page=1,
        type="official_seal",
        text="official_seal",
        source="has_image",
    )

    redacted_count = asyncio.run(
        _ImageRedactor()._redact_image(
            str(input_path),
            FileType.IMAGE,
            [bbox],
            str(output_path),
            {},
        )
    )

    output = Image.open(output_path).convert("RGB")
    original_roi = image.crop((48, 36, 192, 144))
    output_roi = output.crop((48, 36, 192, 144))
    changed = ImageChops.difference(original_roi, output_roi).getbbox()

    assert redacted_count == 1
    assert changed is not None
    assert _non_white_pixels(output_roi) > 0


def test_image_redaction_white_fill_on_visual_stamp_uses_visible_mosaic(tmp_path: Path):
    input_path = tmp_path / "stamp-white-fill.png"
    output_path = tmp_path / "stamp-white-fill-redacted.png"

    image = Image.new("RGB", (240, 180), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((78, 48, 152, 122), outline=(220, 20, 20), width=5)
    draw.line((88, 85, 142, 85), fill=(220, 20, 20), width=4)
    draw.line((115, 58, 115, 112), fill=(220, 20, 20), width=4)
    image.save(input_path)

    bbox = BoundingBox(
        id="seal-white-fill",
        x=0.2,
        y=0.2,
        width=0.6,
        height=0.6,
        page=1,
        type="official_seal",
        text="official_seal",
        source="has_image",
    )

    redacted_count = asyncio.run(
        _ImageRedactor()._redact_image(
            str(input_path),
            FileType.IMAGE,
            [bbox],
            str(output_path),
            {
                "image_redaction_method": "fill",
                "image_fill_color": "#ffffff",
            },
        )
    )

    output = Image.open(output_path).convert("RGB")
    output_roi = output.crop((48, 36, 192, 144))

    assert redacted_count == 1
    assert _non_white_pixels(output_roi) > 0


def test_image_redaction_oversized_fill_uses_mosaic_instead_of_full_block(tmp_path: Path):
    input_path = tmp_path / "oversized.png"
    output_path = tmp_path / "oversized-redacted.png"

    image = Image.new("RGB", (220, 160), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 210, 150), outline=(30, 30, 30), width=3)
    draw.ellipse((82, 44, 138, 100), outline=(220, 20, 20), width=5)
    draw.line((94, 72, 126, 72), fill=(220, 20, 20), width=4)
    image.save(input_path)

    bbox = BoundingBox(
        id="oversized-seal-frame",
        x=-0.1,
        y=-0.1,
        width=1.2,
        height=1.2,
        page=1,
        type="official_seal",
        text="official_seal",
        source="has_image",
    )

    redacted_count = asyncio.run(
        _ImageRedactor()._redact_image(
            str(input_path),
            FileType.IMAGE,
            [bbox],
            str(output_path),
            {
                "image_redaction_method": "fill",
                "image_fill_color": "#000000",
            },
        )
    )

    output = Image.open(output_path).convert("RGB")

    assert redacted_count == 1
    assert _non_black_pixels(output) > 0
    assert _non_white_pixels(output) > 0
