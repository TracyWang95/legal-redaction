"""
Pydantic 数据模型定义
"""
from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum
from datetime import datetime


class EntityType(str, Enum):
    """实体类型枚举"""
    PERSON = "PERSON"           # 人名
    ORG = "ORG"                 # 机构/公司
    ID_CARD = "ID_CARD"         # 身份证号
    PHONE = "PHONE"             # 电话号码
    ADDRESS = "ADDRESS"         # 地址
    BANK_CARD = "BANK_CARD"     # 银行卡号
    CASE_NUMBER = "CASE_NUMBER" # 案件编号
    DATE = "DATE"               # 日期
    MONEY = "MONEY"             # 金额
    CUSTOM = "CUSTOM"           # 自定义


class FileType(str, Enum):
    """文件类型枚举"""
    DOC = "doc"              # 旧版 Word (.doc)
    DOCX = "docx"            # 新版 Word (.docx)
    PDF = "pdf"
    PDF_SCANNED = "pdf_scanned"  # 扫描版 PDF
    IMAGE = "image"


class ReplacementMode(str, Enum):
    """替换模式"""
    SMART = "smart"      # 智能替换 (当事人甲、当事人乙)
    MASK = "mask"        # 掩码替换 (***)
    CUSTOM = "custom"    # 自定义替换
    STRUCTURED = "structured"  # 结构化语义标签


# ============ 自定义实体类型 ============

class CustomEntityType(BaseModel):
    """自定义实体类型定义"""
    id: str = Field(..., description="类型唯一ID")
    name: str = Field(..., description="类型名称，如'涉案金额'")
    description: str = Field(default="", description="语义描述，用于AI理解")
    examples: list[str] = Field(default_factory=list, description="示例文本，帮助AI识别")
    color: str = Field(default="#6B7280", description="显示颜色")
    replacement_template: str = Field(default="[{name}]", description="替换模板")
    enabled: bool = Field(default=True, description="是否启用")
    created_at: datetime = Field(default_factory=datetime.now)


class CustomEntityTypeCreate(BaseModel):
    """创建自定义实体类型请求"""
    name: str = Field(..., description="类型名称")
    description: str = Field(..., description="语义描述，用于AI理解匹配")
    examples: list[str] = Field(default_factory=list, description="示例文本")
    color: str = Field(default="#6B7280", description="显示颜色")
    replacement_template: str = Field(default="[{name}]", description="替换模板")


class CustomEntityTypeUpdate(BaseModel):
    """更新自定义实体类型请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    examples: Optional[list[str]] = None
    color: Optional[str] = None
    replacement_template: Optional[str] = None
    enabled: Optional[bool] = None


# ============ 请求模型 ============

class Entity(BaseModel):
    """识别到的实体"""
    id: str = Field(..., description="实体唯一ID")
    text: str = Field(..., description="原始文本")
    type: str = Field(..., description="实体类型（内置类型或自定义类型ID）")
    start: int = Field(..., description="起始位置")
    end: int = Field(..., description="结束位置")
    page: int = Field(default=1, description="所在页码")
    confidence: float = Field(default=1.0, description="置信度")
    source: Optional[Literal["regex", "llm", "manual", "has"]] = Field(
        default=None, description="实体来源"
    )
    coref_id: Optional[str] = Field(None, description="指代消解ID")
    replacement: Optional[str] = Field(None, description="替换文本")
    selected: bool = Field(default=True, description="是否选中进行脱敏")
    custom_type_id: Optional[str] = Field(None, description="自定义类型ID（如果是自定义类型）")


class BoundingBox(BaseModel):
    """图片中的敏感区域边界框"""
    id: str = Field(..., description="区域唯一ID")
    x: float = Field(..., description="左上角 X 坐标")
    y: float = Field(..., description="左上角 Y 坐标")
    width: float = Field(..., description="宽度")
    height: float = Field(..., description="高度")
    page: int = Field(default=1, description="所在页码")
    type: str = Field(..., description="实体类型")
    text: Optional[str] = Field(None, description="识别到的文本")
    selected: bool = Field(default=True, description="是否选中进行脱敏")
    source: Optional[Literal["ocr_has", "glm_vision", "manual"]] = Field(
        default=None, description="来源Pipeline: ocr_has=OCR+HaS, glm_vision=GLM Vision, manual=手动标注"
    )


class RedactionConfig(BaseModel):
    """脱敏配置"""
    replacement_mode: ReplacementMode = Field(default=ReplacementMode.SMART)
    entity_types: list[str] = Field(
        default=["PERSON", "PHONE", "ID_CARD"]
    )
    custom_entity_types: list[str] = Field(
        default_factory=list, description="启用的自定义实体类型ID列表"
    )
    custom_replacements: dict[str, str] = Field(default_factory=dict)


class RedactionRequest(BaseModel):
    """脱敏请求"""
    file_id: str = Field(..., description="文件ID")
    entities: list[Entity] = Field(default_factory=list, description="要脱敏的实体列表")
    bounding_boxes: list[BoundingBox] = Field(default_factory=list, description="要脱敏的图片区域")
    config: RedactionConfig = Field(default_factory=RedactionConfig)


class NERRequest(BaseModel):
    """NER识别请求"""
    entity_types: list[str] = Field(
        default=["PERSON", "PHONE", "ID_CARD", "ORG", "CASE_NUMBER"],
        description="要识别的内置实体类型"
    )
    custom_entity_type_ids: list[str] = Field(
        default_factory=list,
        description="要识别的自定义实体类型ID列表"
    )


# ============ 响应模型 ============

class FileUploadResponse(BaseModel):
    """文件上传响应"""
    file_id: str
    filename: str
    file_type: FileType
    file_size: int
    page_count: int = 1
    message: str = "文件上传成功"


class ParseResult(BaseModel):
    """文件解析结果"""
    file_id: str
    file_type: FileType
    content: str = Field(default="", description="提取的文本内容")
    page_count: int = 1
    pages: list[str] = Field(default_factory=list, description="分页文本内容")
    is_scanned: bool = Field(default=False, description="是否为扫描件")


class NERResult(BaseModel):
    """NER 识别结果"""
    file_id: str
    entities: list[Entity]
    entity_count: int
    entity_summary: dict[str, int] = Field(default_factory=dict, description="各类型实体数量统计")


class VisionResult(BaseModel):
    """视觉识别结果"""
    file_id: str
    page: int
    bounding_boxes: list[BoundingBox]
    result_image: Optional[str] = None  # 带检测框的图片 base64


class RedactionResult(BaseModel):
    """脱敏结果"""
    file_id: str
    output_file_id: str
    redacted_count: int
    entity_map: dict[str, str] = Field(default_factory=dict, description="实体映射表")
    download_url: str


class CompareData(BaseModel):
    """对比数据"""
    file_id: str
    original_content: str
    redacted_content: str
    changes: list[dict] = Field(default_factory=list)


# ============ 通用响应 ============

class APIResponse(BaseModel):
    """通用 API 响应"""
    success: bool = True
    message: str = "操作成功"
    data: Optional[dict] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str = "healthy"
    version: str
    timestamp: datetime = Field(default_factory=datetime.now)
