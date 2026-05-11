"""
推理模型配置 — 业务逻辑层
（视觉：HaS Image 8081 微服务；与文本 NER 分离）
"""

from __future__ import annotations

import logging

from app.core.config import settings
from app.core.persistence import load_json, save_json
from app.models.schemas import ModelConfig, ModelConfigList

logger = logging.getLogger(__name__)


# ── 默认 / 内置常量 ──────────────────────────────────────

DEFAULT_CONFIGS = ModelConfigList(
    configs=[
        ModelConfig(
            id="paddle_ocr_service",
            name="PaddleOCR-VL 微服务 (8082)",
            provider="local",
            enabled=True,
            base_url=settings.OCR_BASE_URL,
            model_name="PaddleOCR-VL-1.5-0.9B",
            temperature=0.8,
            top_p=0.6,
            max_tokens=4096,
            enable_thinking=False,
            description="PaddleOCR-VL OCR；基址与后端环境变量 OCR_BASE_URL 一致",
        ),
        ModelConfig(
            id="has_image_service",
            name="HaS Image 微服务 (8081)",
            provider="local",
            enabled=True,
            base_url=settings.HAS_IMAGE_BASE_URL,
            model_name="HaS-Image-YOLO11",
            temperature=0.8,
            top_p=0.6,
            max_tokens=4096,
            enable_thinking=False,
            description="Ultralytics YOLO11 实例分割；权重由环境变量 HAS_IMAGE_WEIGHTS 指定",
        ),
        ModelConfig(
            id="vlm_service",
            name="VLM 视觉语义服务",
            provider="custom",
            enabled=True,
            base_url=settings.VLM_BASE_URL,
            model_name=settings.VLM_MODEL_NAME,
            temperature=0.1,
            top_p=0.6,
            max_tokens=1024,
            enable_thinking=False,
            description="OpenAI 兼容视觉语言模型，用规则清单识别签字等自定义视觉特征。",
        ),
    ],
    active_id="has_image_service",
)

# 内置视觉后端，禁止删除
VISION_BUILTIN_IDS = frozenset({"paddle_ocr_service", "has_image_service", "vlm_service"})

# 旧版条目，加载时剔除
_LEGACY_VISION_IDS = frozenset({"local_glm", "zhipu_glm4v", "zhipu_glm"})  # kept for migration

_SERVING_STATUSES = frozenset({"busy", "running", "processing", "inferencing"})
_LOADING_STATUSES = frozenset({"loading", "starting", "warming_up", "warming-up"})
_UNAVAILABLE_STATUSES = frozenset({"unavailable", "offline", "degraded", "error", "failed"})


def _model_state_from_health_payload(data: dict) -> tuple[str, bool, bool]:
    status = str(data.get("status", "")).strip().lower()
    ready = bool(data["ready"]) if "ready" in data else True
    if status in _SERVING_STATUSES:
        return "serving", True, ready
    if status in _LOADING_STATUSES:
        return "loading", True, ready
    if status in _UNAVAILABLE_STATUSES:
        return "not_ready", False, ready
    if not ready:
        return "not_ready", False, ready
    return "ready", True, ready


def _infer_gpu_provider(data: dict) -> str | None:
    explicit = str(data.get("gpu_provider") or "").strip()
    if explicit:
        return explicit
    device = str(data.get("device") or "").strip().lower()
    if "vulkan" in device:
        return "vulkan"
    if "cuda" in device or device.startswith("gpu") or device.isdigit():
        return "cuda"
    if "metal" in device:
        return "metal"
    if "cpu" in device:
        return "cpu"
    if data.get("gpu_available") is False:
        return "none"
    if data.get("gpu_available") is True:
        return "gpu"
    return None


def _health_detail(
    *,
    provider: str,
    base_url: str,
    health_url: str,
    data: dict,
) -> dict:
    model_state, service_online, ready = _model_state_from_health_payload(data)
    detail = {
        "provider": provider,
        "base_url": base_url,
        "health_url": health_url,
        "model": data.get("model") or data.get("name"),
        "ready": ready,
        "service_online": service_online,
        "model_state": model_state,
    }
    for key in (
        "runtime",
        "runtime_mode",
        "device",
        "gpu_available",
        "gpu_only_mode",
        "cpu_fallback_risk",
        "structure_ready",
        "weights",
    ):
        if key in data:
            detail[key] = data[key]
    gpu_provider = _infer_gpu_provider(data)
    if gpu_provider:
        detail["gpu_provider"] = gpu_provider
    return detail


