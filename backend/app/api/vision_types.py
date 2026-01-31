"""
图像识别类型管理 API
用于视觉模型的敏感类型配置（与文本类型分离）
"""
from fastapi import APIRouter, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel, Field
import uuid

router = APIRouter()


class VisionTypeConfig(BaseModel):
    """图像识别类型配置"""
    id: str = Field(..., description="唯一ID")
    name: str = Field(..., description="显示名称")
    description: Optional[str] = Field(None, description="语义描述")
    examples: List[str] = Field(default_factory=list, description="示例文本")
    color: str = Field(default="#6B7280", description="前端显示颜色")
    enabled: bool = Field(default=True, description="是否启用")
    order: int = Field(default=100, description="排序权重")


class CreateVisionTypeRequest(BaseModel):
    name: str
    description: Optional[str] = None
    examples: List[str] = []
    color: str = "#6B7280"


class UpdateVisionTypeRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    examples: Optional[List[str]] = None
    color: Optional[str] = None
    enabled: Optional[bool] = None
    order: Optional[int] = None


# 预置图像识别类型（与文本类型分离）
PRESET_VISION_TYPES: Dict[str, VisionTypeConfig] = {
    "PERSON": VisionTypeConfig(
        id="PERSON",
        name="人名/签名",
        description="人名、签名或指纹类标记",
        examples=["张三", "李四"],
        color="#3B82F6",
        order=1,
    ),
    "ID_CARD": VisionTypeConfig(
        id="ID_CARD",
        name="身份证号",
        description="身份证号码区域",
        examples=["110101199003071234"],
        color="#EF4444",
        order=2,
    ),
    "PHONE": VisionTypeConfig(
        id="PHONE",
        name="电话号码",
        description="手机或座机号码区域",
        examples=["13812345678", "010-88889999"],
        color="#F97316",
        order=3,
    ),
    "BANK_CARD": VisionTypeConfig(
        id="BANK_CARD",
        name="银行卡号",
        description="银行卡号区域",
        examples=["6222020200012345678"],
        color="#EC4899",
        order=4,
    ),
    "ADDRESS": VisionTypeConfig(
        id="ADDRESS",
        name="地址",
        description="详细地址区域",
        examples=["北京市朝阳区..."],
        color="#6366F1",
        order=5,
    ),
}


vision_types_db: Dict[str, VisionTypeConfig] = PRESET_VISION_TYPES.copy()


@router.get("/vision-types", response_model=List[VisionTypeConfig])
async def get_vision_types(enabled_only: bool = True):
    """获取图像识别类型列表"""
    types = list(vision_types_db.values())
    if enabled_only:
        types = [t for t in types if t.enabled]
    return sorted(types, key=lambda t: t.order)


@router.post("/vision-types", response_model=VisionTypeConfig)
async def create_vision_type(request: CreateVisionTypeRequest):
    """创建新的图像识别类型"""
    type_id = f"vision_{uuid.uuid4().hex[:8]}"
    new_type = VisionTypeConfig(
        id=type_id,
        name=request.name,
        description=request.description,
        examples=request.examples,
        color=request.color,
        enabled=True,
        order=200,
    )
    vision_types_db[type_id] = new_type
    return new_type


@router.put("/vision-types/{type_id}", response_model=VisionTypeConfig)
async def update_vision_type(type_id: str, request: UpdateVisionTypeRequest):
    """更新图像识别类型"""
    if type_id not in vision_types_db:
        raise HTTPException(status_code=404, detail="类型不存在")
    existing = vision_types_db[type_id]
    update_data = request.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(existing, key, value)
    vision_types_db[type_id] = existing
    return existing


@router.delete("/vision-types/{type_id}")
async def delete_vision_type(type_id: str):
    """删除图像识别类型（预置不可删除）"""
    if type_id not in vision_types_db:
        raise HTTPException(status_code=404, detail="类型不存在")
    if type_id in PRESET_VISION_TYPES:
        raise HTTPException(status_code=400, detail="预置类型不能删除，只能禁用")
    del vision_types_db[type_id]
    return {"message": "删除成功"}


@router.post("/vision-types/{type_id}/toggle")
async def toggle_vision_type(type_id: str):
    """切换图像识别类型启用状态"""
    if type_id not in vision_types_db:
        raise HTTPException(status_code=404, detail="类型不存在")
    vision_types_db[type_id].enabled = not vision_types_db[type_id].enabled
    return {"enabled": vision_types_db[type_id].enabled}


@router.post("/vision-types/reset")
async def reset_vision_types():
    """重置图像识别类型为默认配置"""
    global vision_types_db
    vision_types_db = PRESET_VISION_TYPES.copy()
    return {"message": "已重置为默认配置"}


def get_enabled_vision_types() -> List[VisionTypeConfig]:
    return [t for t in vision_types_db.values() if t.enabled]
