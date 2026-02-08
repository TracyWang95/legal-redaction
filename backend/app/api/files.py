"""
文件管理 API 路由
处理文件上传、下载、解析等操作
"""
import os
import uuid
import aiofiles
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Body
from fastapi.responses import FileResponse
from typing import Optional, List
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.persistence import load_json, save_json
from app.models.schemas import (
    FileUploadResponse, 
    ParseResult, 
    NERResult, 
    NERRequest,
    FileType,
    APIResponse,
)
from app.services.file_parser import FileParser
from app.services.hybrid_ner_service import perform_hybrid_ner

router = APIRouter()

# 文件存储（磁盘持久化 + 内存缓存）
def _normalize_file_type(value):
    try:
        return FileType(value) if isinstance(value, str) else value
    except Exception:
        return value


def _load_file_store() -> dict[str, dict]:
    raw = load_json(settings.FILE_STORE_PATH, default={}) or {}
    store: dict[str, dict] = {}
    for file_id, info in raw.items():
        if not isinstance(info, dict):
            continue
        file_path = info.get("file_path")
        if file_path and not os.path.exists(file_path):
            # 原始文件不存在，跳过
            continue
        info["file_type"] = _normalize_file_type(info.get("file_type"))
        store[file_id] = info
    return store


file_store: dict[str, dict] = _load_file_store()


def persist_file_store() -> None:
    save_json(settings.FILE_STORE_PATH, file_store)


class HybridNERRequest(BaseModel):
    """混合识别请求"""
    entity_type_ids: List[str] = Field(default_factory=list, description="要识别的实体类型ID列表")
    has_mode: Optional[str] = Field(default="auto", description="HaS 模式：auto/ner/hide")


def get_file_type(filename: str) -> FileType:
    """根据文件扩展名判断文件类型"""
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".doc":
        return FileType.DOC
    elif ext == ".docx":
        return FileType.DOCX
    elif ext == ".pdf":
        return FileType.PDF
    elif ext in [".jpg", ".jpeg", ".png"]:
        return FileType.IMAGE
    else:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")


def validate_file(file: UploadFile) -> None:
    """验证上传的文件"""
    # 检查文件扩展名
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400, 
            detail=f"不支持的文件类型: {ext}，支持的类型: {settings.ALLOWED_EXTENSIONS}"
        )


