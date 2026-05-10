# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio

from app.core import has_image_client


class _FakeResponse:
    def json(self):
        return {"boxes": [{"category": "official_seal", "confidence": 0.91}]}


def test_detect_privacy_regions_uses_active_model_config_base_url(monkeypatch):
    calls = []

    async def fake_retry_async(fn, url, body, **kwargs):
        calls.append({"fn": fn, "url": url, "body": body, "kwargs": kwargs})
        return _FakeResponse()

    monkeypatch.setattr(
        has_image_client.model_config_service,
        "get_has_image_base_url",
        lambda: "http://has-image-config:18081",
    )
    monkeypatch.setattr(has_image_client, "retry_async", fake_retry_async)

    boxes = asyncio.run(
        has_image_client.detect_privacy_regions(
            b"image-bytes",
            conf=0.42,
            category_slugs=["official_seal"],
        )
    )

    assert boxes == [{"category": "official_seal", "confidence": 0.91}]
    assert calls[0]["url"] == "http://has-image-config:18081/detect"
    assert calls[0]["body"]["conf"] == 0.42
    assert calls[0]["body"]["categories"] == ["official_seal"]
    assert calls[0]["body"]["image_base64"]
