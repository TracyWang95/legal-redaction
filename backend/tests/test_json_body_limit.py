# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

"""Tests for differentiated request body size limits (JSON vs multipart)."""
from __future__ import annotations

import asyncio

from starlette.requests import Request
from starlette.responses import Response

from app.main import MaxBodySizeMiddleware


def test_large_json_body_returns_413(test_client):
    """A >1MB JSON body to a non-upload endpoint should return 413."""
    # Build a JSON payload just over 1 MB
    oversized_payload = {"data": "x" * (1024 * 1024 + 1)}
    resp = test_client.post(
        "/api/v1/redaction/preview-entity-map",
        json=oversized_payload,
    )
    assert resp.status_code == 413
    body = resp.json()
    assert body["error_code"] == "BODY_TOO_LARGE"


def test_small_json_body_passes(test_client):
    """A small JSON body should not be rejected by size middleware."""
    # This endpoint may return 422 (validation) but NOT 413
    resp = test_client.post(
        "/api/v1/redaction/preview-entity-map",
        json={"entities": [], "config": {}},
    )
    assert resp.status_code != 413


def test_streamed_json_without_content_length_still_returns_413():
    async def receive():
        return {
            "type": "http.request",
            "body": b"x" * (1024 * 1024 + 10),
            "more_body": False,
        }

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/redaction/preview-entity-map",
        "headers": [(b"content-type", b"application/json")],
    }
    request = Request(scope, receive)
    middleware = MaxBodySizeMiddleware(app=lambda scope, receive, send: None)

    called = False

    async def call_next(req: Request):
        nonlocal called
        called = True
        await req.body()
        return Response(status_code=200)

    response = asyncio.run(middleware.dispatch(request, call_next))
    assert response.status_code == 413
    assert called is False
