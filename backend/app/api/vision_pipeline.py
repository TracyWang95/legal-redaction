"""
图像识别 Pipeline 配置 API
支持两种模式：
1. OCR + HaS Pipeline：适合文字多的场景（微信聊天、PDF扫描件）
2. GLM Vision Pipeline：适合公章、签字、皱褶图片等场景（本地）
"""
from fastapi import APIRouter, HTTPException
from typing import List, Dict, Optional, Literal
from pydantic import BaseModel, Field
from enum import Enum
from app.core.config import settings
from app.core.persistence import load_json, save_json

router = APIRouter()


class PipelineMode(str, Enum):
    OCR_HAS = "ocr_has"       # OCR + HaS 本地模型
    GLM_VISION = "glm_vision"  # GLM 视觉大模型


class PipelineTypeConfig(BaseModel):
    """Pipeline 下的类型配置"""
    id: str = Field(..., description="唯一ID")
    name: str = Field(..., description="显示名称")
    description: Optional[str] = Field(None, description="语义描述/视觉提示")
    examples: List[str] = Field(default_factory=list, description="示例文本")
    color: str = Field(default="#6B7280", description="前端显示颜色")
    enabled: bool = Field(default=True, description="是否启用")
    order: int = Field(default=100, description="排序权重")


class PipelineConfig(BaseModel):
    """Pipeline 配置"""
    mode: PipelineMode = Field(..., description="Pipeline 模式")
    name: str = Field(..., description="显示名称")
    description: str = Field(..., description="描述")
    enabled: bool = Field(default=True, description="是否启用")
    types: List[PipelineTypeConfig] = Field(default_factory=list, description="该 Pipeline 下的类型配置")


# 预置 OCR + HaS Pipeline 的类型
PRESET_OCR_HAS_TYPES: List[PipelineTypeConfig] = [
    # ===== 人员相关 =====
    PipelineTypeConfig(
        id="PERSON", name="人名", description="人名、姓名",
        examples=["张三", "李四"], color="#3B82F6", order=10,
    ),
    
    # ===== 组织机构 =====
    PipelineTypeConfig(
        id="ORG", name="组织机构", description="政府机关、事业单位、社会团体等",
        examples=["国务院", "北京市教育局"], color="#10B981", order=20,
    ),
    PipelineTypeConfig(
        id="COMPANY", name="公司名", description="公司全称或简称",
        examples=["腾讯", "深圳市腾讯计算机系统有限公司", "阿里巴巴"], color="#14B8A6", order=21,
    ),
    
    # ===== 联系方式 =====
    PipelineTypeConfig(
        id="PHONE", name="手机号", description="11位手机号码",
        examples=["13812345678"], color="#F97316", order=30,
    ),
    PipelineTypeConfig(
        id="EMAIL", name="电子邮箱", description="电子邮件地址",
        examples=["example@company.com"], color="#EAB308", order=32,
    ),
    
    # ===== 证件号码 =====
    PipelineTypeConfig(
        id="ID_CARD", name="身份证号", description="18位身份证号码",
        examples=["110101199003071234"], color="#EF4444", order=40,
    ),
    PipelineTypeConfig(
        id="BANK_CARD", name="银行卡号", description="16-19位银行卡号码",
        examples=["6222020200012345678"], color="#EC4899", order=41,
    ),
    
    # ===== 银行账户相关 =====
    PipelineTypeConfig(
        id="ACCOUNT_NAME", name="账户名", description="银行账户名称",
        examples=["张三", "深圳市腾讯计算机系统有限公司"], color="#A855F7", order=42,
    ),
    PipelineTypeConfig(
        id="BANK_NAME", name="开户行", description="开户银行名称",
        examples=["中国工商银行北京分行", "招商银行深圳支行"], color="#7C3AED", order=43,
    ),
    PipelineTypeConfig(
        id="ACCOUNT_NUMBER", name="账号", description="银行账号、支付宝账号、微信账号等各类账号",
        examples=["6222020200012345678", "alipay123"], color="#8B5CF6", order=44,
    ),
    
    # ===== 地址 =====
    PipelineTypeConfig(
        id="ADDRESS", name="地址", description="详细地址",
        examples=["北京市朝阳区建国路88号"], color="#6366F1", order=50,
    ),
    
    # ===== 日期 =====
    PipelineTypeConfig(
        id="DATE", name="日期", description="日期信息",
        examples=["2024年1月1日", "2024-01-01"], color="#A16207", order=60,
    ),
    
    # ===== PaddleOCR-VL 视觉识别 =====
    PipelineTypeConfig(
        id="SEAL", name="公章/印章", description="PaddleOCR-VL 自动识别的公章、印章区域",
        examples=[], color="#DC143C", order=90,
    ),
]

