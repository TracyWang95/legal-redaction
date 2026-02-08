"""
推理模型配置 API
支持本地 OpenAI 兼容接口和云端 API（如智谱 GLM）
"""
import os
import json
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/model-config", tags=["model-config"])

# 配置文件路径
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "model_config.json")


class ModelConfig(BaseModel):
    """模型配置"""
    id: str = Field(..., description="配置ID")
    name: str = Field(..., description="配置名称")
    provider: Literal["local", "zhipu", "openai", "custom"] = Field(..., description="提供商类型")
    enabled: bool = Field(default=True, description="是否启用")
    
    # API 配置
    base_url: Optional[str] = Field(None, description="API 基础 URL（本地/自定义）")
    api_key: Optional[str] = Field(None, description="API Key（云端服务）")
    model_name: str = Field(..., description="模型名称")
    
    # 生成参数
    temperature: float = Field(default=0.8, ge=0, le=2)
    top_p: float = Field(default=0.6, ge=0, le=1)
    max_tokens: int = Field(default=4096, ge=1, le=32768)
    
    # 是否启用思考模式（智谱 GLM 特有）
    enable_thinking: bool = Field(default=False, description="是否启用思考模式")
    
    # 备注
    description: Optional[str] = Field(None, description="配置说明")


class ModelConfigList(BaseModel):
    """模型配置列表"""
    configs: list[ModelConfig]
    active_id: Optional[str] = Field(None, description="当前激活的配置ID")


# 默认配置
DEFAULT_CONFIGS = ModelConfigList(
    configs=[
        ModelConfig(
            id="local_glm",
            name="本地 GLM-4.6V (llama.cpp)",
            provider="local",
            enabled=True,
            base_url="http://localhost:8081",
            model_name="glm",
            temperature=0.8,
            top_p=0.6,
            max_tokens=4096,
            enable_thinking=False,
            description="本地部署的 GLM-4.6V-Flash-Q4_K_M.gguf，适合离线使用"
        ),
        ModelConfig(
            id="zhipu_glm4v",
            name="智谱 GLM-4.6V (云端)",
            provider="zhipu",
            enabled=False,
            api_key="",  # 用户需要填写
            model_name="glm-4.6v",
            temperature=0.8,
            top_p=0.6,
            max_tokens=4096,
            enable_thinking=True,
            description="智谱 AI 云端 GLM-4.6V，需要 API Key"
        ),
    ],
    active_id="local_glm"
)


def load_configs() -> ModelConfigList:
    """加载配置"""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return ModelConfigList(**data)
        except Exception as e:
            print(f"[ModelConfig] 加载配置失败: {e}")
    return DEFAULT_CONFIGS


def save_configs(configs: ModelConfigList):
    """保存配置"""
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(configs.model_dump(), f, ensure_ascii=False, indent=2)


@router.get("", response_model=ModelConfigList)
async def get_model_configs():
    """获取所有模型配置"""
    return load_configs()


@router.get("/active", response_model=Optional[ModelConfig])
async def get_active_config():
    """获取当前激活的模型配置"""
    configs = load_configs()
    if configs.active_id:
        for cfg in configs.configs:
            if cfg.id == configs.active_id and cfg.enabled:
                return cfg
    # 返回第一个启用的配置
    for cfg in configs.configs:
        if cfg.enabled:
            return cfg
    return None


@router.post("/active/{config_id}")
async def set_active_config(config_id: str):
    """设置激活的模型配置"""
    configs = load_configs()
    found = False
    for cfg in configs.configs:
        if cfg.id == config_id:
            if not cfg.enabled:
                raise HTTPException(status_code=400, detail="该配置未启用")
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="配置不存在")
    
    configs.active_id = config_id
    save_configs(configs)
    return {"success": True, "active_id": config_id}


@router.post("", response_model=ModelConfig)
async def create_model_config(config: ModelConfig):
    """创建新的模型配置"""
    configs = load_configs()
    
    # 检查 ID 是否重复
    for cfg in configs.configs:
        if cfg.id == config.id:
            raise HTTPException(status_code=400, detail="配置ID已存在")
    
    configs.configs.append(config)
    save_configs(configs)
    return config


@router.put("/{config_id}", response_model=ModelConfig)
async def update_model_config(config_id: str, config: ModelConfig):
    """更新模型配置"""
    configs = load_configs()
    
    for i, cfg in enumerate(configs.configs):
        if cfg.id == config_id:
            config.id = config_id  # 保持 ID 不变
            configs.configs[i] = config
            save_configs(configs)
            return config
    
    raise HTTPException(status_code=404, detail="配置不存在")


@router.delete("/{config_id}")
async def delete_model_config(config_id: str):
    """删除模型配置"""
    configs = load_configs()
    
    # 不允许删除最后一个配置
    if len(configs.configs) <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个配置")
    
    for i, cfg in enumerate(configs.configs):
        if cfg.id == config_id:
            configs.configs.pop(i)
            # 如果删除的是激活配置，切换到第一个启用的配置
            if configs.active_id == config_id:
                configs.active_id = None
                for c in configs.configs:
                    if c.enabled:
                        configs.active_id = c.id
                        break
            save_configs(configs)
            return {"success": True}
    
    raise HTTPException(status_code=404, detail="配置不存在")


@router.post("/reset")
async def reset_model_configs():
    """重置为默认配置"""
    save_configs(DEFAULT_CONFIGS)
    return {"success": True}


@router.post("/test/{config_id}")
async def test_model_config(config_id: str):
    """测试模型配置连通性"""
    configs = load_configs()
    
    config = None
    for cfg in configs.configs:
        if cfg.id == config_id:
            config = cfg
            break
    
    if not config:
        raise HTTPException(status_code=404, detail="配置不存在")
    
    try:
        if config.provider == "local":
            # 测试本地 llama.cpp 服务
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{config.base_url}/health")
                if resp.status_code == 200:
                    return {"success": True, "message": "本地服务连接成功"}
                else:
                    return {"success": False, "message": f"服务返回状态码: {resp.status_code}"}
        
        elif config.provider == "zhipu":
            # 测试智谱 API
            if not config.api_key:
                return {"success": False, "message": "请先配置 API Key"}
            
            from zhipuai import ZhipuAI
            client = ZhipuAI(api_key=config.api_key)
            # 简单测试：获取模型列表
            response = client.chat.completions.create(
                model=config.model_name,
                messages=[{"role": "user", "content": "你好"}],
                max_tokens=10
            )
            return {"success": True, "message": "智谱 API 连接成功"}
        
        elif config.provider in ["openai", "custom"]:
            # 测试 OpenAI 兼容接口
            import httpx
            headers = {}
            if config.api_key:
                headers["Authorization"] = f"Bearer {config.api_key}"
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{config.base_url}/v1/models", headers=headers)
                if resp.status_code == 200:
                    return {"success": True, "message": "API 连接成功"}
                else:
                    return {"success": False, "message": f"API 返回状态码: {resp.status_code}"}
        
        return {"success": False, "message": "未知的提供商类型"}
    
    except Exception as e:
        return {"success": False, "message": str(e)}
