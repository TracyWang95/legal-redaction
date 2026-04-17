from __future__ import annotations

import asyncio
import base64
import io

from PIL import Image

from scripts import ocr_server


def _make_image_b64(width: int, height: int) -> str:
    image = Image.new("RGB", (width, height), color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def test_ocr_extract_keeps_normalized_boxes_after_resize(monkeypatch):
    monkeypatch.setattr(ocr_server, "_ready", True)
    monkeypatch.setattr(
        ocr_server,
        "extract_vl",
        lambda image, max_new_tokens=512: [
            ocr_server.OCRBox(
                text="sample",
                x=0.25,
                y=0.4,
                width=0.5,
                height=0.2,
                confidence=0.9,
                label="text",
            )
        ],
    )

    response = asyncio.run(
        ocr_server.ocr_extract(
            ocr_server.OCRRequest(
                image=_make_image_b64(1200, 2000),
                max_new_tokens=512,
            )
        )
    )

    assert len(response.boxes) == 1
    box = response.boxes[0]
    assert box.x == 0.25
    assert box.y == 0.4
    assert box.width == 0.5
    assert box.height == 0.2