# 预置 GLM Vision Pipeline 的类型
PRESET_GLM_VISION_TYPES: List[PipelineTypeConfig] = [
    PipelineTypeConfig(
        id="SIGNATURE", name="签名/手写", description="手写签名、签字区域",
        examples=[], color="#3B82F6", order=1,
    ),
    PipelineTypeConfig(
        id="SEAL", name="公章/印章", description="公章、私章、印章区域",
        examples=[], color="#EF4444", order=2,
    ),
    PipelineTypeConfig(
        id="FINGERPRINT", name="指纹/手印", description="指纹、按手印区域",
        examples=[], color="#F97316", order=3,
    ),
    PipelineTypeConfig(
        id="PHOTO", name="证件照", description="身份证照片、证件照区域",
        examples=[], color="#8B5CF6", order=4,
    ),
    PipelineTypeConfig(
        id="QR_CODE", name="二维码", description="二维码区域",
        examples=[], color="#10B981", order=5,
    ),
    PipelineTypeConfig(
        id="GLM_ID_CARD", name="身份证号", description="身份证号码区域（视觉识别）",
        examples=["110101199003071234"], color="#EC4899", order=6,
    ),
    PipelineTypeConfig(
        id="GLM_BANK_CARD", name="银行卡号", description="银行卡号码区域（视觉识别）",
        examples=["6222020200012345678"], color="#6366F1", order=7,
    ),
]


# 预置 Pipeline 配置
PRESET_PIPELINES: Dict[str, PipelineConfig] = {
    "ocr_has": PipelineConfig(
        mode=PipelineMode.OCR_HAS,
        name="OCR + HaS (本地)",
        description="使用 PaddleOCR-VL 提取文字 + HaS 本地模型识别敏感信息。适合文字多的场景：微信聊天记录、PDF扫描件、合同文档等。完全离线，速度快。",
        enabled=True,
        types=PRESET_OCR_HAS_TYPES,
    ),
    "glm_vision": PipelineConfig(
        mode=PipelineMode.GLM_VISION,
        name="GLM Vision (本地)",
        description="使用本地 GLM-4.6V 视觉大模型识别。适合公章、签字、皱褶图片、证件照等场景。",
        enabled=True,
        types=PRESET_GLM_VISION_TYPES,
    ),
}


def _load_pipelines() -> Dict[str, PipelineConfig]:
    raw = load_json(settings.PIPELINE_STORE_PATH, default=None)
    if not raw:
        return {k: v.model_copy(deep=True) for k, v in PRESET_PIPELINES.items()}
    pipelines: Dict[str, PipelineConfig] = {k: v.model_copy(deep=True) for k, v in PRESET_PIPELINES.items()}
    for key, value in raw.items():
        try:
            loaded = PipelineConfig(**value)
        except Exception:
            continue
        if key in pipelines:
            # 强制使用最新预置的名称/描述（避免历史云端文案残留）
            base = pipelines[key]
            pipelines[key] = base.model_copy(update={
                "enabled": loaded.enabled,
                "types": loaded.types,
            })
        else:
            pipelines[key] = loaded
    return pipelines


def _persist_pipelines() -> None:
    save_json(settings.PIPELINE_STORE_PATH, pipelines_db)


# 内存存储（启动时从磁盘恢复）
pipelines_db: Dict[str, PipelineConfig] = _load_pipelines()
_persist_pipelines()


@router.get("/vision-pipelines", response_model=List[PipelineConfig])
async def get_pipelines(enabled_only: bool = False):
    """获取所有 Pipeline 配置"""
    pipelines = list(pipelines_db.values())
    if enabled_only:
        pipelines = [p for p in pipelines if p.enabled]
    return pipelines


