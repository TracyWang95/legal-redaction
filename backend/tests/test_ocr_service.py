# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

from app.services import ocr_service
from app.services.ocr_service import OCRService, OCRServiceError


class _FakeOcrClient:
    def __init__(self):
        self.calls = []

    def post(self, url, json):
        self.calls.append({"url": url, "json": json})
        return {"ok": True}


class _FakeResponse:
    def __init__(self, status_code: int, text: str = "error", json_data: dict | None = None):
        self.status_code = status_code
        self.text = text
        self._json_data = json_data or {"boxes": [], "elapsed": 0}

    def json(self):
        return self._json_data


def test_ocr_request_uses_configured_generation_budget(monkeypatch):
    monkeypatch.setattr(ocr_service.settings, "OCR_MAX_NEW_TOKENS", 1536)
    monkeypatch.setattr(
        ocr_service.model_config_service,
        "get_paddle_ocr_base_url",
        lambda: "http://ocr-config:9999",
    )
    monkeypatch.setattr(ocr_service.ocr_breaker, "call_sync", lambda fn: fn())
    service = OCRService()
    fake_client = _FakeOcrClient()
    service._ocr_client = fake_client

    response = service._do_ocr_request("image-base64")

    assert response == {"ok": True}
    assert fake_client.calls == [
        {
            "url": f"{service.base_url}/ocr",
            "json": {"image": "image-base64", "max_new_tokens": 1536},
        }
    ]


def test_ocr_health_cache_is_scoped_to_configured_base_url(monkeypatch):
    urls = iter(["http://ocr-a:8082", "http://ocr-b:8082"])
    requested = []

    class FakeHealthClient:
        def get(self, url):
            requested.append(url)
            return _FakeResponse(200, json_data={"ready": False})

    monkeypatch.setattr(ocr_service.model_config_service, "get_paddle_ocr_base_url", lambda: next(urls))
    service = OCRService()
    service._health_client = FakeHealthClient()

    assert service.is_available() is False
    assert service.is_available() is False

    assert requested == ["http://ocr-a:8082/health", "http://ocr-b:8082/health"]


def test_ocr_health_treats_busy_service_as_available():
    class FakeHealthClient:
        def get(self, _url):
            return _FakeResponse(200, json_data={"ready": False, "status": "busy"})

    service = OCRService()
    service._health_client = FakeHealthClient()

    assert service.is_available() is True


def test_ocr_health_treats_open_port_timeout_as_available(monkeypatch):
    class FakeHealthClient:
        def get(self, _url):
            import httpx

            raise httpx.ReadTimeout("OCR worker is running inference")

    monkeypatch.setattr(ocr_service, "_tcp_port_open", lambda *_args, **_kwargs: True)
    service = OCRService()
    service._health_client = FakeHealthClient()

    assert service.is_available() is True


def test_ocr_non_200_status_raises_transient_for_server_errors(monkeypatch):
    monkeypatch.setattr(
        ocr_service,
        "retry_sync",
        lambda *args, **kwargs: _FakeResponse(503, "model overloaded"),
    )
    service = OCRService()

    try:
        service.extract_text_boxes(b"image")
    except OCRServiceError as exc:
        assert exc.transient is True
        assert "HTTP 503" in str(exc)
    else:
        raise AssertionError("expected OCRServiceError")


def test_ocr_non_200_status_raises_permanent_for_bad_requests(monkeypatch):
    monkeypatch.setattr(
        ocr_service,
        "retry_sync",
        lambda *args, **kwargs: _FakeResponse(400, "invalid image"),
    )
    service = OCRService()

    try:
        service.extract_text_boxes(b"image")
    except OCRServiceError as exc:
        assert exc.transient is False
        assert "HTTP 400" in str(exc)
    else:
        raise AssertionError("expected OCRServiceError")