def _preflight_result(
    *,
    success: bool,
    status: str,
    message: str,
    provider: str,
    base_url: str,
    detail: dict | None = None,
) -> dict:
    out = {
        "success": success,
        "status": status,
        "message": message,
        "provider": provider,
        "base_url": base_url,
    }
    if detail:
        out["detail"] = detail
    return out


async def _probe_local_http_health(
    *,
    base_url: str,
    provider: str,
    default_model: str,
    timeout: float,
) -> dict:
    import httpx

    from app.core.health_checks import _tcp_port_open

    base = base_url.rstrip("/")
    health_url = f"{base}/health"
    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            resp = await client.get(health_url)
    except httpx.TimeoutException:
        if _tcp_port_open(health_url):
            return _preflight_result(
                success=True,
                status="online",
                message=f"{default_model} service is online at {base}; health probe timed out while the worker is occupied.",
                provider=provider,
                base_url=base,
                detail={
                    "provider": provider,
                    "base_url": base,
                    "health_url": health_url,
                    "service_online": True,
                    "model_state": "serving",
                    "probe": "health_timeout_port_open",
                },
            )
        return _preflight_result(
            success=False,
            status="offline",
            message=f"Cannot connect to {default_model} service ({base}).",
            provider=provider,
            base_url=base,
        )
    except Exception:
        logger.exception("Local model health probe failed for %s at %s", default_model, base)
        return _preflight_result(
            success=False,
            status="offline",
            message=f"Cannot connect to {default_model} service ({base}).",
            provider=provider,
            base_url=base,
        )

    if resp.status_code != 200:
        return _preflight_result(
            success=False,
            status="degraded",
            message=f"{default_model} /health returned HTTP {resp.status_code}",
            provider=provider,
            base_url=base,
            detail={"provider": provider, "base_url": base, "health_url": health_url, "http_status": resp.status_code},
        )

    try:
        data = resp.json()
    except Exception:
        return _preflight_result(
            success=True,
            status="online",
            message=f"{default_model} service responded at {base}, but /health did not return JSON.",
            provider=provider,
            base_url=base,
            detail={"provider": provider, "base_url": base, "health_url": health_url, "service_online": True},
        )

    if not isinstance(data, dict):
        return _preflight_result(
            success=True,
            status="online",
            message=f"{default_model} service responded at {base}, but /health returned non-object JSON.",
            provider=provider,
            base_url=base,
            detail={"provider": provider, "base_url": base, "health_url": health_url, "service_online": True},
        )

    model = data.get("model") or data.get("name") or default_model
    detail = _health_detail(provider=provider, base_url=base, health_url=health_url, data={**data, "model": model})
    model_state = detail["model_state"]
    if detail.get("cpu_fallback_risk"):
        return _preflight_result(
            success=False,
            status="degraded",
            message=f"{model} service is reachable at {base}, but CPU fallback risk is reported.",
            provider=provider,
            base_url=base,
            detail=detail,
        )
    if model_state in {"serving", "loading"}:
        return _preflight_result(
            success=True,
            status="online",
            message=f"{model} service is online at {base}; model_state={model_state}.",
            provider=provider,
            base_url=base,
            detail=detail,
        )
    if model_state != "ready":
        return _preflight_result(
            success=False,
            status="degraded",
            message=f"{model} service is reachable at {base}, but the model is not ready.",
            provider=provider,
            base_url=base,
            detail=detail,
        )
    return _preflight_result(
        success=True,
        status="online",
        message=f"{model} is online and ready.",
        provider=provider,
        base_url=base,
        detail=detail,
    )


# ── 内部工具 ─────────────────────────────────────────────

def is_has_image_runtime_config(config: ModelConfig) -> bool:
    return (
        config.enabled
        and config.provider == "local"
        and config.id not in {"paddle_ocr_service", "vlm_service"}
    )


