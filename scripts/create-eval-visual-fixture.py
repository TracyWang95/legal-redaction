#!/usr/bin/env python
# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Generate a public visual smoke-test fixture.

The output is synthetic and safe to ship: it contains fake contract text, a
red stamp-like mark, an approval line, and a QR-style placeholder. The image is
used to verify OCR/vision plumbing without relying on private files under
private corpus.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "fixtures" / "eval" / "sample-visual.png"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create fixtures/eval/sample-visual.png")
    parser.add_argument("output", nargs="?", default=str(DEFAULT_OUTPUT))
    return parser.parse_args()


def font(size: int) -> ImageFont.ImageFont:
    for name in ("arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_qr_placeholder(draw: ImageDraw.ImageDraw, left: int, top: int, cell: int = 12) -> None:
    pattern = [
        "111111100101",
        "100000101101",
        "101110100001",
        "101110111101",
        "101110100101",
        "100000101001",
        "111111101111",
        "000000001000",
        "110101111011",
        "001011001101",
        "111001101001",
        "100110011111",
    ]
    draw.rectangle(
        [left - 8, top - 8, left + len(pattern[0]) * cell + 8, top + len(pattern) * cell + 8],
        fill=(255, 255, 255),
        outline=(17, 24, 39),
        width=2,
    )
    for row, line in enumerate(pattern):
        for col, value in enumerate(line):
            if value == "1":
                x = left + col * cell
                y = top + row * cell
                draw.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(17, 24, 39))


def main() -> int:
    args = parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGB", (900, 640), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    title_font = font(34)
    body_font = font(23)
    small_font = font(18)

    draw.rectangle([0, 0, 899, 639], outline=(203, 213, 225), width=2)
    draw.text((58, 44), "Synthetic Procurement Contract", fill=(15, 23, 42), font=title_font)
    draw.line([58, 96, 842, 96], fill=(148, 163, 184), width=2)

    rows = [
        "Contract No: OPEN-2026-042",
        "Party A: Northwind Data Systems",
        "Party B: Example Research Hospital",
        "Contact: Alice Chen  +1-202-555-0199",
        "Address: 88 Sample Road, Test City",
        "Invoice: 2026-INV-0007    Amount: 168,400.00",
    ]
    y = 132
    for row in rows:
        draw.text((72, y), row, fill=(31, 41, 55), font=body_font)
        y += 46

    draw.rounded_rectangle([68, 430, 516, 545], radius=10, outline=(148, 163, 184), width=2)
    draw.text((92, 454), "Review note:", fill=(15, 23, 42), font=body_font)
    draw.text((92, 494), "Contains fake PII for eval only.", fill=(71, 85, 105), font=small_font)

    # Stamp-like red ink. The ring and spokes are intentionally simple so the
    # offline seal fallback can detect it without any model service.
    cx, cy, radius = 690, 278, 92
    red = (205, 25, 30)
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=red, width=12)
    draw.ellipse([cx - 48, cy - 48, cx + 48, cy + 48], outline=red, width=5)
    draw.line([cx - 62, cy, cx + 62, cy], fill=red, width=5)
    draw.line([cx, cy - 62, cx, cy + 62], fill=red, width=5)
    draw.text((cx - 68, cy - 12), "APPROVED", fill=red, font=small_font)

    draw.line([600, 448, 842, 448], fill=(17, 24, 39), width=3)
    draw.arc([606, 402, 740, 472], 200, 338, fill=(17, 24, 39), width=4)
    draw.text((604, 466), "Authorized approval", fill=(71, 85, 105), font=small_font)

    draw_qr_placeholder(draw, 674, 492)

    image.save(output)
    print(f"visual fixture: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