@router.post("/files/upload", response_model=FileUploadResponse)
async def upload_file(file: UploadFile = File(...)):
    """
    上传文件
    
    支持的文件类型:
    - Word 文档 (.doc, .docx)
    - PDF 文档 (.pdf)
    - 图片 (.jpg, .jpeg, .png)
    """
    validate_file(file)
    
    # 生成唯一文件ID
    file_id = str(uuid.uuid4())
    file_ext = os.path.splitext(file.filename)[1].lower()
    stored_filename = f"{file_id}{file_ext}"
    file_path = os.path.join(settings.UPLOAD_DIR, stored_filename)
    
    # 保存文件
    try:
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
            file_size = len(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")
    
    # 检查文件大小
    if file_size > settings.MAX_FILE_SIZE:
        os.remove(file_path)
        raise HTTPException(
            status_code=400, 
            detail=f"文件过大，最大支持 {settings.MAX_FILE_SIZE // 1024 // 1024}MB"
        )
    
    file_type = get_file_type(file.filename)
    
    # 存储文件元信息
    file_store[file_id] = {
        "id": file_id,
        "original_filename": file.filename,
        "stored_filename": stored_filename,
        "file_path": file_path,
        "file_type": file_type,
        "file_size": file_size,
    }
    persist_file_store()
    
    return FileUploadResponse(
        file_id=file_id,
        filename=file.filename,
        file_type=file_type,
        file_size=file_size,
    )


@router.get("/files/{file_id}/parse", response_model=ParseResult)
async def parse_file(file_id: str):
    """
    解析文件内容
    
    - 对于 Word/PDF: 提取文本内容
    - 对于图片/扫描版 PDF: 标记为需要视觉处理
    """
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    file_path = file_info["file_path"]
    file_type = file_info["file_type"]
    
    parser = FileParser()
    result = await parser.parse(file_path, file_type)
    
    # 更新文件信息
    file_store[file_id].update({
        "content": result.content,
        "pages": result.pages,
        "page_count": result.page_count,
        "is_scanned": result.is_scanned,
    })
    persist_file_store()
    
    result.file_id = file_id
    return result


@router.post("/files/{file_id}/ner/hybrid", response_model=NERResult)
async def hybrid_ner_extract(
    file_id: str,
    request: HybridNERRequest = Body(default=HybridNERRequest()),
):
    """
    混合NER识别 - HaS本地模型 + 正则
    
    工作流程:
    1. Stage 1: HaS本地模型识别（替代GLM）
    2. Stage 2: 正则识别（高置信度模式匹配）
    3. Stage 3: 交叉验证 + 指代消解
    """
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    
    # 检查是否已解析
    if "content" not in file_info:
        raise HTTPException(status_code=400, detail="请先解析文件内容")
    
    # 如果是扫描件，返回空结果（需要视觉处理）
    if file_info.get("is_scanned", False):
        return NERResult(
            file_id=file_id,
            entities=[],
            entity_count=0,
            entity_summary={},
        )
    
    content = file_info["content"]
    
    # 获取实体类型配置
    from app.api.entity_types import get_enabled_types, entity_types_db
    from app.services.hybrid_ner_service import perform_hybrid_ner
    
    # 确定要识别的类型
    if request.entity_type_ids:
        entity_types = [entity_types_db[tid] for tid in request.entity_type_ids if tid in entity_types_db]
    else:
        entity_types = get_enabled_types()
    
    try:
        # 执行混合识别（HaS + 正则）
        entities = await perform_hybrid_ner(
            content,
            entity_types,
            has_mode=(request.has_mode or "ner").lower(),
        )
        
        print(f"混合识别完成，共 {len(entities)} 个实体")
        
    except Exception as e:
        print(f"混合识别失败: {e}")
        import traceback
        traceback.print_exc()
        entities = []
    
    # 统计各类型实体数量
    entity_summary = {}
    for entity in entities:
        entity_type = entity.type
        entity_summary[entity_type] = entity_summary.get(entity_type, 0) + 1
    
    # 存储识别结果
    file_store[file_id]["entities"] = entities
    persist_file_store()
    
    return NERResult(
        file_id=file_id,
        entities=entities,
        entity_count=len(entities),
        entity_summary=entity_summary,
    )


@router.get("/files/{file_id}/ner", response_model=NERResult)
async def extract_entities(file_id: str):
    """
    对文件进行命名实体识别 (NER) - 使用默认实体类型
    
    识别文档中的敏感信息:
    - 人名、机构名
    - 身份证号、电话号码
    - 地址、银行卡号
    - 案件编号等
    """
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    
    # 检查是否已解析
    if "content" not in file_info:
        raise HTTPException(status_code=400, detail="请先解析文件内容")
    
    # 如果是扫描件，返回空结果（需要视觉处理）
    if file_info.get("is_scanned", False):
        return NERResult(
            file_id=file_id,
            entities=[],
            entity_count=0,
            entity_summary={},
        )
    
    from app.api.entity_types import get_enabled_types
    entity_types = get_enabled_types()
    entities = await perform_hybrid_ner(file_info["content"], entity_types, has_mode="auto")
    
    # 统计各类型实体数量
    entity_summary = {}
    for entity in entities:
        entity_type = entity.type
        entity_summary[entity_type] = entity_summary.get(entity_type, 0) + 1
    
    # 存储识别结果
    file_store[file_id]["entities"] = entities
    persist_file_store()
    
    return NERResult(
        file_id=file_id,
        entities=entities,
        entity_count=len(entities),
        entity_summary=entity_summary,
    )


@router.post("/files/{file_id}/ner", response_model=NERResult)
async def extract_entities_with_config(
    file_id: str,
    request: NERRequest = Body(default=NERRequest()),
):
    """
    对文件进行命名实体识别 (NER) - 支持自定义实体类型
    
    可以指定:
    - entity_types: 要识别的内置实体类型列表
    - custom_entity_type_ids: 要识别的自定义实体类型ID列表
    """
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    
    # 检查是否已解析
    if "content" not in file_info:
        raise HTTPException(status_code=400, detail="请先解析文件内容")
    
    # 如果是扫描件，返回空结果（需要视觉处理）
    if file_info.get("is_scanned", False):
        return NERResult(
            file_id=file_id,
            entities=[],
            entity_count=0,
            entity_summary={},
        )
    
    from app.api.entity_types import get_enabled_types
    entity_types = get_enabled_types()
    entities = await perform_hybrid_ner(file_info["content"], entity_types, has_mode="auto")
    
    # 统计各类型实体数量
    entity_summary = {}
    for entity in entities:
        entity_type = entity.type
        entity_summary[entity_type] = entity_summary.get(entity_type, 0) + 1
    
    # 存储识别结果
    file_store[file_id]["entities"] = entities
    persist_file_store()
    
    return NERResult(
        file_id=file_id,
        entities=entities,
        entity_count=len(entities),
        entity_summary=entity_summary,
    )


@router.get("/files/{file_id}")
async def get_file_info(file_id: str):
    """获取文件信息"""
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    return file_store[file_id]


@router.get("/files/{file_id}/download")
async def download_file(file_id: str, redacted: bool = False):
    """
    下载文件
    
    - redacted=False: 下载原始文件
    - redacted=True: 下载脱敏后的文件
    """
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    
    if redacted:
        if "output_path" not in file_info:
            raise HTTPException(status_code=400, detail="文件尚未脱敏")
        file_path = file_info["output_path"]
        filename = f"redacted_{file_info['original_filename']}"
    else:
        file_path = file_info["file_path"]
        filename = file_info["original_filename"]
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )


@router.delete("/files/{file_id}")
async def delete_file(file_id: str):
    """删除文件"""
    if file_id not in file_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = file_store[file_id]
    
    # 删除原始文件
    if os.path.exists(file_info["file_path"]):
        os.remove(file_info["file_path"])
    
    # 删除脱敏后的文件
    if "output_path" in file_info and os.path.exists(file_info["output_path"]):
        os.remove(file_info["output_path"])
    
    del file_store[file_id]
    persist_file_store()
    
    return APIResponse(message="文件删除成功")