def _sanitize_model_config_list(raw: ModelConfigList) -> tuple[ModelConfigList, bool]:
    kept = [
        c
        for c in raw.configs
        if c.id not in _LEGACY_VISION_IDS and c.provider != "zhipu"
    ]
    changed = len(kept) != len(raw.configs)
    seen: set[str] = set()
    merged: list[ModelConfig] = []
    for d in DEFAULT_CONFIGS.configs:
        match = next((c for c in kept if c.id == d.id), None)
        if match:
            merged.append(match)
            seen.add(match.id)
        else:
            merged.append(d.model_copy(deep=True))
            changed = True
    for c in kept:
        if c.id not in seen:
            merged.append(c)
            seen.add(c.id)
    final_merged: list[ModelConfig] = []
    for c in merged:
        if c.id in VISION_BUILTIN_IDS and not c.enabled:
            final_merged.append(c.model_copy(update={"enabled": True}))
            changed = True
        else:
            final_merged.append(c)
    active_candidates = {c.id for c in final_merged if is_has_image_runtime_config(c)}
    active = raw.active_id if raw.active_id in active_candidates else None
    if active is None:
        active = "has_image_service" if "has_image_service" in active_candidates else None
        if active is None and active_candidates:
            active = next(c.id for c in final_merged if c.id in active_candidates)
        changed = True
    out = ModelConfigList(configs=final_merged, active_id=active)
    return out, changed


# ── 持久化 ────────────────────────────────────────────────

def load_configs() -> ModelConfigList:
    """加载配置；自动迁移并移除已废弃的 GLM 视觉配置项"""
    raw = load_json(settings.MODEL_CONFIG_PATH, default=None)
    if raw is not None:
        try:
            lst = ModelConfigList(**raw)
            lst, changed = _sanitize_model_config_list(lst)
            if changed:
                save_configs(lst)
                logger.info("ModelConfig 已迁移：移除旧版 GLM 视觉配置，保留 HaS Image 等条目")
            return lst
        except Exception as e:
            logger.error("ModelConfig 加载配置失败: %s", e)
    return DEFAULT_CONFIGS.model_copy(deep=True)


def save_configs(configs: ModelConfigList) -> None:
    """保存配置"""
    save_json(settings.MODEL_CONFIG_PATH, configs)


# ── 业务方法 ──────────────────────────────────────────────

def get_configs() -> ModelConfigList:
    return load_configs()


def get_active() -> ModelConfig | None:
    return get_active_has_image_config()


def get_active_has_image_config() -> ModelConfig | None:
    configs = load_configs()
    if configs.active_id:
        for cfg in configs.configs:
            if cfg.id == configs.active_id and is_has_image_runtime_config(cfg):
                return cfg
    for cfg in configs.configs:
        if is_has_image_runtime_config(cfg):
            return cfg
    return None


def get_config(config_id: str) -> ModelConfig | None:
    for cfg in load_configs().configs:
        if cfg.id == config_id:
            return cfg
    return None


def get_paddle_ocr_base_url() -> str:
    config = get_config("paddle_ocr_service")
    if config and config.enabled and config.base_url:
        return config.base_url.rstrip("/")
    return settings.OCR_BASE_URL.rstrip("/")


def get_has_image_base_url() -> str:
    config = get_active_has_image_config()
    if config and config.base_url:
        return config.base_url.rstrip("/")
    fallback = get_config("has_image_service")
    if fallback and fallback.enabled and fallback.base_url:
        return fallback.base_url.rstrip("/")
    return settings.HAS_IMAGE_BASE_URL.rstrip("/")


def get_vlm_config() -> ModelConfig | None:
    config = get_config("vlm_service")
    if config and config.enabled:
        return config
    return None


def get_vlm_base_url() -> str:
    config = get_vlm_config()
    if config and config.base_url:
        return config.base_url.rstrip("/")
    return settings.VLM_BASE_URL.rstrip("/")


def set_active(config_id: str) -> tuple[bool, str]:
    """Returns (success, error_or_active_id)."""
    configs = load_configs()
    found = False
    for cfg in configs.configs:
        if cfg.id == config_id:
            if not cfg.enabled:
                return False, "该配置未启用"
            if not is_has_image_runtime_config(cfg):
                return False, "Config cannot be used as the active HaS Image /detect runtime"
            found = True
            break
    if not found:
        return False, "配置不存在"
    configs.active_id = config_id
    save_configs(configs)
    return True, config_id


def create_config(config: ModelConfig) -> tuple[bool, str]:
    """Returns (success, error_message)."""
    configs = load_configs()
    for cfg in configs.configs:
        if cfg.id == config.id:
            return False, "配置ID已存在"
    configs.configs.append(config)
    save_configs(configs)
    return True, ""


