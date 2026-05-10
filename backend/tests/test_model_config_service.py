# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import asyncio

import httpx

from app.models.schemas import ModelConfig, ModelConfigList
from app.services import model_config_service


def _config(
    config_id: str,
    *,
    provider: str = "local",
    enabled: bool = True,
    base_url: str | None = "http://configured",
) -> ModelConfig:
    return ModelConfig(
        id=config_id,
        name=config_id,
        provider=provider,
        enabled=enabled,
        base_url=base_url,
        model_name=config_id,
    )


def test_builtin_base_url_helpers_use_model_config(monkeypatch):
    configs = ModelConfigList(
        configs=[
            _config("paddle_ocr_service", base_url="http://ocr-config:8082/"),
            _config("has_image_service", base_url="http://has-image-config:8081/"),
        ],
        active_id="has_image_service",
    )
    monkeypatch.setattr(model_config_service, "load_configs", lambda: configs)

    assert model_config_service.get_paddle_ocr_base_url() == "http://ocr-config:8082"
    assert model_config_service.get_has_image_base_url() == "http://has-image-config:8081"


def test_has_image_base_url_uses_active_local_runtime_config(monkeypatch):
    configs = ModelConfigList(
        configs=[
            _config("paddle_ocr_service", base_url="http://ocr-config:8082"),
            _config("has_image_service", base_url="http://has-image-default:8081"),
            _config("custom_has_image", base_url="http://custom-has-image:18081"),
        ],
        active_id="custom_has_image",
    )
    monkeypatch.setattr(model_config_service, "load_configs", lambda: configs)

    assert model_config_service.get_has_image_base_url() == "http://custom-has-image:18081"


def test_sanitize_rejects_non_has_image_active_config():
    sanitized, changed = model_config_service._sanitize_model_config_list(
        ModelConfigList(
            configs=[
                _config("paddle_ocr_service"),
                _config("has_image_service", base_url="http://has-image:8081"),
                _config("openai_vision", provider="openai", base_url="http://api.example"),
            ],
            active_id="openai_vision",
        )
    )

    assert changed is True
    assert sanitized.active_id == "has_image_service"


class _FakeResponse:
    def __init__(self, data: dict, status_code: int = 200):
        self._data = data
        self.status_code = status_code

    def json(self) -> dict:
        return self._data


class _FakeAsyncClient:
    def __init__(self, response=None, error=None, *args, **kwargs):
        self.response = response
        self.error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, *_args, **_kwargs):
        if self.error:
            raise self.error
        return self.response


def test_paddle_ocr_preflight_treats_busy_as_online(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(
            _FakeResponse({"model": "PaddleOCR-VL", "ready": False, "status": "busy", "device": "cuda:0"})
        ),
    )

    result = asyncio.run(model_config_service._probe_paddle_ocr_health("http://ocr.test:8082"))

    assert result["success"] is True
    assert result["status"] == "online"
    assert result["provider"] == "local"
    assert result["detail"]["model_state"] == "serving"
    assert result["detail"]["gpu_provider"] == "cuda"
    assert "busy" not in result["message"].lower()


def test_paddle_ocr_preflight_timeout_open_port_is_online(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(error=httpx.ReadTimeout("worker occupied")),
    )
    monkeypatch.setattr("app.core.health_checks._tcp_port_open", lambda *_args, **_kwargs: True)

    result = asyncio.run(model_config_service._probe_paddle_ocr_health("http://ocr.test:8082"))

    assert result["success"] is True
    assert result["status"] == "online"
    assert result["detail"]["probe"] == "health_timeout_port_open"
    assert result["detail"]["model_state"] == "serving"


def test_has_image_config_preflight_treats_busy_as_online(monkeypatch):
    configs = ModelConfigList(
        configs=[_config("has_image_service", base_url="http://has-image.test:8081")],
        active_id="has_image_service",
    )
    monkeypatch.setattr(model_config_service, "load_configs", lambda: configs)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(
            _FakeResponse({"model": "HaS Image", "ready": False, "status": "busy", "device": "cuda:0"})
        ),
    )

    result, error = asyncio.run(model_config_service.test_config("has_image_service"))

    assert error == ""
    assert result["success"] is True
    assert result["status"] == "online"
    assert result["detail"]["model_state"] == "serving"
    assert result["detail"]["gpu_provider"] == "cuda"


def test_has_image_config_preflight_degrades_cpu_fallback_risk(monkeypatch):
    configs = ModelConfigList(
        configs=[_config("has_image_service", base_url="http://has-image.test:8081")],
        active_id="has_image_service",
    )
    monkeypatch.setattr(model_config_service, "load_configs", lambda: configs)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(
            _FakeResponse(
                {
                    "model": "HaS Image",
                    "ready": True,
                    "status": "ok",
                    "runtime": "ultralytics-yolo",
                    "runtime_mode": "cpu",
                    "device": "cpu",
                    "gpu_only_mode": True,
                    "cpu_fallback_risk": True,
                }
            )
        ),
    )

    result, error = asyncio.run(model_config_service.test_config("has_image_service"))

    assert error == ""
    assert result["success"] is False
    assert result["status"] == "degraded"
    assert "CPU fallback risk" in result["message"]
    assert result["detail"]["runtime_mode"] == "cpu"
    assert result["detail"]["cpu_fallback_risk"] is True
