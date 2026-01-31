"""
脱敏处理 API 路由
处理文档脱敏、对比等操作
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.models.schemas import (
    RedactionRequest,
    RedactionResult,
    CompareData,
    VisionResult,
    APIResponse,
)
from app.services.redactor import Redactor
from app.services.vision_service import VisionService
from app.api.files import file_store, persist_file_store

router = APIRouter()


class VisionDetectRequest(BaseModel):
    """视觉识别请求体"""
    # 两个 Pipeline 独立选择类型
    # None 表示未显式选择（使用系统启用的默认类型）
    # [] 表示显式不选择（不运行该 Pipeline）
    selected_ocr_has_types: Optional[List[str]] = None  # OCR+HaS Pipeline 选中的类型 ID
    selected_glm_vision_types: Optional[List[str]] = None  # GLM Vision Pipeline 选中的类型 ID


@router.post("/redaction/execute", response_model=RedactionResult)
async def execute_redaction(request: RedactionRequest):
    """
    执行文档脱敏
    
    根据提供的实体列表和配置，对文档进行脱敏处理:
    - 文本类文档: 替换敏感文本
    - 图片类文档: 添加黑色遮罩
    """
    file_id = request.file_id
    
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    
    redactor = Redactor()
    result = await redactor.redact(
        file_info=file_info,
        entities=request.entities,
        bounding_boxes=request.bounding_boxes,
        config=request.config,
    )
    
    # 更新文件存储
    file_store[file_id]["output_path"] = result.get("output_path")
    file_store[file_id]["entity_map"] = result.get("entity_map", {})
    persist_file_store()
    
    return RedactionResult(
        file_id=file_id,
        output_file_id=result["output_file_id"],
        redacted_count=result["redacted_count"],
        entity_map=result.get("entity_map", {}),
        download_url=f"/api/v1/files/{file_id}/download?redacted=true",
    )


@router.get("/redaction/{file_id}/compare", response_model=CompareData)
async def get_comparison(file_id: str):
    """
    获取脱敏前后对比数据
    
    返回原始内容和脱敏后内容，用于前端展示对比视图
    """
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    
    if "output_path" not in file_info:
        raise HTTPException(status_code=400, detail="文件尚未脱敏")
    
    redactor = Redactor()
    compare_data = await redactor.get_comparison(file_info)
    
    return CompareData(
        file_id=file_id,
        original_content=compare_data["original"],
        redacted_content=compare_data["redacted"],
        changes=compare_data.get("changes", []),
    )


@router.post("/redaction/{file_id}/vision", response_model=VisionResult)
async def detect_sensitive_regions(
    file_id: str, 
    page: int = 1,
    request: Optional[VisionDetectRequest] = None,
):
    """
    对图片/扫描件进行视觉识别
    
    同时运行两种 Pipeline:
    - OCR + HaS：适合文字识别（人名、组织、昵称等）
    - GLM Vision：适合视觉识别（公章、签名、指纹等）
    
    只识别前端选中的类型，两个 Pipeline 独立运行，最后合并结果
    """
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    
    # 获取两个 Pipeline 的类型配置
    from app.api.vision_pipeline import get_pipeline_types_for_mode, pipelines_db
    
    # 获取系统配置中启用的类型
    all_ocr_has_types = get_pipeline_types_for_mode("ocr_has")
    all_glm_vision_types = get_pipeline_types_for_mode("glm_vision")
    
    # 根据前端选择过滤类型（两个 Pipeline 独立选择）
    selected_ocr_has_ids: Optional[set[str]] = None
    selected_glm_vision_ids: Optional[set[str]] = None
    if request is None:
        # 默认只启用 OCR+HaS，GLM 需要显式勾选
        selected_glm_vision_ids = set()
    else:
        if request.selected_ocr_has_types is not None:
            selected_ocr_has_ids = set(request.selected_ocr_has_types or [])
        if request.selected_glm_vision_types is not None:
            selected_glm_vision_ids = set(request.selected_glm_vision_types or [])
        else:
            # 未显式选择 GLM 时不运行
            selected_glm_vision_ids = set()
    
    # 如果前端显式传了选中的类型，只保留选中的；否则用全部启用的
    if selected_ocr_has_ids is not None:
        ocr_has_types = [t for t in all_ocr_has_types if t.id in selected_ocr_has_ids]
    else:
        ocr_has_types = all_ocr_has_types
    
    if selected_glm_vision_ids is not None:
        glm_vision_types = [t for t in all_glm_vision_types if t.id in selected_glm_vision_ids]
    else:
        glm_vision_types = all_glm_vision_types
    
    # 检查 Pipeline 是否启用且有类型要识别
    ocr_has_enabled = pipelines_db.get("ocr_has", None) and pipelines_db["ocr_has"].enabled and len(ocr_has_types) > 0
    glm_vision_enabled = pipelines_db.get("glm_vision", None) and pipelines_db["glm_vision"].enabled and len(glm_vision_types) > 0
    
    print(f"[API] OCR+HaS selected: {[t.id for t in ocr_has_types] if ocr_has_types else []}")
    print(f"[API] GLM Vision selected: {[t.id for t in glm_vision_types] if glm_vision_types else []}")
    
    vision_service = VisionService()
    bounding_boxes, result_image = await vision_service.detect_with_dual_pipeline(
        file_path=file_info["file_path"],
        file_type=file_info["file_type"],
        page=page,
        ocr_has_types=ocr_has_types if ocr_has_enabled else None,
        glm_vision_types=glm_vision_types if glm_vision_enabled else None,
    )
    
    # 存储识别结果
    if "bounding_boxes" not in file_store[file_id]:
        file_store[file_id]["bounding_boxes"] = {}
    file_store[file_id]["bounding_boxes"][page] = bounding_boxes
    persist_file_store()
    
    return VisionResult(
        file_id=file_id,
        page=page,
        bounding_boxes=bounding_boxes,
        result_image=result_image,
    )


@router.get("/redaction/entity-types")
async def get_entity_types():
    """获取支持的实体类型列表"""
    from app.models.schemas import EntityType
    
    entity_types = [
        {"value": EntityType.PERSON.value, "label": "人名", "color": "#F59E0B"},
        {"value": EntityType.ORG.value, "label": "机构/公司", "color": "#3B82F6"},
        {"value": EntityType.ID_CARD.value, "label": "身份证号", "color": "#EF4444"},
        {"value": EntityType.PHONE.value, "label": "电话号码", "color": "#10B981"},
        {"value": EntityType.ADDRESS.value, "label": "地址", "color": "#8B5CF6"},
        {"value": EntityType.BANK_CARD.value, "label": "银行卡号", "color": "#EC4899"},
        {"value": EntityType.CASE_NUMBER.value, "label": "案件编号", "color": "#6366F1"},
        {"value": EntityType.DATE.value, "label": "日期", "color": "#14B8A6"},
        {"value": EntityType.MONEY.value, "label": "金额", "color": "#F97316"},
        {"value": EntityType.CUSTOM.value, "label": "自定义", "color": "#6B7280"},
    ]
    
    return {"entity_types": entity_types}


@router.get("/redaction/replacement-modes")
async def get_replacement_modes():
    """获取支持的替换模式列表"""
    from app.models.schemas import ReplacementMode
    
    modes = [
        {
            "value": ReplacementMode.SMART.value,
            "label": "智能替换",
            "description": "将敏感信息替换为语义化的标识，如 '当事人甲'、'公司A'",
        },
        {
            "value": ReplacementMode.STRUCTURED.value,
            "label": "结构化语义标签",
            "description": "用结构化标签替换敏感信息，保留层级语义与指代关系",
        },
        {
            "value": ReplacementMode.MASK.value,
            "label": "掩码替换",
            "description": "将敏感信息替换为 *** 或部分隐藏，如 '张**'、'138****1234'",
        },
        {
            "value": ReplacementMode.CUSTOM.value,
            "label": "自定义替换",
            "description": "手动指定每个敏感信息的替换文本",
        },
    ]
    
    return {"replacement_modes": modes}
