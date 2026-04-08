"""
Vision (image/scanned-PDF) detection result models.
"""

from pydantic import BaseModel, ConfigDict, Field

from .entity_schemas import BoundingBox

__all__ = [
    "VisionResult",
    "HybridNERRequest",
]


class VisionResult(BaseModel):
    """视觉识别结果"""
    file_id: str
    page: int
    bounding_boxes: list[BoundingBox]
    result_image: str | None = None  # 带检测框的图片 base64


class HybridNERRequest(BaseModel):
    """混合识别请求（HaS 固定为 NER）"""
    model_config = ConfigDict(extra="ignore")

    entity_type_ids: list[str] = Field(default_factory=list, description="要识别的实体类型ID列表")