def update_config(config_id: str, config: ModelConfig) -> tuple[ModelConfig | None, str]:
    """Returns (updated_config_or_None, error_message)."""
    configs = load_configs()
    if config_id in VISION_BUILTIN_IDS:
        config.enabled = True
    for i, cfg in enumerate(configs.configs):
        if cfg.id == config_id:
            config.id = config_id
            configs.configs[i] = config
            if configs.active_id == config_id and not is_has_image_runtime_config(config):
                configs.active_id = next(
                    (c.id for c in configs.configs if is_has_image_runtime_config(c)),
                    None,
                )
            save_configs(configs)
            return config, ""
    return None, "配置不存在"


def delete_config(config_id: str) -> tuple[bool, str]:
    """Returns (success, error_message)."""
    configs = load_configs()
    if config_id in VISION_BUILTIN_IDS:
        return False, "内置视觉后端（PaddleOCR-VL / HaS Image）不可删除"
    if len(configs.configs) <= 1:
        return False, "至少保留一个配置"
    for i, cfg in enumerate(configs.configs):
        if cfg.id == config_id:
            configs.configs.pop(i)
            if configs.active_id == config_id:
                configs.active_id = None
                for c in configs.configs:
                    if is_has_image_runtime_config(c):
                        configs.active_id = c.id
                        break
            save_configs(configs)
            return True, ""
    return False, "配置不存在"


def reset_configs() -> None:
    save_configs(DEFAULT_CONFIGS.model_copy(deep=True))


# ── 健康探测 ──────────────────────────────────────────────

async def _probe_paddle_ocr_health(base_override: str | None = None) -> dict:
    """探测 PaddleOCR-VL：GET /health，检查 ready。"""
    base = (base_override or settings.OCR_BASE_URL).rstrip("/")
    timeout = float(getattr(settings, "OCR_HEALTH_PROBE_TIMEOUT", 45.0))
    return await _probe_local_http_health(
        base_url=base,
        provider="local",
        default_model="PaddleOCR-VL",
        timeout=timeout,
    )


async def test_paddle_ocr() -> dict:
    """与推理后端列表中 PaddleOCR-VL 条目的「测试」同源。"""
    return await _probe_paddle_ocr_health(get_paddle_ocr_base_url())


async def test_config(config_id: str) -> tuple[dict | None, str]:
    """Returns (result_dict_or_None, error_message). None means config not found."""
    configs = load_configs()

    config = None
    for cfg in configs.configs:
        if cfg.id == config_id:
            config = cfg
            break

    if not config:
        return None, "配置不存在"

    if config.id == "paddle_ocr_service":
        base = (config.base_url or settings.OCR_BASE_URL).rstrip("/")
        return await _probe_paddle_ocr_health(base), ""

    try:
        if config.provider == "local":
            base = (config.base_url or "").rstrip("/")
            if base:
                return await _probe_local_http_health(
                    base_url=base,
                    provider=config.provider,
                    default_model=config.model_name or config.name or "Local model service",
                    timeout=10.0,
                ), ""
            return _preflight_result(
                success=False,
                status="offline",
                message="Missing base_url",
                provider=config.provider,
                base_url="",
            ), ""

        elif config.provider in ["openai", "custom"]:
            import httpx
            headers = {}
            if config.api_key:
                headers["Authorization"] = f"Bearer {config.api_key}"
            base = (config.base_url or "").rstrip("/")
            if not base:
                return _preflight_result(
                    success=False,
                    status="offline",
                    message="Missing base_url",
                    provider=config.provider,
                    base_url="",
                ), ""
            async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
                resp = await client.get(f"{base}/v1/models", headers=headers)
            if resp.status_code == 200:
                return _preflight_result(
                    success=True,
                    status="online",
                    message="API model endpoint is reachable.",
                    provider=config.provider,
                    base_url=base,
                    detail={"provider": config.provider, "base_url": base, "models_url": f"{base}/v1/models"},
                ), ""
            return _preflight_result(
                success=False,
                status="degraded",
                message=f"API model endpoint returned HTTP {resp.status_code}",
                provider=config.provider,
                base_url=base,
                detail={"provider": config.provider, "base_url": base, "models_url": f"{base}/v1/models", "http_status": resp.status_code},
            ), ""

        return _preflight_result(
            success=False,
            status="offline",
            message="Unknown provider type",
            provider=config.provider,
            base_url=(config.base_url or "").rstrip("/"),
        ), ""

    except Exception:
        logger.exception("Model config health check failed for %s", getattr(config, "id", "unknown"))
        return _preflight_result(
            success=False,
            status="offline",
            message="Model service health check failed.",
            provider=getattr(config, "provider", "unknown"),
            base_url=(getattr(config, "base_url", "") or "").rstrip("/"),
        ), ""