@router.get("/vision-pipelines/{mode}", response_model=PipelineConfig)
async def get_pipeline(mode: str):
    """获取指定 Pipeline 配置"""
    if mode not in pipelines_db:
        raise HTTPException(status_code=404, detail="Pipeline 不存在")
    return pipelines_db[mode]


@router.post("/vision-pipelines/{mode}/toggle")
async def toggle_pipeline(mode: str):
    """切换 Pipeline 启用状态"""
    if mode not in pipelines_db:
        raise HTTPException(status_code=404, detail="Pipeline 不存在")
    pipelines_db[mode].enabled = not pipelines_db[mode].enabled
    return {"enabled": pipelines_db[mode].enabled}


@router.get("/vision-pipelines/{mode}/types", response_model=List[PipelineTypeConfig])
async def get_pipeline_types(mode: str, enabled_only: bool = True):
    """获取指定 Pipeline 的类型配置"""
    if mode not in pipelines_db:
        raise HTTPException(status_code=404, detail="Pipeline 不存在")
    types = pipelines_db[mode].types
    if enabled_only:
        types = [t for t in types if t.enabled]
    return sorted(types, key=lambda t: t.order)


@router.post("/vision-pipelines/{mode}/types", response_model=PipelineTypeConfig)
async def add_pipeline_type(mode: str, request: PipelineTypeConfig):
    """添加 Pipeline 类型"""
    if mode not in pipelines_db:
        raise HTTPException(status_code=404, detail="Pipeline 不存在")
    
    # 检查 ID 是否已存在
    existing_ids = [t.id for t in pipelines_db[mode].types]
    if request.id in existing_ids:
        raise HTTPException(status_code=400, detail="类型 ID 已存在")
    
    pipelines_db[mode].types.append(request)
    return request


@router.put("/vision-pipelines/{mode}/types/{type_id}", response_model=PipelineTypeConfig)
async def update_pipeline_type(mode: str, type_id: str, request: PipelineTypeConfig):
    """更新 Pipeline 类型"""
    if mode not in pipelines_db:
        raise HTTPException(status_code=404, detail="Pipeline 不存在")
    
    for i, t in enumerate(pipelines_db[mode].types):
        if t.id == type_id:
            pipelines_db[mode].types[i] = request
            return request
    
    raise HTTPException(status_code=404, detail="类型不存在")


@router.post("/vision-pipelines/{mode}/types/{type_id}/toggle")
async def toggle_pipeline_type(mode: str, type_id: str):
    """切换 Pipeline 类型启用状态"""
    if mode not in pipelines_db:
        raise HTTPException(status_code=404, detail="Pipeline 不存在")
    
    for t in pipelines_db[mode].types:
        if t.id == type_id:
            t.enabled = not t.enabled
            return {"enabled": t.enabled}
    
    raise HTTPException(status_code=404, detail="类型不存在")


@router.delete("/vision-pipelines/{mode}/types/{type_id}")
async def delete_pipeline_type(mode: str, type_id: str):
    """删除 Pipeline 类型"""
    if mode not in pipelines_db:
        raise HTTPException(status_code=404, detail="Pipeline 不存在")
    
    # 检查是否是预置类型
    preset_ids = [t.id for t in PRESET_PIPELINES.get(mode, PipelineConfig(
        mode=PipelineMode.OCR_HAS, name="", description="", types=[]
    )).types]
    
    if type_id in preset_ids:
        raise HTTPException(status_code=400, detail="预置类型不能删除，只能禁用")
    
    pipelines_db[mode].types = [t for t in pipelines_db[mode].types if t.id != type_id]
    return {"message": "删除成功"}


@router.post("/vision-pipelines/reset")
async def reset_pipelines():
    """重置所有 Pipeline 配置为默认"""
    global pipelines_db
    pipelines_db = {k: v.model_copy(deep=True) for k, v in PRESET_PIPELINES.items()}
    return {"message": "已重置为默认配置"}


def get_pipeline_types_for_mode(mode: str) -> List[PipelineTypeConfig]:
    """获取指定模式下启用的类型配置"""
    if mode not in pipelines_db:
        return []
    return [t for t in pipelines_db[mode].types if t.enabled]
