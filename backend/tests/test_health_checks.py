from __future__ import annotations

import httpx

from app.core import gpu_memory
from app.core import health_checks
from app.services.job_management_service import progress_from_items


class _JsonResponse:
    def __init__(self, data: dict, status_code: int = 200):
        self._data = data
        self.status_code = status_code

    def json(self) -> dict:
        return self._data


def test_check_ocr_sync_reports_online_when_health_times_out_but_port_is_open(monkeypatch):
    def fake_get(*_args, **_kwargs):
        raise httpx.ReadTimeout("busy")

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)
    monkeypatch.setattr(health_checks, "_tcp_port_open", lambda *_args, **_kwargs: True)

    assert health_checks.check_ocr_sync("http://127.0.0.1:8082/health", "Paddle") == (
        "Paddle",
        "online",
    )


def test_check_ocr_sync_reports_offline_when_health_times_out_and_port_is_closed(monkeypatch):
    def fake_get(*_args, **_kwargs):
        raise httpx.ReadTimeout("down")

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)
    monkeypatch.setattr(health_checks, "_tcp_port_open", lambda *_args, **_kwargs: False)

    assert health_checks.check_ocr_sync("http://127.0.0.1:8082/health", "Paddle") == (
        "Paddle",
        "offline",
    )


def test_check_ocr_sync_reports_online_when_service_is_loading(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse({"model": "PaddleOCR-VL", "ready": False, "status": "loading"})

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    assert health_checks.check_ocr_sync("http://127.0.0.1:8082/health", "Paddle") == (
        "PaddleOCR-VL",
        "online",
    )


def test_check_sync_treats_busy_model_service_as_ready(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse({"model": "HaS Image", "ready": False, "status": "busy"})

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    assert health_checks.check_sync("http://127.0.0.1:8081/health", "HaS Image") == (
        "HaS Image",
        True,
    )


def test_service_health_reports_busy_as_online_without_busy_status(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse({"model": "HaS Image", "ready": False, "status": "busy"})

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    result = health_checks.check_service_health_sync("http://127.0.0.1:8081/health", "HaS Image")

    assert result.name == "HaS Image"
    assert result.status == "online"
    assert result.detail["model_state"] == "serving"
    assert "busy" not in result.as_service_payload()["status"]


def test_service_health_reports_loading_as_online_not_busy(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse({"model": "PaddleOCR-VL", "ready": False, "status": "loading"})

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    result = health_checks.check_service_health_sync("http://127.0.0.1:8082/health", "Paddle")

    assert result.name == "PaddleOCR-VL"
    assert result.status == "online"
    assert result.detail["model_state"] == "loading"


def test_service_health_reports_timeout_with_open_port_as_online(monkeypatch):
    def fake_get(*_args, **_kwargs):
        raise httpx.ReadTimeout("worker timeout")

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)
    monkeypatch.setattr(health_checks, "_tcp_port_open", lambda *_args, **_kwargs: True)

    result = health_checks.check_service_health_sync(
        "http://127.0.0.1:8081/health",
        "HaS Image",
    )

    assert result.status == "online"
    assert result.detail["probe"] == "health_timeout_port_open"
    assert result.detail["model_state"] == "serving"


def test_service_health_reports_timeout_with_closed_port_as_offline(monkeypatch):
    def fake_get(*_args, **_kwargs):
        raise httpx.ReadTimeout("worker timeout")

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)
    monkeypatch.setattr(health_checks, "_tcp_port_open", lambda *_args, **_kwargs: False)

    result = health_checks.check_service_health_sync(
        "http://127.0.0.1:8081/health",
        "HaS Image",
    )

    assert result.status == "offline"
    assert result.detail["reachable"] is False
    assert result.detail["model_state"] == "unreachable"


def test_service_health_reports_reachable_unready_service_as_degraded(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse({"model": "HaS Image", "ready": False, "status": "unavailable"})

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    result = health_checks.check_service_health_sync("http://127.0.0.1:8081/health", "HaS Image")

    assert result.name == "HaS Image"
    assert result.status == "degraded"
    assert result.detail["reachable"] is True
    assert result.detail["model_state"] == "not_ready"


def test_check_ocr_sync_reports_degraded_when_service_is_reachable_but_not_ready(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse({"model": "PaddleOCR-VL", "ready": False})

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    assert health_checks.check_ocr_sync("http://127.0.0.1:8082/health", "Paddle") == (
        "PaddleOCR-VL",
        "degraded",
    )


def test_check_ocr_sync_reports_degraded_when_service_marks_unavailable(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse({"model": "PaddleOCR-VL", "ready": False, "status": "unavailable"})

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    assert health_checks.check_ocr_sync("http://127.0.0.1:8082/health", "Paddle") == (
        "PaddleOCR-VL",
        "degraded",
    )


def test_ocr_health_timeout_open_port_keeps_online_detail(monkeypatch):
    def fake_get(*_args, **_kwargs):
        raise httpx.ReadTimeout("worker occupied")

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)
    monkeypatch.setattr(health_checks, "_tcp_port_open", lambda *_args, **_kwargs: True)

    result = health_checks.check_ocr_health_sync("http://127.0.0.1:8082/health", "Paddle")

    assert result.status == "online"
    assert result.detail["probe"] == "health_timeout_port_open"
    assert result.detail["model_state"] == "serving"


def test_check_has_ner_reports_online_when_probe_fails_but_port_is_open(monkeypatch):
    def fake_probe(*_args, **_kwargs):
        return False, "timeout", "", False

    monkeypatch.setattr("app.core.llamacpp_probe.probe_llamacpp", fake_probe)
    monkeypatch.setattr(health_checks, "_tcp_port_open", lambda *_args, **_kwargs: True)

    assert health_checks.check_has_ner() == ("HaS_4.0_0.6B", "online")


def test_check_has_ner_health_keeps_non_strict_probe_message_out_of_name(monkeypatch):
    def fake_probe(*_args, **_kwargs):
        return True, "llama-server responded with loading detail", "http://127.0.0.1:8080/v1/models", False

    monkeypatch.setattr("app.core.llamacpp_probe.probe_llamacpp", fake_probe)
    monkeypatch.setenv("HAS_TEXT_N_GPU_LAYERS", "0")

    result = health_checks.check_has_ner_health()

    assert result.name == "HaS_4.0_0.6B"
    assert result.status == "online"
    assert result.detail["runtime"] == "vllm server"
    assert result.detail["runtime_mode"] == "gpu"
    assert result.detail["cpu_fallback_risk"] is False
    assert result.detail["probe_message"] == "llama-server responded with loading detail"


def test_has_text_runtime_detail_reads_dotenv_fallback(monkeypatch):
    def fake_dotenv_value(name):
        return {
            "HAS_TEXT_N_GPU_LAYERS": "-1",
            "HAS_TEXT_DEVICE": "Vulkan1",
        }.get(name, "")

    monkeypatch.delenv("HAS_TEXT_N_GPU_LAYERS", raising=False)
    monkeypatch.delenv("HAS_TEXT_DEVICE", raising=False)
    monkeypatch.delenv("HAS_TEXT_GPU_PROVIDER", raising=False)
    monkeypatch.setattr(health_checks, "_read_runtime_dotenv_value", fake_dotenv_value)

    detail = health_checks._has_text_runtime_detail()

    assert detail["gpu_layers"] == "-1"
    assert detail["device"] == "Vulkan1"
    assert detail["gpu_enabled"] is True
    assert detail["runtime_mode"] == "gpu"
    assert detail["gpu_provider"] == "vulkan"
    assert detail["gpu_only_mode"] is True
    assert detail["runtime_expectation"] == "cuda-gpu"
    assert detail["cpu_fallback_risk"] is False


def test_has_text_runtime_detail_env_overrides_dotenv(monkeypatch):
    monkeypatch.setenv("HAS_TEXT_N_GPU_LAYERS", "0")
    monkeypatch.setenv("HAS_TEXT_DEVICE", "CPU")
    monkeypatch.delenv("HAS_TEXT_GPU_PROVIDER", raising=False)
    monkeypatch.setattr(health_checks, "_read_runtime_dotenv_value", lambda _name: "-1")

    detail = health_checks._has_text_runtime_detail()

    assert detail["gpu_layers"] == "0"
    assert detail["device"] == "CPU"
    assert detail["gpu_enabled"] is False
    assert detail["runtime_mode"] == "cpu"
    assert detail["gpu_provider"] == "none"
    assert detail["gpu_only_mode"] is False
    assert detail["runtime_expectation"] == "cuda-gpu"
    assert detail["cpu_fallback_risk"] is True


def test_has_text_runtime_detail_defaults_to_gpu_offload(monkeypatch):
    monkeypatch.delenv("HAS_TEXT_N_GPU_LAYERS", raising=False)
    monkeypatch.delenv("HAS_TEXT_DEVICE", raising=False)
    monkeypatch.delenv("HAS_TEXT_GPU_PROVIDER", raising=False)
    monkeypatch.delenv("HAS_TEXT_ALLOW_CPU", raising=False)
    monkeypatch.setattr(health_checks, "_read_runtime_dotenv_value", lambda _name: "")

    detail = health_checks._has_text_runtime_detail()

    assert detail["gpu_layers"] == "-1"
    assert detail["runtime_mode"] == "gpu"
    assert detail["gpu_only_mode"] is True
    assert detail["cpu_fallback_risk"] is False


def test_service_health_degrades_gpu_only_model_when_cpu_fallback_is_reported(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse(
            {
                "model": "HaS-Image-YOLO11",
                "ready": True,
                "runtime": "ultralytics-yolo",
                "runtime_mode": "cpu",
                "gpu_available": False,
                "device": "cpu",
                "gpu_only_mode": True,
            }
        )

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    result = health_checks.check_service_health_sync(
        "http://127.0.0.1:8081/health",
        "HaS Image",
        service_kind="has_image",
    )

    assert result.status == "degraded"
    assert result.detail["runtime"] == "ultralytics-yolo"
    assert result.detail["runtime_mode"] == "cpu"
    assert result.detail["gpu_only_mode"] is True
    assert result.detail["cpu_fallback_risk"] is True


def test_legacy_has_image_health_without_runtime_fields_stays_online(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse(
            {
                "model": "HaS-Image-YOLO11",
                "ready": True,
                "weights": "/models/sensitive_seg_best.pt",
            }
        )

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    result = health_checks.check_service_health_sync(
        "http://127.0.0.1:8081/health",
        "HaS Image",
        service_kind="has_image",
    )

    assert result.status == "online"
    assert result.detail["runtime"] == "ultralytics-yolo"
    assert result.detail["runtime_mode"] == "unknown"
    assert result.detail["cpu_fallback_risk"] is False


def test_ocr_health_preserves_gpu_runtime_contract(monkeypatch):
    def fake_get(*_args, **_kwargs):
        return _JsonResponse(
            {
                "model": "PaddleOCR-VL",
                "ready": True,
                "gpu_available": True,
                "device": "gpu:0",
                "gpu_only_mode": True,
            }
        )

    monkeypatch.setattr(health_checks._health_check_client, "get", fake_get)

    result = health_checks.check_ocr_health_sync("http://127.0.0.1:8082/health", "Paddle")

    assert result.status == "online"
    assert result.detail["runtime"] == "paddleocr"
    assert result.detail["runtime_mode"] == "gpu"
    assert result.detail["cpu_fallback_risk"] is False


def test_parse_nvidia_smi_process_csv_handles_wsl_not_found_rows():
    processes = gpu_memory._parse_nvidia_smi_process_csv(
        "269411, [Not Found], [N/A]\n"
        "114128, /usr/bin/python, 1234\n"
    )

    assert processes == [
        {"pid": 269411, "name": "", "used_mb": None},
        {"pid": 114128, "name": "/usr/bin/python", "used_mb": 1234},
    ]


def test_progress_from_items_includes_processing_count():
    progress = progress_from_items(
        [
            {"status": "processing"},
            {"status": "pending"},
            {"status": "awaiting_review"},
        ]
    )

    assert progress["processing"] == 1
    assert progress["pending"] == 1
    assert progress["awaiting_review"] == 1
